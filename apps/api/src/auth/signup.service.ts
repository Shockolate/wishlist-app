import { Inject, Injectable } from '@nestjs/common';
import type { ResendVerificationRequest, SignupRequest } from '@wishlist/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { users, wishlists } from '../db/schema.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword } from '../security/passwords.js';
import { newToken } from '../security/tokens.js';
import { invalidToken } from './auth-errors.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class SignupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EmailGate) private readonly gate: EmailGate,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
    @Inject(EmailTokensService) private readonly tokens: EmailTokensService,
    @Inject(AuthEmails) private readonly emails: AuthEmails,
  ) {}

  /**
   * Spec §5. A new address gets an account, its wishlist (spec §2) and a verification email. An
   * existing address gets an "already have an account" email instead, and the response is the same
   * either way.
   */
  async signup(input: SignupRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    await this.passwordPolicy.assertNotBreached(input.password);
    // Hash before looking the address up, so argon2 (the slow part) runs whether or not it exists.
    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();

    const verifyToken = await this.db.transaction(async (tx) => {
      const userId = newId();
      // DO NOTHING covers the unique lower(email) index, including a concurrent signup.
      const [created] = await tx
        .insert(users)
        .values({
          id: userId,
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!created) return null;
      await tx.insert(wishlists).values({
        id: newId(),
        ownerId: userId,
        title: `${input.displayName}'s wishlist`,
        shareToken: newToken(16),
        createdAt: now,
        updatedAt: now,
      });
      return this.tokens.issue(tx, userId, 'verify_email');
    });

    if (verifyToken) this.emails.verification(input.email, verifyToken);
    else this.emails.accountExists(input.email);
  }

  async verifyEmail(token: string): Promise<void> {
    const now = this.clock.now();
    const verified = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, token, 'verify_email');
      if (!userId) return false;
      await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
      return true;
    });
    if (!verified) throw invalidToken();
  }

  /** Spec §5: always 202. Only an unverified account gets an email. */
  async resendVerification(input: ResendVerificationRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    const user = await findUserByEmail(this.db, input.email);
    if (!user || user.emailVerifiedAt) return;
    const token = await this.db.transaction((tx) => this.tokens.issue(tx, user.id, 'verify_email'));
    this.emails.verification(user.email, token);
  }
}
