import type { Item } from '@wishlist/contracts';
import { shopName } from '@/lib/item-display';
import { ItemPhoto } from './item-photo';

/** One row of the list (D37). Task 4 opens it in place; Task 5 adds the handle and the arrows. */
export function ItemRow({ item }: { item: Item }) {
  return (
    <li className="flex items-center gap-1.5 border-t border-foreground/15 py-2.5 pr-1 pl-2.5 first:border-t-0">
      <ItemPhoto item={item} />
      <div className="min-w-0 flex-1 px-1.5">
        <ItemSummary item={item} />
      </div>
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
