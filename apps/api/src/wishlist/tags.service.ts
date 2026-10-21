import { Inject, Injectable } from '@nestjs/common';
import { MAX_TAGS_PER_ITEM, MAX_TAGS_PER_LIST, type Tag } from '@wishlist/contracts';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database, type Transaction } from '../db/database.module.js';
import { items, itemTags, tags } from '../db/schema.js';
import { lockOwnWishlist } from './own-wishlist.js';
import { keyOfCleanName } from './tag-queries.js';
import {
  itemNotFound,
  itemTagLimitReached,
  tagLimitReached,
  tagNameTaken,
  tagNotFound,
} from './wishlist-errors.js';

const IdSchema = z.uuid();

/**
 * The owner's tags (design §6). Every method is one transaction that starts with
 * `lockOwnWishlist`, so tag changes and item saves on one list run one at a time. None of them
 * locks an `items` row: that keeps the users → wishlists → items order, and a tick that inserts
 * into `item_tags` waits for a claim's lock on the item through the foreign key instead.
 *
 * Names arrive cleaned by `CreateTagRequestSchema` and `RenameTagRequestSchema`, so they are keyed
 * with `keyOfCleanName`, never `tagKey`, which would clean them a second time.
 */
@Injectable()
export class TagsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Makes the tag, or returns the list's tag with the same key as it is stored, not renamed to this
   * spelling (ruling 6). `created` tells the controller which status to send. The 51st tag is
   * 422 TAG_LIMIT_REACHED.
   */
  async create(ownerId: string, name: string): Promise<{ tag: Tag; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const nameKey = keyOfCleanName(name);
      const [existing] = await tx
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(and(eq(tags.wishlistId, wishlistId), eq(tags.nameKey, nameKey)));
      if (existing) return { tag: existing, created: false };
      const [size] = await tx
        .select({ n: count() })
        .from(tags)
        .where(eq(tags.wishlistId, wishlistId));
      if ((size?.n ?? 0) >= MAX_TAGS_PER_LIST) throw tagLimitReached();
      const now = this.clock.now();
      const id = newId();
      await tx
        .insert(tags)
        .values({ id, wishlistId, name, nameKey, createdAt: now, updatedAt: now });
      return { tag: { id, name }, created: true };
    });
  }

  /**
   * Renames the tag. Only a different tag with the same key is a conflict, so changing just the
   * case of its own name is allowed and updates `name_key` too.
   */
  async rename(ownerId: string, tagId: string, name: string): Promise<Tag> {
    if (!IdSchema.safeParse(tagId).success) throw tagNotFound();
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      await requireTag(tx, wishlistId, tagId);
      const nameKey = keyOfCleanName(name);
      const [clash] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.wishlistId, wishlistId), eq(tags.nameKey, nameKey), ne(tags.id, tagId)));
      if (clash) throw tagNameTaken();
      const [renamed] = await tx
        .update(tags)
        .set({ name, nameKey, updatedAt: this.clock.now() })
        .where(eq(tags.id, tagId))
        .returning({ id: tags.id, name: tags.name });
      if (!renamed) throw tagNotFound();
      return renamed;
    });
  }

  /** Deletes the tag. Its links go with it (cascade) and the items stay. */
  async delete(ownerId: string, tagId: string): Promise<void> {
    if (!IdSchema.safeParse(tagId).success) throw tagNotFound();
    await this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const deleted = await tx
        .delete(tags)
        .where(and(eq(tags.id, tagId), eq(tags.wishlistId, wishlistId)))
        .returning({ id: tags.id });
      if (deleted.length === 0) throw tagNotFound();
    });
  }

  /**
   * Puts the tag on the item. `item_tags` has no constraint tying a tag's list to its item's, so
   * this is the check that both are on the session's list (ruling 5). The tag is checked first.
   * An existing link is a no-op, even for an item at its limit.
   */
  async tick(ownerId: string, tagId: string, itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockAndCheckPair(tx, ownerId, tagId, itemId);
      const [linked] = await tx
        .select({ tagId: itemTags.tagId })
        .from(itemTags)
        .where(and(eq(itemTags.itemId, itemId), eq(itemTags.tagId, tagId)));
      if (linked) return;
      const [carried] = await tx
        .select({ n: count() })
        .from(itemTags)
        .where(eq(itemTags.itemId, itemId));
      if ((carried?.n ?? 0) >= MAX_TAGS_PER_ITEM) throw itemTagLimitReached();
      await tx.insert(itemTags).values({ itemId, tagId }).onConflictDoNothing();
    });
  }

  /** Takes the tag off the item. Not being on it is fine: 204 either way. */
  async untick(ownerId: string, tagId: string, itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockAndCheckPair(tx, ownerId, tagId, itemId);
      await tx.delete(itemTags).where(and(eq(itemTags.itemId, itemId), eq(itemTags.tagId, tagId)));
    });
  }

  private async lockAndCheckPair(
    tx: Transaction,
    ownerId: string,
    tagId: string,
    itemId: string,
  ): Promise<void> {
    if (!IdSchema.safeParse(tagId).success) throw tagNotFound();
    if (!IdSchema.safeParse(itemId).success) throw itemNotFound();
    const wishlistId = await lockOwnWishlist(tx, ownerId);
    await requireTag(tx, wishlistId, tagId);
    const [item] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)));
    if (!item) throw itemNotFound();
  }
}

async function requireTag(tx: Transaction, wishlistId: string, tagId: string): Promise<void> {
  const [tag] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.wishlistId, wishlistId)));
  if (!tag) throw tagNotFound();
}
