import { asc, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { claims, items } from '../db/schema.js';
import type { ClaimRow } from './projection.js';

/**
 * Every read that returns claims runs in one snapshot, so `remaining` always agrees with the items
 * beside it (Plan 3a final review; spec §5).
 */
export const SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** An item as gifters see it: the owner's fields without its position (spec §5). */
export const SHARED_ITEM_COLUMNS = {
  id: items.id,
  title: items.title,
  url: items.url,
  imageUrl: items.imageUrl,
  priceText: items.priceText,
  note: items.note,
  quantity: items.quantity,
};

/** A claim as the API returns it (`Claim` in contracts): never its item or its token's hash. */
export const CLAIM_COLUMNS = {
  id: claims.id,
  claimerName: claims.claimerName,
  quantity: claims.quantity,
};

export function readSharedItems(tx: Transaction, wishlistId: string) {
  return tx
    .select(SHARED_ITEM_COLUMNS)
    .from(items)
    .where(eq(items.wishlistId, wishlistId))
    .orderBy(asc(items.position), asc(items.id));
}

/** Every claim on the list, oldest first (Plan 4a rule 10). */
export function readClaims(tx: Transaction, wishlistId: string): Promise<ClaimRow[]> {
  return tx
    .select({ ...CLAIM_COLUMNS, itemId: claims.itemId })
    .from(claims)
    .innerJoin(items, eq(items.id, claims.itemId))
    .where(eq(items.wishlistId, wishlistId))
    .orderBy(asc(claims.createdAt), asc(claims.id));
}

/**
 * How many of an item are claimed, every claim counted. To decide a write, trust it only inside a
 * transaction that holds the item's row lock, at READ COMMITTED (the default): after the lock wait,
 * each statement sees what the previous holder committed. Under a read-only `SNAPSHOT` it is
 * consistent but may be stale, which is fine for display.
 */
export async function claimedTotal(tx: Transaction, itemId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${claims.quantity}), 0)::int` })
    .from(claims)
    .where(eq(claims.itemId, itemId));
  return row?.total ?? 0;
}
