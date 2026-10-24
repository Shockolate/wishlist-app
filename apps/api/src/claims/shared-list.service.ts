import { Inject, Injectable } from '@nestjs/common';
import { CAPABILITY_TOKEN_PATTERN, type SharedWishlistResponse } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '../auth/sessions.service.js';
import { DB, type Database } from '../db/database.module.js';
import { users, wishlists } from '../db/schema.js';
import { readTagIdsByItem, readTags } from '../wishlist/tag-queries.js';
import { shareLinkNotFound } from './claims-errors.js';
import { canLink } from './links.js';
import { projectWishlist, seesClaims, type Viewer } from './projection.js';
import { readClaims, readSharedItems, SNAPSHOT } from './queries.js';

/** The list behind a share link (spec §5). Anyone holding the link may look. */
@Injectable()
export class SharedListService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The list as `viewer` may see it (spec §5.1): the owner, signed in, sees claim totals once
   * they opt in, never names (D75). A verified non-owner also gets their own display name back,
   * for the claim sheet (D76). A malformed token is refused before the database is asked.
   */
  async get(shareToken: string, viewer: SessionUser | null): Promise<SharedWishlistResponse> {
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
      const viewerIsOwner = viewer?.id === list.ownerId;
      const audience: Viewer = viewerIsOwner
        ? { kind: 'owner', showClaims: list.showClaims }
        : { kind: 'guest' };
      const sharedRows = await readSharedItems(tx, list.id);
      const tagIdsByItem = await readTagIdsByItem(tx, list.id);
      const rows = sharedRows.map((row) => ({ ...row, tagIds: tagIdsByItem.get(row.id) ?? [] }));
      // An owner who hasn't opted in never gets claim data: it isn't even read (spec §5).
      const claimRows = seesClaims(audience) ? await readClaims(tx, list.id) : [];
      return {
        title: list.title,
        ownerDisplayName: list.ownerDisplayName,
        viewerIsOwner,
        ownerSeesClaims: list.showClaims,
        // Only tags some item carries: a gifter never sees an empty tag (Plan 7a).
        tags: await readTags(tx, list.id, { usedOnly: true }),
        items: projectWishlist(rows, claimRows, audience),
        ...(canLink(viewer, list.ownerId) && { viewer: { displayName: viewer.displayName } }),
      };
    }, SNAPSHOT);
  }
}
