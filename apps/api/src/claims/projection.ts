import type { Claim } from '@wishlist/contracts';
import { remainingOf } from './remaining.js';

/** Who is looking at a list (spec §5.1). The owner's opt-in travels with the viewer. */
export type Viewer = { kind: 'guest' } | { kind: 'owner'; showClaims: boolean };

/** A claim as the database gives it to the projection. */
export interface ClaimRow {
  id: string;
  itemId: string;
  claimerName: string;
  quantity: number;
}

export type ProjectedItem<T> = T & { remaining?: number; claims?: Claim[] };

/** Whether this viewer may see claim data: gifters always, the owner only after opting in. */
export function seesClaims(viewer: Viewer): boolean {
  return viewer.kind === 'guest' || viewer.showClaims;
}

/**
 * The items as `viewer` may see them (spec §5.1). This is the only place claim data joins an
 * item. For a viewer who may not see it, `remaining` and `claims` are absent, not empty, so not
 * even "nothing is claimed yet" reaches the owner (success criterion 4).
 *
 * The spec writes `projectWishlist(wishlist, items, claims, viewer)`; the list's one input, its
 * opt-in, travels in the owner viewer instead (Plan 4a rule 1).
 */
export function projectWishlist<T extends { id: string; quantity: number }>(
  items: readonly T[],
  claims: readonly ClaimRow[],
  viewer: Viewer,
): ProjectedItem<T>[] {
  if (!seesClaims(viewer)) return items.map((item) => ({ ...item }));
  const byItem = new Map<string, Claim[]>();
  for (const { id, itemId, claimerName, quantity } of claims) {
    const list = byItem.get(itemId) ?? [];
    list.push({ id, claimerName, quantity });
    byItem.set(itemId, list);
  }
  return items.map((item) => {
    const own = byItem.get(item.id) ?? [];
    const claimed = own.reduce((sum, claim) => sum + claim.quantity, 0);
    return { ...item, remaining: remainingOf(item.quantity, claimed), claims: own };
  });
}
