import { Inject, Injectable } from '@nestjs/common';
import type {
  RotateShareTokenResponse,
  UpdateWishlistRequest,
  WishlistResponse,
  WishlistSettingsResponse,
} from '@wishlist/contracts';
import { asc, eq } from 'drizzle-orm';
import { projectWishlist, seesClaims, type Viewer } from '../claims/projection.js';
import { readClaims, SNAPSHOT } from '../claims/queries.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { DB, type Database } from '../db/database.module.js';
import { items, wishlists } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';
import { newToken } from '../security/tokens.js';
import { ITEM_COLUMNS } from './item-columns.js';
import { shareUrl as shareUrlFor } from './links.js';
import { readTagIdsByItem, readTags } from './tag-queries.js';

/** The list itself: reading it, its settings, and rotating its share link (spec §5). */
@Injectable()
export class WishlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The owner's list, its items in order with their tag IDs, every tag, and claim data only after
   * opting in (spec §5.1). One snapshot, so `remaining` and the tags agree with the items beside
   * them.
   */
  async get(ownerId: string): Promise<WishlistResponse> {
    return this.db.transaction(async (tx) => {
      const [list] = await tx
        .select({
          id: wishlists.id,
          title: wishlists.title,
          shareToken: wishlists.shareToken,
          showClaims: wishlists.showClaimsToOwner,
          suggestTags: wishlists.suggestTags,
        })
        .from(wishlists)
        .where(eq(wishlists.ownerId, ownerId));
      if (!list) throw unauthenticated();
      const rows = await tx
        .select(ITEM_COLUMNS)
        .from(items)
        .where(eq(items.wishlistId, list.id))
        .orderBy(asc(items.position), asc(items.id));
      const tagIdsByItem = await readTagIdsByItem(tx, list.id);
      const tagged = rows.map((row) => ({ ...row, tagIds: tagIdsByItem.get(row.id) ?? [] }));
      const viewer: Viewer = { kind: 'owner', showClaims: list.showClaims };
      // An owner who hasn't opted in never gets claim data: it isn't even read (spec §5).
      const claimRows = seesClaims(viewer) ? await readClaims(tx, list.id) : [];
      return {
        title: list.title,
        shareUrl: this.shareUrl(list.shareToken),
        showClaimsToOwner: list.showClaims,
        suggestTags: list.suggestTags,
        tags: await readTags(tx, list.id, { usedOnly: false }),
        items: projectWishlist(tagged, claimRows, viewer),
      };
    }, SNAPSHOT);
  }

  /** A new title, the spoiler setting, tag suggestions, or any mix (spec §5, D33). One UPDATE takes the row lock. */
  async updateSettings(
    ownerId: string,
    changes: UpdateWishlistRequest,
  ): Promise<WishlistSettingsResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({
        ...(changes.title !== undefined && { title: changes.title }),
        ...(changes.showClaimsToOwner !== undefined && {
          showClaimsToOwner: changes.showClaimsToOwner,
        }),
        ...(changes.suggestTags !== undefined && { suggestTags: changes.suggestTags }),
        updatedAt: this.clock.now(),
      })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({
        title: wishlists.title,
        shareToken: wishlists.shareToken,
        showClaimsToOwner: wishlists.showClaimsToOwner,
        suggestTags: wishlists.suggestTags,
      });
    if (!list) throw unauthenticated();
    return {
      title: list.title,
      shareUrl: this.shareUrl(list.shareToken),
      showClaimsToOwner: list.showClaimsToOwner,
      suggestTags: list.suggestTags,
    };
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
