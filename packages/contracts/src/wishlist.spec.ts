import { describe, expect, it } from 'vitest';
import {
  CreateItemRequestSchema,
  ImageUrlSchema,
  ItemUrlSchema,
  MAX_ITEMS,
  ReorderItemsRequestSchema,
  UnfurlRequestSchema,
  UnfurlResponseSchema,
  UpdateItemRequestSchema,
  UpdateWishlistRequestSchema,
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
