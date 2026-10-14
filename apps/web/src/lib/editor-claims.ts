import { remainingOf, type Item } from '@wishlist/contracts';
import { joinNames } from './share-copy';

export interface EditorClaimLine {
  text: string;
  kind: 'none' | 'some' | 'taken';
}

/**
 * The line under an item on /list once the owner has opted in (D33, the Plan 4b mockups). Null
 * when the API sent no claims: the owner hasn't opted in (spec §5.1).
 */
export function editorClaimLine({
  quantity,
  claims,
}: Pick<Item, 'quantity' | 'claims'>): EditorClaimLine | null {
  if (claims === undefined) return null;
  if (claims.length === 0) return { text: 'No claims yet', kind: 'none' };
  const remaining = remainingOf(
    quantity,
    claims.reduce((sum, claim) => sum + claim.quantity, 0),
  );
  if (remaining === 0) {
    const names = [...new Set(claims.map((claim) => claim.claimerName))];
    return {
      text: `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} getting this`,
      kind: 'taken',
    };
  }
  const who = claims.map((claim) => `${claim.claimerName} ×${claim.quantity}`).join(', ');
  return { text: `${who} · ${remaining} left`, kind: 'some' };
}
