import { CleanupResultSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client } from './support/client.js';
import { openTestDatabase } from './support/database.js';

const SECRET = 'c'.repeat(48);
const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase',
  displayName: 'Bob',
};
const DAY = 24 * 60 * 60 * 1000;

const db = openTestDatabase();
let t: AuthTestApp;
let unconfigured: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url, { CRON_SECRET: SECRET });
  unconfigured = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await unconfigured.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

const runCron = (app: AuthTestApp['app'], authorization?: string) => {
  const req = http(app).get('/api/internal/cron/daily');
  return authorization ? req.set('Authorization', authorization) : req;
};
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe('GET /api/internal/cron/daily (spec §10)', () => {
  it('refuses requests without the exact bearer secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
      expect((await runCron(t.app, authorization)).status).toBe(401);
    }
  });

  it('refuses everyone when CRON_SECRET is unset', async () => {
    for (const authorization of ['Bearer undefined', `Bearer ${SECRET}`]) {
      expect((await runCron(unconfigured.app, authorization)).status).toBe(401);
    }
  });

  it('purges week-old unverified accounts, expired tokens and sessions, and stale rate-limit windows', async () => {
    await signUp(t, ADA); // stays unverified
    await signUpVerified(t, BOB);
    await logIn(t, BOB);

    t.clock.advance(31 * DAY);
    const res = await runCron(t.app, `Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = CleanupResultSchema.parse(res.body);
    // Ada's account goes, and its token and wishlist cascade with it. Bob's used verification
    // token and his 30-day session have expired.
    expect(result).toMatchObject({ unverifiedUsers: 1, emailTokens: 1, sessions: 1 });
    expect(result.rateLimitWindows).toBeGreaterThan(0);

    const { rows } = await db.pool.query<{ email: string }>('select email from users');
    expect(rows.map((r) => r.email)).toEqual([BOB.email]);
    expect(await count('wishlists')).toBe(1);
    for (const table of ['sessions', 'email_tokens', 'rate_limits'])
      expect(await count(table)).toBe(0);
  });

  it('keeps unverified accounts younger than 7 days, and live sessions', async () => {
    await signUp(t, ADA);
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);

    t.clock.advance(6 * DAY);
    const result = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);

    expect(result).toMatchObject({ unverifiedUsers: 0, sessions: 0 });
    expect(await count('users')).toBe(2);
    expect((await client(t.app, bob).get('/me')).status).toBe(200);
  });
});
