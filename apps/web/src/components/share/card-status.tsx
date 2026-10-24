import { CheckIcon } from '@/components/list/icons';
import { countLine, isTaken, mineOf, takenLine, type ItemClaims } from '@/lib/share-copy';

/**
 * What a card says about its claims: who has it covered, or how many are left. Rendered
 * inside the gifter's footer in the browser. The owner sees a count instead (`OwnerClaimStatus`).
 */
export function CardStatus({ status }: { status: ItemClaims }) {
  if (isTaken(status) && mineOf(status) === 0) {
    return (
      <p className="-mx-4 mt-3 -mb-4 flex items-center gap-2 bg-success-wash px-4 py-3 text-[15px] font-medium text-success-foreground">
        <CheckIcon />
        <span className="[overflow-wrap:anywhere]">{takenLine(status)}</span>
      </p>
    );
  }
  const line = countLine(status);
  return line ? (
    <p className="mt-2.5 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
      {line}
    </p>
  ) : null;
}
