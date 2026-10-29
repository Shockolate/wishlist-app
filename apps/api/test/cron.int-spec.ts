import {
  CleanupResultSchema,
  CreateClaimResponseSchema,
  GiftsResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanupService } from '../src/ops/cleanup.service.js';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedItem, shareTokenOf } from './support/lists.js';

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

  describe('the heartbeat (D86)', () => {
    it('pings succeeded once after an authorized run', async () => {
      const res = await runCron(t.app, `Bearer ${SECRET}`);
      expect(res.status).toBe(200);
      CleanupResultSchema.parse(res.body);
      expect(t.heartbeat.pings).toEqual(['succeeded']);
    });

    it('pings nothing when unauthorized', async () => {
      expect((await runCron(t.app, 'Bearer wrong')).status).toBe(401);
      expect(t.heartbeat.pings).toEqual([]);
    });

    it('pings failed and still fails when the cleanup throws', async () => {
      const cleanup = t.app.get(CleanupService);
      const spy = vi.spyOn(cleanup, 'runDaily').mockRejectedValueOnce(new Error('cleanup broke'));
      try {
        const res = await runCron(t.app, `Bearer ${SECRET}`);
        expect(res.status).toBe(500);
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect(t.heartbeat.pings).toEqual(['failed']);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('the Neon quota check (D105)', () => {
    it('runs once after an authorized run', async () => {
      expect((await runCron(t.app, `Bearer ${SECRET}`)).status).toBe(200);
      expect(t.quota.runs).toBe(1);
    });

    it('does not run when unauthorized', async () => {
      expect((await runCron(t.app, 'Bearer wrong')).status).toBe(401);
      expect(t.quota.runs).toBe(0);
    });

    it('still runs when the cleanup throws, and the run still fails', async () => {
      const cleanup = t.app.get(CleanupService);
      const spy = vi.spyOn(cleanup, 'runDaily').mockRejectedValueOnce(new Error('cleanup broke'));
      try {
        expect((await runCron(t.app, `Bearer ${SECRET}`)).status).toBe(500);
        expect(t.quota.runs).toBe(1);
        expect(t.heartbeat.pings).toEqual(['failed']);
      } finally {
        spy.mockRestore();
      }
    });
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
    expect(result).toMatchObject({ unverifiedUsers: 1, emailTokens: 1, sessions: 1, giftNotes: 0 });
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

    expect(result).toMatchObject({ unverifiedUsers: 0, sessions: 0, giftNotes: 0 });
    expect(await count('users')).toBe(2);
    expect((await client(t.app, bob).get('/me')).status).toBe(200);
  });

  it('stamps gone_at on new notes, and deletes notes older than 30 days (Plan 10b, D79)', async () => {
    await signUpVerified(t);
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);
    const shareToken = await shareTokenOf(db, ADA.email);
    const kettle = await seedItem(db, ADA.email, 'Kettle');
    const mug = await seedItem(db, ADA.email, 'Mug');
    // Bob has two linked claims; the owner deleting the kettle leaves a note no code stamped.
    for (const item of [kettle, mug]) {
      const res = await client(t.app, bob).post(`/shared/${shareToken}/items/${item}/claims`, {
        claimerName: 'Bob',
        quantity: 1,
      });
      expect(CreateClaimResponseSchema.parse(res.body).onYourGifts).toBe(true);
    }
    await db.pool.query('delete from items where id = $1', [kettle]);
    const noteGoneAt = async () =>
      (
        await db.pool.query<{ gone_at: Date | null }>(
          'select gone_at from claim_links where claim_id is null',
        )
      ).rows.map((r) => r.gone_at);
    expect(await noteGoneAt()).toEqual([null]);

    // Day 0: the note is stamped with today, and nothing is old enough to delete.
    const stamped = t.clock.now();
    const day0 = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);
    expect(day0.giftNotes).toBe(0);
    expect(await noteGoneAt()).toEqual([stamped]);

    // Day 29: still a note, and the stamp isn't moved by another run.
    t.clock.advance(29 * DAY);
    const day29 = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);
    expect(day29.giftNotes).toBe(0);
    expect(await noteGoneAt()).toEqual([stamped]);

    // Day 31: the note goes. The live link on the mug is never touched.
    t.clock.advance(2 * DAY);
    const day31 = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);
    expect(day31.giftNotes).toBe(1);
    expect(await noteGoneAt()).toEqual([]);
    const { rows } = await db.pool.query<{ claim_id: string | null; gone_at: Date | null }>(
      'select claim_id, gone_at from claim_links',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.claim_id).not.toBeNull();
    expect(rows[0]?.gone_at).toBeNull();
    expect(await count('claims')).toBe(1);
  });

  it('stamps the notes an unverified-account purge makes in the same run', async () => {
    await signUp(t, ADA); // never verified; owns a list
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);
    const shareToken = await shareTokenOf(db, ADA.email);
    const item = await seedItem(db, ADA.email, 'Kettle');
    await client(t.app, bob).post(`/shared/${shareToken}/items/${item}/claims`, {
      claimerName: 'Bob',
      quantity: 1,
    });

    t.clock.advance(8 * DAY);
    const stamped = t.clock.now();
    const result = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);

    expect(result).toMatchObject({ unverifiedUsers: 1, giftNotes: 0 });
    const { rows } = await db.pool.query<{ gone_at: Date | null }>(
      'select gone_at from claim_links where claim_id is null',
    );
    expect(rows.map((r) => r.gone_at)).toEqual([stamped]);
    const bobsSession = await client(t.app, bob).get('/me/gifts');
    expect(GiftsResponseSchema.parse(bobsSession.body).gone).toHaveLength(1);
  });
});
