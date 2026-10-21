import {
  ErrorCode,
  MAX_TAGS_PER_ITEM,
  MAX_TAGS_PER_LIST,
  ProblemSchema,
  TagSchema,
  WishlistResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { linkTag, seedItem, seedTag } from './support/lists.js';
import { untilBlockedBy } from './support/locks.js';

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

const problemOf = (res: ApiResponse) => ProblemSchema.parse(res.body);
const codeOf = (res: ApiResponse) => problemOf(res).code;
const rows = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.pool.query<T>(sql, params)).rows;
const count = async (table: string) =>
  Number((await rows<{ n: string }>(`select count(*) as n from ${table}`))[0]?.n);

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const createTag = (cookie: string, body: object) =>
  client(t.app, cookie).post('/wishlist/tags', body);
const renameTag = (cookie: string, id: string, body: object) =>
  client(t.app, cookie).patch(`/wishlist/tags/${id}`, body);
const deleteTag = (cookie: string, id: string) =>
  client(t.app, cookie).delete(`/wishlist/tags/${id}`);
const tick = (cookie: string, tagId: string, itemId: string) =>
  client(t.app, cookie).put(`/wishlist/tags/${tagId}/items/${itemId}`);
const untick = (cookie: string, tagId: string, itemId: string) =>
  client(t.app, cookie).delete(`/wishlist/tags/${tagId}/items/${itemId}`);
const links = (itemId: string) =>
  rows<{ tag_id: string }>('select tag_id from item_tags where item_id = $1', [itemId]);
const storedTag = async (id: string) =>
  (
    await rows<{ name: string; name_key: string }>(
      'select name, name_key from tags where id = $1',
      [id],
    )
  )[0];

describe('POST /wishlist/tags (design §6, ruling 6)', () => {
  it('makes a tag from the cleaned name with 201, and answers 200 with the stored tag for the same key', async () => {
    const cookie = await owner();
    const made = await createTag(cookie, { name: ' #Kitchen ' });
    expect(made.status).toBe(201);
    expect(made.headers['cache-control']).toBe('no-store');
    const tag = TagSchema.parse(made.body);
    expect(tag.name).toBe('Kitchen');

    const again = await createTag(cookie, { name: 'kitchen' });
    expect(again.status).toBe(200);
    expect(TagSchema.parse(again.body)).toEqual(tag);
    expect(await count('tags')).toBe(1);
    expect((await storedTag(tag.id))?.name).toBe('Kitchen');
  });

  it('keys a name that starts with a second # as itself, so "##Kitchen" is a new tag (ruling 5)', async () => {
    const cookie = await owner();
    const kitchen = TagSchema.parse((await createTag(cookie, { name: 'Kitchen' })).body);
    const res = await createTag(cookie, { name: '##Kitchen' });
    expect(res.status).toBe(201);
    const made = TagSchema.parse(res.body);
    expect(made.id).not.toBe(kitchen.id);
    expect(made.name).toBe('#Kitchen');
    expect((await storedTag(made.id))?.name_key).toBe('#kitchen');
    expect(await count('tags')).toBe(2);
  });

  it('answers 422 TAG_LIMIT_REACHED for the 51st tag, and 200 for an existing one at the limit', async () => {
    const cookie = await owner();
    for (let i = 0; i < MAX_TAGS_PER_LIST; i++) await seedTag(db, ADA.email, `Tag ${i}`);
    const res = await createTag(cookie, { name: 'One too many' });
    expect([res.status, codeOf(res)]).toEqual([422, ErrorCode.TAG_LIMIT_REACHED]);
    expect(problemOf(res).detail).toBe('A list holds at most 50 tags.');
    expect(await count('tags')).toBe(MAX_TAGS_PER_LIST);
    expect((await createTag(cookie, { name: 'tag 7' })).status).toBe(200);
  });

  it('refuses a body the schema refuses with 400 VALIDATION_FAILED', async () => {
    const cookie = await owner();
    const res = await createTag(cookie, { name: '  # ' });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });
});

describe('PATCH /wishlist/tags/:id', () => {
  it('renames a tag, and GET /wishlist shows the new name', async () => {
    const cookie = await owner();
    const id = await seedTag(db, ADA.email, 'Kitchen');
    const res = await renameTag(cookie, id, { name: 'Cooking' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(TagSchema.parse(res.body)).toEqual({ id, name: 'Cooking' });
    expect(await storedTag(id)).toEqual({ name: 'Cooking', name_key: 'cooking' });
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.tags).toEqual([{ id, name: 'Cooking' }]);
  });

  it('allows a case-only rename of the tag itself, and updates its key', async () => {
    const cookie = await owner();
    const id = await seedTag(db, ADA.email, 'kitchen');
    const res = await renameTag(cookie, id, { name: 'Kitchen' });
    expect(res.status).toBe(200);
    expect(await storedTag(id)).toEqual({ name: 'Kitchen', name_key: 'kitchen' });
  });

  it('answers 409 TAG_NAME_TAKEN for another tag’s key, without echoing the name', async () => {
    const cookie = await owner();
    await seedTag(db, ADA.email, 'Kitchen');
    const id = await seedTag(db, ADA.email, 'Cooking');
    const res = await renameTag(cookie, id, { name: 'KITCHEN' });
    expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.TAG_NAME_TAKEN]);
    const { detail } = problemOf(res);
    expect(detail).toBe('You already have a tag with that name.');
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('kitchen');
    expect((await storedTag(id))?.name).toBe('Cooking');
  });
});

describe('DELETE /wishlist/tags/:id', () => {
  it('deletes the tag and its links, keeps the item, and answers 404 the second time', async () => {
    const cookie = await owner();
    const id = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, id);
    const res = await deleteTag(cookie, id);
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await count('tags')).toBe(0);
    expect(await count('item_tags')).toBe(0);
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.items.map((item) => [item.id, item.tagIds])).toEqual([[itemId, []]]);
    const again = await deleteTag(cookie, id);
    expect([again.status, codeOf(again)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect(problemOf(again).detail).toBe('That tag no longer exists.');
  });
});

describe('PUT and DELETE /wishlist/tags/:id/items/:itemId', () => {
  it('ticks idempotently: 204 twice, one row', async () => {
    const cookie = await owner();
    const tagId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    const first = await tick(cookie, tagId, itemId);
    expect(first.status).toBe(204);
    expect(first.headers['cache-control']).toBe('no-store');
    expect((await tick(cookie, tagId, itemId)).status).toBe(204);
    expect(await links(itemId)).toEqual([{ tag_id: tagId }]);
  });

  it('unticks idempotently: 204 twice, no row, and the tag and item stay', async () => {
    const cookie = await owner();
    const tagId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, tagId);
    expect((await untick(cookie, tagId, itemId)).status).toBe(204);
    expect((await untick(cookie, tagId, itemId)).status).toBe(204);
    expect(await links(itemId)).toEqual([]);
    expect([await count('tags'), await count('items')]).toEqual([1, 1]);
  });

  it('answers 422 ITEM_TAG_LIMIT_REACHED for an 11th tag, but 204 for one it already has', async () => {
    const cookie = await owner();
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    const ids: string[] = [];
    for (let i = 0; i <= MAX_TAGS_PER_ITEM; i++) ids.push(await seedTag(db, ADA.email, `Tag ${i}`));
    for (const id of ids.slice(0, MAX_TAGS_PER_ITEM)) await linkTag(db, itemId, id);
    const res = await tick(cookie, ids[MAX_TAGS_PER_ITEM]!, itemId);
    expect([res.status, codeOf(res)]).toEqual([422, ErrorCode.ITEM_TAG_LIMIT_REACHED]);
    expect(problemOf(res).detail).toBe('An item holds at most 10 tags.');
    expect(await links(itemId)).toHaveLength(MAX_TAGS_PER_ITEM);
    expect((await tick(cookie, ids[0]!, itemId)).status).toBe(204);
  });
});

describe('what is not the session’s list is 404 NOT_FOUND (ruling 5)', () => {
  it('refuses another user’s tag and item, an unknown id and a malformed id on every route', async () => {
    const cookie = await owner();
    await signUpVerified(t, BOB);
    const myTag = await seedTag(db, ADA.email, 'Mine');
    const myItem = await seedItem(db, ADA.email, 'Kettle');
    const bobsTag = await seedTag(db, BOB.email, 'Bobs');
    const bobsItem = await seedItem(db, BOB.email, 'Mug');
    const calls: [string, () => Promise<ApiResponse>][] = [];
    for (const bad of [bobsTag, UNKNOWN_ID, 'nope']) {
      calls.push(
        [`rename ${bad}`, () => renameTag(cookie, bad, { name: 'X' })],
        [`delete ${bad}`, () => deleteTag(cookie, bad)],
        [`tick ${bad}`, () => tick(cookie, bad, myItem)],
        [`untick ${bad}`, () => untick(cookie, bad, myItem)],
      );
    }
    for (const bad of [bobsItem, UNKNOWN_ID, 'nope']) {
      calls.push(
        [`tick item ${bad}`, () => tick(cookie, myTag, bad)],
        [`untick item ${bad}`, () => untick(cookie, myTag, bad)],
      );
    }
    for (const [what, call] of calls) {
      const res = await call();
      expect([what, res.status, codeOf(res)]).toEqual([what, 404, ErrorCode.NOT_FOUND]);
    }
    expect([await count('tags'), await count('item_tags')]).toEqual([2, 0]);
    expect(await storedTag(bobsTag)).toEqual({ name: 'Bobs', name_key: 'bobs' });
  });

  it('answers 404 to a tick on an item deleted a moment earlier (Review Focus 5)', async () => {
    const cookie = await owner();
    const tagId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, tagId);
    expect((await client(t.app, cookie).delete(`/wishlist/items/${itemId}`)).status).toBe(204);
    expect(await count('item_tags')).toBe(0);
    const res = await tick(cookie, tagId, itemId);
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect(await count('item_tags')).toBe(0);
  });
});

describe('the tag routes need a signed-in, verified owner and the app’s origin', () => {
  it('answers 401 without a session', async () => {
    const res = await createTag('', { name: 'Kitchen' });
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
  });

  it('answers 403 EMAIL_NOT_VERIFIED to an unverified email', async () => {
    await signUp(t);
    const res = await createTag(await logIn(t), { name: 'Kitchen' });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
  });

  it('answers 403 FORBIDDEN_ORIGIN to a change without the app’s Origin', async () => {
    const cookie = await owner();
    const res = await http(t.app)
      .post('/api/wishlist/tags')
      .set('Cookie', cookie)
      .send({ name: 'Kitchen' });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.FORBIDDEN_ORIGIN]);
    expect(await count('tags')).toBe(0);
  });
});

describe('a tick while a claim holds the item’s row lock (Review Focus 4)', () => {
  it('waits for the lock and then lands with 204 and one row', async () => {
    const cookie = await owner();
    const tagId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    const holder = await db.pool.connect();
    try {
      await holder.query('begin');
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid;
      await holder.query('select id from items where id = $1 for update', [itemId]);
      const put = tick(cookie, tagId, itemId);
      let settled = false;
      void put.then(() => (settled = true));
      await untilBlockedBy(db.pool, holderPid, 1, put);
      // Waiting on the item's lock through the foreign key, not already answered.
      expect(settled).toBe(false);
      await holder.query('commit');
      expect((await put).status).toBe(204);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect(await links(itemId)).toEqual([{ tag_id: tagId }]);
  });
});
