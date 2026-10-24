import {
  ClaimConflictProblemSchema,
  ClaimDetailsResponseSchema,
  ClaimLinkResponseSchema,
  ClaimSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  ProblemSchema,
  RotateShareTokenResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimsIpKey, claimsListKey } from '../src/claims/rate-limits.js';
import { hashToken } from '../src/security/tokens.js';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import {
  linkTag,
  seedClaim,
  seedItem,
  seedTag,
  shareTokenOf,
  wishlistIdOf,
} from './support/lists.js';
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

const UNKNOWN_TOKEN = 'abcdefghijklmnopqrstuv';
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async () =>
  Number((await db.pool.query<{ n: string }>('select count(*) as n from claims')).rows[0]?.n);
const claimedSum = async () =>
  Number(
    (await db.pool.query<{ n: string }>('select coalesce(sum(quantity), 0) as n from claims'))
      .rows[0]?.n,
  );

const details = (manageToken: string) => client(t.app).get(`/claims/${manageToken}`);
const change = (manageToken: string, body: object) =>
  client(t.app).patch(`/claims/${manageToken}`, body);
const cancel = (manageToken: string) => client(t.app).delete(`/claims/${manageToken}`);

/** Ada wants `quantity` kettles. */
async function adasKettle(quantity: number) {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', quantity);
  return { token: await shareTokenOf(db, ADA.email), kettle };
}

/** A claim made the way a gifter makes one. */
async function claimed(token: string, itemId: string, claimerName: string, quantity = 1) {
  const res = await client(t.app).post(`/shared/${token}/items/${itemId}/claims`, {
    claimerName,
    quantity,
  });
  if (res.status !== 201) throw new Error(`claim answered ${res.status}`);
  return CreateClaimResponseSchema.parse(res.body);
}

describe('GET /claims/:manageToken (spec §5)', () => {
  it('gives the claimer their claim, the item, what is left and the list’s link', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue', 2);
    const res = await details(sue.manageToken);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ClaimDetailsResponseSchema.parse(res.body)).toEqual({
      claim: sue.claim,
      item: {
        id: kettle,
        title: 'Kettle',
        url: null,
        imageUrl: null,
        priceText: null,
        note: null,
        quantity: 3,
      },
      wishlistTitle: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      remaining: 1,
      shareUrl: `http://localhost:3000/s/${token}`,
      ownerSeesClaims: false,
    });
  });

  it('sends no tag IDs, even for an item that carries tags (Plan 7a ruling 2)', async () => {
    const { token, kettle } = await adasKettle(1);
    await linkTag(db, kettle, await seedTag(db, ADA.email, 'Kitchen'));
    const sue = await claimed(token, kettle, 'Sue');
    const { item } = (await details(sue.manageToken)).body as { item: object };
    expect(item).not.toHaveProperty('tagIds');
  });

  it('never shows anyone else’s claim (spec §5.1)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await claimed(token, kettle, 'Sam');
    const res = await details(sue.manageToken);
    expect(JSON.stringify(res.body)).not.toContain('Sam');
    expect(res.body.item).not.toHaveProperty('claims');
  });

  it('gives the new share link after the owner replaces it (spec §5)', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const rotated = RotateShareTokenResponseSchema.parse(
      (await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate')).body,
    );
    const body = ClaimDetailsResponseSchema.parse((await details(sue.manageToken)).body);
    expect(body.shareUrl).toBe(rotated.shareUrl);
  });

  it.each(['abcdefghijklmnopqrstu', `${UNKNOWN_TOKEN}.`, UNKNOWN_TOKEN])(
    'answers 404 NOT_FOUND for the token %j',
    async (manageToken) => {
      const res = await details(manageToken);
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    },
  );

  it('answers 404 once the owner deletes the item, or the account (spec §2)', async () => {
    const { token, kettle } = await adasKettle(2);
    const sue = await claimed(token, kettle, 'Sue');
    const cookie = await logIn(t);
    await client(t.app, cookie).delete(`/wishlist/items/${kettle}`);
    expect((await details(sue.manageToken)).status).toBe(404);

    const lamp = await seedItem(db, ADA.email, 'Lamp', 1);
    const kim = await claimed(token, lamp, 'Kim');
    await client(t.app, cookie).delete('/me', { password: ADA.password });
    expect((await details(kim.manageToken)).status).toBe(404);
  });
});

describe('PATCH /claims/:manageToken (spec §5)', () => {
  it('changes the name, trimmed', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await change(sue.manageToken, { claimerName: ' Aunt Sue ' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ClaimSchema.parse(res.body)).toEqual({ ...sue.claim, claimerName: 'Aunt Sue' });
  });

  it.each([{}, { claimerName: '' }, { quantity: 0 }])(
    'refuses %j with 400 VALIDATION_FAILED',
    async (body) => {
      const { token, kettle } = await adasKettle(1);
      const sue = await claimed(token, kettle, 'Sue');
      const res = await change(sue.manageToken, body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    },
  );

  it('lets a claim grow into what is left, and no further (spec §2)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await claimed(token, kettle, 'Sam');
    expect((await change(sue.manageToken, { quantity: 2 })).status).toBe(200);
    const over = await change(sue.manageToken, { quantity: 3 });
    expect(over.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(over.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 0,
    });
    expect(await claimedSum()).toBe(3);
  });

  it('never refuses a claimer who keeps what they hold after the owner wanted fewer (D19, §6.3)', async () => {
    const { token, kettle } = await adasKettle(2);
    await claimed(token, kettle, 'Sue');
    const sam = await claimed(token, kettle, 'Sam');
    const cut = await client(t.app, await logIn(t)).patch(`/wishlist/items/${kettle}`, {
      quantity: 1,
    });
    expect(cut.status).toBe(200);
    expect((await change(sam.manageToken, { claimerName: 'Uncle Sam' })).status).toBe(200);
    expect((await change(sam.manageToken, { quantity: 1 })).status).toBe(200);
    const more = await change(sam.manageToken, { quantity: 2 });
    expect(ClaimConflictProblemSchema.parse(more.body).remaining).toBe(0);
  });

  it('lets only as many racing increases through as there are kettles left', async () => {
    // Ada wants 10. Five people hold one each, so 5 are left, and each asks to hold 3 (+2).
    const { token, kettle } = await adasKettle(10);
    const holders = [];
    for (let i = 0; i < 5; i++) holders.push(await claimed(token, kettle, `Gifter ${i}`));
    const results = await Promise.all(
      holders.map((holder) => change(holder.manageToken, { quantity: 3 })),
    );
    expect(results.filter((res) => res.status === 200)).toHaveLength(2);
    expect(results.filter((res) => res.status === 409)).toHaveLength(3);
    expect(await claimedSum()).toBe(9);
  });

  it('waits for the item’s row lock, then judges against what the holder committed', async () => {
    // Ada wants 3. Sue holds 1. Another transaction locks the item and commits a claim of 2, so
    // Sue's +1 must not fit, however long her PATCH had to wait for the lock.
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    const holder = await db.pool.connect();
    let patch: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('select id from items where id = $1 for update', [kettle]);
      await holder.query(
        `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
         values (gen_random_uuid(), $1, 'Holder', 2, $2)`,
        [kettle, hashToken('holder')],
      );
      // supertest sends nothing until `.then` is called, so start it here, not at the `await`.
      patch = change(sue.manageToken, { quantity: 2 }).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, patch);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const res = await patch;
    expect(res?.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(res?.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 0,
    });
    expect(await claimedSum()).toBe(3);
  });

  it('re-reads the claim under the lock, so a quantity changed meanwhile is the one judged', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue', 2);
    await claimed(token, kettle, 'Sam', 1);
    const holder = await db.pool.connect();
    let patch: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('select id from items where id = $1 for update', [kettle]);
      await holder.query('update claims set quantity = 1 where manage_token_hash = $1', [
        hashToken(sue.manageToken),
      ]);
      await holder.query(
        `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
         values (gen_random_uuid(), $1, 'Kim', 1, $2)`,
        [kettle, hashToken('kim')],
      );
      patch = change(sue.manageToken, { quantity: 2 }).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, patch);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect((await patch)?.status).toBe(409);
    expect(await claimedSum()).toBe(3);
  });

  it('shares the claim limits: the list’s and the IP’s (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(5);
    const sue = await claimed(token, kettle, 'Sue');
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const byList = await change(sue.manageToken, { quantity: 2 });
    expect([byList.status, codeOf(byList)]).toEqual([429, ErrorCode.RATE_LIMITED]);

    await db.pool.query('truncate rate_limits');
    await fillBucket(db, claimsIpKey('127.0.0.1'), 20);
    const byIp = await change(sue.manageToken, { quantity: 2 });
    expect([byIp.status, codeOf(byIp)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  it('answers 404 NOT_FOUND for a token that is malformed or unknown', async () => {
    for (const manageToken of ['short', UNKNOWN_TOKEN]) {
      const res = await change(manageToken, { claimerName: 'Sue' });
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
  });
});

describe('DELETE /claims/:manageToken (spec §5)', () => {
  it('cancels the claim, and frees what it held', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await cancel(sue.manageToken);
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await details(sue.manageToken)).status).toBe(404);
    expect((await claimed(token, kettle, 'Sam')).claim.quantity).toBe(1);
  });

  it('answers 404 NOT_FOUND when the claim is already gone', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    await cancel(sue.manageToken);
    const again = await cancel(sue.manageToken);
    expect([again.status, codeOf(again)]).toEqual([404, ErrorCode.NOT_FOUND]);
  });

  it('refuses a cancel that does not come from the app (spec §6.2)', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await http(t.app)
      .delete(`/api/claims/${sue.manageToken}`)
      .set('content-type', 'application/json')
      .send('{}');
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.FORBIDDEN_ORIGIN]);
    expect(await count()).toBe(1);
  });

  it('a change racing a cancel from another device ends cleanly (Review Focus 5)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    const [changed, cancelled] = await Promise.all([
      change(sue.manageToken, { quantity: 2 }),
      cancel(sue.manageToken),
    ]);
    expect(cancelled.status).toBe(204);
    expect([200, 404]).toContain(changed.status);
    expect(await count()).toBe(0);
  });
});

describe('a claim on the owner’s own list (D82)', () => {
  const BOB: Account = {
    email: 'bob@example.com',
    password: 'another fine passphrase 2',
    displayName: 'Bob',
  };

  /** Ada's verified list with Sue's claim on a kettle, and Ada's session. */
  async function suesClaim() {
    await signUpVerified(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 3);
    const sue = await seedClaim(db, kettle, 'Sue', 2);
    return { sue, ada: await logIn(t) };
  }

  const claimRows = async () =>
    (
      await db.pool.query<{ claimer_name: string; quantity: number }>(
        'select claimer_name, quantity from claims',
      )
    ).rows;

  it('refuses a GET with 403 OWN_LIST_CLAIM and no claim data', async () => {
    const { sue, ada } = await suesClaim();
    const res = await client(t.app, ada).get(`/claims/${sue.manageToken}`);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sue');
    expect(body).not.toContain(sue.id);
    expect(body).not.toContain('remaining');
  });

  it('refuses a PATCH, and the claim is unchanged', async () => {
    const { sue, ada } = await suesClaim();
    const res = await client(t.app, ada).patch(`/claims/${sue.manageToken}`, { quantity: 1 });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
    expect(await claimRows()).toEqual([{ claimer_name: 'Sue', quantity: 2 }]);
  });

  it('refuses a DELETE, and the claim stays', async () => {
    const { sue, ada } = await suesClaim();
    const res = await client(t.app, ada).delete(`/claims/${sue.manageToken}`);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
    expect(await count()).toBe(1);
  });

  it('refuses the owner before the list’s limit, so a 429 says nothing (D43)', async () => {
    const { sue, ada } = await suesClaim();
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await client(t.app, ada).patch(`/claims/${sue.manageToken}`, { quantity: 1 });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
  });

  it('refuses an owner whose email is unconfirmed too', async () => {
    await signUp(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 3);
    const sue = await seedClaim(db, kettle, 'Sue', 2);
    const ada = await logIn(t);
    const res = await client(t.app, ada).get(`/claims/${sue.manageToken}`);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
  });

  it('treats anyone else who is signed in as the claimer, as before', async () => {
    const { sue } = await suesClaim();
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);
    const res = await client(t.app, bob).get(`/claims/${sue.manageToken}`);
    expect(res.status).toBe(200);
    expect(ClaimDetailsResponseSchema.parse(res.body).claim.claimerName).toBe('Sue');
    expect((await client(t.app, bob).delete(`/claims/${sue.manageToken}`)).status).toBe(204);
  });

  it('still answers 404 for an unknown token, signed in as the owner', async () => {
    const { ada } = await suesClaim();
    for (const res of [
      await client(t.app, ada).get(`/claims/${UNKNOWN_TOKEN}`),
      await client(t.app, ada).patch(`/claims/${UNKNOWN_TOKEN}`, { quantity: 1 }),
      await client(t.app, ada).delete(`/claims/${UNKNOWN_TOKEN}`),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
  });
});

describe('GET /claims/:manageToken tells a signed-in gifter about links (D76)', () => {
  const BOB: Account = {
    email: 'bob@example.com',
    password: 'another fine passphrase 2',
    displayName: 'Bob',
  };
  const CAM: Account = { ...BOB, email: 'cam@example.com', displayName: 'Cam' };

  const linkTo = (claimId: string, email: string) =>
    db.pool.query(
      `insert into claim_links (id, claim_id, user_id, item_title, owner_display_name)
       select gen_random_uuid(), $1, id, 'Kettle', 'Ada' from users where email = $2`,
      [claimId, email],
    );

  it('says none, yours or someone-else to a verified gifter, and nothing to a guest', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await signUpVerified(t, BOB);
    await signUpVerified(t, CAM);
    const bob = await logIn(t, BOB);
    const cam = await logIn(t, CAM);
    const linkOf = async (cookie?: string) =>
      ClaimDetailsResponseSchema.parse(
        (await client(t.app, cookie).get(`/claims/${sue.manageToken}`)).body,
      ).link;

    expect(await linkOf()).toBeUndefined();
    expect(await linkOf(bob)).toBe('none');
    await linkTo(sue.claim.id, BOB.email);
    expect(await linkOf(bob)).toBe('yours');
    expect(await linkOf(cam)).toBe('someone-else');
    expect(await linkOf()).toBeUndefined();
    const guest = (await details(sue.manageToken)).body as object;
    expect(guest).not.toHaveProperty('link');
  });

  it('adds no link for an unverified account', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    await signUp(t, BOB);
    const res = await client(t.app, await logIn(t, BOB)).get(`/claims/${sue.manageToken}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('link');
  });

  it('adds no link for the owner, who is refused first (D82)', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await client(t.app, await logIn(t)).get(`/claims/${sue.manageToken}`);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
    expect(res.body).not.toHaveProperty('link');
  });
});

describe('POST and DELETE /claims/:manageToken/link (D77, D80)', () => {
  const BOB: Account = {
    email: 'bob@example.com',
    password: 'another fine passphrase 2',
    displayName: 'Bob',
  };
  const CAM: Account = { ...BOB, email: 'cam@example.com', displayName: 'Cam' };

  const link = (manageToken: string, cookie?: string) =>
    client(t.app, cookie).post(`/claims/${manageToken}/link`);
  const unlink = (manageToken: string, cookie?: string) =>
    client(t.app, cookie).delete(`/claims/${manageToken}/link`);
  const linkOf = (res: ApiResponse) => ClaimLinkResponseSchema.parse(res.body).link;
  const userId = async (email: string) =>
    (await db.pool.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]
      ?.id;
  const linkRows = async () =>
    (
      await db.pool.query<{
        user_id: string;
        claim_id: string | null;
        item_title: string;
        owner_display_name: string;
        cancelled_at: Date | null;
        gone_at: Date | null;
      }>(
        `select user_id, claim_id, item_title, owner_display_name, cancelled_at, gone_at
           from claim_links`,
      )
    ).rows;

  /** Sue's claim on Ada's kettle, and verified, signed-in Bob and Cam. */
  async function setUp() {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await signUpVerified(t, BOB);
    await signUpVerified(t, CAM);
    return { sue, bob: await logIn(t, BOB), cam: await logIn(t, CAM) };
  }

  it('links an unlinked claim, and answers someone-else when another account holds it', async () => {
    const { sue, bob, cam } = await setUp();
    const first = await link(sue.manageToken, bob);
    expect(first.status).toBe(200);
    expect(linkOf(first)).toBe('yours');
    expect(await linkRows()).toEqual([
      {
        user_id: await userId(BOB.email),
        claim_id: sue.claim.id,
        item_title: 'Kettle',
        owner_display_name: 'Ada',
        cancelled_at: null,
        gone_at: null,
      },
    ]);
    expect(linkOf(await link(sue.manageToken, bob))).toBe('yours');
    const other = await link(sue.manageToken, cam);
    expect([other.status, linkOf(other)]).toEqual([200, 'someone-else']);
    expect((await linkRows()).map((l) => l.user_id)).toEqual([await userId(BOB.email)]);
    // The claim itself is untouched.
    expect(await claimedSum()).toBe(1);
  });

  it('two accounts linking one claim at once: exactly one wins (Review Focus 1)', async () => {
    const { sue, bob, cam } = await setUp();
    const [a, b] = await Promise.all([link(sue.manageToken, bob), link(sue.manageToken, cam)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([linkOf(a), linkOf(b)].sort()).toEqual(['someone-else', 'yours']);
    expect(await linkRows()).toHaveLength(1);
  });

  it('refuses the owner (403 OWN_LIST_CLAIM), an unverified user (403 EMAIL_NOT_VERIFIED) and a guest (401)', async () => {
    const { sue } = await setUp();
    const ada = await logIn(t);
    const owner = await link(sue.manageToken, ada);
    expect([owner.status, codeOf(owner)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
    expect(JSON.stringify(owner.body)).not.toContain('Sue');
    const ownerUnlink = await unlink(sue.manageToken, ada);
    expect([ownerUnlink.status, codeOf(ownerUnlink)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);

    const dan: Account = { ...BOB, email: 'dan@example.com', displayName: 'Dan' };
    await signUp(t, dan);
    const danCookie = await logIn(t, dan);
    for (const res of [
      await link(sue.manageToken, danCookie),
      await unlink(sue.manageToken, danCookie),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
    }
    for (const res of [await link(sue.manageToken), await unlink(sue.manageToken)]) {
      expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
    }
    expect(await linkRows()).toEqual([]);
  });

  it('answers 404 NOT_FOUND for a token that is malformed or unknown', async () => {
    const { bob } = await setUp();
    for (const manageToken of ['short', UNKNOWN_TOKEN]) {
      for (const res of [await link(manageToken, bob), await unlink(manageToken, bob)]) {
        expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
      }
    }
  });

  it('refuses the owner before the list’s limit, so a 429 says nothing (D43)', async () => {
    const { sue } = await setUp();
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await link(sue.manageToken, await logIn(t));
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWN_LIST_CLAIM]);
  });

  it('DELETE …/link removes only the session’s own link, and the claim stays (Review Focus 2)', async () => {
    const { sue, bob, cam } = await setUp();
    await link(sue.manageToken, bob);

    const notHers = await unlink(sue.manageToken, cam);
    expect(notHers.status).toBe(204);
    expect(await linkRows()).toHaveLength(1);

    const mine = await unlink(sue.manageToken, bob);
    expect(mine.status).toBe(204);
    expect(mine.headers['cache-control']).toBe('no-store');
    expect(await linkRows()).toEqual([]);
    expect(await count()).toBe(1);
    expect((await details(sue.manageToken)).status).toBe(200);

    expect((await unlink(sue.manageToken, bob)).status).toBe(204);
    expect(linkOf(await link(sue.manageToken, cam))).toBe('yours');
  });

  it('answers 404 when the claim goes between the lookup and the link (R5)', async () => {
    const { sue, bob } = await setUp();
    const holder = await db.pool.connect();
    let racing: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('delete from claims where id = $1', [sue.claim.id]);
      racing = link(sue.manageToken, bob).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, racing);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const res = await racing;
    expect([res?.status, res && codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect(await linkRows()).toEqual([]);
  });

  it('cancelling through the link leaves the linked gifter a cancelled note', async () => {
    const { sue, bob } = await setUp();
    await link(sue.manageToken, bob);
    expect((await cancel(sue.manageToken)).status).toBe(204);
    const [note, ...rest] = await linkRows();
    expect(rest).toEqual([]);
    expect(note).toMatchObject({
      user_id: await userId(BOB.email),
      claim_id: null,
      item_title: 'Kettle',
      owner_display_name: 'Ada',
    });
    expect(note?.cancelled_at).toBeInstanceOf(Date);
    expect(note?.gone_at).toEqual(note?.cancelled_at);
    expect(await count()).toBe(0);
  });

  it('another signed-in account cancelling also leaves the linked gifter a note', async () => {
    const { sue, bob, cam } = await setUp();
    await link(sue.manageToken, bob);
    expect((await client(t.app, cam).delete(`/claims/${sue.manageToken}`)).status).toBe(204);
    const rows = await linkRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.claim_id).toBeNull();
    expect(rows[0]?.cancelled_at).not.toBeNull();
  });

  it('the linked gifter cancelling on /c leaves no note', async () => {
    const { sue, bob } = await setUp();
    await link(sue.manageToken, bob);
    expect((await client(t.app, bob).delete(`/claims/${sue.manageToken}`)).status).toBe(204);
    expect(await linkRows()).toEqual([]);
    expect(await count()).toBe(0);
  });

  it.each([
    ['a guest, which stamps the note', undefined],
    ['the linked gifter, which deletes the link', 'bob'],
  ] as const)(
    'cancelling (%s) takes the claim row before its link, the cascade’s order (R10)',
    async (_who, canceller) => {
      // An owner deleting the item cascades item → claim → link. A cancel that took the link
      // first and then waited for the claim could deadlock with it, so while the claim's row is
      // held elsewhere, the waiting cancel must hold no lock on the link.
      const { sue, bob } = await setUp();
      await link(sue.manageToken, bob);
      const linkId = (await db.pool.query<{ id: string }>('select id from claim_links')).rows[0]!
        .id;
      const holder = await db.pool.connect();
      let cancelling: Promise<ApiResponse> | undefined;
      let probe: Promise<number | null> | undefined;
      try {
        await holder.query('begin');
        const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]!.pid;
        await holder.query('select id from claims where id = $1 for update', [sue.claim.id]);
        cancelling = client(t.app, canceller === 'bob' ? bob : undefined)
          .delete(`/claims/${sue.manageToken}`)
          .then((res) => res);
        await untilBlockedBy(db.pool, holderPid, 1, cancelling);
        probe = db.pool
          .query('select id from claim_links where id = $1 for update nowait', [linkId])
          .then((res) => res.rowCount);
        await probe.catch(() => undefined);
        await holder.query('commit');
      } finally {
        await holder.query('rollback').catch(() => undefined);
        holder.release();
      }
      await expect(probe).resolves.toBe(1);
      expect((await cancelling)?.status).toBe(204);
      expect(await count()).toBe(0);
      const rows = await linkRows();
      if (canceller === 'bob') expect(rows).toEqual([]);
      else expect(rows).toMatchObject([{ claim_id: null, cancelled_at: expect.any(Date) }]);
    },
  );

  it('cancelling a claim nobody linked leaves nothing behind', async () => {
    const { sue } = await setUp();
    expect((await cancel(sue.manageToken)).status).toBe(204);
    expect(await linkRows()).toEqual([]);
  });

  it('link and unlink count against the claim limits (spec §6.6)', async () => {
    const { sue, bob } = await setUp();
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    for (const res of [await link(sue.manageToken, bob), await unlink(sue.manageToken, bob)]) {
      expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    }
    expect(await linkRows()).toEqual([]);

    await db.pool.query('truncate rate_limits');
    await fillBucket(db, claimsIpKey('127.0.0.1'), 20);
    for (const res of [await link(sue.manageToken, bob), await unlink(sue.manageToken, bob)]) {
      expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    }
  });

  it('counts a successful link and unlink', async () => {
    const { sue, bob } = await setUp();
    const listCount = async () =>
      Number(
        (
          await db.pool.query<{ n: string }>(
            "select coalesce(sum(count), 0) as n from rate_limits where key like 'claims:list%'",
          )
        ).rows[0]?.n,
      );
    const before = await listCount();
    await link(sue.manageToken, bob);
    await unlink(sue.manageToken, bob);
    expect((await listCount()) - before).toBe(2);
  });
});
