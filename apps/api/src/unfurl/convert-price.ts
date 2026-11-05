import { PRICE_MAX, type Price } from './metadata.js';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * A price in dollars, as display text, or null when it shouldn't be used (price conversion design
 * §5.4 steps 4 and 5). `usdPer` is units of the price's currency per 1 USD, so dollars are the amount
 * divided by it, rounded to cents. Null when the result isn't a finite number above zero after
 * rounding ("$0.00" is no price), or when the text is longer than the price cap.
 */
export function convertToUsd(price: Price, usdPer: number): string | null {
  const dollars = Math.round((Number(price.amount) / usdPer) * 100) / 100;
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const text = USD.format(dollars);
  return text.length > PRICE_MAX ? null : text;
}
