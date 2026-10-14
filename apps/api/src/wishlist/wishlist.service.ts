import { Inject, Injectable } from '@nestjs/common';
import type {
  RotateShareTokenResponse,
  WishlistResponse,
  WishlistSettingsResponse,
} from '@wishlist/contracts';
import { asc, eq } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { DB, type Database } from '../db/database.module.js';
import { items, wishlists } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';
import { newToken } from '../security/tokens.js';
import { ITEM_COLUMNS } from './item-columns.js';
import { shareUrl as shareUrlFor } from './links.js';

/** The list itself: reading it, renaming it and rotating its share link (spec §5). */
@Injectable()
export class WishlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The owner's list with its items in order. Claim data joins it in Plan 4 (D33). */
  async get(ownerId: string): Promise<WishlistResponse> {
    const [list] = await this.db
      .select({ id: wishlists.id, title: wishlists.title, shareToken: wishlists.shareToken })
      .from(wishlists)
      .where(eq(wishlists.ownerId, ownerId));
    if (!list) throw unauthenticated();
    const rows = await this.db
      .select(ITEM_COLUMNS)
      .from(items)
      .where(eq(items.wishlistId, list.id))
      .orderBy(asc(items.position), asc(items.id));
    return { title: list.title, shareUrl: this.shareUrl(list.shareToken), items: rows };
  }

  async rename(ownerId: string, title: string): Promise<WishlistSettingsResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({ title, updatedAt: this.clock.now() })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({ title: wishlists.title, shareToken: wishlists.shareToken });
    if (!list) throw unauthenticated();
    return { title: list.title, shareUrl: this.shareUrl(list.shareToken) };
  }

  /** A fresh token: the old link stops working at once, and claims are unaffected (spec §2). */
  async rotateShareToken(ownerId: string): Promise<RotateShareTokenResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({ shareToken: newToken(16), updatedAt: this.clock.now() })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({ shareToken: wishlists.shareToken });
    if (!list) throw unauthenticated();
    return { shareUrl: this.shareUrl(list.shareToken) };
  }

  private shareUrl(shareToken: string): string {
    return shareUrlFor(this.env.APP_ORIGIN, shareToken);
  }
}
