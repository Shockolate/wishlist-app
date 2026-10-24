import type { Gift } from '@wishlist/contracts';

export interface GiftGroup {
  shareUrl: string;
  ownerDisplayName: string;
  wishlistTitle: string;
  gifts: Gift[];
}

/**
 * Runs of gifts on the same list. The API has already put each list's gifts together, by your
 * earliest claim on it (Plan 10b ruling 2), so this only cuts the sequence where the list changes.
 * It never reorders: a list that comes round again is a new group rather than a surprise move.
 */
export function groupByList(gifts: readonly Gift[]): GiftGroup[] {
  const groups: GiftGroup[] = [];
  for (const gift of gifts) {
    const last = groups.at(-1);
    if (last?.shareUrl === gift.shareUrl) {
      last.gifts.push(gift);
    } else {
      groups.push({
        shareUrl: gift.shareUrl,
        ownerDisplayName: gift.ownerDisplayName,
        wishlistTitle: gift.wishlistTitle,
        gifts: [gift],
      });
    }
  }
  return groups;
}
