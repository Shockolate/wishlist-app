import type { Item } from '@wishlist/contracts';
import { countLine } from './share-copy';

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

/**
 * What the owner's own share page says under a card: how many they want when it's more than one
 * (as it did before D75), and, once they've opted in, how many are claimed.
 */
export function ownerShareLines(item: Pick<Item, 'quantity' | 'claimed'>): {
  want: string | null;
  claim: EditorClaimLine | null;
} {
  return {
    want: countLine({ wants: 'You want', quantity: item.quantity }),
    claim: ownerClaimLine(item),
  };
}
