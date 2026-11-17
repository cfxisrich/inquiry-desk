import type { AppState, Quote } from '../shared/domain';

export function selectQuotes(data: AppState) {
  const latest = new Map<string, Quote>();
  for (const quote of data.quotes) {
    if (quote.version > (latest.get(quote.inquiryId)?.version ?? 0)) latest.set(quote.inquiryId, quote);
  }
  const active = new Set(data.inquiries.filter(item => item.status !== 'won' && item.status !== 'lost').map(item => item.id));
  const pending = new Set([...latest.values()].filter(quote => !quote.sentAt && active.has(quote.inquiryId)).map(quote => quote.id));
  return { latest, pending };
}
