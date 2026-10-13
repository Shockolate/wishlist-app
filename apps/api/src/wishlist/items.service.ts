import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_ITEMS,
  type CreateItemRequest,
  type Item,
  type UpdateItemRequest,
} from '@wishlist/contracts';
import { and, count, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { items } from '../db/schema.js';
import { ITEM_COLUMNS } from './item-columns.js';
import { lockOwnWishlist } from './own-wishlist.js';
import { itemNotFound, listFull, orderConflict } from './wishlist-errors.js';

const ItemIdSchema = z.uuid();

/** The items on the owner's list (spec §2, §5). Every change runs under the list's row lock. */
@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Appends the item to the end of the list (spec §2). The 201st is 422 LIST_FULL. */
  async create(ownerId: string, input: CreateItemRequest): Promise<Item> {
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
      return item;
    });
  }

  /** Changes only the fields sent. Null or blank clears an optional one (Plan 3a rule 1). */
  async update(ownerId: string, itemId: string, input: UpdateItemRequest): Promise<Item> {
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const [item] = await tx
        .update(items)
        .set({ ...sentFields(input), updatedAt: this.clock.now() })
        .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)))
        .returning(ITEM_COLUMNS);
      if (!item) throw itemNotFound();
      return item;
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

/** What a PATCH sent. Undefined means "leave it", and null means "clear it" (Plan 3a rule 1). */
function sentFields(input: UpdateItemRequest): Partial<UpdateItemRequest> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
