import { Inject, Injectable } from '@nestjs/common';
import type { PasswordResetConfirmRequest, PasswordResetRequest } from '@wishlist/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword } from '../security/passwords.js';
import { invalidToken } from './auth-errors.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EmailGate) private readonly gate: EmailGate,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
    @Inject(EmailTokensService) private readonly tokens: EmailTokensService,
    @Inject(AuthEmails) private readonly emails: AuthEmails,
  ) {}

  /** Spec §5: always 202, whether or not the address has an account. */
  async request(input: PasswordResetRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    const user = await findUserByEmail(this.db, input.email);
    if (!user) return;
    const token = await this.db.transaction((tx) =>
      this.tokens.issue(tx, user.id, 'reset_password'),
    );
    this.emails.passwordReset(user.email, token);
  }

  /**
   * Spec §5. It sets the new password and verifies the address if it wasn't already, since the
   * reset proves the person reads that inbox. Then it revokes every session. The token is checked
   * before the breach check and the hash, so a made-up token can't make the server do that work.
   */
  async confirm(input: PasswordResetConfirmRequest): Promise<void> {
    if (!(await this.tokens.peek(this.db, input.token, 'reset_password'))) throw invalidToken();
    await this.passwordPolicy.assertNotBreached(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.clock.now();

    const reset = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, input.token, 'reset_password');
      if (!userId) return false;
      // Any other live reset link would undo this reset for the next hour (rule 18).
      await this.tokens.retireUnused(tx, userId, 'reset_password');
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
      await tx
        .update(users)
        .set({ emailVerifiedAt: now })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      return true;
    });
    if (!reset) throw invalidToken();
  }
}
