import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import type { Database, Transaction } from '../db/database.module.js';
import { emailTokens, users, type EmailTokenPurpose } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';

/** Spec §6.5: verify links last 24 hours, reset links 1 hour. */
export const EMAIL_TOKEN_TTL_MS: Readonly<Record<EmailTokenPurpose, number>> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

/** Single-use email-link tokens. Only their SHA-256 is stored (spec §4, §6.5). */
@Injectable()
export class EmailTokensService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * A fresh token; the user's earlier unused tokens for this purpose stop working. Locking the
   * user's row first serializes concurrent calls for one user: the second waits, and its delete
   * then sees the first's committed token (rule 18). Lock order: the user's row before its
   * email_tokens rows; consume() and changePassword follow it too.
   */
  async issue(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<string> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await this.retireUnused(tx, userId, purpose);
    const now = this.clock.now();
    const token = newToken(32);
    await tx.insert(emailTokens).values({
      id: newId(),
      userId,
      purpose,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  /** Deletes the user's unused tokens for a purpose, e.g. spare reset links once the password changed. */
  async retireUnused(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<void> {
    await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.consumedAt),
        ),
      );
  }

  /** The user a live token belongs to, without using it up. A cheap check before expensive work. */
  async peek(db: Database, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const [row] = await db
      .select({ userId: emailTokens.userId })
      .from(emailTokens)
      .where(this.live(token, purpose));
    return row?.userId ?? null;
  }

  /**
   * Uses up a live token inside the caller's transaction and returns its user. Returns null if
   * the token is unknown, expired or already used. Locking the token row makes a concurrent
   * second use wait, then find the token consumed. Lock order: the user's row before its
   * email_tokens rows, as in issue() and changePassword, so the callers' later users UPDATE
   * can't deadlock with them.
   */
  async consume(
    tx: Transaction,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<string | null> {
    const [found] = await tx
      .select({ userId: emailTokens.userId })
      .from(emailTokens)
      .where(this.live(token, purpose));
    if (!found) return null;
    // Lock order: the users row before email_tokens rows, as issue() and changePassword do.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, found.userId))
      .for('no key update');
    const [row] = await tx
      .select({ id: emailTokens.id, userId: emailTokens.userId })
      .from(emailTokens)
      .where(this.live(token, purpose))
      .for('update');
    // Superseded by issue(), or retired by a password change, while waiting for the user's row.
    if (!row) return null;
    await tx
      .update(emailTokens)
      .set({ consumedAt: this.clock.now() })
      .where(eq(emailTokens.id, row.id));
    return row.userId;
  }

  private live(token: string, purpose: EmailTokenPurpose): SQL | undefined {
    return and(
      eq(emailTokens.tokenHash, hashToken(token)),
      eq(emailTokens.purpose, purpose),
      isNull(emailTokens.consumedAt),
      gt(emailTokens.expiresAt, this.clock.now()),
    );
  }
}
