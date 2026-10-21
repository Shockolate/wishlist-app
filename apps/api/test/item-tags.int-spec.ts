import {
  ErrorCode,
  ItemWriteResponseSchema,
  ProblemSchema,
  WishlistResponseSchema,
  type ItemWriteResponse,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { linkTag, seedItem, seedTag } from './support/lists.js';

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
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const create = (cookie: string, body: object) =>
  client(t.app, cookie).post('/wishlist/items', body);
const patch = (cookie: string, itemId: string, body: object) =>
  client(t.app, cookie).patch(`/wishlist/items/${itemId}`, body);

function written(res: ApiResponse, status: number): ItemWriteResponse {
  expect(res.status).toBe(status);
  return ItemWriteResponseSchema.parse(res.body);
}

const tagNamesOnItem = async (itemId: string) =>
  (
    await db.pool.query<{ name: string }>(
      `select t.name from item_tags it join tags t on t.id = it.tag_id
       where it.item_id = $1 order by t.name_key`,
      [itemId],
    )
  ).rows.map((row) => row.name);

describe('tags on POST /wishlist/items (design §6)', () => {
  it('makes a tag from a name and answers with it, then lists it on GET /wishlist', async () => {
    const cookie = await owner();
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ name: 'Kitchen' }] }),
      201,
    );
    const [tag] = item.tags ?? [];
    expect(tag).toEqual({ id: expect.any(String) as string, name: 'Kitchen' });
    expect(item.tagIds).toEqual([tag?.id]);
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.tags).toEqual([tag]);
    expect(list.items[0]?.tagIds).toEqual([tag?.id]);
  });

  it('sends empty tagIds and tags when none were sent', async () => {
    const cookie = await owner();
    const res = await create(cookie, { title: 'Kettle' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tagIds: [], tags: [] });
  });

  it('joins an existing tag retyped differently, keeping its spelling (Review Focus 2)', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ name: '  KITCHEN ' }] }),
      201,
    );
    expect(item.tags).toEqual([{ id: kitchenId, name: 'Kitchen' }]);
    expect(item.tagIds).toEqual([kitchenId]);
    expect(await count('tags')).toBe(1);
  });

  it('links a tag named twice, by id and by two spellings, once (Review Focus 3)', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const item = written(
      await create(cookie, {
        title: 'Kettle',
        tags: [{ id: kitchenId }, { name: 'kitchen' }, { name: 'Kitchen ' }],
      }),
      201,
    );
    expect(item.tagIds).toEqual([kitchenId]);
    expect(await count('item_tags')).toBe(1);
    expect(await count('tags')).toBe(1);
  });

  it('makes a new tag once when two entries spell it differently', async () => {
    const cookie = await owner();
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ name: 'Gifts' }, { name: ' gifts ' }] }),
      201,
    );
    expect(item.tags).toEqual([{ id: expect.any(String) as string, name: 'Gifts' }]);
    expect(await count('tags')).toBe(1);
  });

  it('keeps a leading # as part of the tag: "#Kitchen" is not "Kitchen"', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ name: '#Kitchen' }] }),
      201,
    );
    expect(item.tags).toEqual([{ id: expect.any(String) as string, name: '#Kitchen' }]);
    expect(item.tagIds).not.toContain(kitchenId);
    const rows = await db.pool.query<{ name: string; name_key: string }>(
      'select name, name_key from tags',
    );
    // Sorted here, not in SQL: how '#' sorts against letters depends on the database's collation.
    expect(rows.rows.sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: '#Kitchen', name_key: '#kitchen' },
      { name: 'Kitchen', name_key: 'kitchen' },
    ]);
  });

  it('stores a new tag in its cleaned spelling', async () => {
    const cookie = await owner();
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ name: ' #Gift   ideas ' }] }),
      201,
    );
    expect(item.tags).toEqual([{ id: expect.any(String) as string, name: '#Gift ideas' }]);
    const rows = await db.pool.query<{ name: string; name_key: string }>(
      'select name, name_key from tags',
    );
    expect(rows.rows).toEqual([{ name: '#Gift ideas', name_key: '#gift ideas' }]);
  });

  it('accepts an upper-case id for a tag on the list', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ id: kitchenId.toUpperCase() }] }),
      201,
    );
    expect(item.tags).toEqual([{ id: kitchenId, name: 'Kitchen' }]);
    expect(await count('tags')).toBe(1);
  });

  it("drops an id from another user's list and leaves that list unchanged", async () => {
    const cookie = await owner();
    await owner(BOB);
    const bobsTag = await seedTag(db, BOB.email, 'Secret');
    const bobsItem = await seedItem(db, BOB.email, 'Bike');
    await linkTag(db, bobsItem, bobsTag);

    const item = written(
      await create(cookie, { title: 'Kettle', tags: [{ id: bobsTag }, { name: 'Mine' }] }),
      201,
    );
    expect(item.tags?.map((tag) => tag.name)).toEqual(['Mine']);
    expect(await tagNamesOnItem(item.id)).toEqual(['Mine']);
    const bobsLinks = await db.pool.query('select item_id from item_tags where tag_id = $1', [
      bobsTag,
    ]);
    expect(bobsLinks.rows).toEqual([{ item_id: bobsItem }]);
    expect(await count('tags')).toBe(2);
  });

  it('refuses a 51st tag with 422 TAG_LIMIT_REACHED and creates no item (ruling 3)', async () => {
    const cookie = await owner();
    let firstId = '';
    for (let i = 0; i < 50; i++) {
      const id = await seedTag(db, ADA.email, `Tag ${String(i).padStart(2, '0')}`);
      if (i === 0) firstId = id;
    }
    const refused = await create(cookie, { title: 'Kettle', tags: [{ name: 'New' }] });
    expect([refused.status, codeOf(refused)]).toEqual([422, ErrorCode.TAG_LIMIT_REACHED]);
    expect(await count('items')).toBe(0);
    expect(await count('tags')).toBe(50);

    const byId = written(await create(cookie, { title: 'Kettle', tags: [{ id: firstId }] }), 201);
    expect(byId.tagIds).toEqual([firstId]);
    const byName = written(await create(cookie, { title: 'Pot', tags: [{ name: 'tag 07' }] }), 201);
    expect(byName.tags).toEqual([{ id: expect.any(String) as string, name: 'Tag 07' }]);
  });

  it('refuses eleven entries with 400 VALIDATION_FAILED', async () => {
    const cookie = await owner();
    const tags = Array.from({ length: 11 }, (_, i) => ({ name: `Tag ${i}` }));
    const res = await create(cookie, { title: 'Kettle', tags });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    expect(await count('items')).toBe(0);
  });
});

describe('tags on PATCH /wishlist/items/:id (design §6)', () => {
  it('drops the id of a tag deleted meanwhile and does not recreate it (Review Focus 1)', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, kitchenId);
    await db.pool.query('delete from tags where id = $1', [kitchenId]);

    const item = written(
      await patch(cookie, itemId, { tags: [{ id: kitchenId }, { name: 'Books' }] }),
      200,
    );
    expect(item.tags?.map((tag) => tag.name)).toEqual(['Books']);
    expect(await tagNamesOnItem(itemId)).toEqual(['Books']);
    const names = await db.pool.query<{ name: string }>('select name from tags');
    expect(names.rows).toEqual([{ name: 'Books' }]);
  });

  it('keeps the item on a tag renamed meanwhile and makes no copy (Review Focus 1)', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, kitchenId);
    await db.pool.query(`update tags set name = 'Cooking', name_key = 'cooking' where id = $1`, [
      kitchenId,
    ]);

    const item = written(await patch(cookie, itemId, { tags: [{ id: kitchenId }] }), 200);
    expect(item.tags).toEqual([{ id: kitchenId, name: 'Cooking' }]);
    expect(item.tagIds).toEqual([kitchenId]);
    expect(await count('tags')).toBe(1);
  });

  it("drops an id from another user's list and leaves that list unchanged", async () => {
    const cookie = await owner();
    await owner(BOB);
    const bobsTag = await seedTag(db, BOB.email, 'Secret');
    const bobsItem = await seedItem(db, BOB.email, 'Bike');
    const itemId = await seedItem(db, ADA.email, 'Kettle');

    const item = written(await patch(cookie, itemId, { tags: [{ id: bobsTag }] }), 200);
    expect(item.tagIds).toEqual([]);
    expect(item.tags).toEqual([]);
    expect(await count('item_tags')).toBe(0);
    expect(await count('tags')).toBe(1);
    expect(await tagNamesOnItem(bobsItem)).toEqual([]);
  });

  it('leaves tags alone when none are sent, and clears them with []', async () => {
    const cookie = await owner();
    const kitchenId = await seedTag(db, ADA.email, 'Kitchen');
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    await linkTag(db, itemId, kitchenId);

    const renamed = written(await patch(cookie, itemId, { title: 'New' }), 200);
    expect(renamed).toMatchObject({
      title: 'New',
      tagIds: [kitchenId],
      tags: [{ id: kitchenId, name: 'Kitchen' }],
    });

    const cleared = written(await patch(cookie, itemId, { tags: [] }), 200);
    expect(cleared).toMatchObject({ title: 'New', tagIds: [], tags: [] });
    expect(await count('item_tags')).toBe(0);
    expect(await count('tags')).toBe(1);
  });

  it('replaces the set, in name order', async () => {
    const cookie = await owner();
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    written(await patch(cookie, itemId, { tags: [{ name: 'Zebra' }, { name: 'Apple' }] }), 200);
    const item = written(
      await patch(cookie, itemId, { tags: [{ name: 'Mango' }, { name: 'apple' }] }),
      200,
    );
    expect(item.tags?.map((tag) => tag.name)).toEqual(['Apple', 'Mango']);
    expect(item.tagIds).toEqual(item.tags?.map((tag) => tag.id));
    expect(await tagNamesOnItem(itemId)).toEqual(['Apple', 'Mango']);
  });

  it('makes no tag when the item is not on the list (404)', async () => {
    const cookie = await owner();
    await owner(BOB);
    const bobsItem = await seedItem(db, BOB.email, 'Bike');
    const res = await patch(cookie, bobsItem, { tags: [{ name: 'Mine' }] });
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect(await count('tags')).toBe(0);
  });

  it('refuses a 51st tag with 422 and changes nothing (ruling 3)', async () => {
    const cookie = await owner();
    for (let i = 0; i < 50; i++) await seedTag(db, ADA.email, `Tag ${String(i).padStart(2, '0')}`);
    const itemId = await seedItem(db, ADA.email, 'Kettle');
    const res = await patch(cookie, itemId, { title: 'Changed', tags: [{ name: 'New' }] });
    expect([res.status, codeOf(res)]).toEqual([422, ErrorCode.TAG_LIMIT_REACHED]);
    const row = await db.pool.query<{ title: string }>('select title from items where id = $1', [
      itemId,
    ]);
    expect(row.rows).toEqual([{ title: 'Kettle' }]);
    expect(await count('tags')).toBe(50);
  });
});
