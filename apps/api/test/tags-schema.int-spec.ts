import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';
import { linkTag, seedItem, seedTag } from './support/lists.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = 'ada@example.com';
const BOB = 'bob@example.com';

async function seedList(email: string, n: number) {
  const userId = `0199a3b2-0000-7000-8000-00000000010${n}`;
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Name')`,
    [userId, email],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values (gen_random_uuid(), $1, 't', $2)`,
    [userId, `token-${n}`],
  );
}

const count = async (table: 'tags' | 'item_tags' | 'items') => {
  const { rows } = await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return rows[0]?.n;
};

describe('tags and item_tags (design §5)', () => {
  beforeEach(async () => {
    await seedList(ADA, 1);
    await seedList(BOB, 2);
  });

  it('rejects a second tag with the same key on one list, but allows it on another', async () => {
    await seedTag(db, ADA, 'Kitchen');
    await expect(seedTag(db, ADA, 'KITCHEN')).rejects.toThrow(/tags_wishlist_id_name_key_unique/);
    await expect(seedTag(db, BOB, 'Kitchen')).resolves.toEqual(expect.any(String));
  });

  it('rejects the same tag on the same item twice', async () => {
    const item = await seedItem(db, ADA, 'Kettle');
    const tag = await seedTag(db, ADA, 'Kitchen');
    await linkTag(db, item, tag);
    await expect(linkTag(db, item, tag)).rejects.toThrow(/item_tags_item_id_tag_id_pk/);
  });

  it("removes an item's links with the item and keeps the tag", async () => {
    const item = await seedItem(db, ADA, 'Kettle');
    const tag = await seedTag(db, ADA, 'Kitchen');
    await linkTag(db, item, tag);
    await db.pool.query('delete from items where id = $1', [item]);
    expect(await count('item_tags')).toBe('0');
    expect(await count('tags')).toBe('1');
  });

  it("removes a tag's links with the tag and keeps the item", async () => {
    const item = await seedItem(db, ADA, 'Kettle');
    const tag = await seedTag(db, ADA, 'Kitchen');
    await linkTag(db, item, tag);
    await db.pool.query('delete from tags where id = $1', [tag]);
    expect(await count('item_tags')).toBe('0');
    expect(await count('items')).toBe('1');
  });

  it('cascades an account deletion through the list to its tags and links', async () => {
    const item = await seedItem(db, ADA, 'Kettle');
    await linkTag(db, item, await seedTag(db, ADA, 'Kitchen'));
    await db.pool.query('delete from users where email = $1', [ADA]);
    expect(await count('tags')).toBe('0');
    expect(await count('item_tags')).toBe('0');
  });

  it('indexes links by tag', async () => {
    const { rows } = await db.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'item_tags_tag_id_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(tag_id\)/);
  });
});
