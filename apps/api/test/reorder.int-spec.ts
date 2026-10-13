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

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

async function created(cookie: string, title: string): Promise<Item> {
  const res = await client(t.app, cookie).post('/wishlist/items', { title });
  if (res.status !== 201) throw new Error(`create answered ${res.status}`);
  return ItemSchema.parse(res.body);
}

const reorder = (cookie: string, itemIds: unknown) =>
  client(t.app, cookie).put('/wishlist/items/order', { itemIds });

async function itemsOf(cookie: string) {
  return WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body).items;
}

describe('PUT /wishlist/items/order (spec §5)', () => {
  it('rewrites the whole order', async () => {
    const cookie = await owner();
    const [a, b, c] = [
      await created(cookie, 'A'),
      await created(cookie, 'B'),
      await created(cookie, 'C'),
    ];
    expect((await reorder(cookie, [c.id, a.id, b.id])).status).toBe(204);
    const items = await itemsOf(cookie);
    expect(items.map((item) => item.title)).toEqual(['C', 'A', 'B']);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('closes the gap a delete left (Plan 3a rule 3)', async () => {
    const cookie = await owner();
    const [a, b, c] = [
      await created(cookie, 'A'),
      await created(cookie, 'B'),
      await created(cookie, 'C'),
    ];
    await client(t.app, cookie).delete(`/wishlist/items/${b.id}`);
    expect((await reorder(cookie, [c.id, a.id])).status).toBe(204);
    expect((await itemsOf(cookie)).map((item) => item.position)).toEqual([0, 1]);
  });

  it('accepts an empty order for an empty list', async () => {
    expect((await reorder(await owner(), [])).status).toBe(204);
  });

  it('refuses any set of IDs that is not exactly the list, and changes nothing', async () => {
    const bob = await owner(BOB);
    const bobsItem = await created(bob, 'Bike');
    const cookie = await owner();
    const [a, b, c] = [
      await created(cookie, 'A'),
      await created(cookie, 'B'),
      await created(cookie, 'C'),
    ];
    const wrongSets = {
      'one missing': [a.id, b.id],
      'one unknown': [a.id, b.id, c.id, UNKNOWN_ID],
      'one twice': [a.id, a.id, b.id, c.id],
      "another user's item": [a.id, b.id, bobsItem.id],
    };
    for (const [name, ids] of Object.entries(wrongSets)) {
      const res = await reorder(cookie, ids);
      expect([name, res.status, codeOf(res)]).toEqual([name, 409, ErrorCode.ORDER_CONFLICT]);
    }
    expect((await itemsOf(cookie)).map((item) => item.title)).toEqual(['A', 'B', 'C']);
  });

  it('refuses a stale order after another tab added an item (spec §8)', async () => {
    const cookie = await owner();
    const [a, b] = [await created(cookie, 'A'), await created(cookie, 'B')];
    await created(cookie, 'Added in another tab');
    const res = await reorder(cookie, [b.id, a.id]);
    expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.ORDER_CONFLICT]);
  });

  it.each([
    ['a non-UUID', ['not-a-uuid']],
    ['201 IDs', Array<string>(201).fill(UNKNOWN_ID)],
    ['no array', 'A,B'],
  ])('refuses %s with 400 VALIDATION_FAILED', async (_name, itemIds) => {
    const res = await reorder(await owner(), itemIds);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('a reorder racing a create never leaves two items at one position', async () => {
    const cookie = await owner();
    const [a, b] = [await created(cookie, 'A'), await created(cookie, 'B')];
    const [moved, added] = await Promise.all([
      reorder(cookie, [b.id, a.id]),
      client(t.app, cookie).post('/wishlist/items', { title: 'C' }),
    ]);
    expect([204, 409]).toContain(moved.status);
    expect(added.status).toBe(201);
    const positions = (await itemsOf(cookie)).map((item) => item.position);
    expect(new Set(positions).size).toBe(3);
  });

  it('needs a session', async () => {
    const res = await client(t.app).put('/wishlist/items/order', { itemIds: [] });
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
  });
});
