import {
  CAPABILITY_TOKEN_PATTERN,
  ClaimConflictProblemSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  ProblemSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimsListKey } from '../src/claims/rate-limits.js';
import { newId } from '../src/core/ids.js';
import { hashToken, newToken } from '../src/security/tokens.js';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedItem, shareTokenOf, wishlistIdOf } from './support/lists.js';
import { untilBlockedBy } from './support/locks.js';
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
const UNKNOWN_ID = '0199a3b2-0000-7000-8000-0000000000ff';
const UNKNOWN_TOKEN = 'abcdefghijklmnopqrstuv';

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const claim = (token: string, itemId: string, body: object, cookie?: string) =>
  client(t.app, cookie).post(`/shared/${token}/items/${itemId}/claims`, body);
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
const claimedSum = async () =>
  Number(
    (await db.pool.query<{ n: string }>('select coalesce(sum(quantity), 0) as n from claims'))
      .rows[0]?.n,
  );

/** Ada's list with one kettle, of which Ada wants `quantity`. */
async function adasKettle(quantity = 1) {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', quantity);
  return { token: await shareTokenOf(db, ADA.email), kettle };
}

describe('POST /shared/:shareToken/items/:itemId/claims (spec §5)', () => {
  it('claims for a guest, and returns the manage link', async () => {
    const { token, kettle } = await adasKettle(3);
    const res = await claim(token, kettle, { claimerName: ' Aunt Sue\n', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = CreateClaimResponseSchema.parse(res.body);
    expect(body.claim).toEqual({
      id: expect.any(String) as string,
      claimerName: 'Aunt Sue',
      quantity: 2,
    });
    expect(body.manageUrl).toBe(`http://localhost:3000/c/${body.manageToken}`);
  });

  it('keeps only the manage token’s hash (spec §4)', async () => {
    const { token, kettle } = await adasKettle();
    const { manageToken } = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue' })).body,
    );
    const { rows } = await db.pool.query('select * from claims');
    expect(rows[0]).toMatchObject({ quantity: 1, manage_token_hash: hashToken(manageToken) });
    expect(JSON.stringify(rows)).not.toContain(manageToken);
  });

  it.each([
    { claimerName: '' },
    { claimerName: '   ' },
    { claimerName: 'a'.repeat(51) },
    { claimerName: 'Sue‮eus' },
    { claimerName: 'Sue', quantity: 0 },
    { claimerName: 'Sue', quantity: 100 },
    { quantity: 1 },
  ])('refuses %j with 400 VALIDATION_FAILED (Review Focus 4)', async (body) => {
    const { token, kettle } = await adasKettle();
    const res = await claim(token, kettle, body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    expect(await count('claims')).toBe(0);
  });

  it('answers 409 with what is left when a claim asks for more (spec §6.3)', async () => {
    const { token, kettle } = await adasKettle(3);
    expect((await claim(token, kettle, { claimerName: 'Sue', quantity: 2 })).status).toBe(201);
    const over = await claim(token, kettle, { claimerName: 'Sam', quantity: 2 });
    expect(over.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(over.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 1,
    });
    expect((await claim(token, kettle, { claimerName: 'Sam', quantity: 1 })).status).toBe(201);
    const none = await claim(token, kettle, { claimerName: 'Kim', quantity: 1 });
    expect(ClaimConflictProblemSchema.parse(none.body).remaining).toBe(0);
    expect(await claimedSum()).toBe(3);
  });

  it('refuses the owner with 403, never a 409 that would say what is left (spec §2, §5)', async () => {
    const { token, kettle } = await adasKettle(1);
    const cookie = await logIn(t);
    const first = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([first.status, codeOf(first)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
    expect((await claim(token, kettle, { claimerName: 'Sue' })).status).toBe(201);
    const full = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([full.status, codeOf(full)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
    expect(full.body).not.toHaveProperty('remaining');
    expect(await count('claims')).toBe(1);
  });

  it('refuses an owner whose email is unconfirmed (Plan 4a rule 5)', async () => {
    await signUp(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 1);
    const res = await claim(
      await shareTokenOf(db, ADA.email),
      kettle,
      { claimerName: 'Ada' },
      await logIn(t),
    );
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
  });

  it('lets someone else who is signed in claim', async () => {
    const { token, kettle } = await adasKettle();
    await signUpVerified(t, BOB);
    expect((await claim(token, kettle, { claimerName: 'Bob' }, await logIn(t, BOB))).status).toBe(
      201,
    );
  });

  it('answers 404 SHARE_LINK_NOT_FOUND for a replaced link, and NOT_FOUND for an item not on it', async () => {
    const { token, kettle } = await adasKettle();
    await signUpVerified(t, BOB);
    const bobsItem = await seedItem(db, BOB.email, 'Bike', 1);
    for (const itemId of [UNKNOWN_ID, 'kettle', bobsItem]) {
      const res = await claim(token, itemId, { claimerName: 'Sue' });
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
    await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate');
    const replaced = await claim(token, kettle, { claimerName: 'Sue' });
    expect([replaced.status, codeOf(replaced)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
    expect(await count('claims')).toBe(0);
  });

  it('refuses a claim that does not come from the app (spec §6.2)', async () => {
    const { token, kettle } = await adasKettle();
    const res = await http(t.app)
      .post(`/api/shared/${token}/items/${kettle}/claims`)
      .send({ claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.FORBIDDEN_ORIGIN]);
  });

  it('lets exactly one of 20 racing claims take the last kettle (spec §8)', async () => {
    const { token, kettle } = await adasKettle(1);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    const conflicts = results.filter((res) => res.status === 409);
    expect(conflicts).toHaveLength(19);
    for (const res of conflicts)
      expect(ClaimConflictProblemSchema.parse(res.body).remaining).toBe(0);
    expect(await claimedSum()).toBe(1);
    // All 20 counted against the IP, the 409s too (spec §6.6), so a 21st is turned away.
    const next = await claim(token, kettle, { claimerName: 'Gifter 20' });
    expect([next.status, codeOf(next)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  // The 20-way race above is not proof of the lock: the rate-limit upserts on the shared IP and
  // list counter rows stagger the requests, so their transactions rarely overlap, and it passes
  // without FOR UPDATE. Here another transaction holds the item's row lock with a claim not yet
  // committed. Only an implementation that locks the row waits for it, and then sees its claim.
  it('makes a claim wait for the item’s lock, then judges it against what committed (spec §6.3)', async () => {
    const { token, kettle } = await adasKettle(1);
    const holder = await db.pool.connect();
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('select id from items where id = $1 for update', [kettle]);
      await holder.query(
        `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
         values ($1, $2, 'Holder', 1, $3)`,
        [newId(), kettle, hashToken('holder')],
      );
      const pending = Promise.all(
        Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
      );
      // Every claim is waiting on the item's row lock, or behind one that is.
      await untilBlockedBy(db.pool, holderPid, 5, pending);
      await holder.query('commit');
      const results = await pending;
      for (const res of results) {
        expect(res.status).toBe(409);
        expect(ClaimConflictProblemSchema.parse(res.body).remaining).toBe(0);
      }
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect(await claimedSum()).toBe(1);
  });

  it('counts 20 attempts an hour per IP before looking the link up, then answers 429 (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(99);
    for (let i = 0; i < 20; i++) {
      expect((await claim(UNKNOWN_TOKEN, kettle, { claimerName: 'Sue' })).status).toBe(404);
    }
    const res = await claim(token, kettle, { claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await count('claims')).toBe(0);
  });

  it('allows 30 claims an hour on one list, whoever makes them (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(99);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await claim(token, kettle, { claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  // Otherwise anyone with the link could use up the list's claims with made-up item IDs, and
  // every gifter would get a 429 until the window ends.
  it('does not count a claim on an item that is not on the list against the list (D104)', async () => {
    const { token, kettle } = await adasKettle(99);
    await signUpVerified(t, BOB);
    const bobsItem = await seedItem(db, BOB.email, 'Bike', 1);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 29);
    for (const itemId of [UNKNOWN_ID, bobsItem]) {
      const res = await claim(token, itemId, { claimerName: 'Sue' });
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
    expect((await claim(token, kettle, { claimerName: 'Sue' })).status).toBe(201);
  });

  it('a claim racing the owner deleting the account leaves no claim behind (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const cookie = await logIn(t);
    const [deletion, ...claims] = await Promise.all([
      client(t.app, cookie).delete('/me', { password: ADA.password }),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of claims) expect([201, 404]).toContain(res.status);
    expect(await count('claims')).toBe(0);
  });

  it('claims racing the owner deleting the item leave no claim behind (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const cookie = await logIn(t);
    const [deletion, ...claims] = await Promise.all([
      client(t.app, cookie).delete(`/wishlist/items/${kettle}`),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of claims) expect([201, 404]).toContain(res.status);
    expect(await count('claims')).toBe(0);
  });

  it('claims racing the owner’s quantity change and reorder never fail with a 500 (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const socks = await seedItem(db, ADA.email, 'Socks', 1);
    const cookie = await logIn(t);
    const [change, reorder, ...claims] = await Promise.all([
      client(t.app, cookie).patch(`/wishlist/items/${kettle}`, { quantity: 1 }),
      client(t.app, cookie).put('/wishlist/items/order', { itemIds: [socks, kettle] }),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect([change?.status, reorder?.status]).toEqual([200, 204]);
    for (const res of claims) expect([201, 409]).toContain(res.status);
  });

  it('refuses the owner with 403 even when the list’s claims are used up (D43)', async () => {
    const { token, kettle } = await adasKettle(3);
    const cookie = await logIn(t);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
  });

  it('marks a refused claim no-store, like every problem (Plan 4b)', async () => {
    const { token, kettle } = await adasKettle();
    const res = await http(t.app)
      .post(`/api/shared/${token}/items/${kettle}/claims`)
      .send({ claimerName: 'Sue' });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('replaying a claim with the sheet’s own manage token (D42)', () => {
  it('claims with the token the sheet sent, and keeps only its hash', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    const res = await claim(token, kettle, { claimerName: 'Sue', manageToken });
    expect(res.status).toBe(201);
    const body = CreateClaimResponseSchema.parse(res.body);
    expect(body.manageToken).toBe(manageToken);
    expect(body.manageUrl).toBe(`http://localhost:3000/c/${manageToken}`);
    const { rows } = await db.pool.query('select manage_token_hash from claims');
    expect(rows).toEqual([{ manage_token_hash: hashToken(manageToken) }]);
  });

  it('returns the same claim when the token comes back, and writes no second row', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    const first = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue', quantity: 2, manageToken })).body,
    );
    const again = await claim(token, kettle, { claimerName: 'Sue', quantity: 2, manageToken });
    expect(again.status).toBe(201);
    expect(CreateClaimResponseSchema.parse(again.body)).toEqual(first);
    expect(await count('claims')).toBe(1);
    expect(await claimedSum()).toBe(2);
  });

  it('replays the last unit with 201, never a 409 against itself', async () => {
    const { token, kettle } = await adasKettle(1);
    const manageToken = newToken(16);
    expect((await claim(token, kettle, { claimerName: 'Sue', manageToken })).status).toBe(201);
    const again = await claim(token, kettle, { claimerName: 'Sue', manageToken });
    expect(again.status).toBe(201);
    expect(await claimedSum()).toBe(1);
  });

  it('answers a replay with the claim as it is now, whatever the replay asked for', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    await claim(token, kettle, { claimerName: 'Sue', manageToken });
    await client(t.app).patch(`/claims/${manageToken}`, { claimerName: 'Aunt Sue', quantity: 2 });
    const again = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue', quantity: 1, manageToken })).body,
    );
    expect(again.claim).toMatchObject({ claimerName: 'Aunt Sue', quantity: 2 });
  });

  it('lets a double tap through once: both answers are the one claim', async () => {
    const { token, kettle } = await adasKettle(1);
    const manageToken = newToken(16);
    const [a, b] = await Promise.all([
      claim(token, kettle, { claimerName: 'Sue', manageToken }),
      claim(token, kettle, { claimerName: 'Sue', manageToken }),
    ]);
    expect([a?.status, b?.status]).toEqual([201, 201]);
    expect(CreateClaimResponseSchema.parse(a?.body).claim.id).toBe(
      CreateClaimResponseSchema.parse(b?.body).claim.id,
    );
    expect(await count('claims')).toBe(1);
  });

  it('refuses a token that belongs to a claim on another item', async () => {
    const { token, kettle } = await adasKettle(3);
    const socks = await seedItem(db, ADA.email, 'Socks', 3);
    const manageToken = newToken(16);
    await claim(token, kettle, { claimerName: 'Sue', manageToken });
    const res = await claim(token, socks, { claimerName: 'Sue', manageToken });
    expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.MANAGE_TOKEN_IN_USE]);
    expect(JSON.stringify(res.body)).not.toContain(manageToken);
    expect(await count('claims')).toBe(1);
  });

  // Two items claimed at once with one token take different row locks, so the lookup can't see
  // the other's uncommitted row. The unique index catches it, and the answer is the same 409.
  it('refuses the same token racing onto another item, through the unique index', async () => {
    const { token, kettle } = await adasKettle(3);
    const socks = await seedItem(db, ADA.email, 'Socks', 3);
    const manageToken = newToken(16);
    const holder = await db.pool.connect();
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query(
        `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
         values ($1, $2, 'Holder', 1, $3)`,
        [newId(), socks, hashToken(manageToken)],
      );
      // supertest sends nothing until .then: start the claim now, before the holder commits.
      const pending = claim(token, kettle, { claimerName: 'Sue', manageToken }).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, pending);
      await holder.query('commit');
      const res = await pending;
      expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.MANAGE_TOKEN_IN_USE]);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect(await count('claims')).toBe(1);
  });

  it('refuses a malformed token in the body with 400 VALIDATION_FAILED', async () => {
    const { token, kettle } = await adasKettle();
    const res = await claim(token, kettle, { claimerName: 'Sue', manageToken: 'short' });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('mints a token that fits the pattern when the sheet sends none', async () => {
    const { token, kettle } = await adasKettle();
    const body = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue' })).body,
    );
    expect(body.manageToken).toMatch(CAPABILITY_TOKEN_PATTERN);
  });
});

describe('linking a claim to a signed-in gifter (D76)', () => {
  const links = async () =>
    (
      await db.pool.query<{
        claim_id: string;
        user_id: string;
        item_title: string;
        owner_display_name: string;
        bought_at: Date | null;
      }>('select claim_id, user_id, item_title, owner_display_name, bought_at from claim_links')
    ).rows;
  const userId = async (email: string) =>
    (await db.pool.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]
      ?.id;

  it('links a claim made by a verified, signed-in gifter, and says so', async () => {
    const { token, kettle } = await adasKettle(2);
    await signUpVerified(t, BOB);
    const res = await claim(token, kettle, { claimerName: 'Bobby' }, await logIn(t, BOB));
    expect(res.status).toBe(201);
    const body = CreateClaimResponseSchema.parse(res.body);
    expect(body.onYourGifts).toBe(true);
    expect(await links()).toEqual([
      {
        claim_id: body.claim.id,
        user_id: await userId(BOB.email),
        item_title: 'Kettle',
        owner_display_name: 'Ada',
        bought_at: null,
      },
    ]);
  });

  it('does not link a guest’s or an unverified account’s claim', async () => {
    const { token, kettle } = await adasKettle(3);
    const guest = await claim(token, kettle, { claimerName: 'Sue' });
    expect(guest.status).toBe(201);
    expect(guest.body).not.toHaveProperty('onYourGifts');
    await signUp(t, BOB);
    const unverified = await claim(token, kettle, { claimerName: 'Bobby' }, await logIn(t, BOB));
    expect(unverified.status).toBe(201);
    expect(unverified.body).not.toHaveProperty('onYourGifts');
    expect(await count('claims')).toBe(2);
    expect(await count('claim_links')).toBe(0);
  });

  it('a replayed token links the existing claim once (D42)', async () => {
    const { token, kettle } = await adasKettle(2);
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);
    const manageToken = newToken(16);
    const first = await claim(token, kettle, { claimerName: 'Bobby', manageToken }, bob);
    const again = await claim(token, kettle, { claimerName: 'Bobby', manageToken }, bob);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(CreateClaimResponseSchema.parse(again.body).onYourGifts).toBe(true);
    expect(await count('claims')).toBe(1);
    expect(await count('claim_links')).toBe(1);
  });

  it('a replay while signed in links a claim that was made as a guest', async () => {
    const { token, kettle } = await adasKettle(2);
    const manageToken = newToken(16);
    const guest = await claim(token, kettle, { claimerName: 'Bobby', manageToken });
    expect(guest.body).not.toHaveProperty('onYourGifts');
    await signUpVerified(t, BOB);
    const again = await claim(
      token,
      kettle,
      { claimerName: 'Bobby', manageToken },
      await logIn(t, BOB),
    );
    expect(CreateClaimResponseSchema.parse(again.body).onYourGifts).toBe(true);
    expect(await count('claim_links')).toBe(1);
  });

  it('a replay by another account does not take the link, and says false (ruling 5)', async () => {
    const { token, kettle } = await adasKettle(2);
    await signUpVerified(t, BOB);
    const manageToken = newToken(16);
    await claim(token, kettle, { claimerName: 'Bobby', manageToken }, await logIn(t, BOB));
    const cam: Account = { ...BOB, email: 'cam@example.com', displayName: 'Cam' };
    await signUpVerified(t, cam);
    const res = await claim(
      token,
      kettle,
      { claimerName: 'Cam', manageToken },
      await logIn(t, cam),
    );
    expect(res.status).toBe(201);
    expect(CreateClaimResponseSchema.parse(res.body).onYourGifts).toBe(false);
    expect((await links()).map((l) => l.user_id)).toEqual([await userId(BOB.email)]);
  });

  it('a replay racing a cancel answers 404, not 500 (R7)', async () => {
    const { token, kettle } = await adasKettle(2);
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);
    const manageToken = newToken(16);
    const first = await claim(token, kettle, { claimerName: 'Bobby', manageToken });
    const claimId = CreateClaimResponseSchema.parse(first.body).claim.id;
    // A cancel that has deleted the claim but not yet committed: the replay's link insert
    // reaches the claim row's foreign key check and waits for it.
    const holder = await db.pool.connect();
    let replay: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('delete from claims where id = $1', [claimId]);
      replay = claim(token, kettle, { claimerName: 'Bobby', manageToken }, bob).then((r) => r);
      await untilBlockedBy(db.pool, holderPid, 1, replay);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const res = await replay;
    expect([res?.status, res && codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect(await count('claim_links')).toBe(0);
  });

  it('refuses the owner, verified or not, and links nothing', async () => {
    const { token, kettle } = await adasKettle(1);
    const res = await claim(token, kettle, { claimerName: 'Ada' }, await logIn(t));
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
    expect(await count('claim_links')).toBe(0);
  });
});
