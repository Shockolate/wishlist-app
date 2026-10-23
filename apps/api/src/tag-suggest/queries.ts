import type { Tag } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { wishlists } from '../db/schema.js';
import { readTags } from '../wishlist/tag-queries.js';

/**
 * The owner's `suggestTags` setting and every tag on their list, read together so the setting and
 * the names agree. Null means the owner has no list: the account was deleted after SessionGuard
 * checked the session.
 */
export async function readSuggestContext(
  tx: Transaction,
  ownerId: string,
): Promise<{ suggestTags: boolean; tags: Tag[] } | null> {
  const [list] = await tx
    .select({ id: wishlists.id, suggestTags: wishlists.suggestTags })
    .from(wishlists)
    .where(eq(wishlists.ownerId, ownerId));
  if (!list) return null;
  return {
    suggestTags: list.suggestTags,
    tags: await readTags(tx, list.id, { usedOnly: false }),
  };
}
