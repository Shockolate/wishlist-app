import { describe, expect, it } from 'vitest';
import { projectWishlist, seesClaims, type ClaimRow, type Viewer } from './projection.js';

const KETTLE = { id: 'kettle', title: 'Kettle', quantity: 3 };
const SOCKS = { id: 'socks', title: 'Socks', quantity: 1 };
// The owner wants 1 lamp now, but 2 were claimed before the change (D19).
const LAMP = { id: 'lamp', title: 'Lamp', quantity: 1 };
const ITEMS = [KETTLE, SOCKS, LAMP];
const CLAIMS: ClaimRow[] = [
  { id: 'c1', itemId: 'kettle', claimerName: 'Sue', quantity: 1 },
  { id: 'c2', itemId: 'kettle', claimerName: 'Sam', quantity: 1 },
  { id: 'c3', itemId: 'lamp', claimerName: 'Kim', quantity: 2 },
  // A claim on an item that isn't in the list given: ignored.
  { id: 'c4', itemId: 'gone', claimerName: 'Lee', quantity: 1 },
];

const GUEST: Viewer = { kind: 'guest' };
const OWNER_OPTED_OUT: Viewer = { kind: 'owner', showClaims: false };
const OWNER_OPTED_IN: Viewer = { kind: 'owner', showClaims: true };

const WITH_CLAIMS = [
  {
    ...KETTLE,
    remaining: 1,
    claims: [
      { id: 'c1', claimerName: 'Sue', quantity: 1 },
      { id: 'c2', claimerName: 'Sam', quantity: 1 },
    ],
  },
  { ...SOCKS, remaining: 1, claims: [] },
  { ...LAMP, remaining: 0, claims: [{ id: 'c3', claimerName: 'Kim', quantity: 2 }] },
];

describe('projectWishlist (spec §5.1)', () => {
  it('shows a guest what is left and who is getting what', () => {
    const items = projectWishlist(ITEMS, CLAIMS, GUEST);
    expect(items).toEqual(WITH_CLAIMS);
    for (const item of items) expect(item).not.toHaveProperty('claimed');
  });

  it('shows an owner who opted in how many are claimed and what is left, and never who (D75)', () => {
    const items = projectWishlist(ITEMS, CLAIMS, OWNER_OPTED_IN);
    expect(items).toEqual([
      { ...KETTLE, remaining: 1, claimed: 2 },
      { ...SOCKS, remaining: 1, claimed: 0 },
      { ...LAMP, remaining: 0, claimed: 2 },
    ]);
    const json = JSON.stringify(items);
    expect(json).not.toContain('Sue');
    expect(json).not.toContain('c1');
  });

  it('leaves the claim fields out, not empty, for an owner who has not opted in', () => {
    const items = projectWishlist(ITEMS, CLAIMS, OWNER_OPTED_OUT);
    expect(items).toEqual(ITEMS);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'quantity', 'title']);
      expect('claimed' in item).toBe(false);
    }
  });

  it('gives each claim only its ID, name and quantity: never its item or its token', () => {
    const [kettle] = projectWishlist(ITEMS, CLAIMS, GUEST);
    for (const claim of kettle?.claims ?? []) {
      expect(Object.keys(claim).sort()).toEqual(['claimerName', 'id', 'quantity']);
    }
  });

  it('keeps the list’s order and changes nothing it was given', () => {
    const items = ITEMS.map((item) => ({ ...item }));
    const projected = projectWishlist(items, CLAIMS, GUEST);
    expect(projected.map((item) => item.id)).toEqual(['kettle', 'socks', 'lamp']);
    expect(items).toEqual(ITEMS);
  });
});

describe('seesClaims (spec §5.1)', () => {
  it.each([
    [GUEST, true],
    [OWNER_OPTED_OUT, false],
    [OWNER_OPTED_IN, true],
  ])('%j → %s', (viewer, sees) => {
    expect(seesClaims(viewer)).toBe(sees);
  });
});
