import { MAX_TAGS_PER_LIST, type ItemTagRef, type Tag } from '@wishlist/contracts';
import { and, asc, eq, exists } from 'drizzle-orm';
import { newId } from '../core/ids.js';
import type { Transaction } from '../db/database.module.js';
import { itemTags as itemTagRows, tags } from '../db/schema.js';
import { tagLimitReached } from './wishlist-errors.js';

/**
 * The list's tags, by `name_key` then ID, which is the order every response uses (Plan 7a). With
 * `usedOnly`, a tag no item carries is left out: gifters never see an empty tag.
 */
export function readTags(
  tx: Transaction,
  wishlistId: string,
  opts: { usedOnly: boolean },
): Promise<Tag[]> {
  const onTheList = eq(tags.wishlistId, wishlistId);
  const carried = exists(
    tx.select({ one: itemTagRows.tagId }).from(itemTagRows).where(eq(itemTagRows.tagId, tags.id)),
  );
  return tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(opts.usedOnly ? and(onTheList, carried) : onTheList)
    .orderBy(asc(tags.nameKey), asc(tags.id));
}

/**
 * Each item's tag IDs, in the same order as `readTags`. An item with no tags has no entry, so
 * callers default to `[]`.
 */
export async function readTagIdsByItem(
  tx: Transaction,
  wishlistId: string,
): Promise<Map<string, string[]>> {
  const links = await tx
    .select({ itemId: itemTagRows.itemId, tagId: itemTagRows.tagId })
    .from(itemTagRows)
    .innerJoin(tags, eq(tags.id, itemTagRows.tagId))
    .where(eq(tags.wishlistId, wishlistId))
    .orderBy(asc(tags.nameKey), asc(tags.id));
  const byItem = new Map<string, string[]>();
  for (const { itemId, tagId } of links) {
    const ids = byItem.get(itemId) ?? [];
    ids.push(tagId);
    byItem.set(itemId, ids);
  }
  return byItem;
}

/**
 * The `name_key` of a name that `TagNameSchema` has already cleaned, which is every name in a
 * parsed request (design §3). Raw input uses `tagKey` from the contracts, which cleans first; for
 * a cleaned name the two agree.
 */
export function keyOfCleanName(name: string): string {
  return name.toLowerCase();
}

/**
 * Turns an item's `tags` into tag IDs on this list (design §6), in first-seen order, each once.
 * An `id` that isn't on the list is dropped without a word: the tag was deleted in another tab, or
 * was never this owner's, and a save from a stale form must not fail or bring it back. A `name`
 * joins the list's tag with the same key, or makes one; it is matched on the stored `name_key`
 * that the unique index enforces, so a spelling that differs only in case or spacing never makes
 * a second tag. Must run in a transaction that holds `lockOwnWishlist`: that lock is what makes
 * the load-then-insert safe, and it is the only guard that an ID belongs to this list, because
 * `item_tags` has no constraint tying a tag's list to its item's.
 */
export async function resolveTagRefs(
  tx: Transaction,
  wishlistId: string,
  refs: ItemTagRef[],
  now: Date,
): Promise<string[]> {
  const stored = await tx
    .select({ id: tags.id, nameKey: tags.nameKey })
    .from(tags)
    .where(eq(tags.wishlistId, wishlistId));
  const onList = new Set(stored.map((tag) => tag.id));
  const idByKey = new Map(stored.map((tag) => [tag.nameKey, tag.id]));
  const resolved = new Set<string>();
  for (const ref of refs) {
    if ('id' in ref) {
      // `z.uuid()` accepts upper case, and Postgres hands IDs back in lower case.
      const id = ref.id.toLowerCase();
      if (onList.has(id)) resolved.add(id);
      continue;
    }
    const key = keyOfCleanName(ref.name);
    let id = idByKey.get(key);
    if (id === undefined) {
      if (onList.size >= MAX_TAGS_PER_LIST) throw tagLimitReached();
      id = newId();
      await tx
        .insert(tags)
        .values({ id, wishlistId, name: ref.name, nameKey: key, createdAt: now, updatedAt: now });
      onList.add(id);
      idByKey.set(key, id);
    }
    resolved.add(id);
  }
  return [...resolved];
}

/**
 * Makes `tagIds` the item's whole tag set. The IDs must come from `resolveTagRefs` on the item's
 * own list, and the caller must hold `lockOwnWishlist`.
 */
export async function setItemTags(
  tx: Transaction,
  itemId: string,
  tagIds: string[],
): Promise<void> {
  await tx.delete(itemTagRows).where(eq(itemTagRows.itemId, itemId));
  if (tagIds.length === 0) return;
  await tx.insert(itemTagRows).values(tagIds.map((tagId) => ({ itemId, tagId })));
}

/** The item's tags, in the order every response uses. */
export function itemTags(tx: Transaction, itemId: string): Promise<Tag[]> {
  return tx
    .select({ id: tags.id, name: tags.name })
    .from(itemTagRows)
    .innerJoin(tags, eq(tags.id, itemTagRows.tagId))
    .where(eq(itemTagRows.itemId, itemId))
    .orderBy(asc(tags.nameKey), asc(tags.id));
}
