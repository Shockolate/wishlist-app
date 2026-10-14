/**
 * How many of an item are still wanted (spec §2): what the owner wants less what's claimed. Never
 * stored, and never below 0, because an owner may lower a quantity below what's claimed (D19).
 */
export function remainingOf(quantity: number, claimed: number): number {
  return Math.max(0, quantity - claimed);
}

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
