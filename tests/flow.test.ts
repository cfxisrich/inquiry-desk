import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';
import type { AppState, FollowUp, Inquiry, InquiryInput, Product, Quote, QuoteInput } from '../shared/domain.ts';

const productInput = { sku: 'BR-6204', name: '深沟球轴承', specification: '6204-2RS / 20×47×14 mm', unit: '件', priceCents: 1990 };
const inquiryInput: InquiryInput = {
  customer: '华东设备有限公司', contact: '张经理 / sales@example.test', source: 'email',
  originalText: '需要 6204-2RS 轴承 2 件，请含税报价，运费另列。',
  notes: '', status: 'new', nextFollowUp: null, items: [],
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
  return async <T>(path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
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
  assert.equal((await call(`/inquiries/${inquiry.body.id}/status`, 'PATCH', { status: 'won' })).status, 200);
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
    inquiryId: inquiry.id, note: '客户确认数量，周五再联系。', nextFollowUp: '2027-01-15',
  });
  assert.equal(first.status, 201);
  assert.equal((await call<AppState>('/state')).body.inquiries[0].nextFollowUp, '2027-01-15');
  assert.equal((await call('/followups', 'POST', {
    inquiryId: inquiry.id, note: '已完成沟通，等待客户安排。', nextFollowUp: null,
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
    assert.equal((await call('/quotes', 'POST', {
      inquiryId: inquiry.id, sellerName: '持久化测试', validUntil: '2027-01-31', taxIncluded: true,
      shippingCents: 1000, notes: '重启后保留', items: [{ productId: product.id, quantity: 2, unitPriceCents: 1990 }],
    })).status, 201);
    assert.equal((await call('/followups', 'POST', {
      inquiryId: inquiry.id, note: '重启前的沟通记录', nextFollowUp: '2027-01-15',
    })).status, 201);
  });
  await t.test('新的服务实例读到已保存内容', async t => {
    const call = await startApp(t, databasePath);
    const state = (await call<AppState>('/state')).body;
    assert.equal(state.products[0].sku, productInput.sku);
    assert.equal(state.inquiries[0].originalText, inquiryInput.originalText);
    assert.equal(state.inquiries[0].nextFollowUp, '2027-01-15');
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
