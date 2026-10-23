import type { Item } from '@wishlist/contracts';

export interface EditorClaimLine {
  text: string;
  kind: 'none' | 'some' | 'taken';
}

/**
 * How many of an item are claimed, as the owner sees it on /list and on their own share page once
 * they've opted in (D75): a count, never a name. Null when the API sent no `claimed`: the owner
 * hasn't opted in (spec §5.1). `claimed` is unclamped (D19), so it can exceed `quantity`.
 */
export function ownerClaimLine({
  quantity,
  claimed,
}: Pick<Item, 'quantity' | 'claimed'>): EditorClaimLine | null {
  if (claimed === undefined) return null;
  if (claimed === 0) return { text: 'None claimed yet', kind: 'none' };
  if (claimed < quantity) return { text: `${claimed} of ${quantity} claimed`, kind: 'some' };
  if (claimed === quantity) {
    return { text: quantity === 1 ? 'Claimed' : `All ${quantity} claimed`, kind: 'taken' };
  }
  return { text: `${claimed} of ${quantity} claimed`, kind: 'taken' };
}
