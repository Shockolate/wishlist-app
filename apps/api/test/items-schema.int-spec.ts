import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const LIST = '0199a3b2-0000-7000-8000-00000000000a';
const ITEM = '0199a3b2-0000-7000-8000-0000000000b1';

async function insertList() {
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [ADA],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
    [LIST, ADA],
  );
}

const insertItem = (quantity: number) =>
  db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position) values ($1, $2, 'Kettle', $3, 0)`,
    [ITEM, LIST, quantity],
  );

describe('items (spec §4)', () => {
  it.each([0, 100])('rejects a quantity of %i', async (quantity) => {
    await insertList();
    await expect(insertItem(quantity)).rejects.toThrow(/items_quantity_check/);
  });

  it('cascades a user deletion through the wishlist to its items', async () => {
    await insertList();
    await insertItem(1);
    await db.pool.query('delete from users');
    const { rows } = await db.pool.query<{ n: string }>('select count(*) as n from items');
    expect(rows[0]?.n).toBe('0');
  });

  it("indexes a list's items by position", async () => {
    const { rows } = await db.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'items_wishlist_id_position_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(wishlist_id, "?position"?\)/);
  });
});
