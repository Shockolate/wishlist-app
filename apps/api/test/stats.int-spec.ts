import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());

const id = (n: number) => `0199a3b2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const [ADA, BEA, CY] = [id(1), id(2), id(3)];
const [ADA_LIST, BEA_LIST, CY_LIST] = [id(11), id(12), id(13)];
const [KETTLE, BOOK, POTTERY, SCARF] = [id(21), id(22), id(23), id(24)];
const [KITCHEN, WINTER] = [id(31), id(32)];
const [KETTLE_A, KETTLE_B, SCARF_C] = [id(41), id(42), id(43)];

/**
 * Three accounts (Ada and Bea verified), Ada's list of three items with Kettle over-claimed (the
 * owner lowered it to 2 after 3 were claimed), Bea's one item, and Cy's empty list. Ada has Bea's
 * scarf on Your gifts, ticked Bought, and a note left by a claim that's gone.
 */
async function seed() {
  const q = (sql: string, params: unknown[]) => db.pool.query(sql, params);
  const user = (uid: string, name: string, created: string, verified: string | null) =>
    q(
      `insert into users (id, email, password_hash, display_name, created_at, email_verified_at)
       values ($1, $2, 'x', $3, $4, $5)`,
      [uid, `${name.toLowerCase()}@example.com`, name, created, verified],
    );
  await user(ADA, 'Ada', '2026-10-05T09:00:00Z', '2026-10-05T09:05:00Z');
  await user(BEA, 'Bea', '2026-10-11T23:30:00Z', '2026-10-12T00:10:00Z');
  await user(CY, 'Cy', '2026-10-20T12:00:00Z', null);

  const list = (lid: string, owner: string, showClaims: boolean, suggestTags: boolean) =>
    q(
      `insert into wishlists (id, owner_id, title, share_token, show_claims_to_owner, suggest_tags)
       values ($1, $2, 't', $3, $4, $5)`,
      [lid, owner, `share-${lid}`, showClaims, suggestTags],
    );
  await list(ADA_LIST, ADA, true, true);
  await list(BEA_LIST, BEA, false, false);
  await list(CY_LIST, CY, false, true);

  const item = (
    iid: string,
    lid: string,
    title: string,
    url: string | null,
    qty: number,
    pos: number,
  ) =>
    q(
      `insert into items (id, wishlist_id, title, url, quantity, position) values ($1, $2, $3, $4, $5, $6)`,
      [iid, lid, title, url, qty, pos],
    );
  await item(KETTLE, ADA_LIST, 'Kettle', 'https://shop.example/kettle', 2, 0);
  await item(BOOK, ADA_LIST, 'Book', 'https://shop.example/book', 1, 1);
  await item(POTTERY, ADA_LIST, 'Pottery class', null, 1, 2);
  await item(SCARF, BEA_LIST, 'Scarf', 'https://shop.example/scarf', 1, 0);

  const tag = (tid: string, lid: string, name: string) =>
    q(`insert into tags (id, wishlist_id, name, name_key) values ($1, $2, $3, $3)`, [
      tid,
      lid,
      name,
    ]);
  await tag(KITCHEN, ADA_LIST, 'kitchen');
  await tag(WINTER, BEA_LIST, 'winter');
  await q(`insert into item_tags (item_id, tag_id) values ($1, $2)`, [KETTLE, KITCHEN]);

  const claim = (cid: string, iid: string, qty: number, created: string) =>
    q(
      `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash, created_at)
       values ($1, $2, 'Someone', $3, $4, $5)`,
      [cid, iid, qty, `hash-${cid}`, created],
    );
  await claim(KETTLE_A, KETTLE, 2, '2026-10-14T10:00:00Z');
  await claim(KETTLE_B, KETTLE, 1, '2026-10-14T11:00:00Z');
  await claim(SCARF_C, SCARF, 1, '2026-10-20T10:00:00Z');

  const link = (lid: string, cid: string | null) =>
    q(
      `insert into claim_links (id, claim_id, user_id, bought_at, item_title, owner_display_name)
       values ($1, $2, $3, now(), 'Scarf', 'Bea')`,
      [lid, cid, ADA],
    );
  await link(id(51), SCARF_C);
  await link(id(52), null);
}

describe('stats views (D102)', () => {
  beforeEach(() => db.truncateAll());

  it('empty database: one overview row, zeros and nulls', async () => {
    const { rows } = await db.pool.query('select * from stats.overview');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accounts: 0,
      items: 0,
      claims: 0,
      claimed_units: 0,
      wanted_units: 0,
      avg_items_per_list: null,
      median_items_per_list: null,
      max_items_per_list: null,
      claimed_share: null,
    });
  });

  it('overview counts the seeded data', async () => {
    await seed();
    const { rows } = await db.pool.query('select * from stats.overview');
    expect(rows).toEqual([
      {
        accounts: 3,
        verified_accounts: 2,
        lists_with_items: 2,
        items: 4,
        ideas: 1,
        link_items: 3,
        items_with_tags: 1,
        tags: 2,
        avg_items_per_list: '2.0',
        median_items_per_list: '2.0',
        max_items_per_list: 3,
        claims: 3,
        claimed_units: 3,
        wanted_units: 5,
        claimed_share: '0.60',
        lists_with_claims: 2,
        linked_claims: 1,
        bought_ticks: 1,
        owners_showing_claims: 1,
        lists_suggesting_tags: 2,
      },
    ]);
  });

  it('accounts_weekly buckets sign-ups and verifications by UTC week', async () => {
    await seed();
    const { rows } = await db.pool.query(
      "select to_char(week, 'YYYY-MM-DD') as week, signups, verifications from stats.accounts_weekly",
    );
    expect(rows).toEqual([
      { week: '2026-10-19', signups: 1, verifications: 0 }, // Cy, never verified
      { week: '2026-10-12', signups: 0, verifications: 1 }, // Bea verifies just past midnight UTC
      { week: '2026-10-05', signups: 2, verifications: 1 }, // Ada; Bea signs up Sunday night
    ]);
  });

  it('claims_weekly buckets claims and units by UTC week', async () => {
    await seed();
    const { rows } = await db.pool.query(
      "select to_char(week, 'YYYY-MM-DD') as week, claims, units from stats.claims_weekly",
    );
    expect(rows).toEqual([
      { week: '2026-10-19', claims: 1, units: 1 },
      { week: '2026-10-12', claims: 2, units: 3 },
    ]);
  });
});

describe('stats_reader (D102)', () => {
  // A login role granted only stats_reader, as hanker_stats is in production.
  const role = `stats_probe_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  let probe: Pool;

  beforeAll(async () => {
    await db.pool.query(`create role ${role} with login password '${password}'`);
    await db.pool.query(`grant stats_reader to ${role}`);
    const url = new URL(db.url);
    url.username = role;
    url.password = password;
    probe = new Pool({ connectionString: url.toString(), max: 1 });
  });

  afterAll(async () => {
    await probe?.end();
    await db.pool.query(`drop role if exists ${role}`);
  });

  it('reads every stats view', async () => {
    for (const view of ['overview', 'accounts_weekly', 'claims_weekly']) {
      await expect(probe.query(`select * from stats.${view}`)).resolves.toBeDefined();
    }
  });

  it('is refused the tables', async () => {
    for (const table of ['users', 'claims', 'claim_links', 'drizzle.__drizzle_migrations']) {
      await expect(probe.query(`select 1 from ${table} limit 1`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  // A sweep, not a list, so a table or function a later migration opens up is caught too.
  it('can read no relation outside stats', async () => {
    const { rows } = await probe.query<{ relation: string }>(
      `select c.oid::regclass::text as relation from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname not in ('stats', 'pg_catalog', 'information_schema')
         and n.nspname !~ '^pg_toast'
         and (has_table_privilege(c.oid, 'SELECT') or has_any_column_privilege(c.oid, 'SELECT'))`,
    );
    expect(rows).toEqual([]);
  });

  it('can run no SECURITY DEFINER function', async () => {
    const { rows } = await probe.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname not in ('pg_catalog', 'information_schema')
         and p.prosecdef and has_function_privilege(p.oid, 'EXECUTE')`,
    );
    expect(rows).toEqual([]);
  });

  it('gets no table a later migration creates in stats', async () => {
    await db.pool.query('create table stats.later_table (id int)');
    try {
      const { rows } = await db.pool.query<{ granted: boolean }>(
        "select has_table_privilege('stats_reader', 'stats.later_table', 'SELECT') as granted",
      );
      expect(rows).toEqual([{ granted: false }]);
    } finally {
      await db.pool.query('drop table stats.later_table');
    }
  });

  it("stats holds only views that run with their owner's rights", async () => {
    const { rows } = await db.pool.query<{
      relname: string;
      relkind: string;
      reloptions: string[] | null;
    }>(
      `select c.relname, c.relkind, c.reloptions from pg_class c
       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'stats'`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([
      'accounts_weekly',
      'claims_weekly',
      'overview',
    ]);
    for (const r of rows) {
      expect(r.relkind).toBe('v');
      expect(r.reloptions ?? []).not.toContain('security_invoker=true');
    }
  });

  it('stats_reader cannot log in', async () => {
    const { rows } = await db.pool.query<{ rolcanlogin: boolean }>(
      "select rolcanlogin from pg_roles where rolname = 'stats_reader'",
    );
    expect(rows).toEqual([{ rolcanlogin: false }]);
  });
});
