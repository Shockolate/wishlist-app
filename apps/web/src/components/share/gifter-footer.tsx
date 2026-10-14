'use client';

import type { SharedItem } from '@wishlist/contracts';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ownClaimsOn } from '@/lib/claim-records';
import { isTaken, mineOf, ownStripText, type ItemClaims } from '@/lib/share-copy';
import { CardStatus } from './card-status';
import { useShareClaims } from './share-claims';

/**
 * The bottom of a card for a gifter: who has it covered, this browser's own claim with its way to
 * change it, or the button that opens the claim sheet. One claim per item from one browser
 * (Plan 4b rule 6): the manage page raises it.
 */
export function GifterFooter({ item, ownerName }: { item: SharedItem; ownerName: string }) {
  const { records, open } = useShareClaims();
  const mine = ownClaimsOn(records, item.id).filter((record) =>
    item.claims?.some((claim) => claim.id === record.claimId),
  );
  const status: ItemClaims = {
    wants: `${ownerName} wants`,
    quantity: item.quantity,
    ...(item.claims ? { claims: item.claims } : {}),
    ownIds: new Set(mine.flatMap((record) => (record.claimId ? [record.claimId] : []))),
  };
  const getting = mineOf(status);
  const manageToken = mine[0]?.manageToken;
  return (
    <>
      <CardStatus status={status} />
      {getting > 0 && manageToken ? (
        <p className="mt-3 flex items-center gap-2 rounded-control bg-success-wash py-1 pr-1 pl-3.5 text-[15px] font-medium text-success-foreground">
          <span className="flex-1">{ownStripText(getting)}</span>
          <Link
            href={`/c/${manageToken}`}
            prefetch={false}
            className="inline-flex min-h-11 items-center px-3 font-semibold underline"
          >
            Change<span className="sr-only"> your claim on {item.title}</span>
          </Link>
        </p>
      ) : isTaken(status) ? null : (
        <Button className="mt-3 w-full" onClick={(event) => open(item, event.currentTarget)}>
          I’ll get this<span className="sr-only">: {item.title}</span>
        </Button>
      )}
    </>
  );
}
