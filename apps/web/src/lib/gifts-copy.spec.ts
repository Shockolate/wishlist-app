import type { Gift, GoneGift } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import {
  giftLine,
  goneLine,
  letGoText,
  ON_SOMEONE_ELSES_GIFTS,
  ON_YOUR_GIFTS,
  SEE_GIFTS,
  SHEET_GIFTS_HINT,
  summaryLine,
  TAKEN_OFF_GIFTS,
} from './gifts-copy';

function gift(over: {
  shareUrl?: string;
  bought?: boolean;
  priceText?: string | null;
  quantity?: number;
}): Gift {
  const {
    shareUrl = 'https://hanker.dev/s/a',
    bought = false,
    priceText = null,
    quantity = 1,
  } = over;
  return {
    linkId: '0198f2a0-0000-7000-8000-000000000001',
    claim: { id: '0198f2a0-0000-7000-8000-000000000002', claimerName: 'Sue', quantity },
    item: {
      id: '0198f2a0-0000-7000-8000-000000000003',
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText,
      note: null,
      quantity: 3,
    },
    remaining: 1,
    wishlistTitle: 'Mom’s list',
    ownerDisplayName: 'Mom',
    shareUrl,
    bought,
  };
}

describe('summaryLine (Plan 10b copy table)', () => {
  it('counts things, people and bought ones', () => {
    const gifts = [
      gift({ shareUrl: 'https://hanker.dev/s/a', bought: true }),
      gift({ shareUrl: 'https://hanker.dev/s/a', bought: true }),
      gift({ shareUrl: 'https://hanker.dev/s/a' }),
      gift({ shareUrl: 'https://hanker.dev/s/b' }),
      gift({ shareUrl: 'https://hanker.dev/s/b' }),
      gift({ shareUrl: 'https://hanker.dev/s/c' }),
      gift({ shareUrl: 'https://hanker.dev/s/c' }),
    ];
    expect(summaryLine(gifts)).toBe('7 things for 3 people · 2 bought');
  });

  it('uses the singulars', () => {
    expect(summaryLine([gift({ bought: true })])).toBe('1 thing for 1 person · 1 bought');
  });

  it('leaves out “0 bought”', () => {
    expect(summaryLine([gift({}), gift({})])).toBe('2 things for 1 person');
  });

  it('counts a person once, however many of their things you are getting', () => {
    const gifts = [gift({}), gift({ shareUrl: 'https://hanker.dev/s/b' }), gift({})];
    expect(summaryLine(gifts)).toBe('3 things for 2 people');
  });
});

describe('giftLine', () => {
  it('puts the price first', () => {
    expect(giftLine(gift({ priceText: '$165.00' }))).toBe('$165.00 · you’re getting 1');
  });

  it('says how many are yours', () => {
    expect(giftLine(gift({ priceText: '$38.00', quantity: 2 }))).toBe('$38.00 · you’re getting 2');
  });

  it.each([null, ''])('starts with a capital when the price is %j', (priceText) => {
    expect(giftLine(gift({ priceText }))).toBe('You’re getting 1');
  });
});

describe('goneLine', () => {
  const note = (reason: GoneGift['reason']): GoneGift => ({
    linkId: '0198f2a0-0000-7000-8000-000000000009',
    itemTitle: 'LEGO Botanical bonsai',
    ownerDisplayName: 'Sam',
    reason,
  });

  it('says the owner took it off', () => {
    expect(goneLine(note('removed'))).toBe('Sam took this off their list. Your claim is gone.');
  });

  it('says it was cancelled through its link', () => {
    expect(goneLine(note('cancelled'))).toBe('This claim was cancelled through its link.');
  });
});

describe('letGoText (Plan 10b copy table)', () => {
  it('says the item goes back to the owner’s list', () => {
    expect(letGoText('Mom')).toBe('Someone else can get this for Mom instead.');
  });
});

describe('signed-in claim copy (Plan 10b copy table)', () => {
  it('says what the table says, with curly apostrophes', () => {
    expect(SHEET_GIFTS_HINT).toBe('This goes on Your gifts.');
    expect(SEE_GIFTS).toBe('See Your gifts');
    expect(TAKEN_OFF_GIFTS).toBe('Taken off Your gifts.');
    expect(ON_YOUR_GIFTS).toBe('On Your gifts.');
    expect(ON_SOMEONE_ELSES_GIFTS).toBe(
      'This claim is on someone else’s gifts in Hanker, so it won’t appear on yours. You can still change or cancel it here.',
    );
  });
});
