import { describe, expect, it } from 'vitest';
import { fitsChangedClaim, fitsNewClaim, remainingOf } from './remaining.js';

describe('remainingOf (spec §2)', () => {
  it.each([
    [3, 0, 3],
    [3, 2, 1],
    [3, 3, 0],
    // The owner lowered the quantity below what's claimed (D19): never negative.
    [1, 2, 0],
  ])('wants %i, %i claimed: %i left', (quantity, claimed, left) => {
    expect(remainingOf(quantity, claimed)).toBe(left);
  });
});

describe('fitsNewClaim (spec §6.3)', () => {
  it('fits up to what is left, and no more', () => {
    expect(fitsNewClaim(1, 3, 2)).toBe(true);
    expect(fitsNewClaim(2, 3, 2)).toBe(false);
    expect(fitsNewClaim(1, 1, 2)).toBe(false);
  });
});

describe('fitsChangedClaim (spec §2: up to remaining plus what it holds)', () => {
  it('lets a claim grow into what is left', () => {
    // Wants 3; this claim holds 1 and another holds 1: 1 left, so this one may hold 2.
    expect(fitsChangedClaim(2, 1, 3, 2)).toBe(true);
    expect(fitsChangedClaim(3, 1, 3, 2)).toBe(false);
  });

  it('never refuses keeping or lowering what a claim holds, even past an owner’s cut (D19)', () => {
    // Wants 1 now; this claim and another hold 1 each, so 2 are claimed.
    expect(fitsChangedClaim(1, 1, 1, 2)).toBe(true);
    // Wants 1 now; this claim holds 3.
    expect(fitsChangedClaim(2, 3, 1, 3)).toBe(true);
    expect(fitsChangedClaim(2, 1, 1, 2)).toBe(false);
  });
});
