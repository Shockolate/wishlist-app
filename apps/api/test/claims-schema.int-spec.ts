import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const LIST = '0199a3b2-0000-7000-8000-00000000000a';
const ITEM = '0199a3b2-0000-7000-8000-0000000000b1';

async function insertItem() {
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [ADA],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
    [LIST, ADA],
  );
  await db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position) values ($1, $2, 'Kettle', 2, 0)`,
    [ITEM, LIST],
  );
}

const insertClaim = (quantity: number, hash: string) =>
  db.pool.query(
    `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
     values (gen_random_uuid(), $1, 'Sue', $2, $3)`,
    [ITEM, quantity, hash],
  );

const count = async () =>
  Number((await db.pool.query<{ n: string }>('select count(*) as n from claims')).rows[0]?.n);

describe('claims (spec §4)', () => {
  it('rejects a quantity below 1', async () => {
    await insertItem();
    await expect(insertClaim(0, 'h0')).rejects.toThrow(/claims_quantity_check/);
  });

  it('allows one claim per manage token', async () => {
    await insertItem();
    await insertClaim(1, 'same');
    await expect(insertClaim(1, 'same')).rejects.toThrow(/claims_manage_token_hash_unique/);
  });

  it('goes with its item (spec §2)', async () => {
    await insertItem();
    await insertClaim(1, 'h1');
    await db.pool.query('delete from items');
    expect(await count()).toBe(0);
  });

  it('goes with the owner’s account, through the list and the item (spec §2)', async () => {
    await insertItem();
    await insertClaim(1, 'h1');
    await db.pool.query('delete from users');
    expect(await count()).toBe(0);
  });
});
