import type { SharedItem } from '@wishlist/contracts';
import { CheckIcon } from '@/components/list/icons';
import { ownerClaimLine } from '@/lib/editor-claims';

/**
 * What an owner's own share page says about an item's claims once they've opted in (D75): how many
 * are claimed, never by whom. Nothing when the API sent no total. Styled as `CardStatus` is for
 * gifters: a sage strip when it's all claimed, a muted line otherwise.
 */
export function OwnerClaimStatus({ item }: { item: Pick<SharedItem, 'quantity' | 'claimed'> }) {
  const line = ownerClaimLine(item);
  if (!line) return null;
  if (line.kind === 'taken') {
    return (
      <p className="-mx-4 mt-3 -mb-4 flex items-center gap-2 bg-success-wash px-4 py-3 text-[15px] font-medium text-success-foreground">
        <CheckIcon />
        <span className="[overflow-wrap:anywhere]">{line.text}</span>
      </p>
    );
  }
  return (
    <p className="mt-2.5 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
      {line.text}
    </p>
  );
}
