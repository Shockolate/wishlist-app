import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/session-cookie.js';
import { SessionsService } from '../src/auth/sessions.service.js';
import { newId } from '../src/core/ids.js';
import { http } from '../src/testing/app.js';
import { createAuthTestApp, TEST_START, type AuthTestApp } from './support/auth-app.js';
import { client, sessionCookie, setCookies } from './support/client.js';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A user with a session, made directly: signup and login arrive in later tasks. */
async function signedIn(): Promise<{ userId: string; cookie: string }> {
  const userId = newId();
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [userId],
  );
  const { token } = await t.app.get(SessionsService).create(userId);
  return { userId, cookie: `${SESSION_COOKIE}=${token}` };
}

describe('sessions (spec §6.1)', () => {
  it('GET /me returns the signed-in user', async () => {
    const { userId, cookie } = await signedIn();
    const res = await client(t.app, cookie).get('/me');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(MeResponseSchema.parse(res.body)).toEqual({
      id: userId,
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
    });
  });

  it('answers 401 UNAUTHENTICATED without a session, or with a token that matches none', async () => {
    for (const cookie of [undefined, `${SESSION_COOKIE}=${'A'.repeat(43)}`]) {
      const res = await client(t.app, cookie).get('/me');
      expect(res.status).toBe(401);
      expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });

  it('stores only a hash of the token', async () => {
    const { cookie } = await signedIn();
    const token = cookie.split('=')[1];
    const { rows } = await db.pool.query<{ id: string }>('select id from sessions');
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.id).not.toBe(token);
  });

  it('rejects an expired session even though its row still exists', async () => {
    const { cookie } = await signedIn();
    t.clock.advance(30 * DAY + 1);
    expect((await client(t.app, cookie).get('/me')).status).toBe(401);
  });

  it('slides the expiry at most once an hour, reissuing the cookie when it does', async () => {
    const { cookie } = await signedIn();

    t.clock.advance(59 * 60 * 1000);
    const early = await client(t.app, cookie).get('/me');
    expect(early.status).toBe(200);
    expect(setCookies(early)).toEqual([]);

    t.clock.advance(2 * 60 * 1000);
    const refreshedAt = t.clock.now();
    const refreshed = await client(t.app, cookie).get('/me');
    expect(sessionCookie(refreshed)).toBe(cookie);
    expect(setCookies(refreshed)[0]).toMatch(
      /Max-Age=2592000; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/,
    );
    const { rows } = await db.pool.query<{ last_seen_at: Date; expires_at: Date }>(
      'select last_seen_at, expires_at from sessions',
    );
    expect(rows[0]?.last_seen_at).toEqual(refreshedAt);
    expect(rows[0]?.expires_at).toEqual(new Date(refreshedAt.getTime() + 30 * DAY));

    // Just refreshed, so a request a few minutes later neither writes nor reissues the cookie.
    t.clock.advance(5 * 60 * 1000);
    const soon = await client(t.app, cookie).get('/me');
    expect(soon.status).toBe(200);
    expect(setCookies(soon)).toEqual([]);

    // Past the original 30-day expiry but within the refreshed one: only a slide keeps it alive.
    t.clock.set(new Date(TEST_START.getTime() + 30 * DAY + 30 * 60 * 1000));
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const { cookie } = await signedIn();
    const res = await client(t.app, cookie).post('/auth/logout');
    expect(res.status).toBe(204);
    expect(setCookies(res)[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`),
    );
    expect((await client(t.app, cookie).get('/me')).status).toBe(401);
  });

  it('logout without a session still answers 204 and clears the cookie', async () => {
    const res = await client(t.app).post('/auth/logout');
    expect(res.status).toBe(204);
    expect(setCookies(res)).toHaveLength(1);
  });

  it('logout is state-changing, so the CSRF guard refuses it without the app Origin', async () => {
    const { cookie } = await signedIn();
    const res = await http(t.app).post('/api/auth/logout').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });
});
