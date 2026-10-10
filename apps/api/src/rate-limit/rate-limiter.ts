import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { rateLimits } from '../db/schema.js';
import { rateLimited } from '../http/errors.js';
import { fixedWindow, type RateLimitRule } from './window.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Counts one hit against `key` in the current window. The upsert row-locks the counter, so
   * concurrent hits on the same key are serialized and can never all slip under the limit.
   */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const { start, retryAfterSeconds } = fixedWindow(
      this.clock.now().getTime(),
      rule.windowSeconds,
    );
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    if (!row) throw new Error('rate limit upsert returned no row');
    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfterSeconds,
    };
  }

  /** Counts a hit and throws 429 with Retry-After once `key` is over its limit (spec §6.6). */
  async enforce(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.consume(key, rule);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }
}
