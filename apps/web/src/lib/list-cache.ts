import type { Item, WishlistResponse } from '@wishlist/contracts';

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

/** Appends `item`, once: an item already in the list stays where it is. */
export function appendItem(list: WishlistResponse, item: Item): WishlistResponse {
  if (list.items.some((existing) => existing.id === item.id)) return list;
  return { ...list, items: [...list.items, item] };
}

export function replaceItem(list: WishlistResponse, item: Item): WishlistResponse {
  return {
    ...list,
    items: list.items.map((existing) => (existing.id === item.id ? item : existing)),
  };
}
