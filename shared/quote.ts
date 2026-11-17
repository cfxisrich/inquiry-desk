export function parseMoney(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) throw new Error('金额必须为非负数，最多两位小数');
  const parts = value.trim().split('.');
  return Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0'));
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
}

export function quoteTotals(items: { quantity: number; unitPriceCents: number }[], shippingCents: number) {
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  return { subtotalCents, totalCents: subtotalCents + shippingCents };
}
