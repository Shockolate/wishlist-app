import { hashToken, newToken } from '../../src/security/tokens.js';
import type { TestDatabase } from './database.js';

// Straight-to-the-database setup for the claim tests: faster than requests, and able to make
// states the API won't, such as more claimed than the owner now wants (D19).

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`no ${what}`);
  return row;
}

export async function wishlistIdOf(db: TestDatabase, email: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    'select w.id from wishlists w join users u on u.id = w.owner_id where u.email = $1',
    [email],
  );
  return first(rows, `list for ${email}`).id;
}

export async function shareTokenOf(db: TestDatabase, email: string): Promise<string> {
  const { rows } = await db.pool.query<{ token: string }>(
    'select w.share_token as token from wishlists w join users u on u.id = w.owner_id where u.email = $1',
    [email],
  );
  return first(rows, `list for ${email}`).token;
}

/** Appends an item to the list of the account with this email, and returns its ID. */
export async function seedItem(
  db: TestDatabase,
  email: string,
  title: string,
  quantity = 1,
  imageUrl: string | null = null,
): Promise<string> {
  const wishlistId = await wishlistIdOf(db, email);
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into items (id, wishlist_id, title, quantity, image_url, position)
     values (gen_random_uuid(), $1, $2, $3, $4,
             (select coalesce(max(position) + 1, 0) from items where wishlist_id = $1))
     returning id`,
    [wishlistId, title, quantity, imageUrl],
  );
  return first(rows, 'item').id;
}

/** A claim as a gifter would have made it. `clock_timestamp()` keeps them in the order made. */
export async function seedClaim(
  db: TestDatabase,
  itemId: string,
  claimerName: string,
  quantity: number,
): Promise<{ id: string; manageToken: string }> {
  const manageToken = newToken(16);
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash, created_at)
     values (gen_random_uuid(), $1, $2, $3, $4, clock_timestamp())
     returning id`,
    [itemId, claimerName, quantity, hashToken(manageToken)],
  );
  return { id: first(rows, 'claim').id, manageToken };
}

/** The owner's spoiler setting, set directly. `PATCH /wishlist` takes it from Task 6 on. */
export async function setShowClaims(db: TestDatabase, email: string, on: boolean): Promise<void> {
  await db.pool.query(
    `update wishlists w set show_claims_to_owner = $2
     from users u where u.id = w.owner_id and u.email = $1`,
    [email, on],
  );
}

/** A tag on the list of the account with this email, as the API would store it. */
export async function seedTag(db: TestDatabase, email: string, name: string): Promise<string> {
  const wishlistId = await wishlistIdOf(db, email);
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into tags (id, wishlist_id, name, name_key)
     values (gen_random_uuid(), $1, $2, lower($2))
     returning id`,
    [wishlistId, name],
  );
  return first(rows, 'tag').id;
}

/** Puts a tag on an item. Both must already exist. */
export async function linkTag(db: TestDatabase, itemId: string, tagId: string): Promise<void> {
  await db.pool.query('insert into item_tags (item_id, tag_id) values ($1, $2)', [itemId, tagId]);
}
