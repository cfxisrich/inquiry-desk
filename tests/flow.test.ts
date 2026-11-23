import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { selectQuotes } from '../src/quote-selection.ts';
import { Quotes } from '../src/pages/Quotes.tsx';
import { Inquiries, FollowUps } from '../src/pages/Inquiries.tsx';
import { InquiryDetail } from '../src/pages/InquiryDetail.tsx';
import { createApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';
import type { SessionState } from '../shared/auth.ts';
import type { AppState, FollowUp, Inquiry, InquiryInput, Product, ProductImportPreview, ProductImportResult, Quote, QuoteInput } from '../shared/domain.ts';

const productInput = { sku: 'BR-6204', name: '深沟球轴承', specification: '6204-2RS / 20×47×14 mm', unit: '件', priceCents: 1990 };
const inquiryInput: InquiryInput = {
  customer: '华东设备有限公司', contact: '张经理 / sales@example.test', source: 'email',
  originalText: '需要 6204-2RS 轴承 2 件，请含税报价，运费另列。',
  notes: '', status: 'new', nextFollowUp: null, items: [], missingFields: [],
};

async function startApp(t: TestContext, path = ':memory:') {
  const db = createDatabase(path);
  const server = createApp(db, { companyName: '测试配件商', aiBaseUrl: '', aiApiKey: '', aiModel: '' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  const session = await fetch(`${base}/api/auth/session`).then(response => response.json()) as SessionState;
  const login = await fetch(`${base}/api/auth/${session.setupRequired ? 'setup' : 'login'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Inquiry-Request': '1' },
    body: JSON.stringify({ username: 'test-admin', displayName: '测试管理员', password: 'test-password-123' }),
  });
  assert.equal(login.status, session.setupRequired ? 201 : 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  return async <T>(path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Inquiry-Request': '1', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as T };
  };
}

test('报价金额、版本和快照在商品及客户变更后保持正确', async t => {
  const call = await startApp(t);
  const product = await call<Product>('/products', 'POST', productInput);
  const inquiry = await call<Inquiry>('/inquiries', 'POST', inquiryInput);
  assert.equal(product.status, 201);
  assert.equal(inquiry.status, 201);
  const input: QuoteInput = {
    inquiryId: inquiry.body.id, sellerName: '测试配件商', validUntil: '2027-01-31', taxIncluded: true,
    notes: '款到发货', shippingCents: 1000,
    items: [{ productId: product.body.id, quantity: 2, unitPriceCents: 1990 }],
  };
  const v1 = await call<Quote>('/quotes', 'POST', input);
  assert.equal(v1.status, 201);
  assert.equal(v1.body.subtotalCents, 3980);
  assert.equal(v1.body.totalCents, 4980);
  assert.equal(v1.body.version, 1);
  assert.equal(v1.body.sentAt, null);
  assert.equal(v1.body.customer, inquiryInput.customer);

  assert.equal((await call<Product>(`/products/${product.body.id}`, 'PUT', {
    ...productInput, name: '新版轴承名称', specification: '更新后的规格', priceCents: 2500,
  })).status, 200);
  assert.equal((await call<Inquiry>(`/inquiries/${inquiry.body.id}`, 'PUT', {
    ...inquiryInput, customer: '新客户名称', contact: '李经理',
    revision: (await call<Inquiry>("/inquiries/" + inquiry.body.id)).body.revision,
  })).status, 200);
  const v2 = await call<Quote>('/quotes', 'POST', {
    ...input, items: [{ productId: product.body.id, quantity: 2, unitPriceCents: 2500 }],
  });
  assert.equal(v2.status, 201);
  assert.equal(v2.body.version, 2);
  assert.equal(v2.body.totalCents, 6000);
  assert.equal(v2.body.items[0].name, '新版轴承名称');
  assert.equal(v2.body.customer, '新客户名称');
  assert.notEqual(v2.body.id, v1.body.id);
  const state = (await call<AppState>('/state')).body;
  assert.deepEqual(state.quotes.find(quote => quote.id === v1.body.id), v1.body);

  const sent = await call<Quote>(`/quotes/${v1.body.id}/sent`, 'POST', {});
  assert.equal(sent.status, 200);
  assert.ok(sent.body.sentAt);
  assert.equal((await call<AppState>('/state')).body.inquiries[0].status, 'quoted');
  assert.equal((await call(`/inquiries/${inquiry.body.id}/status`, 'PATCH', {
    status: 'won', revision: (await call<Inquiry>(`/inquiries/${inquiry.body.id}`)).body.revision,
  })).status, 200);
  const sentAgain = await call<Quote>(`/quotes/${v1.body.id}/sent`, 'POST', {});
  assert.equal(sentAgain.body.sentAt, sent.body.sentAt);
  assert.equal((await call<Quote>(`/quotes/${v2.body.id}/sent`, 'POST', {})).status, 200);
  assert.equal((await call<AppState>('/state')).body.inquiries[0].status, 'won');
});

test('CSV 按行报告错误，重复或无效的批次不会部分写入', async t => {
  const call = await startApp(t);
  const header = 'sku,name,specification,unit,price\n';
  const duplicate = await call<{ error: string }>('/products/import', 'POST', {
    csv: `${header}A,轴承,6204,件,19.90\nA,重复轴承,6205,件,25.00`,
  });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /3/);
  assert.equal((await call<AppState>('/state')).body.products.length, 0);

  const invalid = await call<{ error: string }>('/products/import', 'POST', {
    csv: `${header}A,轴承,6204,件,19.90\nB,螺栓,M8,件,-1.00`,
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /3/);
  assert.equal((await call<AppState>('/state')).body.products.length, 0);

  const imported = await call<{ count: number }>('/products/import', 'POST', {
    csv: `\uFEFF${header}A,轴承,"6204, 双面密封",件,19.90\nB,螺栓,M8,件,1.20`,
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.count, 2);
  const existing = await call<{ error: string }>('/products/import', 'POST', {
    csv: `${header}C,新商品,M10,件,2.00\nA,已有商品,6204,件,20.00`,
  });
  assert.equal(existing.status, 409);
  const state = (await call<AppState>('/state')).body;
  assert.deepEqual(state.products.map(product => product.sku).sort(), ['A', 'B']);
  assert.equal(state.products.find(product => product.sku === 'A')?.priceCents, 1990);
});

test('批量调价先预览再提交，保留商品资料与历史报价，未变商品不写入', async t => {
  const call = await startApp(t);
  const product = (await call<Product>('/products', 'POST', productInput)).body;
  const unchanged = (await call<Product>('/products', 'POST', { ...productInput, sku: 'KEEP', priceCents: 120 })).body;
  const inquiry = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const quote = (await call<Quote>('/quotes', 'POST', {
    inquiryId: inquiry.id, sellerName: '测试配件商', validUntil: '2027-01-31', taxIncluded: true,
    notes: '已议价，款到发货', shippingCents: 1000,
    items: [{ productId: product.id, quantity: 2, unitPriceCents: 1800 }],
  })).body;
  const csv = 'sku,name,specification,unit,price\nBR-6204,供应商新名称,供应商规格,箱,25.00\nKEEP,忽略名称,忽略规格,箱,1.20\nNEW,新密封圈,N10,包,3.50';
  const before = (await call<AppState>('/state')).body;
  const preview = await call<ProductImportPreview>('/products/import/preview', 'POST', { csv });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.rows.map(row => row.status), ['update', 'unchanged', 'new']);
  assert.deepEqual((await call<AppState>('/state')).body, before);
  assert.deepEqual(preview.body.rows[0], {
    line: 2, status: 'update', sku: product.sku, name: product.name, specification: product.specification,
    unit: product.unit, priceCents: 2500, oldPriceCents: 1990,
  });
  const result = await call<ProductImportResult>('/products/import', 'POST', { csv, fingerprint: preview.body.fingerprint });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { count: 3, added: 1, updated: 1, unchanged: 1 });
  const after = (await call<AppState>('/state')).body;
  const updated = after.products.find(item => item.id === product.id)!;
  assert.deepEqual(updated, { ...product, priceCents: 2500, updatedAt: updated.updatedAt });
  assert.ok(updated.updatedAt >= product.updatedAt);
  assert.deepEqual(after.products.find(item => item.id === unchanged.id), unchanged);
  assert.equal(after.products.length, 3);
  const added = after.products.find(item => item.sku === 'NEW')!;
  assert.deepEqual([added.name, added.specification, added.unit, added.priceCents], ['新密封圈', 'N10', '包', 350]);
  assert.deepEqual(after.quotes, [quote]);
});

test('导入预览同时列出重复和无效行，确认错误批次不改价也不新增', async t => {
  const call = await startApp(t);
  await call<Product>('/products', 'POST', productInput);
  const before = (await call<AppState>('/state')).body;
  const csv = 'sku,name,specification,unit,price\nBR-6204,轴承,6204,件,25.00\nNEW,新商品,N10,件,3.50\nDUP,商品一,M8,件,1.00\nDUP,商品二,M10,件,2.00\nBAD,负价格商品,M12,件,-1.00\nEMPTY,,M14,件,4.00';
  const preview = await call<ProductImportPreview>('/products/import/preview', 'POST', { csv });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.rows.filter(row => row.status === 'error').map(row => row.line), [5, 6, 7]);
  assert.deepEqual((await call<AppState>('/state')).body, before);
  const result = await call<{ error: string }>('/products/import', 'POST', { csv, fingerprint: preview.body.fingerprint });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /第 5 行/);
  assert.match(result.body.error, /第 6 行/);
  assert.match(result.body.error, /第 7 行/);
  assert.deepEqual((await call<AppState>('/state')).body, before);
});

test('预览后改价或插入同名 SKU 会阻止整批提交，重新预览后才能确认', async t => {
  const call = await startApp(t);
  const product = (await call<Product>('/products', 'POST', productInput)).body;
  const csv = 'sku,name,specification,unit,price\nBR-6204,轴承,6204,件,25.00\nNEW,新商品,N10,件,3.50';
  const first = (await call<ProductImportPreview>('/products/import/preview', 'POST', { csv })).body;
  await call(`/products/${product.id}`, 'PUT', { ...productInput, priceCents: 2200 });
  const afterEdit = (await call<AppState>('/state')).body;
  const conflict = await call<{ error: string }>('/products/import', 'POST', { csv, fingerprint: first.fingerprint });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /重新预览/);
  assert.deepEqual((await call<AppState>('/state')).body, afterEdit);

  const second = (await call<ProductImportPreview>('/products/import/preview', 'POST', { csv })).body;
  await call('/products', 'POST', { ...productInput, sku: 'NEW', name: '已人工维护的商品', priceCents: 400 });
  const afterInsert = (await call<AppState>('/state')).body;
  assert.equal((await call('/products/import', 'POST', { csv, fingerprint: second.fingerprint })).status, 409);
  assert.deepEqual((await call<AppState>('/state')).body, afterInsert);

  const current = (await call<ProductImportPreview>('/products/import/preview', 'POST', { csv })).body;
  const confirmed = await call<ProductImportResult>('/products/import', 'POST', { csv, fingerprint: current.fingerprint });
  assert.equal(confirmed.status, 201);
  assert.deepEqual(confirmed.body, { count: 2, added: 0, updated: 2, unchanged: 0 });
  const after = (await call<AppState>('/state')).body;
  assert.equal(after.products.find(item => item.id === product.id)!.priceCents, 2500);
  assert.equal(after.products.find(item => item.sku === 'NEW')!.priceCents, 350);
  assert.equal(after.products.find(item => item.sku === 'NEW')!.name, '已人工维护的商品');
});

test('无效输入和不存在的商品不能产生半份报价或无效询盘', async t => {
  const call = await startApp(t);
  assert.equal((await call('/products', 'POST', { ...productInput, priceCents: -1 })).status, 400);
  assert.equal((await call('/inquiries', 'POST', { ...inquiryInput, customer: ' ' })).status, 400);
  const product = (await call<Product>('/products', 'POST', productInput)).body;
  const inquiry = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const input = {
    inquiryId: inquiry.id, sellerName: '配件商', validUntil: '2027-01-31', taxIncluded: false,
    notes: '', shippingCents: 0, items: [{ productId: product.id, quantity: 1.5, unitPriceCents: 1990 }],
  };
  assert.equal((await call('/quotes', 'POST', input)).status, 400);
  assert.equal((await call('/quotes', 'POST', {
    ...input, items: Array.from({ length: 100 }, () => ({
      productId: product.id, quantity: 1_000_000, unitPriceCents: 100_000_000,
    })),
  })).status, 400);
  assert.equal((await call('/quotes', 'POST', {
    ...input, items: [
      { productId: product.id, quantity: 1, unitPriceCents: 1990 },
      { productId: 'missing-product', quantity: 1, unitPriceCents: 1990 },
    ],
  })).status, 404);
  assert.equal((await call('/inquiries', 'POST', {
    ...inquiryInput, items: [{ description: '轴承', model: '6204', specification: '', quantity: 2, unit: '件', productId: 'missing-product' }],
  })).status, 404);
  const state = (await call<AppState>('/state')).body;
  assert.equal(state.products.length, 1);
  assert.equal(state.inquiries.length, 1);
  assert.equal(state.quotes.length, 0);
});

test('跟进改期更新询盘，清空下一次日期后保留历史记录', async t => {
  const call = await startApp(t);
  const inquiry = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const first = await call<FollowUp>('/followups', 'POST', {
    inquiryId: inquiry.id, revision: inquiry.revision, note: '客户确认数量，周五再联系。', nextFollowUp: '2027-01-15',
  });
  assert.equal(first.status, 201);
  assert.equal((await call<AppState>('/state')).body.inquiries[0].nextFollowUp, '2027-01-15');
  assert.equal((await call('/followups', 'POST', {
    inquiryId: inquiry.id, revision: (await call<Inquiry>("/inquiries/" + inquiry.id)).body.revision,
    note: '已完成沟通，等待客户安排。', nextFollowUp: null,
  })).status, 201);
  const state = (await call<AppState>('/state')).body;
  assert.equal(state.inquiries[0].nextFollowUp, null);
  assert.equal(state.followUps.length, 2);
  assert.ok(state.followUps.some(item => item.note === first.body.note));
});

test('未配置 AI 时明确拒绝提取且不改动原始询盘', async t => {
  const call = await startApp(t);
  const inquiry = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const before = (await call<AppState>('/state')).body;
  assert.equal(before.settings.aiConfigured, false);
  const extraction = await call<{ error: string }>(`/inquiries/${inquiry.id}/extract`, 'POST', {});
  assert.equal(extraction.status, 503);
  assert.ok(extraction.body.error.length > 0);
  assert.deepEqual((await call<AppState>('/state')).body, before);
});

test('关闭数据库后重新打开，商品、询盘、报价和跟进仍然存在', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'inquiry-desk-test-'));
  const databasePath = join(directory, 'inquiry.sqlite');
  t.after(() => rmSync(directory, { recursive: true }));
  await t.test('通过 HTTP 写入真实 SQLite 文件', async t => {
    const call = await startApp(t, databasePath);
    const product = (await call<Product>('/products', 'POST', productInput)).body;
    const inquiry = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
    assert.equal((await call('/inquiries/' + inquiry.id, 'PUT', {
      ...inquiry, missingFields: ['请确认交期', '请确认付款方式'],
    })).status, 200);
    assert.equal((await call('/quotes', 'POST', {
      inquiryId: inquiry.id, sellerName: '持久化测试', validUntil: '2027-01-31', taxIncluded: true,
      shippingCents: 1000, notes: '重启后保留', items: [{ productId: product.id, quantity: 2, unitPriceCents: 1990 }],
    })).status, 201);
    assert.equal((await call('/followups', 'POST', {
      inquiryId: inquiry.id, revision: (await call<Inquiry>("/inquiries/" + inquiry.id)).body.revision,
      note: '重启前的沟通记录', nextFollowUp: '2027-01-15',
    })).status, 201);
  });
  await t.test('新的服务实例读到已保存内容', async t => {
    const call = await startApp(t, databasePath);
    const state = (await call<AppState>('/state')).body;
    assert.equal(state.products[0].sku, productInput.sku);
    assert.equal(state.inquiries[0].originalText, inquiryInput.originalText);
    assert.equal(state.inquiries[0].nextFollowUp, '2027-01-15');
    assert.deepEqual(state.inquiries[0].missingFields, ['请确认交期', '请确认付款方式']);
    assert.equal(state.inquiries[0].revision, 4);
    assert.equal(state.quotes[0].totalCents, 4980);
    assert.equal(state.quotes[0].notes, '重启后保留');
    assert.equal(state.followUps[0].note, '重启前的沟通记录');
  });
});

test('演示数据仅按用户操作载入空数据库，重复载入不改变数据', async t => {
  const call = await startApp(t);
  assert.equal((await call<AppState>('/state')).body.inquiries.length, 0);
  const demo = await call('/demo', 'POST', {});
  assert.ok(demo.status === 200 || demo.status === 201);
  const state = (await call<AppState>('/state')).body;
  assert.ok(state.products.length > 0);
  assert.ok(state.inquiries.length > 0);
  assert.ok(state.quotes.length > 0);
  assert.equal((await call('/demo', 'POST', {})).status, 409);
  assert.deepEqual((await call<AppState>('/state')).body, state);
});


test('待发送仅包含进行中询盘的最新未发送版本，列表保留完整历史', async t => {
  const call = await startApp(t);
  const product = (await call<Product>('/products', 'POST', productInput)).body;
  const active = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const won = (await call<Inquiry>('/inquiries', 'POST', { ...inquiryInput, status: 'won' })).body;
  const lost = (await call<Inquiry>('/inquiries', 'POST', { ...inquiryInput, status: 'lost' })).body;
  const input = {
    inquiryId: active.id, sellerName: '配件商', validUntil: '2027-01-31', taxIncluded: true,
    notes: '', shippingCents: 0, items: [{ productId: product.id, quantity: 1, unitPriceCents: 1990 }],
  };
  const old = (await call<Quote>('/quotes', 'POST', input)).body;
  const latest = (await call<Quote>('/quotes', 'POST', input)).body;
  await call('/quotes', 'POST', { ...input, inquiryId: won.id });
  await call('/quotes', 'POST', { ...input, inquiryId: lost.id });
  const data = (await call<AppState>('/state')).body;
  assert.deepEqual([...selectQuotes(data).pending], [latest.id]);
  assert.equal(selectQuotes({ ...data, quotes: [...data.quotes].reverse() }).latest.get(active.id)?.id, latest.id);
  const pending = renderToStaticMarkup(createElement(Quotes, { data, initialFilter: 'unsent' }));
  assert.match(pending, new RegExp(`href="#quote/${latest.id}"`));
  assert.doesNotMatch(pending, new RegExp(`href="#quote/${old.id}"`));
  assert.equal((pending.match(/class="quote-code"/g) ?? []).length, 1);
  assert.equal((renderToStaticMarkup(createElement(Quotes, { data })).match(/class="quote-code"/g) ?? []).length, 4);
  await call(`/quotes/${latest.id}/sent`, 'POST', {});
  assert.equal(selectQuotes((await call<AppState>('/state')).body).pending.size, 0);
});

test('询盘筛选和今日跟进只渲染对应客户', async t => {
  const call = await startApp(t);
  await call('/demo', 'POST', {});
  const data = (await call<AppState>('/state')).body;
  const won = renderToStaticMarkup(createElement(Inquiries, { data, initialFilter: 'won' }));
  assert.match(won, /云帆制造/);
  assert.doesNotMatch(won, /恒川自动化|青禾包装设备/);
  const due = renderToStaticMarkup(createElement(FollowUps, { data, dueOnly: true }));
  assert.match(due, /恒川自动化/);
  assert.match(due, /启明精工/);
  assert.doesNotMatch(due, /青禾包装设备|新程机电|云帆制造/);
});

test('空搜索不展开整个商品目录，型号候选优先精确匹配并保留已选商品', async t => {
  const call = await startApp(t);
  await call('/demo', 'POST', {});
  const data = (await call<AppState>('/state')).body;
  const inquiry = data.inquiries.find(item => item.id === 'demo-i4')!;
  data.products = Array.from({ length: 5000 }, (_, index) => ({
    ...data.products[0], id: `product-${index}`, sku: `MODEL-${index}`, specification: '',
  }));
  inquiry.items[0] = { ...inquiry.items[0], model: '', productId: 'product-4999' };
  const empty = renderToStaticMarkup(createElement(InquiryDetail, { data, inquiry, isNew: false, refresh: async () => {}, onDirtyChange: () => {} }));
  assert.match(empty, /value="product-4999"/);
  assert.doesNotMatch(empty, /value="product-0"/);
  inquiry.items[0] = { ...inquiry.items[0], model: ' model-49 ', productId: null };
  const matched = renderToStaticMarkup(createElement(InquiryDetail, { data, inquiry, isNew: false, refresh: async () => {}, onDirtyChange: () => {} }));
  assert.equal((matched.match(/<option value="product-/g) ?? []).length, 3);
  assert.ok(matched.indexOf('<option value="product-49"') < matched.indexOf('<option value="product-490"'));
});


test('两个编辑副本保存时校验版本，旧内容不能覆盖新内容或写入跟进', async t => {
  const call = await startApp(t);
  const created = (await call<Inquiry>('/inquiries', 'POST', inquiryInput)).body;
  const firstEditor = (await call<Inquiry>(`/inquiries/${created.id}`)).body;
  const secondEditor = (await call<Inquiry>(`/inquiries/${created.id}`)).body;
  assert.equal(firstEditor.revision, 1);
  assert.deepEqual(secondEditor, firstEditor);
  const saved = await call<Inquiry>(`/inquiries/${created.id}`, 'PUT', {
    ...firstEditor, notes: '第一位业务员的新备注', missingFields: ['请确认交期'],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  const current = (await call<AppState>('/state')).body;
  const staleSave = await call<{ error: string }>(`/inquiries/${created.id}`, 'PUT', {
    ...secondEditor, notes: '第二位业务员的旧草稿', missingFields: [],
  });
  assert.equal(staleSave.status, 409);
  assert.ok(staleSave.body.error.length > 0);
  assert.equal((await call(`/inquiries/${created.id}/status`, 'PATCH', {
    status: 'lost', revision: secondEditor.revision,
  })).status, 409);
  assert.equal((await call('/followups', 'POST', {
    inquiryId: created.id, revision: secondEditor.revision, note: '旧页面的跟进', nextFollowUp: '2027-02-01',
  })).status, 409);
  assert.deepEqual((await call<AppState>('/state')).body, current);
  assert.equal((await call(`/inquiries/${created.id}`, 'PUT', inquiryInput)).status, 400);
  assert.equal((await call(`/inquiries/${created.id}/status`, 'PATCH', { status: 'lost' })).status, 400);
  assert.equal((await call('/followups', 'POST', {
    inquiryId: created.id, note: '未提供版本', nextFollowUp: null,
  })).status, 400);
  assert.deepEqual((await call<AppState>('/state')).body, current);
  const resolved = await call<Inquiry>(`/inquiries/${created.id}`, 'PUT', {
    ...saved.body, notes: '重新核对后的内容', missingFields: [],
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.revision, 3);
  assert.deepEqual((await call<Inquiry>(`/inquiries/${created.id}`)).body, resolved.body);
});

test('生成报价、标记发送和记录跟进会使旧询盘编辑版本失效', async t => {
  const call = await startApp(t);
  const product = (await call<Product>('/products', 'POST', productInput)).body;
  const initial = (await call<Inquiry>('/inquiries', 'POST', { ...inquiryInput, missingFields: ['请确认收货地址'] })).body;
  const quote = await call<Quote>('/quotes', 'POST', {
    inquiryId: initial.id, sellerName: '配件商', validUntil: '2027-01-31', taxIncluded: true,
    shippingCents: 0, notes: '', items: [{ productId: product.id, quantity: 2, unitPriceCents: 1990 }],
  });
  assert.equal(quote.status, 201);
  const afterQuote = (await call<Inquiry>(`/inquiries/${initial.id}`)).body;
  assert.equal(afterQuote.status, 'quoting');
  assert.equal(afterQuote.revision, initial.revision + 1);
  assert.equal((await call(`/inquiries/${initial.id}`, 'PUT', initial)).status, 409);
  assert.equal((await call(`/quotes/${quote.body.id}/sent`, 'POST', {})).status, 200);
  const afterSent = (await call<Inquiry>(`/inquiries/${initial.id}`)).body;
  assert.equal(afterSent.status, 'quoted');
  assert.equal(afterSent.revision, afterQuote.revision + 1);
  assert.equal((await call(`/inquiries/${initial.id}`, 'PUT', afterQuote)).status, 409);
  assert.equal((await call(`/quotes/${quote.body.id}/sent`, 'POST', {})).status, 200);
  assert.deepEqual((await call<Inquiry>(`/inquiries/${initial.id}`)).body, afterSent);
  assert.equal((await call('/followups', 'POST', {
    inquiryId: initial.id, revision: afterSent.revision, note: '客户希望月底交付', nextFollowUp: '2027-01-20',
  })).status, 201);
  const afterFollowUp = (await call<Inquiry>(`/inquiries/${initial.id}`)).body;
  assert.equal(afterFollowUp.revision, afterSent.revision + 1);
  assert.equal(afterFollowUp.nextFollowUp, '2027-01-20');
  assert.deepEqual(afterFollowUp.missingFields, initial.missingFields);
  assert.equal((await call(`/inquiries/${initial.id}`, 'PUT', afterSent)).status, 409);
  assert.deepEqual((await call<Inquiry>(`/inquiries/${initial.id}`)).body, afterFollowUp);
  assert.equal((await call<AppState>('/state')).body.followUps.length, 1);
});

test('旧库询盘补齐版本和待确认项，已有版本与原始内容保持不变', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'inquiry-revision-test-'));
  const databasePath = join(directory, 'inquiry.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec('CREATE TABLE inquiries (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK (json_valid(data))) STRICT');
  const oldInquiry = {
    id: 'old-inquiry', code: 'IN-00001', customer: '历史客户', contact: '张经理', source: 'email',
    originalText: '原始询盘内容', notes: '迁移前的备注', status: 'quoted', nextFollowUp: '2027-01-15',
    items: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  };
  const existing = { ...oldInquiry, id: 'versioned-inquiry', code: 'IN-00002', revision: 7, missingFields: ['已有待确认事项'] };
  legacy.prepare('INSERT INTO inquiries (id, code, data) VALUES (?, ?, ?)').run(oldInquiry.id, oldInquiry.code, JSON.stringify(oldInquiry));
  legacy.prepare('INSERT INTO inquiries (id, code, data) VALUES (?, ?, ?)').run(existing.id, existing.code, JSON.stringify(existing));
  legacy.close();
  const call = await startApp(t, databasePath);
  t.after(() => rmSync(directory, { recursive: true }));
  assert.deepEqual((await call<Inquiry>(`/inquiries/${oldInquiry.id}`)).body, { ...oldInquiry, revision: 1, missingFields: [] });
  assert.deepEqual((await call<Inquiry>(`/inquiries/${existing.id}`)).body, existing);
  const state = (await call<AppState>('/state')).body;
  assert.equal(state.inquiries.length, 2);
  assert.equal(state.quotes.length, 0);
  assert.equal(state.followUps.length, 0);
});
