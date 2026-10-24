import {
  ClaimDetailsResponseSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  ProblemSchema,
  RotateShareTokenResponseSchema,
  SharedWishlistResponseSchema,
  WishlistResponseSchema,
  WishlistSettingsResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { linkTag, seedClaim, seedItem, seedTag, shareTokenOf } from './support/lists.js';

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
      showClaimsToOwner: false,
      suggestTags: true,
      tags: [],
      items: [],
    });
  });

  it("returns every tag, in name order, and each item's tag IDs (Plan 7a)", async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle');
    const socks = await seedItem(db, ADA.email, 'Socks');
    const kitchen = await seedTag(db, ADA.email, 'Kitchen');
    const garden = await seedTag(db, ADA.email, 'Garden');
    await linkTag(db, kettle, kitchen);
    const res = await client(t.app, cookie).get('/wishlist');
    expect(res.status).toBe(200);
    const body = WishlistResponseSchema.parse(res.body);
    expect(body.tags).toEqual([
      { id: garden, name: 'Garden' },
      { id: kitchen, name: 'Kitchen' },
    ]);
    expect(body.items.map((item) => [item.id, item.tagIds])).toEqual([
      [kettle, [kitchen]],
      [socks, []],
    ]);
  });

  it("orders an item's tag IDs like the tags: by name, not by when they were added", async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle');
    const kitchen = await seedTag(db, ADA.email, 'Kitchen');
    const garden = await seedTag(db, ADA.email, 'Garden');
    await linkTag(db, kettle, kitchen);
    await linkTag(db, kettle, garden);
    const body = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(body.items[0]?.tagIds).toEqual([garden, kitchen]);
  });

  it("keeps tags out of another owner's list", async () => {
    await signUpVerified(t);
    await seedTag(db, ADA.email, 'Kitchen');
    await signUpVerified(t, BOB);
    const res = await client(t.app, await logIn(t, BOB)).get('/wishlist');
    expect(WishlistResponseSchema.parse(res.body).tags).toEqual([]);
  });

  it('says whether the owner sees claims, and carries none until the owner opts in (spec §5.1, §8)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    await seedClaim(db, kettle, 'Sue', 1);
    const res = await client(t.app, cookie).get('/wishlist');
    expect(Object.keys(res.body as object).sort()).toEqual([
      'items',
      'shareUrl',
      'showClaimsToOwner',
      'suggestTags',
      'tags',
      'title',
    ]);
    const body = res.body as { showClaimsToOwner: boolean; items: object[] };
    expect(body.showClaimsToOwner).toBe(false);
    expect(body.items[0]).not.toHaveProperty('remaining');
    expect(body.items[0]).not.toHaveProperty('claims');
    expect(JSON.stringify(res.body)).not.toContain('Sue');
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

  it('turns the spoiler setting on and off, leaving the title alone (D33)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    const sue = await seedClaim(db, kettle, 'Sue', 1);

    const on = await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    expect(on.status).toBe(200);
    expect(WishlistSettingsResponseSchema.parse(on.body)).toMatchObject({
      title: "Ada's wishlist",
      showClaimsToOwner: true,
    });
    const shown = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    // Expand step (D75): the claims still come beside `claimed` until the contract layer.
    expect(shown.items[0]).toMatchObject({ remaining: 1, claimed: 1 });
    expect(shown.items[0]?.claims).toEqual([{ id: sue.id, claimerName: 'Sue', quantity: 1 }]);

    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: false });
    const hidden = (await client(t.app, cookie).get('/wishlist')).body as { items: object[] };
    expect(hidden.items[0]).not.toHaveProperty('claims');
    expect(hidden.items[0]).not.toHaveProperty('claimed');
  });

  it('renames without touching the spoiler setting', async () => {
    const cookie = await owner();
    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    const res = await client(t.app, cookie).patch('/wishlist', { title: 'Birthday' });
    expect(WishlistSettingsResponseSchema.parse(res.body)).toMatchObject({
      title: 'Birthday',
      showClaimsToOwner: true,
    });
  });

  it('turns tag suggestions off and on, and the next read agrees (Plan 9)', async () => {
    const cookie = await owner();

    const off = await client(t.app, cookie).patch('/wishlist', { suggestTags: false });
    expect(off.status).toBe(200);
    expect(WishlistSettingsResponseSchema.parse(off.body)).toMatchObject({ suggestTags: false });
    const offList = WishlistResponseSchema.parse(
      (await client(t.app, cookie).get('/wishlist')).body,
    );
    expect(offList.suggestTags).toBe(false);

    const on = await client(t.app, cookie).patch('/wishlist', { suggestTags: true });
    expect(WishlistSettingsResponseSchema.parse(on.body)).toMatchObject({ suggestTags: true });
    const onList = WishlistResponseSchema.parse(
      (await client(t.app, cookie).get('/wishlist')).body,
    );
    expect(onList.suggestTags).toBe(true);
  });

  it('leaves tag suggestions alone when only the title or the spoiler setting changes', async () => {
    const cookie = await owner();
    await client(t.app, cookie).patch('/wishlist', { suggestTags: false });
    const res = await client(t.app, cookie).patch('/wishlist', {
      title: 'Birthday',
      showClaimsToOwner: true,
    });
    expect(WishlistSettingsResponseSchema.parse(res.body)).toMatchObject({
      title: 'Birthday',
      showClaimsToOwner: true,
      suggestTags: false,
    });
  });

  it.each([{}, { showClaimsToOwner: 'yes' }, { suggestTags: 'no' }])(
    'refuses %j with 400',
    async (body) => {
      const res = await client(t.app, await owner()).patch('/wishlist', body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    },
  );

  it('tells gifters which way the setting is, on the share page and the manage page (D40)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    const token = await shareTokenOf(db, ADA.email);
    const made = CreateClaimResponseSchema.parse(
      (
        await client(t.app).post(`/shared/${token}/items/${kettle}/claims`, {
          claimerName: 'Sue',
        })
      ).body,
    );
    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    const page = SharedWishlistResponseSchema.parse(
      (await client(t.app).get(`/shared/${token}`)).body,
    );
    const manage = ClaimDetailsResponseSchema.parse(
      (await client(t.app).get(`/claims/${made.manageToken}`)).body,
    );
    expect([page.ownerSeesClaims, manage.ownerSeesClaims]).toEqual([true, true]);
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
