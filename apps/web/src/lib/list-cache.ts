import { remainingOf, type Item, type Tag, type WishlistResponse } from '@wishlist/contracts';

/** The editor's one query: the owner's list, as `GET /wishlist` returns it (Plan 3b rule 1). */
export const WISHLIST_KEY = ['wishlist'] as const;

/** The item IDs in list order: a reorder's body. */
export function orderOf(list: WishlistResponse | undefined): string[] {
  return list ? list.items.map((item) => item.id) : [];
}

/**
 * The list with `id` moved to `toIndex`, clamped to the list's ends, and positions renumbered
 * 0…n−1 as the API does. An unknown ID leaves the list as it was.
 */
export function moveItem(list: WishlistResponse, id: string, toIndex: number): WishlistResponse {
  const from = list.items.findIndex((item) => item.id === id);
  const moving = list.items[from];
  if (!moving) return list;
  const to = Math.max(0, Math.min(toIndex, list.items.length - 1));
  const items = list.items.filter((item) => item.id !== id);
  items.splice(to, 0, moving);
  return { ...list, items: items.map((item, position) => ({ ...item, position })) };
}

export function removeItem(list: WishlistResponse, id: string): WishlistResponse {
  return { ...list, items: list.items.filter((item) => item.id !== id) };
}

const optedIn = (list: WishlistResponse) => list.showClaimsToOwner === true;
const claimed = (claims: readonly { quantity: number }[]) =>
  claims.reduce((sum, claim) => sum + claim.quantity, 0);

/**
 * Appends `item`, once: an item already in the list stays where it is. On an opted-in list a new
 * item has no claims yet, and all of it is left (Plan 4b rule 13).
 */
export function appendItem(list: WishlistResponse, item: Item): WishlistResponse {
  if (list.items.some((existing) => existing.id === item.id)) return list;
  const added =
    optedIn(list) && item.claims === undefined
      ? { ...item, claims: [], remaining: item.quantity }
      : item;
  return { ...list, items: [...list.items, added] };
}

/**
 * Puts an item write's answer in place. The answer carries no claim fields, so an opted-in list
 * keeps the claims it had and works out what's left from the new quantity (Plan 4b rule 13).
 */
export function replaceItem(list: WishlistResponse, item: Item): WishlistResponse {
  return {
    ...list,
    items: list.items.map((existing) => {
      if (existing.id !== item.id) return existing;
      if (!optedIn(list) || item.claims !== undefined || existing.claims === undefined) return item;
      return {
        ...item,
        claims: existing.claims,
        remaining: remainingOf(item.quantity, claimed(existing.claims)),
      };
    }),
  };
}

function withoutClaims(item: Item): Item {
  const copy = { ...item };
  delete copy.claims;
  delete copy.remaining;
  return copy;
}

/** The list as an owner who just opted out sees it: no claim data at all (spec §5.1). */
export function stripClaims(list: WishlistResponse): WishlistResponse {
  return { ...list, showClaimsToOwner: false, items: list.items.map(withoutClaims) };
}

/**
 * Adds each tag the list doesn't know, and takes the new name of one it does, by id. New tags are
 * appended: the list's order isn't meaningful, and the UI sorts what it shows.
 */
export function mergeTags(list: WishlistResponse, tags: readonly Tag[]): WishlistResponse {
  if (tags.length === 0) return list;
  const merged = [...(list.tags ?? [])];
  for (const tag of tags) {
    const at = merged.findIndex((known) => known.id === tag.id);
    if (at === -1) merged.push(tag);
    else merged[at] = tag;
  }
  return { ...list, tags: merged };
}

/**
 * Ticks (`on`) or unticks a tag on an item. A tick never lists the same id twice, and an unknown
 * item, or an untick of a tag the item doesn't carry, leaves the item as it was.
 */
export function setItemTag(
  list: WishlistResponse,
  itemId: string,
  tagId: string,
  on: boolean,
): WishlistResponse {
  return {
    ...list,
    items: list.items.map((item) => {
      if (item.id !== itemId) return item;
      const had = item.tagIds ?? [];
      if (on) return had.includes(tagId) ? item : { ...item, tagIds: [...had, tagId] };
      return had.includes(tagId) ? { ...item, tagIds: had.filter((each) => each !== tagId) } : item;
    }),
  };
}

/** Gives a tag its new name. A tag the list doesn't hold is left out, not added: use `mergeTags` for that. */
export function renameTag(list: WishlistResponse, tag: Tag): WishlistResponse {
  if (!list.tags?.some((known) => known.id === tag.id)) return list;
  return { ...list, tags: list.tags.map((known) => (known.id === tag.id ? tag : known)) };
}

/** Drops a tag from the list and from every item that carries it. */
export function removeTag(list: WishlistResponse, tagId: string): WishlistResponse {
  return {
    ...list,
    ...(list.tags ? { tags: list.tags.filter((known) => known.id !== tagId) } : {}),
    items: list.items.map((item) =>
      item.tagIds?.includes(tagId)
        ? { ...item, tagIds: item.tagIds.filter((each) => each !== tagId) }
        : item,
    ),
  };
}
