import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CAPABILITY_TOKEN_PATTERN,
  PREVIEW_CANDIDATES,
  type PreviewPhotoType,
  type SharePreviewResponse,
} from '@wishlist/contracts';
import { and, asc, count, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Database } from '../db/database.module.js';
import { items, users, wishlists } from '../db/schema.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { PHOTO_FETCHER, type PhotoFetcher } from '../unfurl/photo-fetcher.js';
import { photoUnavailable, shareLinkNotFound } from './claims-errors.js';
import { SNAPSHOT } from './queries.js';
import {
  PREVIEW_PHOTOS_OVERALL,
  PREVIEW_PHOTOS_OVERALL_KEY,
  PREVIEW_PHOTOS_PER_LIST,
  previewPhotosListKey,
} from './rate-limits.js';

const ItemIdSchema = z.uuid();

/**
 * What a share link's preview image is drawn from (Plan 12). It is the same for every viewer and
 * never reads a claim, so no claim data can reach a chat app's copy of the image (design §5.4).
 */
@Injectable()
export class SharePreviewService {
  private readonly logger = new Logger('SharePreview');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(PHOTO_FETCHER) private readonly photos: PhotoFetcher,
  ) {}

  /**
   * The list's title, its owner's name, how many items it has, and the first PREVIEW_CANDIDATES
   * items with a photo in list order, all from one snapshot. A malformed token is refused before
   * the database is asked.
   */
  async preview(shareToken: string): Promise<SharePreviewResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    return this.db.transaction(async (tx) => {
      const [list] = await tx
        .select({
          id: wishlists.id,
          title: wishlists.title,
          ownerDisplayName: users.displayName,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.ownerId))
        .where(eq(wishlists.shareToken, shareToken));
      if (!list) throw shareLinkNotFound();
      const [counted] = await tx
        .select({ n: count() })
        .from(items)
        .where(eq(items.wishlistId, list.id));
      const withPhotos = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.wishlistId, list.id), isNotNull(items.imageUrl)))
        .orderBy(asc(items.position), asc(items.id))
        .limit(PREVIEW_CANDIDATES);
      return {
        title: list.title,
        ownerDisplayName: list.ownerDisplayName,
        itemCount: counted?.n ?? 0,
        photoItemIds: withPhotos.map((item) => item.id),
      };
    }, SNAPSHOT);
  }

  /**
   * One item's photo, fetched under spec §6.8's rules (design §5.1). The checks run in ruling 5's
   * order: the token's shape and the item ID's, then the list and item by one query, then the
   * list's limit, the overall limit, and only then the fetch. So a missing photo never counts
   * against a limit, and another list's item is never fetched (Review Focus 5).
   */
  async photo(
    shareToken: string,
    itemId: string,
  ): Promise<{ bytes: Buffer; contentType: PreviewPhotoType }> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    if (!ItemIdSchema.safeParse(itemId).success) throw photoUnavailable();
    // A left join: the list decides SHARE_LINK_NOT_FOUND, and only an item on it has a photo here.
    const [found] = await this.db
      .select({ listId: wishlists.id, imageUrl: items.imageUrl })
      .from(wishlists)
      .leftJoin(items, and(eq(items.wishlistId, wishlists.id), eq(items.id, itemId)))
      .where(eq(wishlists.shareToken, shareToken));
    if (!found) throw shareLinkNotFound();
    if (!found.imageUrl) throw photoUnavailable();
    await this.limiter.enforce(previewPhotosListKey(found.listId), PREVIEW_PHOTOS_PER_LIST);
    await this.limiter.enforce(PREVIEW_PHOTOS_OVERALL_KEY, PREVIEW_PHOTOS_OVERALL);
    const photo = await this.photos.fetch(found.imageUrl);
    // `=== false`, not `!photo.ok`: Vercel's builder type-checks without strictNullChecks (see metadata-fetcher.ts).
    if (photo.ok === false) {
      // The host and the reason only, as unfurl logs: the URL's path can carry personal data.
      this.logger.log(`preview photo skipped reason=${photo.reason} host=${photo.host ?? 'none'}`);
      throw photoUnavailable();
    }
    return { bytes: photo.bytes, contentType: photo.contentType };
  }
}
