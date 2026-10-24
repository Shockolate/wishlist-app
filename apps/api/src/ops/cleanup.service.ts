import { Inject, Injectable } from '@nestjs/common';
import type { CleanupResult } from '@wishlist/contracts';
import { and, isNotNull, isNull, lt } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { claimLinks, emailTokens, rateLimits, sessions, users } from '../db/schema.js';

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
    // Your gifts notes (Plan 10b, D79, D80): a link whose claim is gone. A foreign key's SET NULL
    // can't stamp a time, so notes a cascade made have no gone_at yet; stamp them now, then delete
    // the ones stamped more than 30 days ago. This runs after the purge above, so notes it made
    // start their 30 days today. A cascaded note therefore lives 30 to 31 days. A live link
    // (claim_id set) is never touched.
    await this.db
      .update(claimLinks)
      .set({ goneAt: now })
      .where(and(isNull(claimLinks.claimId), isNull(claimLinks.goneAt)));
    const notes = await this.db
      .delete(claimLinks)
      .where(
        and(
          isNull(claimLinks.claimId),
          isNotNull(claimLinks.goneAt),
          lt(claimLinks.goneAt, new Date(now.getTime() - 30 * DAY_MS)),
        ),
      );
    return {
      unverifiedUsers: unverified.rowCount ?? 0,
      emailTokens: tokens.rowCount ?? 0,
      sessions: expired.rowCount ?? 0,
      rateLimitWindows: windows.rowCount ?? 0,
      giftNotes: notes.rowCount ?? 0,
    };
  }
}
