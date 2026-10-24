import { eq } from 'drizzle-orm';
import type { SessionUser } from '../auth/sessions.service.js';
import { newId } from '../core/ids.js';
import type { Transaction } from '../db/database.module.js';
import { claimLinks } from '../db/schema.js';

/** Whose gifts a claim is on, as one session sees it (design §5). */
export type LinkState = 'none' | 'yours' | 'someone-else';

/**
 * Who may have claims on Your gifts (design §2, D76): a signed-in user whose email is confirmed
 * and who isn't the list's owner. An owner is refused before this is asked (D43, D82).
 */
export function canLink(user: SessionUser | null, ownerId: string): user is SessionUser {
  return user !== null && user.emailVerified && user.id !== ownerId;
}

/** Whether a claim is on no account's gifts, on this user's, or on someone else's. */
export async function linkStateOf(
  tx: Transaction,
  claimId: string,
  userId: string,
): Promise<LinkState> {
  const [row] = await tx
    .select({ userId: claimLinks.userId })
    .from(claimLinks)
    .where(eq(claimLinks.claimId, claimId));
  if (!row) return 'none';
  return row.userId === userId ? 'yours' : 'someone-else';
}

/**
 * Puts a claim on a user's gifts, with the snapshot of its item's title and the owner's name that
 * a note keeps if the claim goes (D80). A claim is on at most one account's gifts: when it already
 * has a link, whoever's it is, this does nothing and returns false. Callers hold the item's row
 * lock, so no other lock is taken here.
 */
export async function insertLink(
  tx: Transaction,
  link: {
    claimId: string;
    userId: string;
    itemTitle: string;
    ownerDisplayName: string;
    now: Date;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(claimLinks)
    .values({
      id: newId(),
      claimId: link.claimId,
      userId: link.userId,
      itemTitle: link.itemTitle,
      ownerDisplayName: link.ownerDisplayName,
      createdAt: link.now,
      updatedAt: link.now,
    })
    .onConflictDoNothing({ target: claimLinks.claimId })
    .returning({ id: claimLinks.id });
  return inserted.length > 0;
}
