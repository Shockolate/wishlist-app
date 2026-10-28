# Production Stats Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude a production role that can read aggregate usage views and nothing else, and lock the Neon MCP plugin to it.

**Architecture:** One custom Drizzle migration creates schema `stats`, three aggregate views that run with their owner's rights, and a `NOLOGIN` role `stats_reader` that may read them. Ted creates the login role `hanker_stats` by hand in production, grants it only `stats_reader`, and signs the Neon plugin in locked to that role and the `wishlist` project.

**Tech Stack:** Postgres 17 (Neon), Drizzle Kit custom migrations, Vitest integration tests on Testcontainers, `pg`.

**Spec:** [`docs/superpowers/specs/2026-10-28-production-stats-access-design.md`](../specs/2026-10-28-production-stats-access-design.md) (approved by Ted 2026-10-28). Decision D102.

## Global Constraints

- Every view in `stats` returns only counts, sums, averages or week buckets: never an email, a name, a title, a note, a URL, a token or hash, or a row per user, list, item or claim (spec §1 anti-goals).
- Views don't set `security_invoker` (spec §3.2).
- `stats_reader` is `NOLOGIN` and is granted nothing outside schema `stats`; `hanker_stats` is created in SQL, never in the Neon console (spec §2, §3.1).
- The migration only adds, works beside the deployed API, passes squawk, and starts with the repo's `SET LOCAL lock_timeout = '5s'` / `statement_timeout = '30s'` lines.
- Weeks are UTC, Monday-start: `date_trunc('week', <ts> AT TIME ZONE 'UTC')::date`.
- Counts are cast to `int` so `pg` returns numbers, not strings.
- Stacked PRs with `gh stack`, Conventional Commit titles, commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The first `gh stack submit` needs Ted's OK (AGENTS.md).

## Review Focus

- **An empty database:** `stats.overview` returns exactly one row, with zero counts and null averages, median, maximum and share, never a division-by-zero error. (Task 2, `empty database`.)
- **An over-claimed item** (the owner lowered the quantity below what's claimed, main spec §2): it counts once in `claimed_units`, never more than it's wanted. (Task 2, seeded Kettle.)
- **Lists with no items:** every account has a list, so empty lists must be left out of the average, median and maximum. (Task 2, Cy's empty list.)
- **Your gifts notes** (`claim_links.claim_id` null): not counted as linked claims or Bought ticks, even when the note carries a `bought_at`. (Task 2, the note row.)
- **A week with verifications but no sign-ups:** an account that signed up one week and verified the next must show its verification in the second week. (Task 2, `accounts_weekly`.)

## File map

| File | Responsibility |
|---|---|
| `apps/api/drizzle/0007_stats_views.sql` (+ `meta/_journal.json`, `meta/0007_snapshot.json` from the generator) | Schema, role, views, grants |
| `apps/api/test/stats.int-spec.ts` | The views' numbers and the role's limits |
| `docs/deployment.md`, `docs/operations.md`, `AGENTS.md`, `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`, `docs/superpowers/plans/2026-10-07-roadmap.md` | Runbook, inventory, rules, D102, roadmap row |

Views stay out of `schema.ts`: a custom migration copies the previous snapshot, so later `db:generate` runs don't see or touch `stats`.

---

### Task 1: The design and plan layer

**Files:**
- Add: `docs/superpowers/specs/2026-10-28-production-stats-access-design.md`, `docs/superpowers/plans/2026-10-28-plan-14-production-stats.md` (both already written, uncommitted)

- [ ] **Step 1: Start the stack**

```bash
git switch main && git pull --ff-only
gh stack init docs/plan-14
git add docs/superpowers/specs/2026-10-28-production-stats-access-design.md docs/superpowers/plans/2026-10-28-plan-14-production-stats.md
git commit -m "docs: design and plan for production stats access (D102)"
```

- [ ] **Step 2: Check formatting**

Run: `pnpm format:check`
Expected: passes. If not, `pnpm prettier --write` the two files and amend.

---

### Task 2: The `stats` views and `stats_reader`

**Files:**
- Create: `apps/api/test/stats.int-spec.ts`
- Create: `apps/api/drizzle/0007_stats_views.sql` (generated empty, then written)

**Interfaces:**
- Produces (SQL, used by Task 3's docs and Ted's runbook):
  - `stats.overview` — one row: `accounts`, `verified_accounts`, `lists_with_items`, `items`, `ideas`, `link_items`, `items_with_tags`, `tags`, `claims`, `claimed_units`, `wanted_units`, `lists_with_claims`, `linked_claims`, `bought_ticks`, `owners_showing_claims`, `lists_suggesting_tags` (all `int`); `avg_items_per_list`, `median_items_per_list` (`numeric`, rounded to 1 place); `max_items_per_list` (`int`); `claimed_share` (`numeric`, `claimed_units / wanted_units` rounded to 2 places, null when `wanted_units` is 0).
  - `stats.accounts_weekly` — `week date`, `signups int`, `verifications int`, one row per week that has either, newest first.
  - `stats.claims_weekly` — `week date`, `claims int`, `units int`, by the claim's `created_at`, newest first.
  - Role `stats_reader` (`NOLOGIN`) with `USAGE` on `stats` and `SELECT` on its views.

Definitions the tests pin: `claimed_units` = Σ over items of `least(Σ claim quantity, item quantity)`; `wanted_units` = Σ item quantity; `ideas` = items with `url IS NULL`; sums are `coalesce`d to 0, so an empty database gives `wanted_units = 0`; `linked_claims` and `bought_ticks` count only `claim_links` with `claim_id IS NOT NULL` (and `bought_at IS NOT NULL` for ticks); `owners_showing_claims` = wishlists with `show_claims_to_owner`; `lists_suggesting_tags` = wishlists with `suggest_tags`.

- [ ] **Step 1: Write the failing tests in `apps/api/test/stats.int-spec.ts`**

Use `openTestDatabase()`, `truncateAll()` in `beforeEach`, and direct inserts as in `claims-schema.int-spec.ts`. Seed (fixed UUIDs, `created_at` set explicitly so weeks are deterministic):

| Who | Account | List | Items |
|---|---|---|---|
| Ada | verified; signed up Mon 2026-10-05, verified 2026-10-05 | `show_claims_to_owner = true` | Kettle (url, qty 2, tagged "kitchen"), Book (url, qty 1), Pottery class (url null, qty 1) |
| Bea | signed up Sun 2026-10-11 23:30 UTC, verified Mon 2026-10-12 00:10 UTC | `suggest_tags = false`, an unused tag "winter" | Scarf (url, qty 1) |
| Cy | unverified, signed up 2026-10-20 | empty | — |

Claims: on Kettle, 2 (made 2026-10-14) and 1 (made 2026-10-14), so it's over-claimed; on Scarf, 1 (made 2026-10-20). `claim_links` (user Ada): one linked to the Scarf claim with `bought_at` set; one note with `claim_id` null and `bought_at` set.

```ts
describe('stats views (D102)', () => {
  it('empty database: one overview row, zeros and nulls', async () => {
    const [row] = (await db.pool.query('select * from stats.overview')).rows;
    expect(row).toMatchObject({ accounts: 0, items: 0, claims: 0, wanted_units: 0,
      avg_items_per_list: null, median_items_per_list: null, max_items_per_list: null, claimed_share: null });
  });

  it('overview counts the seeded data', async () => {
    await seed();
    const { rows } = await db.pool.query('select * from stats.overview');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      accounts: 3, verified_accounts: 2, lists_with_items: 2, items: 4, ideas: 1, link_items: 3,
      items_with_tags: 1, tags: 2, avg_items_per_list: '2.0', median_items_per_list: '2.0',
      max_items_per_list: 3, claims: 3, claimed_units: 3, wanted_units: 5, claimed_share: '0.60',
      lists_with_claims: 2, linked_claims: 1, bought_ticks: 1, owners_showing_claims: 1,
      lists_suggesting_tags: 2,
    });
  });

  it('accounts_weekly buckets sign-ups and verifications by UTC week', async () => {
    await seed();
    const { rows } = await db.pool.query("select to_char(week, 'YYYY-MM-DD') as week, signups, verifications from stats.accounts_weekly");
    expect(rows).toEqual([
      { week: '2026-10-19', signups: 1, verifications: 0 },   // Cy, never verified
      { week: '2026-10-12', signups: 0, verifications: 1 },   // Bea verifies just past midnight UTC
      { week: '2026-10-05', signups: 2, verifications: 1 },   // Ada; Bea signs up Sunday night
    ]);
  });

  it('claims_weekly buckets claims and units', async () => {
    await seed();
    const { rows } = await db.pool.query("select to_char(week, 'YYYY-MM-DD') as week, claims, units from stats.claims_weekly");
    expect(rows).toEqual([
      { week: '2026-10-19', claims: 1, units: 1 },
      { week: '2026-10-12', claims: 2, units: 3 },
    ]);
  });
});

describe('stats_reader (D102)', () => {
  // A login role per run, granted only stats_reader, as hanker_stats is in production.
  // Name: `stats_probe_${random hex}`; created and dropped by the test's beforeAll/afterAll.
  it('reads every stats view', /* select 1 from each of the three views succeeds */);
  it('is refused the tables', /* users, claims, claim_links and drizzle.__drizzle_migrations each reject /permission denied/ */);
  it('stats holds only views that run with their owner\'s rights', async () => {
    const { rows } = await db.pool.query(`
      select c.relname, c.relkind, c.reloptions from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'stats'`);
    expect(rows.map((r) => r.relname).sort()).toEqual(['accounts_weekly', 'claims_weekly', 'overview']);
    for (const r of rows) {
      expect(r.relkind).toBe('v');
      expect(r.reloptions ?? []).not.toContain('security_invoker=true');
    }
  });
  it('stats_reader cannot log in', /* pg_roles.rolcanlogin is false for stats_reader */);
});
```

The probe connects with a `Pool` on `db.url` with `username`/`password` replaced (via `new URL`); close it before `DROP ROLE` in `afterAll`. The `stats_reader` tests don't truncate-dependent data; they only check access.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @wishlist/api test:integration test/stats.int-spec.ts` (Docker running; see AGENTS.md Environment)
Expected: FAIL with `relation "stats.overview" does not exist` and `role "stats_reader" does not exist`.

- [ ] **Step 3: Generate the empty migration**

Run: `pnpm --filter @wishlist/api exec drizzle-kit generate --custom --name stats_views`
Expected: `apps/api/drizzle/0007_stats_views.sql` (empty), a journal entry and `0007_snapshot.json`.

- [ ] **Step 4: Write `0007_stats_views.sql`**

In order, separated by `--> statement-breakpoint`:
1. The two `SET LOCAL` lines.
2. A `DO` block that runs `CREATE ROLE stats_reader NOLOGIN` only when `pg_roles` has no such role (roles outlive a database on a shared cluster).
3. `CREATE SCHEMA stats`.
4. The three views, with a `COMMENT ON VIEW` each stating spec §3.3's limits (deleted rows leave no trace; unverified accounts purge after 7 days; a quantity change stays in the claim's week).
5. `GRANT USAGE ON SCHEMA stats TO stats_reader`, `GRANT SELECT ON ALL TABLES IN SCHEMA stats TO stats_reader`, and `ALTER DEFAULT PRIVILEGES IN SCHEMA stats GRANT SELECT ON TABLES TO stats_reader` (the migrating role is the same everywhere, so a later view is granted on creation).

Approach for `overview`: one `SELECT` of scalar subqueries; a CTE of items per non-empty list feeds `avg`, `percentile_cont(0.5) WITHIN GROUP`, and `max`; a CTE of `least(sum(claims.quantity), items.quantity)` per claimed item feeds `claimed_units`. `accounts_weekly`: `FULL OUTER JOIN` of sign-ups by week and verifications by week, `coalesce` both counts to 0.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @wishlist/api test:integration test/stats.int-spec.ts`
Expected: all PASS.

- [ ] **Step 6: Run the whole integration suite and the CI gate**

Run: `pnpm --filter @wishlist/api test:integration` then `pnpm format:check` and `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: all pass. `health.int-spec.ts` reads the journal, so it expects the new count (8) without changes.

- [ ] **Step 7: Lint the migration with squawk**

Run the squawk command from `.github/workflows/ci.yml` against `apps/api/drizzle/0007_stats_views.sql`.
Expected: no findings. If a rule fires, fix the SQL; exclude a rule only with a reason in `.squawk.toml`, and say so in the PR.

- [ ] **Step 8: Commit as its own layer**

```bash
gh stack add api/stats-views
git add apps/api/drizzle apps/api/test/stats.int-spec.ts
git commit -m "feat(api): aggregate stats views and the stats_reader role (D102)"
```

---

### Task 3: Runbook, inventory, rules and decision

**Files:**
- Modify: `docs/deployment.md` (new section after "2. The read-only role", the `hanker_backup` steps)
- Modify: `docs/operations.md` (credentials inventory table)
- Modify: `AGENTS.md` (Conventions)
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§10 Recovery/Secrets mention of roles, §13 decision log)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (row 14, status Planned)

- [ ] **Step 1: `docs/deployment.md` — "The stats role (D102)"**

Spec §3.5's SQL (create, `\password`, grant, the all-`f` proof), run **after** the migration from Task 2 has deployed, using the direct connection string as the `hanker_backup` section does. Then spec §3.6: sign the Neon plugin in with Full access off, only the `wishlist` project, Postgres role `hanker_stats`; and the acceptance list, with its rule that a failed owner-role check means signing the plugin out.

- [ ] **Step 2: `docs/operations.md` — inventory row**

`hanker_stats` (Postgres role, production): where it lives (production branch), no expiry, what it can do ("read the aggregate views in `stats`, nothing else"), its password is generated and discarded because nothing uses it.

- [ ] **Step 3: `AGENTS.md` — two lines**

- A Conventions bullet, **Stats (D102):** views in `stats` return only aggregates (spec 2026-10-28 §1's list); never grant `stats_reader` a table; Claude reads production only as `hanker_stats` through the locked Neon plugin.
- Append to **Migrations:** dropping or renaming a column a `stats` view uses means dropping and recreating the view in the same migration, and re-granting it.

- [ ] **Step 4: Main spec and roadmap**

Add D102 to §13 with the spec's §7 wording (decision, rejected options). Add a line to the header's "Amended by" list. Name `hanker_stats` beside `hanker_backup` in §10. Add roadmap row 14: "Production stats access", spec link, "`stats` views and `stats_reader`; `hanker_stats` by hand; the Neon plugin locked to it", status Planned.

- [ ] **Step 5: Check and commit as the top layer**

Run: `pnpm format:check`
Expected: passes.

```bash
gh stack add docs/stats-runbook
git add docs AGENTS.md
git commit -m "docs: stats role runbook, inventory and D102"
```

---

### Task 4: Submit, then the production steps

- [ ] **Step 1: Ask Ted before the first submit** (AGENTS.md). On his OK: `gh stack submit --open`, then set each PR's title and body (`gh pr edit <n> --title … --body-file …`), bodies ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 2: Wait for CI on every layer**, and for Ted to merge.

- [ ] **Step 3: After the deploy, confirm the migration ran** — `GET https://hanker.dev/api/health` reports `migrationsApplied: 8` (the journal has 8 entries: 0000–0007).

- [ ] **Step 4: Ted runs the runbook** (Task 3, Step 1) and signs the plugin in locked.

- [ ] **Step 5: Claude runs the acceptance checks** through the locked plugin: `current_user` is `hanker_stats`; each view answers; `users` and `drizzle.__drizzle_migrations` are refused; `list_projects` is hidden; `run_sql` with `role_name: neondb_owner` is refused. Report each result. If the owner-role check isn't refused, stop and tell Ted to sign the plugin out (spec §3.6).

- [ ] **Step 6: Answer the original question** — `select * from stats.overview` and the two weekly views — then open the roadmap row → Done PR.
