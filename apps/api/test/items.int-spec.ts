import {
  ErrorCode,
  ItemSchema,
  ProblemSchema,
  WishlistResponseSchema,
  type Item,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUpVerified, type Account } from './support/accounts.js';
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

const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase 2',
  displayName: 'Bob',
};
const UNKNOWN_ID = '0199a3b2-0000-7000-8000-0000000000ff';

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const create = (cookie: string, body: object) =>
  client(t.app, cookie).post('/wishlist/items', body);

async function created(cookie: string, title: string, fields: object = {}): Promise<Item> {
  const res = await create(cookie, { title, ...fields });
  if (res.status !== 201) throw new Error(`create answered ${res.status}`);
  return ItemSchema.parse(res.body);
}

async function listOf(cookie: string) {
  return WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
}

/** Fills a list straight in the database, at positions 0…n−1: faster than n requests. */
async function seedItems(email: string, n: number) {
  await db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position)
     select gen_random_uuid(), w.id, 'Seed ' || g, 1, g - 1
     from wishlists w join users u on u.id = w.owner_id, generate_series(1, $2::int) g
     where u.email = $1`,
    [email, n],
  );
}

describe('POST /wishlist/items (spec §2, §5)', () => {
  it('appends each new item at the end, with every field present', async () => {
    const cookie = await owner();
    const kettle = await created(cookie, 'Kettle');
    const teapot = await created(cookie, 'Teapot');
    expect(kettle).toEqual({
      id: expect.any(String) as string,
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: null,
      note: null,
      quantity: 1,
      position: 0,
    });
    expect(teapot.position).toBe(1);
    expect((await listOf(cookie)).items.map((item) => item.title)).toEqual(['Kettle', 'Teapot']);
  });

  it('stores a link and an idea alike: an idea is an item without a url (spec §2)', async () => {
    const cookie = await owner();
    const link = await created(cookie, 'Kettle', {
      url: ' https://shop.example/kettle ',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
      note: 'The blue one',
      quantity: 2,
    });
    expect(link).toMatchObject({
      url: 'https://shop.example/kettle',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
      note: 'The blue one',
      quantity: 2,
    });
    expect((await created(cookie, 'Warm socks')).url).toBeNull();
  });

  it.each([
    { title: '' },
    { title: 'Kettle', url: 'javascript:alert(1)' },
    { title: 'Kettle', imageUrl: 'http://cdn.example/kettle.jpg' },
    { title: 'Kettle', quantity: 0 },
    { title: 'Kettle', quantity: 100 },
  ])('refuses %j with 400 VALIDATION_FAILED', async (body) => {
    const res = await create(await owner(), body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it.each([
    { title: 'Ket\u0000tle' },
    { title: 'Bike\u202E' },
    { title: 'Kettle', note: 'Blue\u0000 one' },
    { title: 'Kettle', priceText: '$4\u00000' },
    { title: 'Kettle', url: 'https://shop.example/ket\u0000tle' },
    { title: 'Kettle', imageUrl: 'https://cdn.example/ket\u0000tle.jpg' },
  ])('refuses %j with 400, not 500', async (body) => {
    const cookie = await owner();
    const res = await create(cookie, body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    expect((await listOf(cookie)).items).toEqual([]);
  });

  it('refuses the 201st item with 422 LIST_FULL', async () => {
    const cookie = await owner();
    await seedItems(ADA.email, 200);
    const res = await create(cookie, { title: 'One too many' });
    expect([res.status, codeOf(res)]).toEqual([422, ErrorCode.LIST_FULL]);
    expect(await count('items')).toBe(200);
  });

  it('lets exactly enough concurrent creates through to fill the list, none at the same position', async () => {
    const cookie = await owner();
    await seedItems(ADA.email, 195);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(cookie, { title: `Race ${i}` })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(5);
    expect(results.filter((res) => res.status === 422).map(codeOf)).toEqual(
      Array<string>(5).fill(ErrorCode.LIST_FULL),
    );
    const { rows } = await db.pool.query<{ position: number }>(
      'select position from items order by position',
    );
    expect(rows.map((row) => row.position)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('a create racing an account deletion neither deadlocks nor leaves an item behind', async () => {
    const cookie = await owner();
    const [deletion, ...creates] = await Promise.all([
      client(t.app, cookie).delete('/me', { password: ADA.password }),
      ...Array.from({ length: 5 }, (_, i) => create(cookie, { title: `Race ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of creates) expect([201, 401]).toContain(res.status);
    expect(await count('users')).toBe(0);
    expect(await count('items')).toBe(0);
  });
});

describe('PATCH /wishlist/items/:id (spec §5)', () => {
  it('changes only the fields sent; "" and null clear one (Plan 3a rule 1, Review Focus 2)', async () => {
    const cookie = await owner();
    const item = await created(cookie, 'Kettle', { priceText: '$40.00', note: 'Blue' });

    const renamed = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, {
      title: 'Kettle, blue',
    });
    expect(renamed.status).toBe(200);
    expect(ItemSchema.parse(renamed.body)).toMatchObject({
      title: 'Kettle, blue',
      priceText: '$40.00',
      note: 'Blue',
    });

    const cleared = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, {
      priceText: '',
      note: null,
    });
    expect(ItemSchema.parse(cleared.body)).toMatchObject({
      title: 'Kettle, blue',
      priceText: null,
      note: null,
    });
  });

  it('refuses a NUL in a changed field with 400 and leaves the item alone', async () => {
    const cookie = await owner();
    const item = await created(cookie, 'Kettle');
    const res = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, {
      title: 'Ket\u0000tle',
    });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    expect((await listOf(cookie)).items.map((i) => i.title)).toEqual(['Kettle']);
  });

  it('validates what it changes', async () => {
    const cookie = await owner();
    const item = await created(cookie, 'Kettle');
    const res = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, { quantity: 0 });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });
});

describe('DELETE /wishlist/items/:id (spec §2)', () => {
  it('deletes the item and leaves the rest in order (Plan 3a rule 3: a gap is fine)', async () => {
    const cookie = await owner();
    const [a, b, c] = [
      await created(cookie, 'A'),
      await created(cookie, 'B'),
      await created(cookie, 'C'),
    ];
    const res = await client(t.app, cookie).delete(`/wishlist/items/${b.id}`);
    expect(res.status).toBe(204);
    const { items } = await listOf(cookie);
    expect(items.map((item) => item.id)).toEqual([a.id, c.id]);
    expect(items.map((item) => item.position)).toEqual([0, 2]);
  });
});

describe('an item that is not yours, or is gone, is a 404 (spec §5)', () => {
  it("leaves another user's item alone", async () => {
    const bob = await owner(BOB);
    const bobsItem = await created(bob, 'Bike');
    const ada = await owner();
    const edit = await client(t.app, ada).patch(`/wishlist/items/${bobsItem.id}`, {
      title: 'Mine',
    });
    const removal = await client(t.app, ada).delete(`/wishlist/items/${bobsItem.id}`);
    expect([edit.status, codeOf(edit)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect([removal.status, codeOf(removal)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect((await listOf(bob)).items.map((item) => item.title)).toEqual(['Bike']);
  });

  it('answers an unknown or malformed ID with 404, not 500 (Plan 3a rule 2)', async () => {
    const cookie = await owner();
    for (const id of [UNKNOWN_ID, 'not-a-uuid']) {
      const edit = await client(t.app, cookie).patch(`/wishlist/items/${id}`, { title: 'X' });
      const removal = await client(t.app, cookie).delete(`/wishlist/items/${id}`);
      expect([edit.status, removal.status]).toEqual([404, 404]);
    }
  });

  it('answers an item deleted in another tab with 404 (Plan 3a Review Focus 3)', async () => {
    const cookie = await owner();
    const keep = await created(cookie, 'Keep');
    const gone = await created(cookie, 'Gone');
    expect((await client(t.app, cookie).delete(`/wishlist/items/${gone.id}`)).status).toBe(204);
    const edit = await client(t.app, cookie).patch(`/wishlist/items/${gone.id}`, { title: 'X' });
    const again = await client(t.app, cookie).delete(`/wishlist/items/${gone.id}`);
    expect([edit.status, again.status]).toEqual([404, 404]);
    expect((await listOf(cookie)).items.map((item) => item.id)).toEqual([keep.id]);
  });
});

describe('the item endpoints need a verified owner', () => {
  it('answer 401 without a session', async () => {
    const res = await client(t.app).post('/wishlist/items', { title: 'Kettle' });
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
  });
});
