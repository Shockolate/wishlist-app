import type { Item } from '@wishlist/contracts';
import { ItemRow } from './item-row';

export function ItemList({ items }: { items: Item[] }) {
  return (
    <ol
      aria-label="Your items, most wanted first"
      className="mt-5 overflow-hidden rounded-card border border-border bg-card"
    >
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </ol>
  );
}
