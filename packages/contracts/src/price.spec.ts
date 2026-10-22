import { describe, expect, it } from 'vitest';
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
