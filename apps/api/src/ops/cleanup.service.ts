import { Inject, Injectable } from '@nestjs/common';
import type { CleanupResult } from '@wishlist/contracts';
import { and, isNull, lt } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { emailTokens, rateLimits, sessions, users } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily purge (spec §6.5, §10 "Monitoring and maintenance"). */
@Injectable()
export class CleanupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async runDaily(): Promise<CleanupResult> {
    const now = this.clock.now();
    // Unverified accounts first. Deleting one cascades to its wishlist, tokens and sessions. After a
    // week, a squatted, never-verified address mustn't keep blocking a real signup (spec §6.5).
    const unverified = await this.db
      .delete(users)
      .where(
        and(
          isNull(users.emailVerifiedAt),
          lt(users.createdAt, new Date(now.getTime() - 7 * DAY_MS)),
        ),
      );
    const tokens = await this.db.delete(emailTokens).where(lt(emailTokens.expiresAt, now));
    const expired = await this.db.delete(sessions).where(lt(sessions.expiresAt, now));
    // The longest rate-limit window is an hour, so a window that started a day ago counts nothing.
    const windows = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now.getTime() - DAY_MS)));
    return {
      unverifiedUsers: unverified.rowCount ?? 0,
      emailTokens: tokens.rowCount ?? 0,
      sessions: expired.rowCount ?? 0,
      rateLimitWindows: windows.rowCount ?? 0,
    };
  }
}
