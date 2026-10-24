import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Gift, GiftsResponse, GoneGift, UpdateGiftRequest } from '@wishlist/contracts';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '../auth/sessions.service.js';
import { applyClaimChange } from '../claims/claim-change.js';
import { claimNotFound } from '../claims/claims-errors.js';
import { SHARED_ITEM_COLUMNS, SNAPSHOT } from '../claims/queries.js';
import {
  CLAIMS_PER_IP,
  CLAIMS_PER_LIST,
  claimsIpKey,
  claimsListKey,
} from '../claims/rate-limits.js';
import { remainingOf } from '../claims/remaining.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { DB, type Database, type Transaction } from '../db/database.module.js';
import { claimLinks, claims, items, users, wishlists } from '../db/schema.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { shareUrl } from '../wishlist/links.js';

const LinkIdSchema = z.uuid();

/** A live link with everything a `Gift` is made of, and what ordering it needs. */
type LiveRow = Awaited<ReturnType<GiftsService['liveRows']>>[number];

/**
 * Your gifts (design §5.9): a verified gifter's linked claims across lists, with the private
 * Bought tick. Every link is looked up by the session's own user, so another account's link ID is
 * simply unknown (`404`). Nothing here is ever readable by an owner (D75, D82).
 */
@Injectable()
export class GiftsService {
  private readonly logger = new Logger('Gifts');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Live claims, grouped by list in the order the gifter first claimed from each and by the
   * owner's order within a list, then notes about the claims that went, newest first (ruling 2).
   * One `REPEATABLE READ, READ ONLY` snapshot, so `remaining` agrees with the items beside it.
   */
  async list(user: SessionUser): Promise<GiftsResponse> {
    const { rows, notes, remaining } = await this.db.transaction(async (tx) => {
      const rows = await this.liveRows(tx, user.id);
      const notes = await tx
        .select({
          linkId: claimLinks.id,
          itemTitle: claimLinks.itemTitle,
          ownerDisplayName: claimLinks.ownerDisplayName,
          cancelledAt: claimLinks.cancelledAt,
        })
        .from(claimLinks)
        .where(and(eq(claimLinks.userId, user.id), isNull(claimLinks.claimId)))
        // The cron stamps `gone_at` on a cascaded note a day or so late, so a note without one
        // went since the cron last ran: newer than every stamped note (R14).
        .orderBy(sql`${claimLinks.goneAt} desc nulls first`, desc(claimLinks.id));
      return { rows, notes, remaining: await remainingByItem(tx, rows) };
    }, SNAPSHOT);

    const firstClaimed = new Map<string, LiveRow>();
    for (const row of rows) {
      const first = firstClaimed.get(row.wishlistId);
      if (!first || isBefore(row, first)) firstClaimed.set(row.wishlistId, row);
    }
    const ordered = [...rows].sort((a, b) => {
      if (a.wishlistId !== b.wishlistId) {
        const first = firstClaimed.get(a.wishlistId);
        const other = firstClaimed.get(b.wishlistId);
        if (first && other) return isBefore(first, other) ? -1 : 1;
      }
      return (
        a.position - b.position || compare(a.item.id, b.item.id) || compare(a.linkId, b.linkId)
      );
    });

    await this.refreshSnapshots(user.id, rows);
    return {
      gifts: ordered.map((row) => this.toGift(row, remaining)),
      gone: notes.map((note): GoneGift => ({
        linkId: note.linkId,
        itemTitle: note.itemTitle,
        ownerDisplayName: note.ownerDisplayName,
        reason: note.cancelledAt ? 'cancelled' : 'removed',
      })),
    };
  }

  /**
   * The Bought tick, a new name or quantity, or all of them; answers the gift as it now stands.
   * `bought` alone sets the link's `bought_at`, takes no item lock and charges no claim limit
   * (R13): it touches no claim, only the gifter's own row. A name or quantity follows
   * `PATCH /claims`' transaction (`applyClaimChange`), the tick in the same one, and is charged
   * like it: the IP's limit first, the list's once the link is found to have a claim.
   */
  async change(
    user: SessionUser,
    linkId: string,
    input: UpdateGiftRequest,
    ip: string,
  ): Promise<Gift> {
    const touchesClaim = input.claimerName !== undefined || input.quantity !== undefined;
    if (touchesClaim) await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    const found = await this.findLink(user, linkId);
    const { claimId, itemId, wishlistId } = found;
    // A note has no claim to change.
    if (!claimId || !itemId || !wishlistId) throw claimNotFound();
    if (touchesClaim) await this.limiter.enforce(claimsListKey(wishlistId), CLAIMS_PER_LIST);

    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // Item row first, as every claim write does (spec §6.3); the link row after the claim, the
      // order the owner deleting the item takes them in.
      if (touchesClaim) {
        await applyClaimChange(tx, {
          claimId,
          itemId,
          input: { claimerName: input.claimerName, quantity: input.quantity },
          now,
        });
      }
      if (input.bought !== undefined) {
        const [ticked] = await tx
          .update(claimLinks)
          .set({ boughtAt: input.bought ? now : null, updatedAt: now })
          .where(
            and(
              eq(claimLinks.id, linkId),
              eq(claimLinks.userId, user.id),
              isNotNull(claimLinks.claimId),
            ),
          )
          .returning({ id: claimLinks.id });
        // The claim went (cancelled, or deleted with its item) before this reached the link.
        if (!ticked) throw claimNotFound();
      }
      const [row] = await this.liveRows(tx, user.id, linkId);
      if (!row) throw claimNotFound();
      return this.toGift(row, await remainingByItem(tx, [row]));
    });
  }

  /**
   * Let it go, for a live claim: the claim and the link are deleted, and no note is left. Clear,
   * for a note: the note is deleted. Taking a claim away needs no item lock (spec §6.3). Letting
   * go counts against the IP's claim limit, then the list's; Clear touches only the gifter's own
   * row and counts against neither (R13).
   */
  async remove(user: SessionUser, linkId: string, ip: string): Promise<void> {
    const found = await this.findLink(user, linkId);
    const { claimId, wishlistId } = found;
    if (claimId && wishlistId) {
      await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
      await this.limiter.enforce(claimsListKey(wishlistId), CLAIMS_PER_LIST);
    }
    await this.db.transaction(async (tx) => {
      if (claimId) {
        // The claim's row first, then its link's: the order an item delete's cascade takes them
        // (R10). Deleting the claim nulls the link's `claim_id` and holds the link's row.
        const deleted = await tx
          .delete(claims)
          .where(eq(claims.id, claimId))
          .returning({ id: claims.id });
        // Cancelled or deleted with its item meanwhile: say so, and leave the note (R14).
        if (deleted.length === 0) throw claimNotFound();
      }
      const [link] = await tx
        .delete(claimLinks)
        .where(and(eq(claimLinks.id, linkId), eq(claimLinks.userId, user.id)))
        .returning({ id: claimLinks.id });
      // Taken off this account's gifts meanwhile (Not mine): this rolls the claim's delete back.
      if (!link) throw claimNotFound();
    });
  }

  /** The link, if it's the session's: a malformed, unknown or someone else's ID is one `404`. */
  private async findLink(user: SessionUser, linkId: string) {
    if (!LinkIdSchema.safeParse(linkId).success) throw claimNotFound();
    const [found] = await this.db
      .select({
        claimId: claimLinks.claimId,
        itemId: items.id,
        wishlistId: items.wishlistId,
      })
      .from(claimLinks)
      .leftJoin(claims, eq(claims.id, claimLinks.claimId))
      .leftJoin(items, eq(items.id, claims.itemId))
      .where(and(eq(claimLinks.id, linkId), eq(claimLinks.userId, user.id)));
    if (!found) throw claimNotFound();
    return found;
  }

  /** The session's links that still have a claim, with their claim, item, list and owner. */
  private liveRows(tx: Transaction, userId: string, linkId?: string) {
    return tx
      .select({
        linkId: claimLinks.id,
        boughtAt: claimLinks.boughtAt,
        linkedAt: claimLinks.createdAt,
        snapshotTitle: claimLinks.itemTitle,
        snapshotOwner: claimLinks.ownerDisplayName,
        claim: {
          id: claims.id,
          claimerName: claims.claimerName,
          quantity: claims.quantity,
        },
        item: SHARED_ITEM_COLUMNS,
        position: items.position,
        wishlistId: wishlists.id,
        wishlistTitle: wishlists.title,
        shareToken: wishlists.shareToken,
        ownerDisplayName: users.displayName,
      })
      .from(claimLinks)
      .innerJoin(claims, eq(claims.id, claimLinks.claimId))
      .innerJoin(items, eq(items.id, claims.itemId))
      .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
      .innerJoin(users, eq(users.id, wishlists.ownerId))
      .where(and(eq(claimLinks.userId, userId), linkId ? eq(claimLinks.id, linkId) : undefined))
      .orderBy(asc(claimLinks.createdAt), asc(claimLinks.id));
  }

  private toGift(row: LiveRow, remaining: Map<string, number>): Gift {
    return {
      linkId: row.linkId,
      claim: row.claim,
      item: row.item,
      remaining: remaining.get(row.item.id) ?? row.item.quantity,
      wishlistTitle: row.wishlistTitle,
      ownerDisplayName: row.ownerDisplayName,
      shareUrl: shareUrl(this.env.APP_ORIGIN, row.shareToken),
      bought: row.boughtAt !== null,
    };
  }

  /**
   * Keeps what a note will say current (design §5.8, ruling 3): the title and owner name that
   * differ from what a link last recorded are written back, in one statement of their own after
   * the snapshot has been read. Best effort: a failure is logged without a single value (a title,
   * a name, an ID or the driver's message, which can carry parameters) and the page is still
   * served.
   */
  private async refreshSnapshots(userId: string, rows: LiveRow[]): Promise<void> {
    const stale = rows.filter(
      (row) => row.snapshotTitle !== row.item.title || row.snapshotOwner !== row.ownerDisplayName,
    );
    if (stale.length === 0) return;
    const values = sql.join(
      stale.map((row) => sql`(${row.linkId}::uuid, ${row.item.title}, ${row.ownerDisplayName})`),
      sql`, `,
    );
    try {
      await this.db.execute(sql`
        update claim_links
           set item_title = shown.item_title,
               owner_display_name = shown.owner_display_name
          from (values ${values}) as shown(id, item_title, owner_display_name)
         where claim_links.id = shown.id
           and claim_links.user_id = ${userId}::uuid
      `);
    } catch {
      this.logger.warn('could not refresh the item titles and owner names kept for notes');
    }
  }
}

/** How many of each item are left, every claim counted, for the items these rows are on. */
async function remainingByItem(tx: Transaction, rows: LiveRow[]): Promise<Map<string, number>> {
  const ids = [...new Set(rows.map((row) => row.item.id))];
  if (ids.length === 0) return new Map();
  const totals = await tx
    .select({
      itemId: claims.itemId,
      total: sql<number>`coalesce(sum(${claims.quantity}), 0)::int`,
    })
    .from(claims)
    .where(inArray(claims.itemId, ids))
    .groupBy(claims.itemId);
  const claimed = new Map(totals.map((row) => [row.itemId, row.total]));
  return new Map(
    rows.map((row) => [row.item.id, remainingOf(row.item.quantity, claimed.get(row.item.id) ?? 0)]),
  );
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whether `a` was linked before `b`; the link ID (a v7, so time-ordered) breaks a tie. */
function isBefore(a: LiveRow, b: LiveRow): boolean {
  return (
    a.linkedAt.getTime() < b.linkedAt.getTime() ||
    (a.linkedAt.getTime() === b.linkedAt.getTime() && a.linkId < b.linkId)
  );
}
