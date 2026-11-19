import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { centsSchema, productInputSchema, type Product, type ProductImportRow } from '../shared/domain.ts';
import { parseMoney } from '../shared/quote.ts';
import { HttpError, readRecords } from './store.ts';

const csvProductSchema = productInputSchema.omit({ priceCents: true }).extend({
  price: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, '价格必须为非负金额，最多两位小数')
    .transform(parseMoney).pipe(centsSchema),
});

export function previewProductImport(db: DatabaseSync, csv: string) {
  const records = (() => {
    try {
      return parse<{ record: { sku: string; name: string; specification: string; unit: string; price: string }; info: { lines: number } }>(csv, {
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
  if (records.length === 0) throw new HttpError(400, 'CSV 至少需要表头和一行商品');
  if (records.length > 5000) throw new HttpError(400, '每次最多导入 5000 件商品');
  const existing = new Map(readRecords<Product>(db, 'products').map(product => [product.sku, product]));
  const seen = new Set<string>();
  const rows = records.map<ProductImportRow>(row => {
    const parsed = csvProductSchema.safeParse(row.record);
    if (!parsed.success) {
      return { line: row.info.lines, sku: row.record.sku, name: row.record.name, status: 'error',
        message: parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；') };
    }
    if (seen.has(parsed.data.sku)) {
      return { line: row.info.lines, sku: parsed.data.sku, name: parsed.data.name, status: 'error', message: `SKU ${parsed.data.sku} 在文件中重复` };
    }
    seen.add(parsed.data.sku);
    const product = existing.get(parsed.data.sku);
    return {
      line: row.info.lines, sku: parsed.data.sku, name: product ? product.name : parsed.data.name,
      specification: product ? product.specification : parsed.data.specification, unit: product ? product.unit : parsed.data.unit,
      priceCents: parsed.data.price, oldPriceCents: product ? product.priceCents : null,
      status: !product ? 'new' : product.priceCents === parsed.data.price ? 'unchanged' : 'update',
    };
  });
  const fingerprint = createHash('sha256').update(JSON.stringify([
    csv, rows.map(row => existing.get(row.sku) ?? null),
  ])).digest('hex');
  return { fingerprint, rows };
}
