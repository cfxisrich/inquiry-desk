import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Inquiry, Product, Quote, QuoteInput } from '../shared/domain.ts';
import { quoteTotals } from '../shared/quote.ts';

type Table = 'products' | 'inquiries' | 'quotes' | 'followups';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function readRecords<T>(db: DatabaseSync, table: Table) {
  return (db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all() as { data: string }[])
    .map(row => JSON.parse(row.data) as T);
}

export function readRecord<T>(db: DatabaseSync, table: Table, id: string) {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
  if (!row) throw new HttpError(404, '找不到这条记录');
  return JSON.parse(row.data) as T;
}

export function transaction<T>(db: DatabaseSync, action: () => T) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createQuote(db: DatabaseSync, input: QuoteInput) {
  const totals = quoteTotals(input.items, input.shippingCents);
  if (!Number.isSafeInteger(totals.totalCents)) throw new HttpError(400, '报价总额超出可准确计算的范围');
  return transaction(db, () => {
    const inquiry = readRecord<Inquiry>(db, 'inquiries', input.inquiryId);
    const items = input.items.map(item => {
      const product = readRecord<Product>(db, 'products', item.productId);
      return { ...item, sku: product.sku, name: product.name, specification: product.specification, unit: product.unit };
    });
    const version = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM quotes WHERE inquiry_id = ?')
      .get(input.inquiryId) as { version: number }).version + 1;
    const quote: Quote = {
      ...input, id: randomUUID(), code: `QT-${inquiry.code.slice(3)}-V${version}`, version,
      customer: inquiry.customer, contact: inquiry.contact, items,
      ...totals, createdAt: new Date().toISOString(), sentAt: null,
    };
    db.prepare('INSERT INTO quotes (id, inquiry_id, version, data) VALUES (?, ?, ?, ?)')
      .run(quote.id, quote.inquiryId, quote.version, JSON.stringify(quote));
    if (inquiry.status === 'new') {
      db.prepare('UPDATE inquiries SET data = ? WHERE id = ?')
        .run(JSON.stringify({ ...inquiry, status: 'quoting', revision: inquiry.revision + 1, updatedAt: quote.createdAt }), inquiry.id);
    }
    return quote;
  });
}
