import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_ITEMS,
  type CreateItemRequest,
  type Item,
  type ItemWriteResponse,
  type UpdateItemRequest,
} from '@wishlist/contracts';
import { and, count, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database, type Transaction } from '../db/database.module.js';
import { items } from '../db/schema.js';
import { ITEM_COLUMNS } from './item-columns.js';
import { lockOwnWishlist } from './own-wishlist.js';
import { itemTags, resolveTagRefs, setItemTags } from './tag-queries.js';
import { itemNotFound, listFull, orderConflict } from './wishlist-errors.js';

const ItemIdSchema = z.uuid();

/** The items on the owner's list (spec §2, §5). Every change runs under the list's row lock. */
@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Appends the item to the end of the list (spec §2). The 201st is 422 LIST_FULL. Its tags are
   * saved in the same transaction (design §6), so a refused tag leaves no item behind.
   */
  async create(ownerId: string, input: CreateItemRequest): Promise<ItemWriteResponse> {
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const [list] = await tx
        .select({ size: count(), last: max(items.position) })
        .from(items)
        .where(eq(items.wishlistId, wishlistId));
      if ((list?.size ?? 0) >= MAX_ITEMS) throw listFull();
      const now = this.clock.now();
      const [item] = await tx
        .insert(items)
        .values({
          id: newId(),
          wishlistId,
          title: input.title,
          url: input.url ?? null,
          imageUrl: input.imageUrl ?? null,
          priceText: input.priceText ?? null,
          note: input.note ?? null,
          quantity: input.quantity,
          position: (list?.last ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning(ITEM_COLUMNS);
      if (!item) throw new Error('item insert returned no row');
      const tagIds = await resolveTagRefs(tx, wishlistId, input.tags ?? [], now);
      await setItemTags(tx, item.id, tagIds);
      return withTags(tx, item);
    });
  }

  /**
   * Changes only the fields sent. Null or blank clears an optional one (Plan 3a rule 1). `tags`
   * replaces the item's whole tag set, `[]` clears it, and leaving it out changes nothing (design
   * §6). Either way the response carries the item's current tags.
   */
  async update(
    ownerId: string,
    itemId: string,
    input: UpdateItemRequest,
  ): Promise<ItemWriteResponse> {
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const now = this.clock.now();
      const [item] = await tx
        .update(items)
        .set({ ...sentFields(input), updatedAt: now })
        .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)))
        .returning(ITEM_COLUMNS);
      if (!item) throw itemNotFound();
      if (input.tags !== undefined) {
        await setItemTags(tx, item.id, await resolveTagRefs(tx, wishlistId, input.tags, now));
      }
      return withTags(tx, item);
    });
  }

  async delete(ownerId: string, itemId: string): Promise<void> {
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    await this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const deleted = await tx
        .delete(items)
        .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)))
        .returning({ id: items.id });
      if (deleted.length === 0) throw itemNotFound();
    });
  }

  /**
   * Rewrites the whole order (spec §5). The IDs must be exactly the list's current items, each
   * once. Anything else means another tab changed the list, and the editor refetches (409).
   */
  async reorder(ownerId: string, itemIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const current = await tx
        .select({ id: items.id })
        .from(items)
        .where(eq(items.wishlistId, wishlistId));
      const wanted = new Set(itemIds);
      const exact =
        wanted.size === itemIds.length &&
        wanted.size === current.length &&
        current.every((row) => wanted.has(row.id));
      if (!exact) throw orderConflict();
      if (itemIds.length === 0) return;
      // One statement: each item's new position is its index in itemIds.
      const positions = sql.join(
        itemIds.map((id, index) => sql`when ${id}::uuid then ${index}::int`),
        sql` `,
      );
      await tx
        .update(items)
        .set({ position: sql`case ${items.id} ${positions} end`, updatedAt: this.clock.now() })
        .where(eq(items.wishlistId, wishlistId));
    });
  }
}

/** The item as a write answers (Plan 7a ruling 1): its tag IDs and the tags they name. */
async function withTags(tx: Transaction, item: Item): Promise<ItemWriteResponse> {
  const tags = await itemTags(tx, item.id);
  return { ...item, tagIds: tags.map((tag) => tag.id), tags };
}

/** The columns a PATCH may write. An id, a position or a list is never one of them. */
type ItemChanges = Partial<
  Pick<typeof items.$inferInsert, 'title' | 'url' | 'imageUrl' | 'priceText' | 'note' | 'quantity'>
>;

/**
 * What a PATCH sent, picked field by field: undefined means "leave it", and null means "clear it"
 * (Plan 3a rule 1). Naming the six fields keeps `wishlistId`, `position` and `id` out of the
 * UPDATE even if the request schema is ever loosened.
 */
function sentFields(input: UpdateItemRequest): ItemChanges {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.url !== undefined && { url: input.url }),
    ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
    ...(input.priceText !== undefined && { priceText: input.priceText }),
    ...(input.note !== undefined && { note: input.note }),
    ...(input.quantity !== undefined && { quantity: input.quantity }),
  };
}
