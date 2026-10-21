import type { Tag } from '@wishlist/contracts';
import { and, asc, eq, exists } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { itemTags, tags } from '../db/schema.js';

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
    tx.select({ one: itemTags.tagId }).from(itemTags).where(eq(itemTags.tagId, tags.id)),
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
    .select({ itemId: itemTags.itemId, tagId: itemTags.tagId })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
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
