import type { SharedWishlistResponse } from '@wishlist/contracts';
import { ownerSeesLine } from '@/lib/share-copy';
import { CardStatus } from './card-status';
import { OwnerNote } from './owner-note';
import { ShareCard } from './share-card';

const H1 = 'font-display text-[clamp(2.5rem,6vw,4rem)] leading-none [overflow-wrap:anywhere]';

/** The list behind a share link (spec §7): readable before any JavaScript loads. */
export function SharePage({ list }: { list: SharedWishlistResponse; shareToken: string }) {
  const owner = list.ownerDisplayName;
  const wants = list.viewerIsOwner ? 'You want' : `${owner} wants`;
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
      {list.items.length === 0 ? (
        <p className="mt-8 text-[15px] text-muted-foreground">
          {list.viewerIsOwner
            ? 'Your list is empty. What you add shows here.'
            : `${owner} hasn’t added anything yet.`}
        </p>
      ) : (
        <ol
          aria-label={
            list.viewerIsOwner
              ? 'Your items, most wanted first'
              : `${owner}’s items, most wanted first`
          }
          className="mt-6 flex flex-col gap-4"
        >
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
      )}
    </>
  );
}
