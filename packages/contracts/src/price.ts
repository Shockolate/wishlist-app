// Reading an item's free-text price (design §3). Only a plain "<prefix><number>" is readable;
// anything else ("about £30", "$20–30", "30 USD") stays text and is never filtered on.

export interface ParsedPrice {
  /** The prefix as written: `$`, `CA$`, `¥`. */
  currency: string;
  amount: number;
}

const READABLE_PRICE = /^([A-Za-z]*\p{Sc})(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/u;

export function parsePrice(text: string | null): ParsedPrice | null {
  const match = text === null ? null : READABLE_PRICE.exec(text.trim());
  if (!match) return null;
  const [, currency = '', whole = '', fraction = ''] = match;
  return { currency, amount: Number(`${whole.replaceAll(',', '')}${fraction}`) };
}

/** The currencies whose amounts share one scale, so one set of price bands fits them. */
export const DOLLAR_SCALE: readonly string[] = ['$', 'US$', 'CA$', 'A$', 'NZ$', '£', '€'];
