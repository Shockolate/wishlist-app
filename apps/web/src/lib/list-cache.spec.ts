import type { Item, WishlistResponse } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { appendItem, moveItem, orderOf, removeItem, replaceItem } from './list-cache';

const item = (n: number, extra: Partial<Item> = {}): Item => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Item ${String(n)}`,
  url: null,
  imageUrl: null,
  priceText: null,
  note: null,
  quantity: 1,
  position: n,
  ...extra,
});
const list = (...items: Item[]): WishlistResponse => ({
  title: 'Ada’s wishlist',
  shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
  items,
});
const ids = (l: WishlistResponse) => l.items.map((i) => i.title);

describe('list cache operations (Plan 3b rule 2)', () => {
  it('reads the order as item IDs, and an empty order from no list', () => {
    expect(orderOf(list(item(1), item(2)))).toEqual([item(1).id, item(2).id]);
    expect(orderOf(undefined)).toEqual([]);
  });

  it('moves an item up and down, and renumbers positions 0…n−1 as the API does', () => {
    const moved = moveItem(list(item(1), item(2), item(3)), item(3).id, 0);
    expect(ids(moved)).toEqual(['Item 3', 'Item 1', 'Item 2']);
    expect(moved.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(ids(moveItem(list(item(1), item(2), item(3)), item(1).id, 2))).toEqual([
      'Item 2',
      'Item 3',
      'Item 1',
    ]);
  });

  it('clamps a move past either end, and ignores an unknown ID', () => {
    const l = list(item(1), item(2));
    expect(ids(moveItem(l, item(1).id, 9))).toEqual(['Item 2', 'Item 1']);
    expect(ids(moveItem(l, item(2).id, -3))).toEqual(['Item 2', 'Item 1']);
    expect(moveItem(l, item(7).id, 0)).toBe(l);
  });

  it('removes, appends and replaces items without mutating the list it was given', () => {
    const l = list(item(1), item(2));
    expect(ids(removeItem(l, item(1).id))).toEqual(['Item 2']);
    expect(ids(appendItem(l, item(3)))).toEqual(['Item 1', 'Item 2', 'Item 3']);
    expect(ids(appendItem(l, item(2)))).toEqual(['Item 1', 'Item 2']);
    expect(replaceItem(l, item(2, { title: 'Kettle' })).items[1]?.title).toBe('Kettle');
    expect(ids(l)).toEqual(['Item 1', 'Item 2']);
  });
});
