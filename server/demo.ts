import type { DatabaseSync } from 'node:sqlite';
import type { Product, Inquiry, Quote, FollowUp } from '../shared/domain.ts';
import { quoteTotals } from '../shared/quote.ts';
import { HttpError, transaction } from './store.ts';

function day(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function seedDemo(db: DatabaseSync, companyName: string) {
  const now = new Date().toISOString();
  const products: Product[] = [
    { id: 'demo-p1', sku: 'BR-6204-ZZ', name: '深沟球轴承', specification: '6204-ZZ · 内径 20 mm · 双面防尘', unit: '件', priceCents: 1990, createdAt: now, updatedAt: now },
    { id: 'demo-p2', sku: 'BR-6205-2RS', name: '密封深沟球轴承', specification: '6205-2RS · 内径 25 mm · 橡胶密封', unit: '件', priceCents: 2850, createdAt: now, updatedAt: now },
    { id: 'demo-p3', sku: 'SNS-M12-NPN', name: '电感式接近开关', specification: 'M12 · NPN 常开 · 检测距离 4 mm', unit: '件', priceCents: 6800, createdAt: now, updatedAt: now },
    { id: 'demo-p4', sku: 'VAL-4V210-08', name: '气动电磁阀', specification: '4V210-08 · DC24V · G1/4 接口', unit: '件', priceCents: 9500, createdAt: now, updatedAt: now },
    { id: 'demo-p5', sku: 'CPL-LM25', name: '梅花弹性联轴器', specification: 'LM25 · 孔径 8 × 10 mm · 铝合金', unit: '件', priceCents: 4500, createdAt: now, updatedAt: now },
    { id: 'demo-p6', sku: 'BLT-HTD-5M', name: '工业同步带', specification: 'HTD 5M · 周长 500 mm · 宽 15 mm', unit: '件', priceCents: 3200, createdAt: now, updatedAt: now },
  ];
  const inquiries: Inquiry[] = [
    {
      id: 'demo-i1', code: 'IN-00001', customer: '恒川自动化', contact: '陈工 · chen@example.com', source: 'email',
      originalText: '【演示询盘】您好，我们生产线需要 6204-ZZ 轴承 200 件，以及 M12 NPN 常开接近开关 30 件，请报含税价和运费。希望下周能到货。',
      notes: '客户关注交期，报价前确认现货数量。', status: 'new', nextFollowUp: day(0),
      items: [
        { description: '深沟球轴承', model: '6204-ZZ', specification: '双面防尘', quantity: 200, unit: '件', productId: 'demo-p1' },
        { description: '接近开关', model: 'M12', specification: 'NPN 常开', quantity: 30, unit: '件', productId: 'demo-p3' },
      ], createdAt: now, updatedAt: now,
    },
    {
      id: 'demo-i2', code: 'IN-00002', customer: '远山机械', contact: '李经理 · li@example.com', source: 'chat',
      originalText: '【演示询盘】4V210-08 电磁阀需要 50 件，DC24V。请报价，月底维修用。',
      notes: '已确认接口 G1/4，等待最终报价。', status: 'quoting', nextFollowUp: day(0),
      items: [{ description: '气动电磁阀', model: '4V210-08', specification: 'DC24V · G1/4', quantity: 50, unit: '件', productId: 'demo-p4' }],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'demo-i3', code: 'IN-00003', customer: '启明精工', contact: '王工 · wang@example.com', source: 'email',
      originalText: '【演示询盘】想采购 6205-2RS 轴承 300 件，请发一份含税报价单，收货地苏州。',
      notes: '已发送报价，今天确认客户反馈。', status: 'quoted', nextFollowUp: day(-1),
      items: [{ description: '密封深沟球轴承', model: '6205-2RS', specification: '橡胶密封', quantity: 300, unit: '件', productId: 'demo-p2' }],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'demo-i4', code: 'IN-00004', customer: '青禾包装设备', contact: '周女士 · zhou@example.com', source: 'phone',
      originalText: '【演示询盘】包装机用的同步带要补货，HTD 5M，长度和数量稍后发。',
      notes: '待补充：同步带周长、宽度、采购数量。', status: 'new', nextFollowUp: day(1),
      items: [{ description: '工业同步带', model: 'HTD 5M', specification: '', quantity: null, unit: '件', productId: null }],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'demo-i5', code: 'IN-00005', customer: '云帆制造', contact: '赵工 · zhao@example.com', source: 'email',
      originalText: '【演示询盘】LM25 联轴器，8×10 孔径，100 件，请安排报价。',
      notes: '客户已确认订单，进入交付。', status: 'won', nextFollowUp: null,
      items: [{ description: '梅花弹性联轴器', model: 'LM25', specification: '孔径 8 × 10 mm', quantity: 100, unit: '件', productId: 'demo-p5' }],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'demo-i6', code: 'IN-00006', customer: '新程机电', contact: '许先生 · xu@example.com', source: 'chat',
      originalText: '【演示询盘】M12 NPN 接近开关需要 80 件，能提供报价吗？',
      notes: '已报价，客户正在内部审批。', status: 'quoted', nextFollowUp: day(2),
      items: [{ description: '电感式接近开关', model: 'M12', specification: 'NPN 常开', quantity: 80, unit: '件', productId: 'demo-p3' }],
      createdAt: now, updatedAt: now,
    },
  ];
  const quotes: Quote[] = [
    { inquiry: inquiries[2], product: products[1], quantity: 300 },
    { inquiry: inquiries[4], product: products[4], quantity: 100 },
    { inquiry: inquiries[5], product: products[2], quantity: 80 },
  ].map((entry, index) => {
    const items = [{
      productId: entry.product.id, sku: entry.product.sku, name: entry.product.name,
      specification: entry.product.specification, unit: entry.product.unit,
      quantity: entry.quantity, unitPriceCents: entry.product.priceCents,
    }];
    return {
      id: `demo-q${index + 1}`, code: `QT-${entry.inquiry.code.slice(3)}-V1`, version: 1,
      inquiryId: entry.inquiry.id, sellerName: companyName,
      customer: entry.inquiry.customer, contact: entry.inquiry.contact,
      items, shippingCents: 2000, ...quoteTotals(items, 2000), validUntil: day(14), taxIncluded: true,
      notes: '演示报价：价格有效期 14 天，交期请在确认订单时协商。', createdAt: now, sentAt: now,
    };
  });
  const followUps: FollowUp[] = [
    { id: 'demo-f1', inquiryId: 'demo-i2', note: '电话确认电压为 DC24V，接口 G1/4，按 50 件报价。', nextFollowUp: day(0), createdAt: now },
    { id: 'demo-f2', inquiryId: 'demo-i3', note: '报价已通过邮件发送，客户需要与采购负责人确认。', nextFollowUp: day(-1), createdAt: now },
    { id: 'demo-f3', inquiryId: 'demo-i5', note: '客户确认采购 100 件，已转交订单处理。', nextFollowUp: null, createdAt: now },
    { id: 'demo-f4', inquiryId: 'demo-i6', note: '客户反馈规格满足要求，预计两天后完成审批。', nextFollowUp: day(2), createdAt: now },
  ];
  transaction(db, () => {
    const count = (db.prepare('SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM inquiries) AS count').get() as { count: number }).count;
    if (count > 0) throw new HttpError(409, '已有业务数据，不能加载演示数据。请使用独立的空数据库体验演示');
    const insertProduct = db.prepare('INSERT INTO products (id, sku, data) VALUES (?, ?, ?)');
    for (const product of products) insertProduct.run(product.id, product.sku, JSON.stringify(product));
    const insertInquiry = db.prepare('INSERT INTO inquiries (id, code, data) VALUES (?, ?, ?)');
    for (const inquiry of inquiries) insertInquiry.run(inquiry.id, inquiry.code, JSON.stringify(inquiry));
    const insertQuote = db.prepare('INSERT INTO quotes (id, inquiry_id, version, data) VALUES (?, ?, ?, ?)');
    for (const quote of quotes) insertQuote.run(quote.id, quote.inquiryId, quote.version, JSON.stringify(quote));
    const insertFollowUp = db.prepare('INSERT INTO followups (id, inquiry_id, data) VALUES (?, ?, ?)');
    for (const followUp of followUps) insertFollowUp.run(followUp.id, followUp.inquiryId, JSON.stringify(followUp));
  });
}
