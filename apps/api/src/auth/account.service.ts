import { Inject, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest, MeResponse } from '@wishlist/contracts';
import { and, eq, ne } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { wrongPassword } from './auth-errors.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LOGIN_PER_EMAIL } from './rate-limits.js';
import type { AuthContext } from './session.guard.js';

/** What a signed-in user can change about their own account (spec §5). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
    @Inject(EmailTokensService) private readonly tokens: EmailTokensService,
  ) {}

  async updateDisplayName(auth: AuthContext, displayName: string): Promise<MeResponse> {
    await this.db
      .update(users)
      .set({ displayName, updatedAt: this.clock.now() })
      .where(eq(users.id, auth.user.id));
    return { ...auth.user, displayName };
  }

  /** Revokes every other session and keeps this one (spec §6.1), in the same transaction. */
  async changePassword(auth: AuthContext, input: ChangePasswordRequest): Promise<void> {
    await this.confirmPassword(auth, input.currentPassword);
    await this.passwordPolicy.assertNotBreached(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: this.clock.now() })
        .where(eq(users.id, auth.user.id));
      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)));
      // A reset link sent before the change must not be able to undo it (rule 18).
      await this.tokens.retireUnused(tx, auth.user.id, 'reset_password');
    });
  }

  /** Deleting the user cascades to the wishlist, sessions and email tokens (spec §4). */
  async deleteAccount(auth: AuthContext, password: string): Promise<void> {
    await this.confirmPassword(auth, password);
    await this.db.delete(users).where(eq(users.id, auth.user.id));
  }

  /**
   * Re-checks the password before a sensitive change. Attempts count against login's per-address
   * bucket, so a stolen session can't be used to brute-force the password.
   */
  private async confirmPassword(auth: AuthContext, password: string): Promise<void> {
    await this.limiter.enforce(rateLimitKey('login:email', auth.user.email), LOGIN_PER_EMAIL);
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.user.id));
    if (!row || !(await verifyPassword(row.passwordHash, password))) throw wrongPassword();
  }
}
