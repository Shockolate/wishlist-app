import { Inject, Injectable } from '@nestjs/common';
import {
  CAPABILITY_TOKEN_PATTERN,
  type CreateClaimRequest,
  type CreateClaimResponse,
} from '@wishlist/contracts';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { claims, items, wishlists } from '../db/schema.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { hashToken, newToken } from '../security/tokens.js';
import { manageUrl } from '../wishlist/links.js';
import { itemNotFound } from '../wishlist/wishlist-errors.js';
import { claimExceedsRemaining, ownerCannotClaim, shareLinkNotFound } from './claims-errors.js';
import { CLAIM_COLUMNS, claimedTotal } from './queries.js';
import { CLAIMS_PER_IP, CLAIMS_PER_LIST, claimsIpKey, claimsListKey } from './rate-limits.js';
import { fitsNewClaim, remainingOf } from './remaining.js';

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
   * spec's order: malformed IDs, the IP's limit, the list, its limit, the owner, and only then the
   * transaction, so the owner never sees a 409's `remaining`.
   */
  async create(
    shareToken: string,
    itemId: string,
    input: CreateClaimRequest,
    viewerId: string | null,
    ip: string,
  ): Promise<CreateClaimResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    // Read outside the transaction: a link rotated just after this still gets this one claim,
    // as if it had arrived a moment earlier (Plan 4a rule 3).
    const [list] = await this.db
      .select({ id: wishlists.id, ownerId: wishlists.ownerId })
      .from(wishlists)
      .where(eq(wishlists.shareToken, shareToken));
    if (!list) throw shareLinkNotFound();
    await this.limiter.enforce(claimsListKey(list.id), CLAIMS_PER_LIST);
    if (viewerId === list.ownerId) throw ownerCannotClaim();

    const manageToken = newToken(16);
    const claim = await this.db.transaction(async (tx) => {
      // Spec §6.3: the item's row lock serializes every claim write on it. Only the item is
      // locked, never the list, so the users → wishlists → items order holds.
      const [item] = await tx
        .select({ quantity: items.quantity })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.wishlistId, list.id)))
        .for('update');
      if (!item) throw itemNotFound();
      const claimed = await claimedTotal(tx, itemId);
      if (!fitsNewClaim(input.quantity, item.quantity, claimed)) {
        throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
      }
      const now = this.clock.now();
      const [row] = await tx
        .insert(claims)
        .values({
          id: newId(),
          itemId,
          claimerName: input.claimerName,
          quantity: input.quantity,
          manageTokenHash: hashToken(manageToken),
          createdAt: now,
          updatedAt: now,
        })
        .returning(CLAIM_COLUMNS);
      if (!row) throw new Error('claim insert returned no row');
      return row;
    });
    return { claim, manageToken, manageUrl: manageUrl(this.env.APP_ORIGIN, manageToken) };
  }
}
