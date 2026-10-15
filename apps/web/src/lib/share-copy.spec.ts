import { describe, expect, it } from 'vitest';
import {
  claimButtonLabel,
  claimedLine,
  countLine,
  isTaken,
  joinNames,
  mineOf,
  ownerSeesLine,
  ownStripText,
  stepperHint,
  takenLine,
  type ItemClaims,
} from './share-copy';

const claim = (id: string, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`,
  claimerName,
  quantity,
});
const SUE = claim('01', 'Aunt Sue');
const SAM = claim('02', 'Sam');
const PRIYA = claim('03', 'Priya');
const gifter = (extra: Partial<ItemClaims>): ItemClaims => ({
  wants: 'Ada wants',
  quantity: 1,
  ...extra,
});

describe('share page copy', () => {
  it('joins names the way people say them', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Sue'])).toBe('Sue');
    expect(joinNames(['Sue', 'Sam'])).toBe('Sue and Sam');
    expect(joinNames(['Sue', 'Sam', 'Jo'])).toBe('Sue, Sam and Jo');
  });

  it('tells gifters which way the owner’s setting is (D40)', () => {
    expect(ownerSeesLine('Ada', false)).toBe(
      'Ada can’t see who’s getting what, so the surprise is safe.',
    );
    expect(ownerSeesLine('Ada', true)).toBe('Ada can see who’s getting what.');
  });

  it('says nothing about one unclaimed item, and how many are wanted when it’s more', () => {
    expect(countLine(gifter({ claims: [] }))).toBeNull();
    expect(countLine(gifter({ quantity: 3, claims: [] }))).toBe('Ada wants 3.');
    expect(countLine({ wants: 'You want', quantity: 3 })).toBe('You want 3.');
  });

  it('says who is getting some, and how many are left', () => {
    expect(countLine(gifter({ quantity: 3, claims: [SAM] }))).toBe(
      'Ada wants 3. Sam is getting 1, so 2 are left.',
    );
    expect(countLine(gifter({ quantity: 4, claims: [SAM, claim('04', 'Jo', 2)] }))).toBe(
      'Ada wants 4. Sam is getting 1 and Jo is getting 2, so 1 is left.',
    );
  });

  it('calls this browser’s own claim “you”', () => {
    const item = gifter({ quantity: 3, claims: [SAM, PRIYA], ownIds: new Set([PRIYA.id]) });
    expect(countLine(item)).toBe(
      'Ada wants 3. Sam is getting 1 and you’re getting 1, so 1 is left.',
    );
    expect(mineOf(item)).toBe(1);
    expect(countLine(gifter({ quantity: 3, claims: [PRIYA], ownIds: new Set([PRIYA.id]) }))).toBe(
      'Ada wants 3. You’re getting 1, so 2 are left.',
    );
  });

  it('has no count line once nothing is left, and says who is getting it', () => {
    const taken = gifter({ claims: [SUE] });
    expect(isTaken(taken)).toBe(true);
    expect(countLine(taken)).toBeNull();
    expect(takenLine(taken)).toBe('Taken care of: Aunt Sue is getting this');
    expect(takenLine(gifter({ quantity: 2, claims: [SUE, SAM] }))).toBe(
      'Taken care of: Aunt Sue and Sam are getting this',
    );
    // One person's two claims are one name.
    expect(takenLine(gifter({ quantity: 2, claims: [SAM, claim('05', 'Sam')] }))).toBe(
      'Taken care of: Sam is getting this',
    );
  });

  it('counts an owner who wanted fewer than were claimed as taken (D19)', () => {
    expect(isTaken(gifter({ quantity: 1, claims: [claim('06', 'Sam', 3)] }))).toBe(true);
  });

  it('never calls an item taken when the viewer may not see claims (spec §5.1)', () => {
    expect(isTaken({ wants: 'You want', quantity: 1 })).toBe(false);
    expect(mineOf({ wants: 'You want', quantity: 1 })).toBe(0);
  });
});

describe('claim sheet copy', () => {
  it('hints at the most you can claim, but not when it’s one', () => {
    expect(stepperHint(2)).toBe('Up to 2');
    expect(stepperHint(1)).toBeUndefined();
  });

  it('names the button for the last one after someone got there first', () => {
    expect(claimButtonLabel(2, false)).toBe('Claim it');
    expect(claimButtonLabel(1, false)).toBe('Claim it');
    expect(claimButtonLabel(2, true)).toBe('Claim it');
    expect(claimButtonLabel(1, true)).toBe('Claim the last one');
  });

  it('says what was claimed, and as whom', () => {
    expect(claimedLine(1, 3, 'Ada', 'Priya')).toBe('1 of the 3 Ada wants, as Priya.');
    expect(claimedLine(1, 1, 'Ada', 'Priya')).toBe('As Priya.');
    expect(ownStripText(2)).toBe('You’re getting 2');
  });
});
