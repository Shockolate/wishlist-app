import { describe, expect, it } from 'vitest';
import { DisplayNameSchema } from './auth.js';
import {
  CreateItemRequestSchema,
  ImageUrlSchema,
  ItemSchema,
  ItemTitleSchema,
  ItemUrlSchema,
  ItemWriteResponseSchema,
  MAX_ITEMS,
  NoteSchema,
  PriceTextSchema,
  ReorderItemsRequestSchema,
  UnfurlRequestSchema,
  UnfurlResponseSchema,
  UpdateItemRequestSchema,
  UpdateWishlistRequestSchema,
  WishlistTitleSchema,
  defaultWishlistTitle,
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

describe('item tags on the item schemas (Plan 7a rulings 1 and 4)', () => {
  it('leaves tags out of a PATCH that does not mention them, and clears them with []', () => {
    expect(UpdateItemRequestSchema.parse({})).not.toHaveProperty('tags');
    expect(UpdateItemRequestSchema.parse({ tags: [] })).toEqual({ tags: [] });
  });

  it('takes tags on a create, and leaves them out when absent', () => {
    expect(CreateItemRequestSchema.parse({ title: 'Kettle' })).not.toHaveProperty('tags');
    expect(
      CreateItemRequestSchema.parse({ title: 'Kettle', tags: [{ name: '  Home ' }] }).tags,
    ).toEqual([{ name: 'Home' }]);
  });

  it('parses an item without tagIds, and keeps them when sent', () => {
    const item = {
      id: ID,
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: null,
      note: null,
      quantity: 1,
      position: 0,
    };
    expect(ItemSchema.parse(item)).not.toHaveProperty('tagIds');
    expect(ItemSchema.parse({ ...item, tagIds: [ID] }).tagIds).toEqual([ID]);
  });

  it('gives an item write response its tags beside its tagIds', () => {
    const item = {
      id: ID,
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: null,
      note: null,
      quantity: 1,
      position: 0,
    };
    const tags = [{ id: ID, name: 'Home' }];
    expect(ItemWriteResponseSchema.parse({ ...item, tagIds: [ID], tags })).toEqual({
      ...item,
      tagIds: [ID],
      tags,
    });
    expect(ItemWriteResponseSchema.safeParse(item).success).toBe(true);
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

describe('UpdateWishlistRequestSchema (spec §5, D33)', () => {
  it('takes a title, the spoiler setting, or both', () => {
    expect(UpdateWishlistRequestSchema.parse({ title: ' Birthday ' })).toEqual({
      title: 'Birthday',
    });
    expect(UpdateWishlistRequestSchema.parse({ showClaimsToOwner: true })).toEqual({
      showClaimsToOwner: true,
    });
  });

  it.each([
    {},
    { showClaimsToOwner: 'yes' },
    { title: '' },
    { title: '  ' },
    { title: 'a'.repeat(101) },
  ])('refuses %j', (body) => {
    expect(UpdateWishlistRequestSchema.safeParse(body).success).toBe(false);
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

  it('knows LOOKUP_UNAVAILABLE, for a lookup service that can’t answer (retailer lookups §5.4)', () => {
    expect(UnfurlResponseSchema.safeParse({ failureReason: 'LOOKUP_UNAVAILABLE' }).success).toBe(
      true,
    );
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
    ['PriceTextSchema', PriceTextSchema, '$4\u00000', VISIBLE_MESSAGE],
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

// D36: a price sits beside its title in front of gifters, so it follows the same rule.
describe('PriceTextSchema: visible characters only (D36)', () => {
  it.each([['$40.00'], ['CHF\u00A024.99'], ['24,99\u202F€'], ['around £15'], ['$20–30'], ['₪120']])(
    'accepts %s',
    (price) => {
      expect(PriceTextSchema.parse(price)).toBe(price);
    },
  );

  it.each([
    ['a newline', '$40\n.00'],
    ['a tab', '$40\t.00'],
    ['a right-to-left override', '$\u202E00.04'],
    ['a zero-width space', '$4\u200B0'],
    ['a left-to-right mark', '\u200E$40'],
    ['only joiners and spaces', '\u200D \u200D'],
  ])('refuses %s with one issue', (_label, price) => {
    const result = PriceTextSchema.safeParse(price);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Use visible characters only',
    ]);
  });

  it('still stores a blank price as null', () => {
    expect(PriceTextSchema.parse('  ')).toBeNull();
  });
});

describe('blank-looking text elsewhere (D41)', () => {
  it.each([
    ['WishlistTitleSchema', WishlistTitleSchema],
    ['ItemTitleSchema', ItemTitleSchema],
    ['PriceTextSchema', PriceTextSchema],
  ] as const)('%s refuses a value that draws nothing', (_name, schema) => {
    expect(schema.safeParse('\u3164\u2800').success).toBe(false);
  });
});

describe('defaultWishlistTitle (spec §2, Plan 4a rule 11)', () => {
  it.each(['Ada', 'a'.repeat(50), '\u{1F469}‍\u{1F373} Ada', 'می‌خواهم', "O'Brien", 'Ada\u3164'])(
    'builds a valid title from the display name %j',
    (name) => {
      const title = defaultWishlistTitle(DisplayNameSchema.parse(name));
      expect(WishlistTitleSchema.parse(title)).toBe(title);
    },
  );

  it('is the title sign-up gives', () => {
    expect(defaultWishlistTitle('Ada')).toBe("Ada's wishlist");
  });
});
