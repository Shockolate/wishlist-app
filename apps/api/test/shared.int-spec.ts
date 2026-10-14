import { ErrorCode, ProblemSchema, SharedWishlistResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, setCookies, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedClaim, seedItem, setShowClaims, shareTokenOf } from './support/lists.js';

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
const shared = (token: string, cookie?: string) => client(t.app, cookie).get(`/shared/${token}`);
type Body = { viewerIsOwner: boolean; ownerSeesClaims: boolean; items: object[] };

/** Ada wants 3 kettles (Sue and Sam are getting one each) and a pair of socks nobody has claimed. */
async function adasList() {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', 3);
  const socks = await seedItem(db, ADA.email, 'Socks', 1);
  const sue = await seedClaim(db, kettle, 'Sue', 1);
  const sam = await seedClaim(db, kettle, 'Sam', 1);
  return { token: await shareTokenOf(db, ADA.email), kettle, socks, sue, sam };
}

describe('GET /shared/:shareToken (spec §5)', () => {
  it('shows a guest the list in order, what is left, and who is getting what', async () => {
    const { token, kettle, socks, sue, sam } = await adasList();
    const res = await shared(token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const fields = { url: null, imageUrl: null, priceText: null, note: null };
    expect(SharedWishlistResponseSchema.parse(res.body)).toEqual({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: false,
      ownerSeesClaims: false,
      items: [
        {
          id: kettle,
          title: 'Kettle',
          ...fields,
          quantity: 3,
          remaining: 1,
          claims: [
            { id: sue.id, claimerName: 'Sue', quantity: 1 },
            { id: sam.id, claimerName: 'Sam', quantity: 1 },
          ],
        },
        { id: socks, title: 'Socks', ...fields, quantity: 1, remaining: 1, claims: [] },
      ],
    });
  });

  it('sends no position, and nothing from a claim but its ID, name and quantity', async () => {
    const { token } = await adasList();
    const { items } = (await shared(token)).body as { items: { claims: object[] }[] };
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'claims',
      'id',
      'imageUrl',
      'note',
      'priceText',
      'quantity',
      'remaining',
      'title',
      'url',
    ]);
    expect(Object.keys(items[0]?.claims[0] ?? {}).sort()).toEqual([
      'claimerName',
      'id',
      'quantity',
    ]);
  });

  it('tells the signed-in owner nothing about claims until they opt in (spec §5.1, §8)', async () => {
    const { token } = await adasList();
    const res = await shared(token, await logIn(t));
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([true, false]);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('remaining');
      expect(item).not.toHaveProperty('claims');
    }
    expect(JSON.stringify(res.body)).not.toContain('Sue');
  });

  it('treats an owner whose email is unconfirmed as the owner too (Plan 4a rule 5)', async () => {
    await signUp(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 1);
    await seedClaim(db, kettle, 'Sue', 1);
    const res = await shared(await shareTokenOf(db, ADA.email), await logIn(t));
    expect((res.body as Body).viewerIsOwner).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('Sue');
  });

  it('shows the owner the claims once they opt in', async () => {
    const { token } = await adasList();
    await setShowClaims(db, ADA.email, true);
    const body = SharedWishlistResponseSchema.parse((await shared(token, await logIn(t))).body);
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([true, true]);
    expect(body.items[0]?.claims?.map((claim) => claim.claimerName)).toEqual(['Sue', 'Sam']);
  });

  it('tells a guest which way the owner’s setting is (D40)', async () => {
    const { token } = await adasList();
    await setShowClaims(db, ADA.email, true);
    const body = SharedWishlistResponseSchema.parse((await shared(token)).body);
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([false, true]);
    expect(body.items[0]?.remaining).toBe(1);
  });

  it('treats anyone else who is signed in as a guest', async () => {
    const { token } = await adasList();
    await signUpVerified(t, BOB);
    const body = SharedWishlistResponseSchema.parse(
      (await shared(token, await logIn(t, BOB))).body,
    );
    expect(body.viewerIsOwner).toBe(false);
    expect(body.items[0]?.remaining).toBe(1);
  });

  it('treats a dead session as a guest, and sets no cookie (Review Focus 2)', async () => {
    const { token } = await adasList();
    const res = await shared(token, `__Host-session=${'x'.repeat(43)}`);
    expect(res.status).toBe(200);
    expect((res.body as Body).viewerIsOwner).toBe(false);
    expect(setCookies(res)).toEqual([]);
  });

  it('shows 0 left, not less, when the owner wants fewer than were claimed (D19)', async () => {
    await signUpVerified(t);
    const lamp = await seedItem(db, ADA.email, 'Lamp', 1);
    await seedClaim(db, lamp, 'Kim', 2);
    const body = SharedWishlistResponseSchema.parse(
      (await shared(await shareTokenOf(db, ADA.email))).body,
    );
    expect(body.items[0]?.remaining).toBe(0);
  });

  it('answers 404 SHARE_LINK_NOT_FOUND for a link that is unknown or was replaced (spec §2)', async () => {
    const { token } = await adasList();
    await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate');
    for (const res of [await shared(token), await shared('abcdefghijklmnopqrstuv')]) {
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('never echoes the token in a problem the router raises (a sub-path, an undecodable token)', async () => {
    const { token } = await adasList();
    const extra = await shared(`${token}/extra`);
    expect([extra.status, codeOf(extra)]).toEqual([404, ErrorCode.NOT_FOUND]);
    const undecodable = await shared(`${token}%E0%A4%A`);
    expect([undecodable.status, codeOf(undecodable)]).toEqual([400, ErrorCode.BAD_REQUEST]);
    for (const res of [extra, undecodable]) {
      expect(JSON.stringify(res.body)).not.toContain(token);
    }
  });

  it.each([
    ['a trailing full stop', (token: string) => `${token}.`],
    ['a character missing', (token: string) => token.slice(0, 21)],
    ['a trailing bracket, encoded', (token: string) => `${token}%29`],
    ['a trailing space, encoded', (token: string) => `${token}%20`],
  ])(
    'answers 404 SHARE_LINK_NOT_FOUND for a link with %s (Review Focus 1)',
    async (_label, mangle) => {
      const { token } = await adasList();
      const res = await shared(mangle(token));
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
    },
  );
});
