import type { Claim, UpdateClaimRequest } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { claims, items } from '../db/schema.js';
import { claimExceedsRemaining, claimNotFound } from './claims-errors.js';
import { CLAIM_COLUMNS, claimedTotal } from './queries.js';
import { fitsChangedClaim, remainingOf } from './remaining.js';

/**
 * A new name, a new quantity, or both, for one claim (spec §5, §6.3): the body of the transaction
 * behind `PATCH /claims/:manageToken` and `PATCH /me/gifts/:linkId`, so both follow the same rules.
 * It takes the item's row lock, and nothing else, then re-reads the claim: it may have gone while
 * the caller waited, cancelled or deleted with its item, and that is `claimNotFound`.
 *
 * The new quantity may be at most what's left plus what the claim holds (spec §2), so keeping or
 * lowering it never fails (D19); a larger one that doesn't fit is a 409 carrying `remaining`.
 */
export async function applyClaimChange(
  tx: Transaction,
  change: { claimId: string; itemId: string; input: UpdateClaimRequest; now: Date },
): Promise<Claim> {
  const { claimId, itemId, input, now } = change;
  const [item] = await tx
    .select({ quantity: items.quantity })
    .from(items)
    .where(eq(items.id, itemId))
    .for('update');
  const [current] = item
    ? await tx
        .select({ id: claims.id, quantity: claims.quantity })
        .from(claims)
        .where(eq(claims.id, claimId))
    : [];
  if (!item || !current) throw claimNotFound();
  if (input.quantity !== undefined) {
    const claimed = await claimedTotal(tx, itemId);
    if (!fitsChangedClaim(input.quantity, current.quantity, item.quantity, claimed)) {
      throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
    }
  }
  const [row] = await tx
    .update(claims)
    .set({
      ...(input.claimerName !== undefined && { claimerName: input.claimerName }),
      ...(input.quantity !== undefined && { quantity: input.quantity }),
      updatedAt: now,
    })
    .where(eq(claims.id, current.id))
    .returning(CLAIM_COLUMNS);
  if (!row) throw claimNotFound();
  return row;
}
