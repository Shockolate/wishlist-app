import type { SharedItem } from '@wishlist/contracts';
import type { ReactNode } from 'react';
import { ExternalIcon, IdeaIcon } from '@/components/list/icons';
import { shopName } from '@/lib/item-display';
import { cn } from '@/lib/utils';
import { CardPhoto } from './card-photo';

type CardItem = Pick<SharedItem, 'id' | 'title' | 'url' | 'imageUrl' | 'priceText' | 'note'>;

export const CARD = 'overflow-hidden rounded-card border border-border bg-card';

/**
 * What a card shows of an item: photo, title, price, the shop's link, the owner's note. The share
 * page and the manage page both use it. The title takes focus when the claim sheet closes and its
 * button is gone (Plan 4b, Task 4).
 */
export function ItemCardBody({ item, footer }: { item: CardItem; footer?: ReactNode }) {
  const shop = shopName(item.url);
  return (
    <>
      {item.imageUrl ? <CardPhoto src={item.imageUrl} /> : null}
      <div className="p-4">
        {item.url === null ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            <IdeaIcon />
            An idea
          </p>
        ) : null}
        <h2
          id={`item-${item.id}`}
          tabIndex={-1}
          className={cn(
            'text-[17px] leading-snug font-semibold [overflow-wrap:anywhere]',
            item.url === null && 'mt-1.5',
          )}
        >
          {item.title}
        </h2>
        {item.priceText || (item.url && shop) ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] text-muted-foreground">
            {item.priceText ? (
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">
                {item.priceText}
              </span>
            ) : null}
            {item.url && shop ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-0 items-center gap-1 text-foreground underline [overflow-wrap:anywhere]"
              >
                See it at {shop}
                <ExternalIcon />
              </a>
            ) : null}
          </p>
        ) : null}
        {item.note ? (
          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
            {item.note}
          </p>
        ) : null}
        {footer}
      </div>
    </>
  );
}

/** One item on the share page, as the approved share board draws it. */
export function ShareCard({ item, footer }: { item: CardItem; footer: ReactNode }) {
  return (
    <li className={CARD}>
      <ItemCardBody item={item} footer={footer} />
    </li>
  );
}
