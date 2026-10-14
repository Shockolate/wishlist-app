import { remainingOf } from '@wishlist/contracts';

// The formula lives in contracts, so the editor recomputes it the same way (Plan 4b rule 13).
export { remainingOf };

/** A new claim may take at most what's left (spec §6.3). */
export function fitsNewClaim(requested: number, quantity: number, claimed: number): boolean {
  return requested <= remainingOf(quantity, claimed);
}

/**
 * A changed claim may hold up to what's left plus what it holds already (spec §2, and §6.3 as
 * amended in Plan 4a). `claimed` counts every claim on the item, this one included. Keeping or
 * lowering a quantity always fits, even after the owner wanted fewer than were claimed.
 */
export function fitsChangedClaim(
  next: number,
  current: number,
  quantity: number,
  claimed: number,
): boolean {
  return next <= remainingOf(quantity, claimed) + current;
}
