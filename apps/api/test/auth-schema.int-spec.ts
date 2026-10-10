import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const BOB = '0199a3b2-0000-7000-8000-000000000002';

function insertUser(id: string, email: string) {
  return db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Ada')`,
    [id, email],
  );
}

describe('auth tables (spec §4)', () => {
  it('rejects a second account whose email differs only in case', async () => {
    await insertUser(ADA, 'ada@example.com');
    await expect(insertUser(BOB, 'Ada@Example.com')).rejects.toThrow(/users_email_lower_key/);
  });

  it('gives each user at most one wishlist', async () => {
    await insertUser(ADA, 'ada@example.com');
    const insert = (id: string, shareToken: string) =>
      db.pool.query(
        `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', $3)`,
        [id, ADA, shareToken],
      );
    await insert('0199a3b2-0000-7000-8000-00000000000a', 'share-1');
    await expect(insert('0199a3b2-0000-7000-8000-00000000000b', 'share-2')).rejects.toThrow(
      /wishlists_owner_id_unique/,
    );
  });

  it('only accepts the two email-token purposes', async () => {
    await insertUser(ADA, 'ada@example.com');
    await expect(
      db.pool.query(
        `insert into email_tokens (id, user_id, purpose, token_hash, expires_at)
         values ($1, $2, 'magic_link', 'h', now())`,
        ['0199a3b2-0000-7000-8000-0000000000c1', ADA],
      ),
    ).rejects.toThrow(/email_tokens_purpose_check/);
  });

  it('cascades a user deletion to sessions, email tokens and the wishlist', async () => {
    await insertUser(ADA, 'ada@example.com');
    await db.pool.query(
      `insert into sessions (id, user_id, expires_at, last_seen_at) values ('s1', $1, now(), now())`,
      [ADA],
    );
    await db.pool.query(
      `insert into email_tokens (id, user_id, purpose, token_hash, expires_at)
       values ($1, $2, 'verify_email', 'h1', now())`,
      ['0199a3b2-0000-7000-8000-0000000000c1', ADA],
    );
    await db.pool.query(
      `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
      ['0199a3b2-0000-7000-8000-00000000000a', ADA],
    );

    await db.pool.query('delete from users where id = $1', [ADA]);

    const { rows } = await db.pool.query<{ n: string }>(
      `select (select count(*) from sessions) + (select count(*) from email_tokens)
            + (select count(*) from wishlists) as n`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
