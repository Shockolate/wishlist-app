import { describe, expect, it } from 'vitest';
import { ownerClaimLine } from './editor-claims';

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
