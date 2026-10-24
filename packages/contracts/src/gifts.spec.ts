import { describe, expect, it } from 'vitest';
import { GoneGiftSchema, UpdateGiftRequestSchema } from './gifts.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

describe('UpdateGiftRequestSchema (design §5)', () => {
  it('refuses an empty body', () => {
    expect(UpdateGiftRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a Bought tick alone', () => {
    expect(UpdateGiftRequestSchema.parse({ bought: true })).toEqual({ bought: true });
  });

  it('accepts a bought flag of false, which unticks', () => {
    expect(UpdateGiftRequestSchema.safeParse({ bought: false }).success).toBe(true);
  });

  it('still takes a name or a quantity, as PATCH /claims does', () => {
    expect(UpdateGiftRequestSchema.parse({ claimerName: ' Sue ', quantity: 2 })).toEqual({
      claimerName: 'Sue',
      quantity: 2,
    });
  });
});

describe('GoneGiftSchema', () => {
  const note = { linkId: ID, itemTitle: 'Kettle', ownerDisplayName: 'Ada' };

  it.each(['removed', 'cancelled'])('accepts the reason %s', (reason) => {
    expect(GoneGiftSchema.safeParse({ ...note, reason }).success).toBe(true);
  });

  it('refuses any other reason', () => {
    expect(GoneGiftSchema.safeParse({ ...note, reason: 'other' }).success).toBe(false);
  });
});
