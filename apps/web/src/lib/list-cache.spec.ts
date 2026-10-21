import type { Item, Tag, WishlistResponse } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import {
  appendItem,
  mergeTags,
  moveItem,
  orderOf,
  removeItem,
  removeTag,
  renameTag,
  replaceItem,
  setItemTag,
  stripClaims,
} from './list-cache';

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

const claimOf = (n: number, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  claimerName,
  quantity,
});
const optedIn = (...items: Item[]): WishlistResponse => ({
  ...list(...items),
  showClaimsToOwner: true,
});

describe('claim fields in the cache (Plan 4b rule 13)', () => {
  it('keeps an item’s claims across an edit, and recomputes what is left', () => {
    const before = optedIn(item(1, { quantity: 3, claims: [claimOf(1, 'Sam')], remaining: 2 }));
    const after = replaceItem(before, item(1, { quantity: 2, title: 'Kettle' }));
    expect(after.items[0]).toMatchObject({
      title: 'Kettle',
      quantity: 2,
      claims: [claimOf(1, 'Sam')],
      remaining: 1,
    });
  });

  it('gives a new item no claims and all of it left', () => {
    expect(appendItem(optedIn(), item(2, { quantity: 3 })).items[0]).toMatchObject({
      claims: [],
      remaining: 3,
    });
  });

  it('adds nothing for an owner who hasn’t opted in (spec §5.1)', () => {
    const appended = appendItem(list(), item(2)).items[0];
    expect(appended).not.toHaveProperty('claims');
    expect(appended).not.toHaveProperty('remaining');
    const replaced = replaceItem(list(item(1)), item(1, { title: 'Kettle' })).items[0];
    expect(replaced).not.toHaveProperty('claims');
  });

  it('strips every claim field, and the setting, when the owner opts out', () => {
    const stripped = stripClaims(
      optedIn(item(1, { claims: [claimOf(1, 'Sam')], remaining: 0 }), item(2)),
    );
    expect(stripped.showClaimsToOwner).toBe(false);
    for (const each of stripped.items) {
      expect(each).not.toHaveProperty('claims');
      expect(each).not.toHaveProperty('remaining');
    }
    expect(stripped.items.map((each) => each.title)).toEqual(['Item 1', 'Item 2']);
  });
});

const tag = (n: number, name = `Tag ${String(n)}`): Tag => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  name,
});
const withTags = (tags: Tag[], ...items: Item[]): WishlistResponse => ({ ...list(...items), tags });

describe('tags in the cache (Plan 7b rulings 4, 8)', () => {
  it('merges tags into a list with and without a tags array, adding new ones and renaming known ones', () => {
    expect(mergeTags(list(), [tag(1)]).tags).toEqual([tag(1)]);
    const merged = mergeTags(withTags([tag(1), tag(2)]), [tag(2, 'Renamed'), tag(3)]);
    expect(merged.tags).toEqual([tag(1), tag(2, 'Renamed'), tag(3)]);
  });

  it('leaves the list as it was when there is nothing to merge', () => {
    const before = list(item(1));
    expect(mergeTags(before, [])).toBe(before);
  });

  it('ticks a tag on an item, once, and unticks it', () => {
    const before = withTags([tag(1)], item(1), item(2, { tagIds: [tag(2).id] }));
    const ticked = setItemTag(before, item(1).id, tag(1).id, true);
    expect(ticked.items[0]?.tagIds).toEqual([tag(1).id]);
    expect(setItemTag(ticked, item(1).id, tag(1).id, true).items[0]?.tagIds).toEqual([tag(1).id]);
    // Another item is untouched.
    expect(ticked.items[1]?.tagIds).toEqual([tag(2).id]);
    const unticked = setItemTag(ticked, item(1).id, tag(1).id, false);
    expect(unticked.items[0]?.tagIds).toEqual([]);
  });

  it('unticks a tag an item never had, and ticks an unknown item, without changing anything', () => {
    const before = withTags([tag(1)], item(1));
    expect(setItemTag(before, item(1).id, tag(1).id, false).items).toEqual(before.items);
    expect(setItemTag(before, item(9).id, tag(1).id, true).items).toEqual(before.items);
  });

  it('renames a tag by id, and ignores an unknown one', () => {
    const before = withTags([tag(1), tag(2)], item(1));
    expect(renameTag(before, tag(2, 'Garden')).tags).toEqual([tag(1), tag(2, 'Garden')]);
    expect(renameTag(before, tag(3, 'Nope')).tags).toEqual([tag(1), tag(2)]);
    expect(renameTag(list(item(1)), tag(1, 'Garden'))).toEqual(list(item(1)));
  });

  it('removes a tag from the list and from every item that carries it', () => {
    const before = withTags(
      [tag(1), tag(2)],
      item(1, { tagIds: [tag(1).id, tag(2).id] }),
      item(2, { tagIds: [tag(1).id] }),
      item(3),
    );
    const after = removeTag(before, tag(1).id);
    expect(after.tags).toEqual([tag(2)]);
    expect(after.items.map((each) => each.tagIds)).toEqual([[tag(2).id], [], undefined]);
    expect(removeTag(list(item(1)), tag(1).id)).toEqual(list(item(1)));
  });

  it('keeps the tags and each item’s tagIds when the owner opts out of claims (Plan 7b ruling 8)', () => {
    const before: WishlistResponse = {
      ...withTags(
        [tag(1)],
        item(1, { claims: [claimOf(1, 'Sam')], remaining: 0, tagIds: [tag(1).id] }),
      ),
      showClaimsToOwner: true,
    };
    const stripped = stripClaims(before);
    expect(stripped.tags).toEqual([tag(1)]);
    expect(stripped.items[0]?.tagIds).toEqual([tag(1).id]);
    expect(stripped.items[0]).not.toHaveProperty('claims');
  });
});
