import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DOLLAR_SCALE, parsePrice } from './price.js';

describe('parsePrice (design §3)', () => {
  it.each([
    ['$24.99', '$', 24.99],
    ['£30.00', '£', 30],
    ['€12.50', '€', 12.5],
    ['CA$20.00', 'CA$', 20],
    ['¥1,200', '¥', 1200],
    ['$1,234', '$', 1234],
    ['  $5  ', '$', 5],
    ['$0', '$', 0],
    ['$1234', '$', 1234],
  ])('reads %s', (text, currency, amount) => {
    expect(parsePrice(text)).toEqual({ currency, amount });
  });

  it.each([
    'about £30',
    '$20–30',
    'varies',
    '30',
    '30 USD',
    'CHF 1,234.50',
    '$ 24.99',
    '$1,2345',
    '$.99',
    '-$5',
    '',
    '   ',
    null,
  ])('does not read %j', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('DOLLAR_SCALE', () => {
  it('lists the seven currencies that get a price pill', () => {
    expect(DOLLAR_SCALE).toEqual(['$', 'US$', 'CA$', 'A$', 'NZ$', '£', '€']);
  });
});

// Property tests (fast-check): prices in the readable shape, with and without thousands
// separators, and arbitrary text around and instead of them.
const currency = fc.oneof(
  fc.constantFrom(...DOLLAR_SCALE),
  fc.constantFrom('¥', '₹', '₩', 'CHF', 'kr', '$$'),
);
const priceText = fc.oneof(
  // PriceTextSchema keeps at most 50 characters, so a saved price never has more digits than this.
  fc.tuple(currency, fc.stringMatching(/^\d{1,49}$/)).map(([c, n]) => `${c}${n}`),
  fc
    .tuple(currency, fc.nat(), fc.nat({ max: 99 }))
    .map(([c, n, cents]) => `${c}${n.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`),
  fc.string(),
);

describe('parsePrice properties', () => {
  it('reads any text as null or a currency and a finite amount of zero or more', () => {
    fc.assert(
      fc.property(priceText, fc.constantFrom('', ' ', '\t'), (text, pad) => {
        const price = parsePrice(`${pad}${text}${pad}`);
        if (price === null) return;
        expect(price.currency).toMatch(/^[A-Za-z]*\p{Sc}$/u);
        expect(Number.isFinite(price.amount)).toBe(true);
        expect(price.amount).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('reads a dollar-scale price written with thousands separators back to its amount', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DOLLAR_SCALE), fc.nat({ max: 1_000_000_000 }), (c, cents) => {
        const amount = cents / 100;
        const written = amount.toLocaleString('en-US', { minimumFractionDigits: 2 });
        expect(parsePrice(`${c}${written}`)).toEqual({ currency: c, amount });
      }),
    );
  });
});
