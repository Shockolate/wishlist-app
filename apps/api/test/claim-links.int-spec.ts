import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const SUE = '0199a3b2-0000-7000-8000-000000000002';
const LIST = '0199a3b2-0000-7000-8000-00000000000a';
const ITEM = '0199a3b2-0000-7000-8000-0000000000b1';
const CLAIM = '0199a3b2-0000-7000-8000-0000000000c1';

async function seed() {
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values
       ($1, 'ada@example.com', 'x', 'Ada'), ($2, 'sue@example.com', 'x', 'Sue')`,
    [ADA, SUE],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
    [LIST, ADA],
  );
  await db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position) values ($1, $2, 'Kettle', 2, 0)`,
    [ITEM, LIST],
  );
  await db.pool.query(
    `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
     values ($1, $2, 'Sue', 1, 'h1')`,
    [CLAIM, ITEM],
  );
}

const insertLink = (claimId: string | null) =>
  db.pool.query(
    `insert into claim_links (id, claim_id, user_id, item_title, owner_display_name)
     values (gen_random_uuid(), $1, $2, 'Kettle', 'Ada')`,
    [claimId, SUE],
  );

const count = async (table: 'claim_links' | 'claims') =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe('claim_links (design §4, D76, D80)', () => {
  it('deleting a claim keeps its link with claim_id null', async () => {
    await seed();
    await insertLink(CLAIM);
    await db.pool.query('delete from claims');
    const { rows } = await db.pool.query<{ claim_id: string | null; item_title: string }>(
      'select claim_id, item_title from claim_links',
    );
    expect(rows).toEqual([{ claim_id: null, item_title: 'Kettle' }]);
  });

  it('deleting the user deletes their links and leaves the claim and its quantity', async () => {
    await seed();
    await insertLink(CLAIM);
    await db.pool.query('delete from users where id = $1', [SUE]);
    expect(await count('claim_links')).toBe(0);
    const { rows } = await db.pool.query<{ quantity: number }>('select quantity from claims');
    expect(rows).toEqual([{ quantity: 1 }]);
  });

  it('a claim can be linked once', async () => {
    await seed();
    await insertLink(CLAIM);
    await expect(insertLink(CLAIM)).rejects.toThrow(/claim_links_claim_id_unique/);
  });

  it('many notes may have a null claim_id', async () => {
    await seed();
    await insertLink(null);
    await insertLink(null);
    expect(await count('claim_links')).toBe(2);
  });
});
