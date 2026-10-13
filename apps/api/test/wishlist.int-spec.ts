import {
  ErrorCode,
  ProblemSchema,
  RotateShareTokenResponseSchema,
  WishlistResponseSchema,
  WishlistSettingsResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { logIn, signUp, signUpVerified } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
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

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;

/** A signed-in owner with a verified email: the session cookie. */
async function owner(): Promise<string> {
  await signUpVerified(t);
  return logIn(t);
}

describe('the owner endpoints need a verified owner (spec §5)', () => {
  it('answer 401 without a session', async () => {
    const responses = [
      await client(t.app).get('/wishlist'),
      await client(t.app).patch('/wishlist', { title: 'Birthday' }),
      await client(t.app).post('/wishlist/share-token/rotate'),
    ];
    for (const res of responses) {
      expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
    }
  });

  it('answer 403 EMAIL_NOT_VERIFIED to someone who has not confirmed their email', async () => {
    await signUp(t);
    const cookie = await logIn(t);
    const res = await client(t.app, cookie).get('/wishlist');
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
  });
});

describe('GET /wishlist (spec §5)', () => {
  it('returns the list sign-up made, its share link and no items, and is never cached', async () => {
    const res = await client(t.app, await owner()).get('/wishlist');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(WishlistResponseSchema.parse(res.body)).toEqual({
      title: "Ada's wishlist",
      shareUrl: expect.stringMatching(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{22}$/) as string,
      items: [],
    });
  });

  it('carries no claim data and no spoiler setting before Plan 4 (D33)', async () => {
    const res = await client(t.app, await owner()).get('/wishlist');
    expect(Object.keys(res.body as object).sort()).toEqual(['items', 'shareUrl', 'title']);
  });
});

describe('PATCH /wishlist (spec §5)', () => {
  it('renames the list, trimming the title', async () => {
    const cookie = await owner();
    const res = await client(t.app, cookie).patch('/wishlist', { title: '  Birthday 2026  ' });
    expect(res.status).toBe(200);
    expect(WishlistSettingsResponseSchema.parse(res.body).title).toBe('Birthday 2026');
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.title).toBe('Birthday 2026');
  });

  it.each(['', '   ', 'a'.repeat(101)])('refuses the title %j', async (title) => {
    const res = await client(t.app, await owner()).patch('/wishlist', { title });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('refuses a NUL in the title, which Postgres cannot store, with 400 and not 500', async () => {
    const cookie = await owner();
    const res = await client(t.app, cookie).patch('/wishlist', { title: 'Birth\u0000day' });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.title).toBe("Ada's wishlist");
  });

  it('ignores showClaimsToOwner until Plan 4 (D33)', async () => {
    const res = await client(t.app, await owner()).patch('/wishlist', {
      title: 'Birthday',
      showClaimsToOwner: true,
    });
    expect(res.status).toBe(200);
    const { rows } = await db.pool.query<{ show: boolean }>(
      'select show_claims_to_owner as show from wishlists',
    );
    expect(rows[0]?.show).toBe(false);
  });
});

describe('POST /wishlist/share-token/rotate (spec §2)', () => {
  it('replaces the share token, so the old link stops working at once', async () => {
    const cookie = await owner();
    const before = WishlistResponseSchema.parse(
      (await client(t.app, cookie).get('/wishlist')).body,
    );
    const res = await client(t.app, cookie).post('/wishlist/share-token/rotate');
    expect(res.status).toBe(200);
    const { shareUrl } = RotateShareTokenResponseSchema.parse(res.body);
    expect(shareUrl).not.toBe(before.shareUrl);
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/);

    const oldToken = before.shareUrl.split('/s/')[1];
    const { rows } = await db.pool.query<{ n: string }>(
      'select count(*) as n from wishlists where share_token = $1',
      [oldToken],
    );
    expect(rows[0]?.n).toBe('0');
  });
});
