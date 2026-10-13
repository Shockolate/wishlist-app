import type { Item } from '@wishlist/contracts';
import type { ReactNode, Ref } from 'react';
import { shopName } from '@/lib/item-display';
import { cn } from '@/lib/utils';
import { ItemPhoto } from './item-photo';

/** One row of the list (D37). Its title button opens the item's form in place, below it. */
export function ItemRow({
  item,
  open,
  onToggle,
  titleButtonRef,
  children,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
  titleButtonRef: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const formId = `edit-${item.id}`;
  return (
    <li
      className={cn(
        'border-t border-foreground/15 first:border-t-0',
        open && 'bg-background shadow-[inset_3px_0_0_var(--foreground)]',
      )}
    >
      <div className="flex items-center gap-1.5 py-2.5 pr-1 pl-2.5">
        <ItemPhoto item={item} />
        <button
          ref={titleButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={onToggle}
          className="min-h-14 min-w-0 flex-1 rounded-control px-1.5 text-left"
        >
          <ItemSummary item={item} />
        </button>
      </div>
      {open ? <div id={formId}>{children}</div> : null}
    </li>
  );
}

/** The title and its details: price, how many, the shop, or what the idea is. */
export function ItemSummary({ item }: { item: Item }) {
  const shop = shopName(item.url);
  return (
    <>
      <span className="block text-base leading-snug font-semibold [overflow-wrap:anywhere]">
        {item.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
        {item.priceText ? <span className="text-foreground">{item.priceText}</span> : null}
        {item.quantity > 1 ? (
          <span className="rounded-full border border-border px-2 text-[13px] text-foreground">
            {item.quantity} wanted
          </span>
        ) : null}
        {shop ? <span className="[overflow-wrap:anywhere]">{shop}</span> : null}
        {item.url === null ? (
          <span className="block w-full truncate">
            {item.note ? `An idea: ${item.note}` : 'An idea'}
          </span>
        ) : null}
      </span>
    </>
  );
}
