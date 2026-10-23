import type { SharedItem } from '@wishlist/contracts';
import { CheckIcon } from '@/components/list/icons';
import { ownerShareLines } from '@/lib/editor-claims';

const MUTED = 'mt-2.5 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]';

/**
 * What an owner's own share page says under a card: "You want 3." when it's more than one, and once
 * they've opted in (D75) how many are claimed, never by whom. Styled as `CardStatus` is for
 * gifters: a sage strip when it's all claimed, a muted line otherwise.
 */
export function OwnerClaimStatus({ item }: { item: Pick<SharedItem, 'quantity' | 'claimed'> }) {
  const { want, claim } = ownerShareLines(item);
  return (
    <>
      {want && <p className={MUTED}>{want}</p>}
      {claim?.kind === 'taken' ? (
        <p className="-mx-4 mt-3 -mb-4 flex items-center gap-2 bg-success-wash px-4 py-3 text-[15px] font-medium text-success-foreground">
          <CheckIcon />
          <span className="[overflow-wrap:anywhere]">{claim.text}</span>
        </p>
      ) : (
        claim && <p className={MUTED}>{claim.text}</p>
      )}
    </>
  );
}
