import { items } from '../db/schema.js';

/** An item as the API returns it (`Item` in contracts): every field, empty ones as null. */
export const ITEM_COLUMNS = {
  id: items.id,
  title: items.title,
  url: items.url,
  imageUrl: items.imageUrl,
  priceText: items.priceText,
  note: items.note,
  quantity: items.quantity,
  position: items.position,
};
