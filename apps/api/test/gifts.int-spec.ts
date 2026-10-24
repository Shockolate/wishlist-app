import { Logger } from '@nestjs/common';
import {
  ClaimConflictProblemSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  GiftSchema,
  GiftsResponseSchema,
  ProblemSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsIpKey, claimsListKey } from '../src/claims/rate-limits.js';
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
const CAM: Account = { ...BOB, email: 'cam@example.com', displayName: 'Cam' };
const CY: Account = { ...BOB, email: 'cy@example.com', displayName: 'Cy' };

const UNKNOWN_ID = '0199a3b2-0000-7000-8000-0000000000ff';
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const gifts = (cookie?: string) => client(t.app, cookie).get('/me/gifts');
const change = (linkId: string, body: object, cookie?: string) =>
  client(t.app, cookie).patch(`/me/gifts/${linkId}`, body);
const letGo = (linkId: string, cookie?: string) =>
  client(t.app, cookie).delete(`/me/gifts/${linkId}`);
const listed = async (cookie: string) => {
  const res = await gifts(cookie);
  expect(res.status).toBe(200);
  return GiftsResponseSchema.parse(res.body);
};
const count = async (table: 'claims' | 'claim_links') =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
/** What a claim-limit bucket has counted; undefined when nothing was charged. */
const used = async (key: string) =>
  (await db.pool.query<{ count: number }>('select count from rate_limits where key = $1', [key]))
    .rows[0]?.count;

/** A claim as a gifter makes it; signed in (with `cookie`), it goes on Your gifts. */
async function claim(
  shareToken: string,
  itemId: string,
  claimerName: string,
  quantity = 1,
  cookie?: string,
) {
  const res = await client(t.app, cookie).post(`/shared/${shareToken}/items/${itemId}/claims`, {
    claimerName,
    quantity,
  });
  if (res.status !== 201) throw new Error(`claim answered ${res.status}`);
  return CreateClaimResponseSchema.parse(res.body);
}

/** Ada's kettle (wants 3) and mug; Bob, Cam and Cy verified. Bob's cookie is signed in. */
async function setUp() {
  await signUpVerified(t);
  await signUpVerified(t, BOB);
  await signUpVerified(t, CAM);
  const kettle = await seedItem(db, ADA.email, 'Kettle', 3);
  const mug = await seedItem(db, ADA.email, 'Mug');
  return {
    adaToken: await shareTokenOf(db, ADA.email),
    kettle,
    mug,
    bob: await logIn(t, BOB),
    cam: await logIn(t, CAM),
  };
}

/** Bob's one claim on the kettle, with Sue holding another, and Bob's link ID. */
async function bobsKettle() {
  const s = await setUp();
  await claim(s.adaToken, s.kettle, 'Sue');
  const mine = await claim(s.adaToken, s.kettle, 'Bob', 1, s.bob);
  const { gifts: all } = await listed(s.bob);
  const gift = all[0];
  if (!gift) throw new Error('no gift');
  return { ...s, mine, linkId: gift.linkId };
}

describe('GET /me/gifts (design §5.9, ruling 2)', () => {
  it('lists my gifts grouped by list, in the order I first claimed from each, then by the owner’s order', async () => {
    const s = await setUp();
    await signUpVerified(t, CY);
    const lamp = await seedItem(db, CY.email, 'Lamp');
    const cyToken = await shareTokenOf(db, CY.email);
    await claim(s.adaToken, s.kettle, 'Sue'); // not Bob's: never listed
    // Bob claims from Cy first, then Ada's mug, then Ada's kettle.
    await claim(cyToken, lamp, 'Bob', 1, s.bob);
    t.clock.advance(1000);
    await claim(s.adaToken, s.mug, 'Bob', 1, s.bob);
    t.clock.advance(1000);
    await claim(s.adaToken, s.kettle, 'Bob', 1, s.bob);

    const { gifts: mine, gone } = await listed(s.bob);
    expect(mine.map((g) => g.item.title)).toEqual(['Lamp', 'Kettle', 'Mug']);
    expect(gone).toEqual([]);
    const kettle = mine[1];
    expect(kettle).toMatchObject({
      claim: { claimerName: 'Bob', quantity: 1 },
      item: { id: s.kettle, quantity: 3 },
      remaining: 1,
      ownerDisplayName: 'Ada',
      bought: false,
      shareUrl: expect.stringContaining(s.adaToken) as unknown,
    });
    expect(mine[0]?.ownerDisplayName).toBe('Cy');
    expect(await listed(s.cam)).toEqual({ gifts: [], gone: [] });
  });

  it('lists notes after the gifts, newest first, with why they went', async () => {
    const s = await bobsKettle();
    const bobId = (
      await db.pool.query<{ id: string }>('select id from users where email = $1', [BOB.email])
    ).rows[0]?.id;
    const note = (title: string, cancelled: boolean, goneAt: string | null, updatedAt: string) =>
      db.pool.query(
        `insert into claim_links
           (id, claim_id, user_id, item_title, owner_display_name, cancelled_at, gone_at, updated_at)
         values (gen_random_uuid(), null, $1, $2, 'Ada', $3, $4, $5)`,
        [bobId, title, cancelled ? goneAt : null, goneAt, updatedAt],
      );
    await note('Oldest', true, '2026-10-01T00:00:00Z', '2026-10-30T00:00:00Z');
    await note('Newest', false, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z');
    // The cron hasn't stamped this one yet, so it went since the cron last ran: newer than every
    // stamped note, whenever it was last updated (R14).
    await note('Unstamped', false, null, '2026-10-03T00:00:00Z');

    const body = await listed(s.bob);
    expect(body.gifts).toHaveLength(1);
    expect(body.gone.map((n) => [n.itemTitle, n.reason])).toEqual([
      ['Unstamped', 'removed'],
      ['Newest', 'removed'],
      ['Oldest', 'cancelled'],
    ]);
    expect(Object.keys(body.gone[0] ?? {}).sort()).toEqual([
      'itemTitle',
      'linkId',
      'ownerDisplayName',
      'reason',
    ]);
  });

  it('turns a gift into a note when the item goes, or when someone cancels it through its link', async () => {
    const s = await setUp();
    const cancelled = await claim(s.adaToken, s.kettle, 'Bob', 1, s.bob);
    await claim(s.adaToken, s.mug, 'Bob', 1, s.bob);
    expect((await client(t.app).delete(`/claims/${cancelled.manageToken}`)).status).toBe(204);
    expect((await listed(s.bob)).gone.map((n) => [n.itemTitle, n.reason])).toEqual([
      ['Kettle', 'cancelled'],
    ]);
    await db.pool.query('delete from items where id = $1', [s.mug]);
    const body = await listed(s.bob);
    expect(body.gifts).toEqual([]);
    expect(body.gone.map((n) => [n.itemTitle, n.reason]).sort()).toEqual([
      ['Kettle', 'cancelled'],
      ['Mug', 'removed'],
    ]);
  });

  it('shows a removed note with the title and owner name I last saw (ruling 3)', async () => {
    const s = await setUp();
    await claim(s.adaToken, s.kettle, 'Bob', 1, s.bob);
    await db.pool.query(`update items set title = 'Copper kettle' where id = $1`, [s.kettle]);
    await db.pool.query(`update users set display_name = 'Ada L.' where email = $1`, [ADA.email]);

    const shown = await listed(s.bob);
    expect(shown.gifts[0]).toMatchObject({
      item: { title: 'Copper kettle' },
      ownerDisplayName: 'Ada L.',
    });
    const stored = await db.pool.query<{ item_title: string; owner_display_name: string }>(
      'select item_title, owner_display_name from claim_links',
    );
    expect(stored.rows).toEqual([{ item_title: 'Copper kettle', owner_display_name: 'Ada L.' }]);

    await db.pool.query(`delete from items where id = $1`, [s.kettle]);
    const after = await listed(s.bob);
    expect(after.gifts).toEqual([]);
    expect(after.gone).toEqual([
      {
        linkId: expect.any(String) as unknown,
        itemTitle: 'Copper kettle',
        ownerDisplayName: 'Ada L.',
        reason: 'removed',
      },
    ]);
  });

  it('still answers when the snapshot refresh fails, and logs once without any values', async () => {
    const s = await setUp();
    await claim(s.adaToken, s.kettle, 'Bob', 1, s.bob);
    await db.pool.query(`update items set title = 'Copper kettle' where id = $1`, [s.kettle]);
    await db.pool.query(`
      create function fail_gift_refresh() returns trigger language plpgsql
        as $$ begin raise exception 'refresh refused: Copper kettle'; end $$;
      create trigger fail_gift_refresh before update on claim_links
        for each row execute function fail_gift_refresh();
    `);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const res = await gifts(s.bob);
      expect(res.status).toBe(200);
      expect(GiftsResponseSchema.parse(res.body).gifts[0]?.item.title).toBe('Copper kettle');
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      for (const secret of ['Copper', 'Kettle', 'Ada', 'Bob']) expect(logged).not.toContain(secret);
    } finally {
      warn.mockRestore();
      await db.pool.query(`
        drop trigger fail_gift_refresh on claim_links;
        drop function fail_gift_refresh();
      `);
    }
  });

  it('refuses an unverified user (403) and a guest (401)', async () => {
    const s = await bobsKettle();
    await signUp(t, CY);
    const unverified = await logIn(t, CY);
    for (const res of [
      await gifts(unverified),
      await change(s.linkId, { bought: true }, unverified),
      await letGo(s.linkId, unverified),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
    }
    for (const res of [
      await gifts(),
      await change(s.linkId, { bought: true }),
      await letGo(s.linkId),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(await count('claim_links')).toBe(1);
  });

  it('is not rate limited, and is never cached', async () => {
    const s = await bobsKettle();
    await fillBucket(db, claimsIpKey('127.0.0.1'), 20);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await gifts(s.bob);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('PATCH /me/gifts/:linkId (design §5.9)', () => {
  it('ticks and unticks Bought, and nothing else changes', async () => {
    const s = await bobsKettle();
    const surfaces = async () => ({
      shared: (await client(t.app).get(`/shared/${s.adaToken}`)).body as unknown,
      claims: (await client(t.app).get(`/claims/${s.mine.manageToken}`)).body as unknown,
      claimRows: (await db.pool.query('select * from claims order by id')).rows,
    });
    const before = await surfaces();

    const on = await change(s.linkId, { bought: true }, s.bob);
    expect(on.status).toBe(200);
    expect(GiftSchema.parse(on.body)).toMatchObject({ linkId: s.linkId, bought: true });
    expect((await listed(s.bob)).gifts[0]?.bought).toBe(true);
    expect(await surfaces()).toEqual(before);
    const stored = await db.pool.query<{ bought_at: Date | null }>(
      'select bought_at from claim_links',
    );
    expect(stored.rows[0]?.bought_at).toEqual(t.clock.now());

    const off = await change(s.linkId, { bought: false }, s.bob);
    expect(GiftSchema.parse(off.body).bought).toBe(false);
    expect((await db.pool.query('select bought_at from claim_links')).rows).toEqual([
      { bought_at: null },
    ]);
    expect(await surfaces()).toEqual(before);
  });

  it('ticks Bought without waiting for the item’s lock', async () => {
    const s = await bobsKettle();
    const holder = await db.pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from items where id = $1 for update', [s.kettle]);
      const res = await change(s.linkId, { bought: true }, s.bob);
      expect(res.status).toBe(200);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  });

  it('changes a gift’s name and quantity, and refuses more than is left with 409 and remaining', async () => {
    // Kettle wants 3: Sue holds 1, Bob holds 1, so 1 is left and Bob may hold up to 2.
    const s = await bobsKettle();
    const ok = await change(s.linkId, { claimerName: 'Bobby', quantity: 2, bought: true }, s.bob);
    expect(ok.status).toBe(200);
    expect(GiftSchema.parse(ok.body)).toMatchObject({
      claim: { id: s.mine.claim.id, claimerName: 'Bobby', quantity: 2 },
      remaining: 0,
      bought: true,
    });

    const over = await change(s.linkId, { quantity: 3, bought: false }, s.bob);
    expect(over.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(over.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 0,
    });
    // The refused change took nothing with it: not the quantity, not the tick.
    const row = await db.pool.query(
      `select c.quantity, c.claimer_name, l.bought_at is not null as bought
         from claim_links l join claims c on c.id = l.claim_id`,
    );
    expect(row.rows).toEqual([{ quantity: 2, claimer_name: 'Bobby', bought: true }]);

    const lower = await change(s.linkId, { quantity: 1 }, s.bob);
    expect(GiftSchema.parse(lower.body)).toMatchObject({ claim: { quantity: 1 }, remaining: 1 });
  });

  it('validates the body: at least one field, and the claim’s own rules', async () => {
    const s = await bobsKettle();
    for (const body of [{}, { quantity: 0 }, { claimerName: '' }, { bought: 'yes' }]) {
      const res = await change(s.linkId, body, s.bob);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    }
  });

  it('answers 404 for a link that isn’t mine, and for a gift whose item was deleted meanwhile', async () => {
    const s = await bobsKettle();
    // Not mine, unknown, malformed.
    for (const id of [s.linkId, UNKNOWN_ID, 'nope']) {
      for (const res of [
        await change(id, { bought: true }, s.cam),
        await change(id, { quantity: 1 }, s.cam),
        await letGo(id, s.cam),
      ]) {
        expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
      }
    }
    expect((await change('nope', { bought: true }, s.bob)).status).toBe(404);
    expect(await count('claims')).toBe(2);
    expect((await listed(s.bob)).gifts[0]?.bought).toBe(false);

    // The owner deletes the item; Bob's page, still open, then ticks or saves (Review Focus 3).
    await db.pool.query('delete from items where id = $1', [s.kettle]);
    for (const body of [{ bought: true }, { claimerName: 'Bobby' }, { quantity: 1 }]) {
      const res = await change(s.linkId, body, s.bob);
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
    expect((await db.pool.query('select bought_at from claim_links')).rows).toEqual([
      { bought_at: null },
    ]);
  });

  it('answers 404 when the claim goes while the change waits for the item’s lock', async () => {
    const s = await bobsKettle();
    const holder = await db.pool.connect();
    let racing: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      await holder.query('select 1 from items where id = $1 for update', [s.kettle]);
      racing = change(s.linkId, { quantity: 2 }, s.bob).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await holder.query('delete from claims where id = $1', [s.mine.claim.id]);
      await holder.query('commit');
    } finally {
      holder.release();
    }
    const res = await racing;
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
  });

  it('answers 404 to a change on a note', async () => {
    const s = await bobsKettle();
    await db.pool.query('delete from items where id = $1', [s.kettle]);
    const res = await change(s.linkId, { bought: true }, s.bob);
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
  });

  it('counts a name or quantity change against the IP’s and the list’s claim limits', async () => {
    const s = await bobsKettle();
    const ipKey = claimsIpKey('127.0.0.1');
    const listKey = claimsListKey(await wishlistIdOf(db, ADA.email));
    for (const body of [{ claimerName: 'Bobby' }, { quantity: 2, bought: true }]) {
      await db.pool.query('truncate rate_limits');
      await fillBucket(db, listKey, 30);
      const byList = await change(s.linkId, body, s.bob);
      expect([byList.status, codeOf(byList)]).toEqual([429, ErrorCode.RATE_LIMITED]);
      await db.pool.query('truncate rate_limits');
      await fillBucket(db, ipKey, 20);
      const byIp = await change(s.linkId, body, s.bob);
      expect([byIp.status, codeOf(byIp)]).toEqual([429, ErrorCode.RATE_LIMITED]);
      await db.pool.query('truncate rate_limits');
      expect((await change(s.linkId, body, s.bob)).status).toBe(200);
      expect([await used(ipKey), await used(listKey)]).toEqual([1, 1]);
    }
  });

  it('ticks Bought with both claim limits full, and charges neither (R13)', async () => {
    const s = await bobsKettle();
    const ipKey = claimsIpKey('127.0.0.1');
    const listKey = claimsListKey(await wishlistIdOf(db, ADA.email));
    await fillBucket(db, listKey, 30);
    await fillBucket(db, ipKey, 20);
    for (const bought of [true, false, true]) {
      expect((await change(s.linkId, { bought }, s.bob)).status).toBe(200);
    }
    expect([await used(ipKey), await used(listKey)]).toEqual([20, 30]);
    await db.pool.query('truncate rate_limits');
    expect((await change(s.linkId, { bought: false }, s.bob)).status).toBe(200);
    expect([await used(ipKey), await used(listKey)]).toEqual([undefined, undefined]);
  });
});

describe('DELETE /me/gifts/:linkId (design §5.9)', () => {
  it('letting a gift go deletes the claim and leaves no note; clearing a note deletes it', async () => {
    const s = await bobsKettle();
    const mug = await claim(s.adaToken, s.mug, 'Bob', 1, s.bob);
    expect(mug.onYourGifts).toBe(true);

    const gone = await letGo(s.linkId, s.bob);
    expect(gone.status).toBe(204);
    expect(gone.headers['cache-control']).toBe('no-store');
    // Sue's claim on the same kettle is untouched, and Bob has no note.
    expect(
      (await db.pool.query('select claimer_name from claims order by claimer_name')).rows,
    ).toEqual([{ claimer_name: 'Bob' }, { claimer_name: 'Sue' }]);
    const after = await listed(s.bob);
    expect(after.gifts.map((g) => g.item.title)).toEqual(['Mug']);
    expect(after.gone).toEqual([]);
    expect(await count('claim_links')).toBe(1);
    expect((await letGo(s.linkId, s.bob)).status).toBe(404);

    // The owner takes the mug off; Bob's gift turns into a note, and Clear deletes it.
    await db.pool.query('delete from items where id = $1', [s.mug]);
    const note = (await listed(s.bob)).gone[0];
    if (!note) throw new Error('no note');
    expect(note.reason).toBe('removed');
    expect((await letGo(note.linkId, s.cam)).status).toBe(404);
    expect(await count('claim_links')).toBe(1);
    expect((await letGo(note.linkId, s.bob)).status).toBe(204);
    expect(await count('claim_links')).toBe(0);
    expect(await listed(s.bob)).toEqual({ gifts: [], gone: [] });
  });

  it('frees what the claim held', async () => {
    const s = await bobsKettle();
    await letGo(s.linkId, s.bob);
    const held = await db.pool.query<{ n: string }>('select sum(quantity) as n from claims');
    expect(Number(held.rows[0]?.n)).toBe(1);
  });

  it('counts letting a gift go against the IP’s and the list’s claim limits', async () => {
    const s = await bobsKettle();
    const listKey = claimsListKey(await wishlistIdOf(db, ADA.email));
    const ipKey = claimsIpKey('127.0.0.1');
    await fillBucket(db, listKey, 30);
    const byList = await letGo(s.linkId, s.bob);
    expect([byList.status, codeOf(byList)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    await db.pool.query('truncate rate_limits');
    await fillBucket(db, ipKey, 20);
    const byIp = await letGo(s.linkId, s.bob);
    expect([byIp.status, codeOf(byIp)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(await count('claims')).toBe(2);

    await db.pool.query('truncate rate_limits');
    expect((await letGo(s.linkId, s.bob)).status).toBe(204);
    expect([await used(ipKey), await used(listKey)]).toEqual([1, 1]);
  });

  it('clears a note with both claim limits full, and charges neither (R13)', async () => {
    const s = await bobsKettle();
    const listKey = claimsListKey(await wishlistIdOf(db, ADA.email));
    const ipKey = claimsIpKey('127.0.0.1');
    await db.pool.query('delete from items where id = $1', [s.kettle]);
    await fillBucket(db, listKey, 30);
    await fillBucket(db, ipKey, 20);
    expect((await letGo(s.linkId, s.bob)).status).toBe(204);
    expect(await count('claim_links')).toBe(0);
    expect([await used(ipKey), await used(listKey)]).toEqual([20, 30]);
  });

  it('answers 404 to Let it go on a claim cancelled meanwhile, and leaves the note (R14)', async () => {
    // Bob's page still shows the gift; someone cancels it through its link just as he lets it
    // go. He's told it's gone and the page refreshes to the note, rather than it vanishing.
    const s = await bobsKettle();
    const holder = await db.pool.connect();
    let racing: Promise<ApiResponse> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('delete from claims where id = $1', [s.mine.claim.id]);
      await holder.query(
        'update claim_links set cancelled_at = now(), gone_at = now() where id = $1',
        [s.linkId],
      );
      racing = letGo(s.linkId, s.bob).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, racing);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const res = await racing;
    expect(res?.status).toBe(404);
    expect(res && codeOf(res)).toBe(ErrorCode.NOT_FOUND);
    const { gone } = await listed(s.bob);
    expect(gone).toMatchObject([{ linkId: s.linkId, reason: 'cancelled' }]);
  });

  it('lets a gift go taking the claim row before its link, the cascade’s order (R10)', async () => {
    // An owner deleting the item cascades item → claim → link. Let it go must not hold the link
    // while it waits for the claim, or the two can deadlock.
    const s = await bobsKettle();
    const holder = await db.pool.connect();
    let racing: Promise<ApiResponse> | undefined;
    let probe: Promise<number | null> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('select id from claims where id = $1 for update', [s.mine.claim.id]);
      racing = letGo(s.linkId, s.bob).then((res) => res);
      await untilBlockedBy(db.pool, holderPid, 1, racing);
      probe = db.pool
        .query('select id from claim_links where id = $1 for update nowait', [s.linkId])
        .then((res) => res.rowCount);
      await probe.catch(() => undefined);
      await holder.query('commit');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    await expect(probe).resolves.toBe(1);
    expect((await racing)?.status).toBe(204);
    expect([await count('claims'), await count('claim_links')]).toEqual([1, 0]);
  });
});
