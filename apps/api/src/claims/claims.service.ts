import { Inject, Injectable } from '@nestjs/common';
import {
  CAPABILITY_TOKEN_PATTERN,
  type Claim,
  type ClaimDetailsResponse,
  type ClaimLinkResponse,
  type CreateClaimRequest,
  type CreateClaimResponse,
  type UpdateClaimRequest,
} from '@wishlist/contracts';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '../auth/sessions.service.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { isForeignKeyViolation, isUniqueViolation } from '../db/pg-errors.js';
import { claimLinks, claims, items, users, wishlists } from '../db/schema.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { hashToken, newToken } from '../security/tokens.js';
import { manageUrl, shareUrl } from '../wishlist/links.js';
import { itemNotFound } from '../wishlist/wishlist-errors.js';
import {
  claimExceedsRemaining,
  claimNotFound,
  manageTokenInUse,
  ownerCannotClaim,
  ownListClaim,
  shareLinkNotFound,
} from './claims-errors.js';
import { CLAIM_COLUMNS, SHARED_ITEM_COLUMNS, SNAPSHOT, claimedTotal } from './queries.js';
import { CLAIMS_PER_IP, CLAIMS_PER_LIST, claimsIpKey, claimsListKey } from './rate-limits.js';
import { canLink, insertLink, LINK_CLAIM_FK, linkStateOf } from './links.js';
import { fitsChangedClaim, fitsNewClaim, remainingOf } from './remaining.js';

const ItemIdSchema = z.uuid();

/** Claims, made and managed by gifters through capability links (spec §5, §6.3). */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Claims some of an item on the list behind `shareToken` (spec §5). The checks run in the
   * spec's order: malformed IDs, the IP's limit, the list, the owner (D43), the list's limit, and
   * only then the transaction, so the owner never sees a 409's `remaining` or a 429's hint.
   *
   * A request that sends the manage token of a claim already on this item gets that claim back
   * (D42): the claim sheet replays its token when an answer was lost.
   */
  async create(
    shareToken: string,
    itemId: string,
    input: CreateClaimRequest,
    viewer: SessionUser | null,
    ip: string,
  ): Promise<CreateClaimResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    // Read outside the transaction: a link rotated just after this still gets this one claim,
    // as if it had arrived a moment earlier (Plan 4a rule 3).
    const [list] = await this.db
      .select({
        id: wishlists.id,
        ownerId: wishlists.ownerId,
        ownerDisplayName: users.displayName,
      })
      .from(wishlists)
      .innerJoin(users, eq(users.id, wishlists.ownerId))
      .where(eq(wishlists.shareToken, shareToken));
    if (!list) throw shareLinkNotFound();
    // Before the list's limit (D43): a 429 there would tell the owner gifters have been claiming.
    if (viewer?.id === list.ownerId) throw ownerCannotClaim();
    await this.limiter.enforce(claimsListKey(list.id), CLAIMS_PER_LIST);

    const manageToken = input.manageToken ?? newToken(16);
    const tokenHash = hashToken(manageToken);
    // A verified, signed-in gifter's claim goes on Your gifts (D76); anyone else's is as before.
    const linker = canLink(viewer, list.ownerId) ? viewer : null;
    let made: { claim: Claim; onYourGifts: boolean };
    try {
      made = await this.db.transaction(async (tx) => {
        // Spec §6.3: the item's row lock serializes every claim write on it. Only the item is
        // locked, never the list, so the users → wishlists → items order holds.
        const [item] = await tx
          .select({ quantity: items.quantity, title: items.title })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.wishlistId, list.id)))
          .for('update');
        if (!item) throw itemNotFound();
        // After the lock, so a double tap's second request sees the first one's claim: each
        // statement at READ COMMITTED reads what had committed when it began (D42).
        const [existing] = await tx
          .select({ ...CLAIM_COLUMNS, itemId: claims.itemId })
          .from(claims)
          .where(eq(claims.manageTokenHash, tokenHash));
        const now = this.clock.now();
        // Links the claim to the session if it has none, and says whether it ended up on this
        // session's gifts: a claim another account holds stays theirs (Plan 10b ruling 5).
        const link = async (claimId: string): Promise<boolean> => {
          if (!linker) return false;
          const inserted = await insertLink(tx, {
            claimId,
            userId: linker.id,
            itemTitle: item.title,
            ownerDisplayName: list.ownerDisplayName,
            now,
          });
          return inserted || (await linkStateOf(tx, claimId, linker.id)) === 'yours';
        };
        if (existing) {
          if (existing.itemId !== itemId) throw manageTokenInUse();
          return {
            claim: {
              id: existing.id,
              claimerName: existing.claimerName,
              quantity: existing.quantity,
            },
            onYourGifts: await link(existing.id),
          };
        }
        const claimed = await claimedTotal(tx, itemId);
        if (!fitsNewClaim(input.quantity, item.quantity, claimed)) {
          throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
        }
        const [row] = await tx
          .insert(claims)
          .values({
            id: newId(),
            itemId,
            claimerName: input.claimerName,
            quantity: input.quantity,
            manageTokenHash: tokenHash,
            createdAt: now,
            updatedAt: now,
          })
          .returning(CLAIM_COLUMNS);
        if (!row) throw new Error('claim insert returned no row');
        return { claim: row, onYourGifts: await link(row.id) };
      });
    } catch (error) {
      // The same token claimed on another item at the same moment (Plan 4b rule 3).
      if (isUniqueViolation(error, 'claims_manage_token_hash_unique')) throw manageTokenInUse();
      // A replay racing a cancel: the claim was deleted between our read and the link insert.
      if (isForeignKeyViolation(error, LINK_CLAIM_FK)) throw claimNotFound();
      throw error;
    }
    return {
      claim: made.claim,
      manageToken,
      manageUrl: manageUrl(this.env.APP_ORIGIN, manageToken),
      // Absent for a guest and an unverified account: they have no Your gifts to be on.
      ...(linker && { onYourGifts: made.onYourGifts }),
    };
  }

  /**
   * The claimer's own view (spec §5.1): the manage token is the capability. The list's own owner,
   * signed in, is refused with nothing about the claim (D82).
   */
  async details(manageToken: string, viewer: SessionUser | null): Promise<ClaimDetailsResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          claim: CLAIM_COLUMNS,
          item: SHARED_ITEM_COLUMNS,
          wishlistTitle: wishlists.title,
          shareToken: wishlists.shareToken,
          ownerId: wishlists.ownerId,
          ownerSeesClaims: wishlists.showClaimsToOwner,
          ownerDisplayName: users.displayName,
        })
        .from(claims)
        .innerJoin(items, eq(items.id, claims.itemId))
        .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
        .innerJoin(users, eq(users.id, wishlists.ownerId))
        .where(eq(claims.manageTokenHash, hashToken(manageToken)));
      if (!row) throw claimNotFound();
      if (viewer?.id === row.ownerId) throw ownListClaim();
      const claimed = await claimedTotal(tx, row.item.id);
      return {
        claim: row.claim,
        item: row.item,
        wishlistTitle: row.wishlistTitle,
        ownerDisplayName: row.ownerDisplayName,
        remaining: remainingOf(row.item.quantity, claimed),
        // The list's current link, so it's right after a rotation (spec §5).
        shareUrl: shareUrl(this.env.APP_ORIGIN, row.shareToken),
        ownerSeesClaims: row.ownerSeesClaims,
        // Only for a session that could have the claim on its gifts, and never for the owner,
        // who was refused above (D76, D82).
        ...(canLink(viewer, row.ownerId) && {
          link: await linkStateOf(tx, row.claim.id, viewer.id),
        }),
      };
    }, SNAPSHOT);
  }

  /**
   * A new name, a new quantity, or both (spec §5). The new quantity may be at most what's left
   * plus what the claim holds (spec §2), so keeping or lowering it never fails (D19). The list's
   * own owner is refused before the list's limit (D82, D43), as in `create`.
   */
  async update(
    manageToken: string,
    input: UpdateClaimRequest,
    ip: string,
    viewerId: string | null,
  ): Promise<Claim> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    const tokenHash = hashToken(manageToken);
    const [found] = await this.db
      .select({
        itemId: claims.itemId,
        wishlistId: items.wishlistId,
        ownerId: wishlists.ownerId,
      })
      .from(claims)
      .innerJoin(items, eq(items.id, claims.itemId))
      .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
      .where(eq(claims.manageTokenHash, tokenHash));
    if (!found) throw claimNotFound();
    if (viewerId === found.ownerId) throw ownListClaim();
    await this.limiter.enforce(claimsListKey(found.wishlistId), CLAIMS_PER_LIST);

    return this.db.transaction(async (tx) => {
      // The same lock as a new claim's (spec §6.3): the item's row, and nothing else.
      const [item] = await tx
        .select({ quantity: items.quantity })
        .from(items)
        .where(eq(items.id, found.itemId))
        .for('update');
      // The claim may have gone while we waited: cancelled, or deleted with its item.
      const [current] = item
        ? await tx
            .select({ id: claims.id, quantity: claims.quantity })
            .from(claims)
            .where(eq(claims.manageTokenHash, tokenHash))
        : [];
      if (!item || !current) throw claimNotFound();
      if (input.quantity !== undefined) {
        const claimed = await claimedTotal(tx, found.itemId);
        if (!fitsChangedClaim(input.quantity, current.quantity, item.quantity, claimed)) {
          throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
        }
      }
      const [row] = await tx
        .update(claims)
        .set({
          ...(input.claimerName !== undefined && { claimerName: input.claimerName }),
          ...(input.quantity !== undefined && { quantity: input.quantity }),
          updatedAt: this.clock.now(),
        })
        .where(eq(claims.id, current.id))
        .returning(CLAIM_COLUMNS);
      if (!row) throw claimNotFound();
      return row;
    });
  }

  /**
   * Puts the claim behind `manageToken` on the session's gifts, if it's on nobody's (design §5,
   * D77). Answers `someone-else` when another account holds it, and leaves everything as it was.
   * Checks run in the order of `update`: the token's shape, the IP's limit, the claim, the owner
   * (D82), the list's limit, and only then the write.
   */
  async link(manageToken: string, user: SessionUser, ip: string): Promise<ClaimLinkResponse> {
    const found = await this.claimToLink(manageToken, user, ip);
    const now = this.clock.now();
    try {
      // Two statements at READ COMMITTED: when another account's insert won, ours does nothing,
      // and the read that follows sees its commit. The loop covers the winner's link being
      // removed in between, which makes the claim free again.
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await this.db.transaction(async (tx) => {
          const inserted = await insertLink(tx, {
            claimId: found.claimId,
            userId: user.id,
            itemTitle: found.itemTitle,
            ownerDisplayName: found.ownerDisplayName,
            now,
          });
          return inserted ? 'yours' : await linkStateOf(tx, found.claimId, user.id);
        });
        if (state !== 'none') return { link: state };
      }
    } catch (error) {
      // The claim was cancelled after we found it: it's gone, like any unknown token (R5).
      if (isForeignKeyViolation(error, LINK_CLAIM_FK)) throw claimNotFound();
      throw error;
    }
    throw new Error('claim link kept changing while it was being read');
  }

  /**
   * Takes the claim off the session's gifts (design §5, D77): only the session's own link, and a
   * no-op when the claim has none or another account holds it. The claim is never touched.
   */
  async unlink(manageToken: string, user: SessionUser, ip: string): Promise<void> {
    const found = await this.claimToLink(manageToken, user, ip);
    await this.db
      .delete(claimLinks)
      .where(and(eq(claimLinks.claimId, found.claimId), eq(claimLinks.userId, user.id)));
  }

  /** The guards `link` and `unlink` share, and what a link snapshots about the claim. */
  private async claimToLink(manageToken: string, user: SessionUser, ip: string) {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    const [found] = await this.db
      .select({
        claimId: claims.id,
        itemTitle: items.title,
        wishlistId: items.wishlistId,
        ownerId: wishlists.ownerId,
        ownerDisplayName: users.displayName,
      })
      .from(claims)
      .innerJoin(items, eq(items.id, claims.itemId))
      .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
      .innerJoin(users, eq(users.id, wishlists.ownerId))
      .where(eq(claims.manageTokenHash, hashToken(manageToken)));
    if (!found) throw claimNotFound();
    // Before the list's limit (D43, D82): a 429 there would tell the owner about claims.
    if (user.id === found.ownerId) throw ownListClaim();
    await this.limiter.enforce(claimsListKey(found.wishlistId), CLAIMS_PER_LIST);
    return found;
  }

  /**
   * Cancels the claim (spec §5). No lock: removing a claim can't over-commit an item (§6.3). One
   * transaction, so the claim and what it leaves behind go together (Plan 10b ruling 4): where
   * the claim is on someone's gifts and the canceller isn't that account, its link stays as a
   * `cancelled` note; where it's the canceller's own, the link goes with the claim, no note. The
   * list's own owner, signed in, is refused (D82).
   */
  async cancel(manageToken: string, viewer: SessionUser | null): Promise<void> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    const tokenHash = hashToken(manageToken);
    await this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({
          claimId: claims.id,
          ownerId: wishlists.ownerId,
          linkId: claimLinks.id,
          linkUserId: claimLinks.userId,
        })
        .from(claims)
        .innerJoin(items, eq(items.id, claims.itemId))
        .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
        .leftJoin(claimLinks, eq(claimLinks.claimId, claims.id))
        .where(eq(claims.manageTokenHash, tokenHash));
      if (!found) throw claimNotFound();
      if (viewer?.id === found.ownerId) throw ownListClaim();
      if (found.linkId !== null) {
        if (viewer?.id === found.linkUserId) {
          await tx.delete(claimLinks).where(eq(claimLinks.id, found.linkId));
        } else {
          // The cron would stamp `gone_at` on a note that lacks one, but a cancel knows when.
          const now = this.clock.now();
          await tx
            .update(claimLinks)
            .set({ cancelledAt: now, goneAt: now, updatedAt: now })
            .where(eq(claimLinks.id, found.linkId));
        }
      }
      // Deleting the claim is what sets the link's `claim_id` to null (the foreign key).
      const deleted = await tx
        .delete(claims)
        .where(eq(claims.id, found.claimId))
        .returning({ id: claims.id });
      // Cancelled meanwhile from another device: this transaction's note rolls back with it.
      if (deleted.length === 0) throw claimNotFound();
    });
  }
}
