import { describe, expect, it } from 'vitest';
import {
  CreateItemRequestSchema,
  ImageUrlSchema,
  ItemTitleSchema,
  ItemUrlSchema,
  MAX_ITEMS,
  NoteSchema,
  PriceTextSchema,
  ReorderItemsRequestSchema,
  UnfurlRequestSchema,
  UnfurlResponseSchema,
  UpdateItemRequestSchema,
  UpdateWishlistRequestSchema,
  WishlistTitleSchema,
} from './wishlist.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

describe('ItemUrlSchema (spec §2)', () => {
  it.each([
    ['  https://shop.example/kettle  ', 'https://shop.example/kettle'],
    ['https://shop.example/kettle\n', 'https://shop.example/kettle'],
    ['HTTPS://Shop.Example/Kettle', 'HTTPS://Shop.Example/Kettle'],
    ['http://shop.example/', 'http://shop.example/'],
  ])('accepts a pasted link %j and stores it trimmed (Plan 3a Review Focus 1)', (input, stored) => {
    expect(ItemUrlSchema.parse(input)).toBe(stored);
  });

  it.each([
    'javascript:alert(1)',
    'ftp://shop.example/file',
    'mailto:ada@example.com',
    'shop.example/kettle',
    `https://shop.example/${'a'.repeat(2048)}`,
  ])('rejects %j', (input) => {
    expect(ItemUrlSchema.safeParse(input).success).toBe(false);
  });

  it('stores a blank or null link as null (Plan 3a rule 1)', () => {
    expect(ItemUrlSchema.parse('   ')).toBeNull();
    expect(ItemUrlSchema.parse(null)).toBeNull();
  });
});

describe('ImageUrlSchema (spec §2: https only)', () => {
  it('accepts an https image', () => {
    expect(ImageUrlSchema.parse('https://cdn.example/k.jpg')).toBe('https://cdn.example/k.jpg');
  });

  it('rejects an http image', () => {
    expect(ImageUrlSchema.safeParse('http://cdn.example/k.jpg').success).toBe(false);
  });
});

describe('CreateItemRequestSchema', () => {
  it('needs only a title, and makes the quantity 1', () => {
    expect(CreateItemRequestSchema.parse({ title: '  Kettle  ' })).toEqual({
      title: 'Kettle',
      quantity: 1,
    });
  });

  it.each(['', '   ', 'a'.repeat(201)])('rejects the title %j', (title) => {
    expect(CreateItemRequestSchema.safeParse({ title }).success).toBe(false);
  });

  it.each([0, 100, 1.5, '2'])('rejects the quantity %j', (quantity) => {
    expect(CreateItemRequestSchema.safeParse({ title: 'Kettle', quantity }).success).toBe(false);
  });

  it('stores blank optional fields as null (Plan 3a rule 1)', () => {
    expect(CreateItemRequestSchema.parse({ title: 'Kettle', priceText: '  ', note: '' })).toEqual({
      title: 'Kettle',
      priceText: null,
      note: null,
      quantity: 1,
    });
  });

  it('caps the price at 50 characters and the note at 1000', () => {
    expect(
      CreateItemRequestSchema.safeParse({ title: 'K', priceText: 'a'.repeat(51) }).success,
    ).toBe(false);
    expect(CreateItemRequestSchema.safeParse({ title: 'K', note: 'a'.repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe('UpdateItemRequestSchema (Plan 3a rule 1, Review Focus 2)', () => {
  it('leaves out what was not sent, so it stays as it is', () => {
    expect(UpdateItemRequestSchema.parse({ title: 'New name' })).toEqual({ title: 'New name' });
  });

  it('turns "" and null into null, so they clear the field', () => {
    expect(UpdateItemRequestSchema.parse({ note: '', priceText: null })).toEqual({
      note: null,
      priceText: null,
    });
  });
});

describe('ReorderItemsRequestSchema', () => {
  it('takes item IDs', () => {
    expect(ReorderItemsRequestSchema.parse({ itemIds: [ID] })).toEqual({ itemIds: [ID] });
  });

  it('rejects something that is not a UUID, and more IDs than a list can hold', () => {
    expect(ReorderItemsRequestSchema.safeParse({ itemIds: ['1'] }).success).toBe(false);
    expect(
      ReorderItemsRequestSchema.safeParse({ itemIds: Array(MAX_ITEMS + 1).fill(ID) }).success,
    ).toBe(false);
  });
});

describe('UpdateWishlistRequestSchema', () => {
  it('trims the title and allows up to 100 characters', () => {
    expect(UpdateWishlistRequestSchema.parse({ title: '  Birthday  ' })).toEqual({
      title: 'Birthday',
    });
    expect(UpdateWishlistRequestSchema.safeParse({ title: 'a'.repeat(101) }).success).toBe(false);
    expect(UpdateWishlistRequestSchema.safeParse({ title: '  ' }).success).toBe(false);
  });
});

describe('UnfurlRequestSchema and UnfurlResponseSchema (spec §5, §6.8)', () => {
  it('trims the URL and caps it at 2048 characters', () => {
    expect(UnfurlRequestSchema.parse({ url: ' https://shop.example/k ' })).toEqual({
      url: 'https://shop.example/k',
    });
    expect(UnfurlRequestSchema.safeParse({ url: 'a'.repeat(2049) }).success).toBe(false);
    expect(UnfurlRequestSchema.safeParse({ url: ' ' }).success).toBe(false);
  });

  it('only knows the fixed failure codes', () => {
    expect(UnfurlResponseSchema.safeParse({ failureReason: 'UNREACHABLE' }).success).toBe(true);
    expect(UnfurlResponseSchema.safeParse({ failureReason: 'SOMETHING_ELSE' }).success).toBe(false);
  });
});

// Postgres refuses U+0000 in a text column, which turned it into a 500. It is invisible, so the
// message says what to do rather than what is wrong.
describe('a NUL character is refused in every owner text field', () => {
  const NUL_MESSAGE = 'Remove the invisible character';
  const VISIBLE_MESSAGE = 'Use visible characters only';

  it.each([
    ['WishlistTitleSchema', WishlistTitleSchema, 'Birth\u0000day', VISIBLE_MESSAGE],
    ['ItemTitleSchema', ItemTitleSchema, 'Ket\u0000tle', VISIBLE_MESSAGE],
    ['ItemUrlSchema', ItemUrlSchema, 'https://shop.example/ket\u0000tle', NUL_MESSAGE],
    ['ImageUrlSchema', ImageUrlSchema, 'https://cdn.example/ket\u0000tle.jpg', NUL_MESSAGE],
    ['PriceTextSchema', PriceTextSchema, '$4\u00000', NUL_MESSAGE],
    ['NoteSchema', NoteSchema, 'Blue\u0000 one', NUL_MESSAGE],
  ])('%s', (_name, schema, value, message) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([message]);
  });

  it('refuses a NUL in a link host, with the same message', () => {
    const result = ItemUrlSchema.safeParse('https://shop\u0000.example/kettle');
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([NUL_MESSAGE]);
  });

  it('names the field in a whole request', () => {
    const result = CreateItemRequestSchema.safeParse({ title: 'Ket\u0000tle' });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['title']]);
  });

  it('still accepts a note with a newline and a tab', () => {
    expect(NoteSchema.parse('Line one\n\tLine two')).toBe('Line one\n\tLine two');
  });
});

// D35: list and item titles follow the display-name rule (visible characters only).
describe.each([
  ['WishlistTitleSchema', WishlistTitleSchema],
  ['ItemTitleSchema', ItemTitleSchema],
])('%s: visible characters only (D35)', (_name, schema) => {
  it.each([
    ['Ein Fahrrad \u{1F6B2}'],
    ['\u{1F469}\u200D\u{1F373} Kitchen'],
    ['\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'],
  ])('accepts %s', (title) => {
    expect(schema.safeParse(title).success).toBe(true);
  });

  it.each([
    ['a newline', 'Ket\ntle'],
    ['a tab', 'Ket\ttle'],
    ['a right-to-left override', 'Kettle\u202Eelttek'],
    ['a zero-width space', 'Ket\u200Btle'],
    ['a soft hyphen', 'Ket\u00ADtle'],
    ['only joiners and spaces', '\u200D \u200D'],
  ])('refuses %s with one issue', (_label, title) => {
    const result = schema.safeParse(title);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Use visible characters only',
    ]);
  });

  it('reports an empty title once, as too short', () => {
    expect(schema.safeParse('  ').error?.issues.map((issue) => issue.code)).toEqual(['too_small']);
  });
});
