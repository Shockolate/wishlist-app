import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TOKEN_PATTERN,
  ClaimConflictProblemSchema,
  ClaimDetailsResponseSchema,
  ClaimerNameSchema,
  CreateClaimRequestSchema,
  CreateClaimResponseSchema,
  SharedWishlistResponseSchema,
  UpdateClaimRequestSchema,
} from './claims.js';
import { ErrorCode } from './error-codes.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';
const TOKEN = 'abcdefghijklmnopqrstuv';
const ITEM = {
  id: ID,
  title: 'Kettle',
  url: null,
  imageUrl: null,
  priceText: '$40.00',
  note: null,
  quantity: 2,
};

describe('ClaimerNameSchema (spec §2: the display-name rule)', () => {
  it.each([
    [' Aunt Sue\n', 'Aunt Sue'],
    ['Zoë', 'Zoë'],
    ['\u{1F469}‍\u{1F373} Sam', '\u{1F469}‍\u{1F373} Sam'],
    ['می‌خواهم', 'می‌خواهم'],
  ])('keeps %j as %j (Review Focus 4)', (input, stored) => {
    expect(ClaimerNameSchema.parse(input)).toBe(stored);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['51 characters', 'a'.repeat(51)],
    ['a right-to-left override', 'Sue‮eus'],
    ['a newline inside', 'Aunt\nSue'],
  ])('refuses a name that is %s', (_label, input) => {
    expect(ClaimerNameSchema.safeParse(input).success).toBe(false);
  });
});

describe('CreateClaimRequestSchema (spec §5)', () => {
  it('claims one unless told otherwise', () => {
    expect(CreateClaimRequestSchema.parse({ claimerName: 'Sue' })).toEqual({
      claimerName: 'Sue',
      quantity: 1,
    });
  });

  it.each([0, 100, 1.5, '2'])('refuses a quantity of %j', (quantity) => {
    expect(CreateClaimRequestSchema.safeParse({ claimerName: 'Sue', quantity }).success).toBe(
      false,
    );
  });
});

describe('UpdateClaimRequestSchema (spec §5)', () => {
  it('takes a new name, a new quantity, or both', () => {
    expect(UpdateClaimRequestSchema.parse({ claimerName: ' Sam ' })).toEqual({
      claimerName: 'Sam',
    });
    expect(UpdateClaimRequestSchema.parse({ quantity: 2 })).toEqual({ quantity: 2 });
  });

  it('refuses a change that changes nothing', () => {
    expect(UpdateClaimRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('the public responses (spec §5)', () => {
  it('let the share page leave claim data out entirely (spec §5.1)', () => {
    const parsed = SharedWishlistResponseSchema.parse({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: true,
      ownerSeesClaims: false,
      items: [ITEM],
    });
    expect(parsed.items[0]).not.toHaveProperty('remaining');
    expect(parsed.items[0]).not.toHaveProperty('claims');
  });

  it('carry what is left and who is getting what when the viewer may see them', () => {
    const parsed = SharedWishlistResponseSchema.parse({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: false,
      ownerSeesClaims: false,
      items: [{ ...ITEM, remaining: 1, claims: [{ id: ID, claimerName: 'Sue', quantity: 1 }] }],
    });
    expect(parsed.items[0]?.remaining).toBe(1);
    expect(parsed.items[0]?.claims).toEqual([{ id: ID, claimerName: 'Sue', quantity: 1 }]);
  });

  it('return the manage link with a new claim', () => {
    const parsed = CreateClaimResponseSchema.parse({
      claim: { id: ID, claimerName: 'Sue', quantity: 1 },
      manageToken: TOKEN,
      manageUrl: `https://hanker.dev/c/${TOKEN}`,
    });
    expect(parsed.manageToken).toBe(TOKEN);
  });

  it('give the claimer the item without anyone else’s claims (spec §5.1)', () => {
    const parsed = ClaimDetailsResponseSchema.parse({
      claim: { id: ID, claimerName: 'Sue', quantity: 1 },
      item: ITEM,
      wishlistTitle: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      remaining: 1,
      shareUrl: `https://hanker.dev/s/${TOKEN}`,
      ownerSeesClaims: false,
    });
    expect(Object.keys(parsed.item).sort()).toEqual(
      ['id', 'imageUrl', 'note', 'priceText', 'quantity', 'title', 'url'].sort(),
    );
  });

  it('read how many are left from a 409', () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      requestId: 'r1',
      remaining: 0,
    };
    expect(ClaimConflictProblemSchema.parse(problem).remaining).toBe(0);
  });
});

describe('CAPABILITY_TOKEN_PATTERN (spec §4)', () => {
  it.each([TOKEN, 'A-_0123456789abcdefghi'])('matches %j', (token) => {
    expect(CAPABILITY_TOKEN_PATTERN.test(token)).toBe(true);
  });

  it.each([
    'abcdefghijklmnopqrstu',
    'abcdefghijklmnopqrstuvw',
    'abcdefghijklmnopqrstu.',
    'abcdefghijklmnopqrstu=',
    '',
  ])('refuses %j', (token) => {
    expect(CAPABILITY_TOKEN_PATTERN.test(token)).toBe(false);
  });
});
