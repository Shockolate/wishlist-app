import { Inject, Injectable } from '@nestjs/common';
import { CAPABILITY_TOKEN_PATTERN, type SharedWishlistResponse } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { users, wishlists } from '../db/schema.js';
import { readTagIdsByItem, readTags } from '../wishlist/tag-queries.js';
import { shareLinkNotFound } from './claims-errors.js';
import { projectWishlist, seesClaims, type Viewer } from './projection.js';
import { readClaims, readSharedItems, SNAPSHOT } from './queries.js';

/** The list behind a share link (spec §5). Anyone holding the link may look. */
@Injectable()
export class SharedListService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The list as `viewerId` may see it (spec §5.1): the owner, signed in, sees claim totals once
   * they opt in (D75; the claims beside them until the contract step). A malformed token is
   * refused before the database is asked.
   */
  async get(shareToken: string, viewerId: string | null): Promise<SharedWishlistResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    return this.db.transaction(async (tx) => {
      const [list] = await tx
        .select({
          id: wishlists.id,
          ownerId: wishlists.ownerId,
          title: wishlists.title,
          showClaims: wishlists.showClaimsToOwner,
          ownerDisplayName: users.displayName,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.ownerId))
        .where(eq(wishlists.shareToken, shareToken));
      if (!list) throw shareLinkNotFound();
      const viewerIsOwner = viewerId === list.ownerId;
      const viewer: Viewer = viewerIsOwner
        ? { kind: 'owner', showClaims: list.showClaims }
        : { kind: 'guest' };
      const sharedRows = await readSharedItems(tx, list.id);
      const tagIdsByItem = await readTagIdsByItem(tx, list.id);
      const rows = sharedRows.map((row) => ({ ...row, tagIds: tagIdsByItem.get(row.id) ?? [] }));
      // An owner who hasn't opted in never gets claim data: it isn't even read (spec §5).
      const claimRows = seesClaims(viewer) ? await readClaims(tx, list.id) : [];
      return {
        title: list.title,
        ownerDisplayName: list.ownerDisplayName,
        viewerIsOwner,
        ownerSeesClaims: list.showClaims,
        // Only tags some item carries: a gifter never sees an empty tag (Plan 7a).
        tags: await readTags(tx, list.id, { usedOnly: true }),
        items: projectWishlist(rows, claimRows, viewer),
      };
    }, SNAPSHOT);
  }
}
