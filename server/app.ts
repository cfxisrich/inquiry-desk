import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z, ZodError } from 'zod';
import {
  centsSchema, productInputSchema, inquiryInputSchema, quoteInputSchema, followUpInputSchema, statusSchema,
  type Product, type Inquiry, type Quote, type FollowUp, type AppState,
} from '../shared/domain.ts';
import { parseMoney } from '../shared/quote.ts';
import { extractInquiry, type AppConfig } from './ai.ts';
import { createQuote, HttpError, readRecord, readRecords, transaction } from './store.ts';
import { seedDemo } from './demo.ts';

const csvProductSchema = productInputSchema.omit({ priceCents: true }).extend({
  price: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, '价格必须为非负金额，最多两位小数')
    .transform(parseMoney).pipe(centsSchema),
});

export function createApp(db: DatabaseSync, config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      res.status(415).json({ error: '请使用 application/json 提交数据' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/state', (_req, res) => {
    const state: AppState = {
      products: readRecords<Product>(db, 'products'),
      inquiries: readRecords<Inquiry>(db, 'inquiries'),
      quotes: readRecords<Quote>(db, 'quotes'),
      followUps: readRecords<FollowUp>(db, 'followups'),
      settings: {
        aiConfigured: Boolean(config.aiApiKey && config.aiModel),
        aiModel: config.aiModel, companyName: config.companyName,
      },
    };
    res.json(state);
  });

  app.post('/api/products', (req, res) => {
    const input = productInputSchema.parse(req.body);
    if (db.prepare('SELECT id FROM products WHERE sku = ?').get(input.sku)) throw new HttpError(409, '该 SKU 已存在');
    const now = new Date().toISOString();
    const product: Product = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    db.prepare('INSERT INTO products (id, sku, data) VALUES (?, ?, ?)').run(product.id, product.sku, JSON.stringify(product));
    res.status(201).json(product);
  });

  app.put('/api/products/:id', (req, res) => {
    const input = productInputSchema.parse(req.body);
    const original = readRecord<Product>(db, 'products', req.params.id);
    if (db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(input.sku, original.id)) {
      throw new HttpError(409, '该 SKU 已被其他商品使用');
    }
    const product: Product = { ...original, ...input, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE products SET sku = ?, data = ? WHERE id = ?').run(product.sku, JSON.stringify(product), product.id);
    res.json(product);
  });

  app.post('/api/products/import', (req, res) => {
    const input = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(req.body);
    const rows = (() => {
      try {
        return parse<{ record: { sku: string; name: string; specification: string; unit: string; price: string }; info: { lines: number } }>(input.csv, {
          bom: true, skip_empty_lines: true, trim: true, info: true,
          columns: (header: string[]) => {
            if (header.join(',') !== 'sku,name,specification,unit,price') {
              throw new HttpError(400, '第 1 行表头必须为 sku,name,specification,unit,price，请使用导入模板');
            }
            return header;
          },
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'CSV 格式无法解析，请检查引号、分隔符和每行的列数');
      }
    })();
    if (rows.length === 0) throw new HttpError(400, 'CSV 至少需要表头和一行商品');
    if (rows.length > 5000) throw new HttpError(400, '每次最多导入 5000 件商品');
    const seen = new Set<string>();
    const existing = new Set(readRecords<Product>(db, 'products').map(product => product.sku));
    const now = new Date().toISOString();
    const products = rows.map(row => {
      const parsed = csvProductSchema.safeParse(row.record);
      if (!parsed.success) {
        throw new HttpError(400, `第 ${row.info.lines} 行：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
      }
      if (seen.has(parsed.data.sku)) throw new HttpError(400, `第 ${row.info.lines} 行：SKU ${parsed.data.sku} 在文件中重复`);
      if (existing.has(parsed.data.sku)) throw new HttpError(409, `第 ${row.info.lines} 行：SKU ${parsed.data.sku} 已存在于商品目录`);
      seen.add(parsed.data.sku);
      const product: Product = {
        id: randomUUID(), sku: parsed.data.sku, name: parsed.data.name, specification: parsed.data.specification,
        unit: parsed.data.unit, priceCents: parsed.data.price, createdAt: now, updatedAt: now,
      };
      return product;
    });
    transaction(db, () => {
      const statement = db.prepare('INSERT INTO products (id, sku, data) VALUES (?, ?, ?)');
      for (const product of products) statement.run(product.id, product.sku, JSON.stringify(product));
    });
    res.status(201).json({ count: products.length });
  });

  app.post('/api/inquiries', (req, res) => {
    const input = inquiryInputSchema.parse(req.body);
    for (const item of input.items) {
      if (item.productId !== null) readRecord<Product>(db, 'products', item.productId);
    }
    const now = new Date().toISOString();
    const serial = (db.prepare('SELECT COUNT(*) AS count FROM inquiries').get() as { count: number }).count + 1;
    const inquiry: Inquiry = {
      ...input, id: randomUUID(), code: `IN-${String(serial).padStart(5, '0')}`, createdAt: now, updatedAt: now,
    };
    db.prepare('INSERT INTO inquiries (id, code, data) VALUES (?, ?, ?)').run(inquiry.id, inquiry.code, JSON.stringify(inquiry));
    res.status(201).json(inquiry);
  });

  app.put('/api/inquiries/:id', (req, res) => {
    const input = inquiryInputSchema.parse(req.body);
    const original = readRecord<Inquiry>(db, 'inquiries', req.params.id);
    for (const item of input.items) {
      if (item.productId !== null) readRecord<Product>(db, 'products', item.productId);
    }
    const inquiry: Inquiry = { ...original, ...input, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE inquiries SET data = ? WHERE id = ?').run(JSON.stringify(inquiry), inquiry.id);
    res.json(inquiry);
  });

  app.patch('/api/inquiries/:id/status', (req, res) => {
    const input = z.object({ status: statusSchema }).parse(req.body);
    const original = readRecord<Inquiry>(db, 'inquiries', req.params.id);
    const inquiry: Inquiry = { ...original, status: input.status, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE inquiries SET data = ? WHERE id = ?').run(JSON.stringify(inquiry), inquiry.id);
    res.json(inquiry);
  });

  app.post('/api/inquiries/:id/extract', async (req, res) => {
    const inquiry = readRecord<Inquiry>(db, 'inquiries', req.params.id);
    res.json(await extractInquiry(inquiry.originalText, config));
  });

  app.post('/api/quotes', (req, res) => {
    res.status(201).json(createQuote(db, quoteInputSchema.parse(req.body)));
  });

  app.post('/api/quotes/:id/sent', (req, res) => {
    const original = readRecord<Quote>(db, 'quotes', req.params.id);
    if (original.sentAt) {
      res.json(original);
      return;
    }
    const quote = { ...original, sentAt: new Date().toISOString() };
    transaction(db, () => {
      db.prepare('UPDATE quotes SET data = ? WHERE id = ?').run(JSON.stringify(quote), quote.id);
      const inquiry = readRecord<Inquiry>(db, 'inquiries', quote.inquiryId);
      if (inquiry.status !== 'won' && inquiry.status !== 'lost') {
        db.prepare('UPDATE inquiries SET data = ? WHERE id = ?')
          .run(JSON.stringify({ ...inquiry, status: 'quoted', updatedAt: quote.sentAt }), inquiry.id);
      }
    });
    res.json(quote);
  });

  app.post('/api/followups', (req, res) => {
    const input = followUpInputSchema.parse(req.body);
    const inquiry = readRecord<Inquiry>(db, 'inquiries', input.inquiryId);
    const followUp: FollowUp = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    transaction(db, () => {
      db.prepare('INSERT INTO followups (id, inquiry_id, data) VALUES (?, ?, ?)')
        .run(followUp.id, followUp.inquiryId, JSON.stringify(followUp));
      db.prepare('UPDATE inquiries SET data = ? WHERE id = ?')
        .run(JSON.stringify({ ...inquiry, nextFollowUp: input.nextFollowUp, updatedAt: followUp.createdAt }), inquiry.id);
    });
    res.status(201).json(followUp);
  });

  app.post('/api/demo', (_req, res) => {
    seedDemo(db, config.companyName);
    res.status(201).json({ ok: true });
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: '接口不存在' }); });
  const dist = resolve(import.meta.dirname, '../dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => { res.sendFile(resolve(dist, 'index.html')); });
  }

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；') });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: '请求中的 JSON 格式不正确' });
      return;
    }
    if (error instanceof Error && 'status' in error && error.status === 413) {
      res.status(413).json({ error: '提交内容过大，请控制在 2 MB 以内' });
      return;
    }
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: '服务器处理失败，请检查服务端日志后重试' });
  };
  app.use(handleError);
  return app;
}
