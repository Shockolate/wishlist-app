import { remainingOf, type Item, type WishlistResponse } from '@wishlist/contracts';

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
