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

export type ProjectedItem<T> = T & { remaining?: number; claimed?: number; claims?: Claim[] };

/** Whether this viewer gets claim data: claims for gifters, totals for the owner after opting in. */
export function seesClaims(viewer: Viewer): boolean {
  return viewer.kind === 'guest' || viewer.showClaims;
}

/**
 * The items as `viewer` may see them (spec §5.1, D75). This is the only place claim data joins an
 * item:
 *
 * | viewer              | gets                              |
 * | ------------------- | --------------------------------- |
 * | guest               | `remaining` and `claims`          |
 * | owner, opted in     | `remaining`, `claimed` and `claims` |
 * | owner, not opted in | nothing: the fields are absent    |
 *
 * Expand step (D75): an opted-in owner still gets `claims` beside the new `claimed`, so a web app
 * that reads `claims` keeps working while the web moves to `claimed`; the stack's contract layer
 * stops sending owners `claims`. Where a field is
 * not sent it is absent, not empty, so not even "nothing is claimed yet" reaches an owner who has
 * not opted in (success criterion 4). `claimed` is the sum of the quantities, unclamped, so it can
 * exceed an item's quantity after the owner lowers it (D19); `remaining` never goes below 0.
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
    const remaining = remainingOf(item.quantity, claimed);
    return viewer.kind === 'owner'
      ? { ...item, remaining, claimed, claims: own }
      : { ...item, remaining, claims: own };
  });
}
