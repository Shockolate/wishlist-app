import type { Gift, GoneGift } from '@wishlist/contracts';

// The sentences Your gifts builds from claim numbers (Plan 10b copy table). Pure, so the server
// render and the browser say the same thing.

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Under the heading: "7 things for 3 people · 2 bought". A person is a list, so two lists of the
 * same name count twice. "0 bought" is left out rather than said.
 */
export function summaryLine(gifts: readonly Gift[]): string {
  const people = new Set(gifts.map((gift) => gift.shareUrl)).size;
  const bought = gifts.filter((gift) => gift.bought).length;
  const line = `${plural(gifts.length, 'thing', 'things')} for ${plural(people, 'person', 'people')}`;
  return bought > 0 ? `${line} · ${bought} bought` : line;
}

/** A card's line: the price as the share page shows it, then how many are yours. */
export function giftLine(gift: Gift): string {
  const price = gift.item.priceText;
  return price
    ? `${price} · you’re getting ${gift.claim.quantity}`
    : `You’re getting ${gift.claim.quantity}`;
}

/** What a note says about a claim that went. */
export function goneLine(note: GoneGift): string {
  return note.reason === 'removed'
    ? `${note.ownerDisplayName} took this off their list. Your claim is gone.`
    : 'This claim was cancelled through its link.';
}

/** What the Let it go confirmation says: the item goes back to the owner's list for others. */
export function letGoText(ownerDisplayName: string): string {
  return `Someone else can get this for ${ownerDisplayName} instead.`;
}

/**
 * The page heading's id: where focus goes when a note clears and its button goes with it. A plain
 * module, because a constant exported from a 'use client' file reaches a Server Component as a
 * client reference, not as its string.
 */
export const GIFTS_HEADING_ID = 'gifts-heading';

/** Shown when there are no gifts and no notes. */
export const NOTHING_YET =
  'Nothing here yet. Claims you make while signed in appear here, and so does a claim whose link you open while signed in.';

/** The claim sheet's hint when a verified gifter is signed in: where the claim will go. */
export const SHEET_GIFTS_HINT = 'This goes on Your gifts.';

/** The claim sheet's way to Your gifts, once a claim has landed there. */
export const SEE_GIFTS = 'See Your gifts';

/**
 * `/c` for a claim already on this account's gifts, beside Not mine (R12). The page makes
 * `Your gifts` a link to `/gifts`, as it does in the notice a fresh link shows.
 */
export const ON_YOUR_GIFTS = 'On Your gifts.';

/** `/c`, after Not mine: the claim is still there, but no longer on Your gifts. */
export const TAKEN_OFF_GIFTS = 'Taken off Your gifts.';

/** `/c` for a claim already on another account's gifts. The account is never named. */
export const ON_SOMEONE_ELSES_GIFTS =
  'This claim is on someone else’s gifts in Hanker, so it won’t appear on yours. You can still change or cancel it here.';
