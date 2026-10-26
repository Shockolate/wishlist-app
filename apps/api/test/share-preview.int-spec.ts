import { ErrorCode, ProblemSchema, SharePreviewResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rateLimitKey } from '../src/rate-limit/keys.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedClaim, seedItem, setShowClaims, shareTokenOf, wishlistIdOf } from './support/lists.js';
import { fillBucket } from './support/rate-limits.js';

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

const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase 2',
  displayName: 'Bob',
};

const UNKNOWN_TOKEN = 'abcdefghijklmnopqrstuv';
const PNG = { ok: true, bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' } as const;

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const preview = (token: string, cookie?: string) =>
  client(t.app, cookie).get(`/shared/${token}/preview`);
const photo = (token: string, itemId: string) =>
  client(t.app).get(`/shared/${token}/photos/${itemId}`);
const imageOf = (n: number) => `https://img.example/${n}.jpg`;

/** Ada's list: a kettle with a photo and socks without one. */
async function adasList() {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', 3, imageOf(1));
  const socks = await seedItem(db, ADA.email, 'Socks');
  return { token: await shareTokenOf(db, ADA.email), kettle, socks };
}

async function bucketRows(key: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    'select count(*)::int as n from rate_limits where key = $1',
    [key],
  );
  return rows[0]?.n ?? 0;
}

describe('GET /shared/:shareToken/preview (Plan 12)', () => {
  it('previews the title, owner, count and photo candidates in list order', async () => {
    await signUpVerified(t);
    const ids: string[] = [];
    for (let n = 0; n < 10; n++) {
      // The third item has no photo; the other nine do.
      ids.push(await seedItem(db, ADA.email, `Thing ${n}`, 1, n === 2 ? null : imageOf(n)));
    }
    const res = await preview(await shareTokenOf(db, ADA.email));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(SharePreviewResponseSchema.parse(res.body)).toEqual({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      itemCount: 10,
      photoItemIds: ids.filter((_, n) => n !== 2).slice(0, 8),
    });
  });

  it('previews the same with claims, for a guest and for an owner who sees claims', async () => {
    const { token, kettle, socks } = await adasList();
    const claimFree = (await preview(token)).body as unknown;
    await seedClaim(db, kettle, 'Sue', 1);
    await seedClaim(db, socks, 'Sam', 1);
    await setShowClaims(db, ADA.email, true);
    const guest = await preview(token);
    const owner = await preview(token, await logIn(t));
    for (const res of [guest, owner]) {
      expect(res.status).toBe(200);
      expect(SharePreviewResponseSchema.parse(res.body)).toEqual(claimFree);
      expect(JSON.stringify(res.body)).not.toContain('claim');
      expect(JSON.stringify(res.body)).not.toContain('remaining');
    }
  });

  it('an empty list previews with no candidates', async () => {
    await signUpVerified(t);
    const res = await preview(await shareTokenOf(db, ADA.email));
    expect(SharePreviewResponseSchema.parse(res.body)).toMatchObject({
      itemCount: 0,
      photoItemIds: [],
    });
  });

  it('a malformed, unknown or rotated token is 404 SHARE_LINK_NOT_FOUND (both routes)', async () => {
    const { token, kettle } = await adasList();
    await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate');
    for (const dead of [`${token}.`, UNKNOWN_TOKEN, token]) {
      for (const res of [await preview(dead), await photo(dead, kettle)]) {
        expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
      }
    }
    expect(t.photos.urls).toEqual([]);
  });
});

describe('GET /shared/:shareToken/photos/:itemId (Plan 12)', () => {
  it("returns a photo's bytes and type", async () => {
    const { token, kettle } = await adasList();
    t.photos.next = PNG;
    const res = await photo(token, kettle);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect([...(res.body as Buffer)]).toEqual([1, 2, 3]);
    expect(t.photos.urls).toEqual([imageOf(1)]);
  });

  it('an item without a photo, a malformed item id and a failed fetch are 404 PHOTO_UNAVAILABLE', async () => {
    const { token, kettle, socks } = await adasList();
    for (const itemId of [socks, 'not-a-uuid']) {
      const res = await photo(token, itemId);
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.PHOTO_UNAVAILABLE]);
    }
    expect(t.photos.urls).toEqual([]);

    t.photos.next = { ok: false, reason: 'TIMEOUT', host: 'img.example' };
    const failed = await photo(token, kettle);
    expect([failed.status, codeOf(failed)]).toEqual([404, ErrorCode.PHOTO_UNAVAILABLE]);
    expect(t.photos.urls).toEqual([imageOf(1)]);
  });

  it("another list's item through this token is 404 PHOTO_UNAVAILABLE and nothing is fetched (Review Focus 5)", async () => {
    const { token } = await adasList();
    await signUp(t, BOB);
    const bobs = await seedItem(db, BOB.email, 'Drill', 1, imageOf(9));
    t.photos.next = PNG;
    const res = await photo(token, bobs);
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.PHOTO_UNAVAILABLE]);
    expect(t.photos.urls).toEqual([]);
  });

  it("the list's limit stops fetching", async () => {
    const { token, kettle } = await adasList();
    const listId = await wishlistIdOf(db, ADA.email);
    await fillBucket(db, rateLimitKey('preview-photos:list', listId), 120);
    t.photos.next = PNG;
    const res = await photo(token, kettle);
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(t.photos.urls).toEqual([]);
  });

  it('the overall limit stops fetching', async () => {
    const { token, kettle } = await adasList();
    await fillBucket(db, rateLimitKey('preview-photos:all', 'all'), 3000);
    t.photos.next = PNG;
    const res = await photo(token, kettle);
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(t.photos.urls).toEqual([]);
  });

  it("a missing photo doesn't count against the list", async () => {
    const { token, socks } = await adasList();
    for (let i = 0; i < 3; i++) {
      expect((await photo(token, socks)).status).toBe(404);
    }
    const listId = await wishlistIdOf(db, ADA.email);
    expect(await bucketRows(rateLimitKey('preview-photos:list', listId))).toBe(0);
  });
});
