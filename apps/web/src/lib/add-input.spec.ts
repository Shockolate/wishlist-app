import type { Item } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { classifyAddInput, fillEmpty, formValuesOf, pastedLink, prefill } from './add-input';

describe('classifyAddInput (Plan 3b rule 5)', () => {
  it('asks for something when the box is empty', () => {
    expect(classifyAddInput('')).toEqual({ kind: 'empty' });
    expect(classifyAddInput(' \t ')).toEqual({ kind: 'empty' });
  });

  it.each([
    ['https://shop.example/kettle', 'https://shop.example/kettle'],
    ['  https://shop.example/kettle  ', 'https://shop.example/kettle'],
    ['HTTPS://Shop.example/K', 'HTTPS://Shop.example/K'],
    ['http://shop.example', 'http://shop.example'],
  ])('reads %j as a link', (text, url) => {
    expect(classifyAddInput(text)).toEqual({ kind: 'link', url, titleHint: null });
  });

  it('finds the link in text a phone app shared, and keeps the rest as a title hint (Review Focus 1)', () => {
    expect(classifyAddInput('Garmin Approach CT10 https://a.co/d/xyz')).toEqual({
      kind: 'link',
      url: 'https://a.co/d/xyz',
      titleHint: 'Garmin Approach CT10',
    });
    expect(classifyAddInput('Look at this:\nhttps://a.co/d/xyz\n  Garmin  ')).toEqual({
      kind: 'link',
      url: 'https://a.co/d/xyz',
      titleHint: 'Look at this: Garmin',
    });
    // A text input drops the newline between the title and the link when it's pasted.
    expect(classifyAddInput('Garmin CT10https://a.co/d/xyz')).toMatchObject({
      url: 'https://a.co/d/xyz',
      titleHint: 'Garmin CT10',
    });
  });

  it.each([
    ['etsy.com/listing/123', 'https://etsy.com/listing/123'],
    ['www.shop.example', 'https://www.shop.example'],
    ['shop.example:8080/x?y=1', 'https://shop.example:8080/x?y=1'],
    ['Mr.Smith', 'https://Mr.Smith'],
  ])('adds https:// to %j, which looks like a shop address', (text, url) => {
    expect(classifyAddInput(text)).toEqual({ kind: 'link', url, titleHint: null });
  });

  it('refuses a link with another scheme', () => {
    expect(classifyAddInput('ftp://files.example/kettle')).toEqual({ kind: 'other-scheme' });
  });

  it.each(['a pottery class', 'e.g. socks', 'v1.2', 'javascript:alert(1)', 'http://'])(
    'reads %j as an idea',
    (text) => {
      expect(classifyAddInput(text)).toEqual({ kind: 'idea', title: text });
    },
  );
});

describe('prefill and formValuesOf (Plan 3b rules 6 and 7)', () => {
  it('fills the form from unfurl, then from the title hint, keeping the link', () => {
    expect(
      prefill('https://shop.example/k', 'Hint', {
        title: 'Kettle',
        imageUrl: 'https://cdn.example/k.jpg',
        priceText: '$40.00',
      }),
    ).toEqual({
      title: 'Kettle',
      url: 'https://shop.example/k',
      imageUrl: 'https://cdn.example/k.jpg',
      priceText: '$40.00',
      note: '',
      quantity: 1,
      tags: [],
    });
    expect(
      prefill('https://shop.example/k', 'Hint', { failureReason: 'BLOCKED_BY_SITE' }),
    ).toMatchObject({ title: 'Hint', url: 'https://shop.example/k', imageUrl: '' });
    expect(prefill('https://shop.example/k', null, null).title).toBe('');
  });

  it('turns an item’s nulls into empty fields', () => {
    const item: Item = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: '$40',
      note: null,
      quantity: 2,
      position: 0,
    };
    expect(formValuesOf(item)).toEqual({
      title: 'Kettle',
      url: '',
      imageUrl: '',
      priceText: '$40',
      note: '',
      quantity: 2,
      tags: [],
    });
  });

  it('turns an item’s tagIds into chosen tags', () => {
    const item: Item = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: null,
      note: null,
      quantity: 1,
      position: 0,
      tagIds: ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'],
    };
    expect(formValuesOf(item).tags).toEqual([
      { id: '00000000-0000-4000-8000-0000000000a1' },
      { id: '00000000-0000-4000-8000-0000000000a2' },
    ]);
  });
});

describe('pastedLink (D117)', () => {
  it('reads a pasted link, and what a phone app shared with it', () => {
    expect(pastedLink('https://shop.example/k')).toEqual({
      url: 'https://shop.example/k',
      titleHint: null,
    });
    expect(pastedLink('Garmin CT10 https://a.co/d/xyz')).toEqual({
      url: 'https://a.co/d/xyz',
      titleHint: 'Garmin CT10',
    });
    expect(pastedLink('shop.example/k')).toEqual({
      url: 'https://shop.example/k',
      titleHint: null,
    });
  });

  it('reads nothing from text that isn’t a link, or a link too long to save', () => {
    expect(pastedLink('')).toBeNull();
    expect(pastedLink('a blue rain jacket')).toBeNull();
    expect(pastedLink('ftp://shop.example/k')).toBeNull();
    expect(pastedLink(`https://shop.example/${'k'.repeat(2048)}`)).toBeNull();
  });
});

describe('fillEmpty (D117)', () => {
  const empty = { title: '', imageUrl: '', priceText: '' };
  const page = { title: 'Kettle', imageUrl: 'https://cdn.example/k.jpg', priceText: '$40.00' };

  it('fills every empty field the page has a value for', () => {
    expect(fillEmpty(empty, page, null)).toEqual(page);
    expect(fillEmpty(empty, { title: 'Kettle' }, null)).toEqual({ title: 'Kettle' });
  });

  it('never replaces what the owner typed, counting spaces alone as empty', () => {
    expect(
      fillEmpty({ title: 'Blue kettle', imageUrl: ' ', priceText: '$35' }, page, null),
    ).toEqual({ imageUrl: 'https://cdn.example/k.jpg' });
  });

  it('titles the item from the shared text when the page gives no title', () => {
    expect(fillEmpty(empty, { priceText: '$40.00' }, 'Garmin CT10')).toEqual({
      title: 'Garmin CT10',
      priceText: '$40.00',
    });
    expect(fillEmpty(empty, null, 'Garmin CT10')).toEqual({ title: 'Garmin CT10' });
    expect(fillEmpty(empty, page, 'Garmin CT10').title).toBe('Kettle');
  });

  it('fills nothing from a failed read', () => {
    expect(fillEmpty(empty, { failureReason: 'NO_METADATA' }, null)).toEqual({});
    expect(fillEmpty(empty, null, null)).toEqual({});
  });
});
