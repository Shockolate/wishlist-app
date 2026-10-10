import { ErrorCode } from '@wishlist/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../src/core/clock.js';
import { RateLimiter } from '../src/rate-limit/rate-limiter.js';
import { openTestDatabase } from './support/database.js';

class FakeClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
}

const database = openTestDatabase();
afterAll(() => database.close());
beforeEach(() => database.truncateAll());

const rule = { limit: 3, windowSeconds: 60 };

describe('RateLimiter', () => {
  it('allows hits up to the limit, then blocks until the window resets', async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 10));
    const limiter = new RateLimiter(database.db, clock);

    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await limiter.consume('login:email:a@example.com', rule));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.retryAfterSeconds).toBe(50);

    clock.ms += 50_000;
    expect((await limiter.consume('login:email:a@example.com', rule)).allowed).toBe(true);
  });

  it('counts keys independently', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 0)));
    for (let i = 0; i < 3; i++) await limiter.consume('key-a', rule);
    expect((await limiter.consume('key-a', rule)).allowed).toBe(false);
    expect((await limiter.consume('key-b', rule)).allowed).toBe(true);
  });

  it('enforce throws 429 RATE_LIMITED with Retry-After once over the limit', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 30)));
    const one = { limit: 1, windowSeconds: 60 };
    await limiter.enforce('enforced', one);
    await expect(limiter.enforce('enforced', one)).rejects.toMatchObject({
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      headers: { 'Retry-After': '30' },
    });
  });

  it('admits exactly `limit` hits when requests race', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 0)));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.consume('race', { limit: 5, windowSeconds: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
