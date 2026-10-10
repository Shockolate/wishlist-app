import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest } from '@wishlist/contracts';
import { DB, type Database } from '../db/database.module.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { burnPasswordCheck, verifyPassword } from '../security/passwords.js';
import { invalidCredentials } from './auth-errors.js';
import { LOGIN_PER_EMAIL, LOGIN_PER_IP } from './rate-limits.js';
import { SessionsService } from './sessions.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class LoginService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  /**
   * Spec §5, §6.4, §6.6. Both limits apply before the lookup, so a 429 says nothing about whether
   * the address exists. An unknown address still costs a full argon2 check. Unverified users may
   * log in; owner endpoints check verification (Plan 3).
   */
  async login(input: LoginRequest, ip: string): Promise<{ token: string; maxAgeMs: number }> {
    await this.limiter.enforce(rateLimitKey('login:ip', ip), LOGIN_PER_IP);
    await this.limiter.enforce(rateLimitKey('login:email', input.email), LOGIN_PER_EMAIL);
    const user = await findUserByEmail(this.db, input.email);
    if (!user) {
      await burnPasswordCheck(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();
    return this.sessions.create(user.id);
  }
}
