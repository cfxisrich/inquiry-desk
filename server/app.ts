import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import {
  productInputSchema, inquiryInputSchema, quoteInputSchema, followUpInputSchema, statusSchema,
  type Product, type Inquiry, type Quote, type FollowUp, type AppState,
} from '../shared/domain.ts';
import { extractInquiry, type AppConfig } from './ai.ts';
import { createQuote, HttpError, readRecord, readRecords, transaction } from './store.ts';
import { seedDemo } from './demo.ts';
import { authRouter } from './auth.ts';
import { previewProductImport } from './product-import.ts';

export function createApp(db: DatabaseSync, config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Inquiry-Request') !== '1') {
      throw new HttpError(403, '请求来源验证失败，请通过工作台操作');
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      res.status(415).json({ error: '请使用 application/json 提交数据' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', authRouter(db));

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

  app.post('/api/products/import/preview', (req, res) => {
    const input = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(req.body);
    res.json(previewProductImport(db, input.csv));
  });

  app.post('/api/products/import', (req, res) => {
    const input = z.object({ csv: z.string().min(1).max(2_000_000), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(req.body);
    const result = transaction(db, () => {
      const preview = previewProductImport(db, input.csv);
      if (input.fingerprint && preview.fingerprint !== input.fingerprint) {
        throw new HttpError(409, '商品目录或导入内容已变化，请重新预览后确认');
      }
      const errors = preview.rows.filter(row => row.status === 'error');
      if (errors.length) throw new HttpError(400, errors.map(row => `第 ${row.line} 行：${row.message}`).join('；'));
      const rows = preview.rows.filter(row => row.status !== 'error');
      const existingRow = !input.fingerprint && rows.find(row => row.status !== 'new');
      if (existingRow) throw new HttpError(409, `第 ${existingRow.line} 行：SKU ${existingRow.sku} 已存在于商品目录`);
      const now = new Date().toISOString();
      const insert = db.prepare('INSERT INTO products (id, sku, data) VALUES (?, ?, ?)');
      const update = db.prepare('UPDATE products SET data = ? WHERE sku = ?');
      const existing = new Map(readRecords<Product>(db, 'products').map(product => [product.sku, product]));
      for (const row of rows) {
        if (row.status === 'unchanged') continue;
        if (row.status === 'update') {
          update.run(JSON.stringify({ ...existing.get(row.sku)!, priceCents: row.priceCents, updatedAt: now }), row.sku);
          continue;
        }
        const product: Product = {
          id: randomUUID(), sku: row.sku, name: row.name, specification: row.specification,
          unit: row.unit, priceCents: row.priceCents, createdAt: now, updatedAt: now,
        };
        insert.run(product.id, product.sku, JSON.stringify(product));
      }
      return {
        count: rows.length, added: rows.filter(row => row.status === 'new').length,
        updated: rows.filter(row => row.status === 'update').length, unchanged: rows.filter(row => row.status === 'unchanged').length,
      };
    });
    res.status(201).json(result);
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
