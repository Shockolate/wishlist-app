import type { SharedWishlistResponse } from '@wishlist/contracts';
import { ownerSeesLine } from '@/lib/share-copy';
import { CardStatus } from './card-status';
import { GifterFooter } from './gifter-footer';
import { OwnerNote } from './owner-note';
import { ShareClaimsProvider } from './share-claims';
import { ShareCard } from './share-card';

const H1 = 'font-display text-[clamp(2.5rem,6vw,4rem)] leading-none [overflow-wrap:anywhere]';

/** The list behind a share link (spec §7): readable before any JavaScript loads. */
export function SharePage({
  list,
  shareToken,
}: {
  list: SharedWishlistResponse;
  shareToken: string;
}) {
  const owner = list.ownerDisplayName;
  const wants = list.viewerIsOwner ? 'You want' : `${owner} wants`;
  // The provider holds the claim sheet, so it stays mounted even when the last item goes while the
  // sheet is open: the sheet says so, rather than vanishing with the list.
  const items =
    list.items.length === 0 ? (
      <p className="mt-8 text-[15px] text-muted-foreground">
        {list.viewerIsOwner
          ? 'Your list is empty. What you add shows here.'
          : `${owner} hasn’t added anything yet.`}
      </p>
    ) : list.viewerIsOwner ? (
      <ol aria-label="Your items, most wanted first" className="mt-6 flex flex-col gap-4">
        {list.items.map((item) => (
          <ShareCard
            key={item.id}
            item={item}
            footer={
              <CardStatus
                status={{
                  wants,
                  quantity: item.quantity,
                  ...(item.claims ? { claims: item.claims } : {}),
                }}
              />
            }
          />
        ))}
      </ol>
    ) : (
      <ol aria-label={`${owner}’s items, most wanted first`} className="mt-6 flex flex-col gap-4">
        {list.items.map((item) => (
          <ShareCard
            key={item.id}
            item={item}
            footer={<GifterFooter item={item} ownerName={owner} />}
          />
        ))}
      </ol>
    );
  return (
    <>
      <h1 className={H1}>{list.title}</h1>
      {list.viewerIsOwner ? (
        <OwnerNote ownerSeesClaims={list.ownerSeesClaims} />
      ) : (
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Claim what you’ll give, so nobody else buys it too.{' '}
          {ownerSeesLine(owner, list.ownerSeesClaims)}
        </p>
      )}
      {list.viewerIsOwner ? (
        items
      ) : (
        <ShareClaimsProvider
          shareToken={shareToken}
          ownerName={owner}
          ownerSeesClaims={list.ownerSeesClaims}
          items={list.items}
        >
          {items}
        </ShareClaimsProvider>
      )}
    </>
  );
}
