import { describe, expect, it } from 'vitest';
import { ownerClaimLine, ownerShareLines } from './editor-claims';

describe('ownerClaimLine (D75)', () => {
  it('says nothing unless the owner has opted in (spec §5.1)', () => {
    expect(ownerClaimLine({ quantity: 1 })).toBeNull();
  });

  it('says when nothing has been claimed yet', () => {
    expect(ownerClaimLine({ quantity: 3, claimed: 0 })).toEqual({
      text: 'None claimed yet',
      kind: 'none',
    });
  });

  it('says how many of the wanted ones are claimed', () => {
    expect(ownerClaimLine({ quantity: 5, claimed: 2 })).toEqual({
      text: '2 of 5 claimed',
      kind: 'some',
    });
  });

  it('says when all of them are claimed, and just "Claimed" for one', () => {
    expect(ownerClaimLine({ quantity: 5, claimed: 5 })).toEqual({
      text: 'All 5 claimed',
      kind: 'taken',
    });
    expect(ownerClaimLine({ quantity: 1, claimed: 1 })).toEqual({
      text: 'Claimed',
      kind: 'taken',
    });
  });

  it('reads the same way when more are claimed than wanted (D19)', () => {
    expect(ownerClaimLine({ quantity: 2, claimed: 3 })).toEqual({
      text: '3 of 2 claimed',
      kind: 'taken',
    });
  });
});

describe('ownerShareLines (the owner’s own share page)', () => {
  it('says what the owner wants when it is more than one, with the setting off', () => {
    expect(ownerShareLines({ quantity: 3 })).toEqual({ want: 'You want 3.', claim: null });
  });

  it('says nothing for one wanted with the setting off', () => {
    expect(ownerShareLines({ quantity: 1 })).toEqual({ want: null, claim: null });
  });

  it('adds the claim total once the owner has opted in', () => {
    expect(ownerShareLines({ quantity: 3, claimed: 1 })).toEqual({
      want: 'You want 3.',
      claim: { text: '1 of 3 claimed', kind: 'some' },
    });
  });

  it('keeps the taken kind for the sage strip', () => {
    expect(ownerShareLines({ quantity: 2, claimed: 2 })).toEqual({
      want: 'You want 2.',
      claim: { text: 'All 2 claimed', kind: 'taken' },
    });
  });

  it('has only the claim line for one wanted', () => {
    expect(ownerShareLines({ quantity: 1, claimed: 0 })).toEqual({
      want: null,
      claim: { text: 'None claimed yet', kind: 'none' },
    });
  });
});
