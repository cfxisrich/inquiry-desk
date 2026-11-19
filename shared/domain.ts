import { z } from 'zod';

export const statusLabels = { new: '待处理', quoting: '待报价', quoted: '已报价', won: '已成交', lost: '已丢单' } as const;
export const sourceLabels = { email: '邮件', chat: '聊天', phone: '电话', other: '其他' } as const;
export const statusSchema = z.enum(['new', 'quoting', 'quoted', 'won', 'lost']);
export const dateSchema = z.iso.date();
export const centsSchema = z.number().int().min(0).max(100_000_000);
export const productInputSchema = z.object({
  sku: z.string().trim().min(1, 'SKU 不能为空').max(80),
  name: z.string().trim().min(1, '商品名称不能为空').max(200),
  specification: z.string().trim().max(500),
  unit: z.string().trim().min(1).max(20),
  priceCents: centsSchema,
});
export const inquiryItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  model: z.string().trim().max(120),
  specification: z.string().trim().max(500),
  quantity: z.number().int().positive().max(1_000_000).nullable(),
  unit: z.string().trim().max(20),
  productId: z.string().nullable(),
});
export const inquiryInputSchema = z.object({
  customer: z.string().trim().min(1, '客户名称不能为空').max(200),
  contact: z.string().trim().max(300),
  source: z.enum(['email', 'chat', 'phone', 'other']),
  originalText: z.string().trim().max(30_000),
  notes: z.string().trim().max(3000),
  status: statusSchema,
  nextFollowUp: dateSchema.nullable(),
  items: z.array(inquiryItemSchema).max(100),
});
export const quoteInputSchema = z.object({
  inquiryId: z.string().min(1),
  sellerName: z.string().trim().min(1).max(200),
  validUntil: dateSchema,
  taxIncluded: z.boolean(),
  notes: z.string().trim().max(3000),
  shippingCents: centsSchema,
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive().max(1_000_000),
    unitPriceCents: centsSchema,
  })).min(1, '请至少添加一件商品').max(100),
});
export const followUpInputSchema = z.object({
  inquiryId: z.string().min(1), note: z.string().trim().min(1, '请输入跟进内容').max(3000),
  nextFollowUp: dateSchema.nullable(),
});
export const extractionSchema = z.object({
  customer: z.string().max(200), contact: z.string().max(300),
  items: z.array(inquiryItemSchema.omit({ productId: true })).max(100),
  missingFields: z.array(z.string().max(300)).max(30),
});
export type ProductInput = z.infer<typeof productInputSchema>;
export type Product = ProductInput & { id: string; createdAt: string; updatedAt: string };
export type ProductImportRow = (ProductInput & {
  line: number; status: 'new' | 'update' | 'unchanged'; oldPriceCents: number | null;
}) | { line: number; sku: string; name: string; status: 'error'; message: string };
export type ProductImportPreview = { fingerprint: string; rows: ProductImportRow[] };
export type ProductImportResult = { count: number; added: number; updated: number; unchanged: number };
export type InquiryInput = z.infer<typeof inquiryInputSchema>;
export type Inquiry = InquiryInput & { id: string; code: string; createdAt: string; updatedAt: string };
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type Quote = Omit<QuoteInput, 'items'> & {
  id: string; code: string; version: number; customer: string; contact: string;
  items: (QuoteInput['items'][number] & { sku: string; name: string; specification: string; unit: string })[];
  subtotalCents: number; totalCents: number; createdAt: string; sentAt: string | null;
};
export type FollowUp = z.infer<typeof followUpInputSchema> & { id: string; createdAt: string };
export type Extraction = z.infer<typeof extractionSchema>;
export type AppState = {
  products: Product[]; inquiries: Inquiry[]; quotes: Quote[]; followUps: FollowUp[];
  settings: { aiConfigured: boolean; aiModel: string; companyName: string };
};
