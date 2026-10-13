import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { wishlists } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';

/**
 * Locks the owner's wishlist row until the transaction ends, and returns its ID. Every change to a
 * list or its items starts here, so the changes to one list run one at a time (spec §5). The lock
 * order is users → wishlists → items, the order an account deletion's cascade takes. No row means
 * the account was deleted after SessionGuard checked the session (Plan 3a rule 4).
 */
export async function lockOwnWishlist(tx: Transaction, ownerId: string): Promise<string> {
  const [row] = await tx
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.ownerId, ownerId))
    .for('update');
  if (!row) throw unauthenticated();
  return row.id;
}
