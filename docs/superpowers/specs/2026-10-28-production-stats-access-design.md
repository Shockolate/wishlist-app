# Production stats access — Design

- **Date:** 2026-10-28
- **Status:** Draft, pending review
- **Author:** Ted Armstrong (with Claude)
- **Amends:** the main spec §10 (a second read-only database role beside `hanker_backup`, D48). Decision D102.

## 1. Intent

Ted wants to know whether anyone besides him is using Hanker, and how: how long lists are, how much gets claimed, and so on. He wants to ask Claude, which reads production through the Neon MCP plugin, without Claude being able to read anything personal.

Today the plugin is read-only (each query runs in a `READ ONLY` transaction), but it logs in as the database owner by default, so it could read every email, password hash and claimer name, and anything it reads lands in a conversation with Anthropic, which `/privacy` doesn't list. This design gives Claude a role that can read **aggregate views and nothing else**, and locks the plugin's connection to that role and to the `wishlist` project.

### Goals

- A `stats` schema of views that answer "is anyone using it, and how", over **every account, Ted's included**.
- A login role, `hanker_stats`, that can read those views and is refused every table.
- The Neon MCP plugin locked to `hanker_stats` on the `wishlist` project, so the limit is enforced by Postgres, not by Claude remembering a rule.

### Non-goals

- Dashboards, charts, a web page, or the numbers anywhere in the app.
- Page-view analytics. A visit leaves no row; only sign-ups, items and claims do (see Web Analytics, declined 2026-10-28).
- Excluding Ted's or test accounts (Ted, 2026-10-28: include all).
- Scheduled reports, or the cron writing stats somewhere.

### Anti-goals

These would make it a failure even if it technically works:

- **Any view that returns a person's data:** an email, a display name, a claimer name, a title, a note, a URL, a token or its hash, or a row per user, list, item or claim. Every view returns counts, sums, averages or week buckets.
- **A role that can read a table.** `hanker_stats` gets nothing on `public` or `drizzle` tables, now or after any future migration.
- **`/privacy` becoming untrue.**

## 2. What was proven (2026-10-28)

A throwaway test on a `wishlist-preview` branch made from `preview-seed`:

- A role created in SQL (`CREATE ROLE … WITH LOGIN`, password set with `\password`, never given to Neon) was usable through the MCP's `run_sql` with `role_name`: `current_user` answered with that role.
- Granted `SELECT` on one table, it could read that table and got `permission denied for table users` on another.

So a SQL-created role works with the MCP, and Postgres enforces its grants. Roles created in Neon's console or API join `neon_superuser` (`pg_read_all_data`, `pg_write_all_data`, `BYPASSRLS`), which is why this role is made in SQL, as `hanker_backup` was.

**Noted, accepted:** the MCP logged in without being given the role's password, so Neon has its own path in. The role's grants still bound what it reads; its password is not what keeps others out. Anyone who can sign in to the Neon project can act as any role in it. Only Ted can today.

## 3. Design

### 3.1 Two roles: grants in code, login by hand

- **`stats_reader`**, `NOLOGIN`, created by the migration if it doesn't exist. It gets `USAGE` on schema `stats` and `SELECT` on every view in it. Because the grants live in the migration, a view added later gets its grant in the same migration, and every environment (local, Testcontainers, `preview-seed`, production) has the same grants.
- **`hanker_stats`**, `LOGIN`, created by hand in production only (runbook, §3.5), with `GRANT stats_reader TO hanker_stats` and nothing else.

Postgres roles belong to the cluster, and on Neon to the branch, so the migration's `CREATE ROLE` must be idempotent (a `DO` block checking `pg_roles`); the integration tests share one Testcontainers cluster across files.

### 3.2 Views run with their owner's rights

Postgres views run with the privileges of their owner unless `security_invoker` is set, so `stats_reader` reads the view without any grant on the tables underneath. Views must **not** set `security_invoker = true`. The owner is the migrating role (the database owner in production).

### 3.3 The views

Views in schema `stats`, all aggregate. The exact names and column lists are the builder's call, within this set:

- **Overview** (one row): accounts; verified accounts; lists with at least one item; items; ideas and link items; items with at least one tag; tags; items per non-empty list (average, median, maximum); claims; claimed units over wanted units (`Σ least(claimed, quantity) / Σ quantity`, so an over-claimed item counts once); lists with at least one claim; claims linked to Your gifts; Bought ticks; owners showing claim counts (`show_claims_to_owner`); lists with tag suggestions on (`suggest_tags`).
- **Accounts per week:** sign-ups and verifications, by UTC week of `created_at` and `email_verified_at`.
- **Claims per week:** claims made and units claimed, by UTC week of the claim's `created_at`.

Known limits, to state in a comment on the views: deleted accounts, items and claims leave no trace, so weekly counts are of what still exists; unverified accounts are purged after 7 days (main spec §6.5), so old sign-up weeks count only verified ones; a claim's later quantity change lands in the week it was made.

### 3.4 Migration

A custom SQL migration (`drizzle-kit generate --custom`), since Drizzle's schema can't create roles or grants. It must:

- create schema `stats`, the `stats_reader` role (idempotent), and the views;
- `GRANT USAGE ON SCHEMA stats` and `GRANT SELECT ON ALL TABLES IN SCHEMA stats TO stats_reader`;
- pass squawk (`.squawk.toml`) and work beside the API that's deployed, which it does by only adding.

**Cost to future migrations:** a migration that drops or renames a column a view uses must drop and recreate that view, and re-grant it. Postgres refuses the drop otherwise, so this fails loudly, never silently. AGENTS.md's Migrations line says so.

### 3.5 Production runbook (Ted)

A new section in `docs/deployment.md`, after the `hanker_backup` role, run after the migration has deployed:

```sql
CREATE ROLE hanker_stats WITH LOGIN;
\password hanker_stats          -- generated, then discarded: nothing uses it (§2)
GRANT stats_reader TO hanker_stats;
```

Then prove it, as the owner:

```sql
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
       pg_has_role('hanker_stats', 'neon_superuser', 'member'),
       pg_has_role('hanker_stats', 'pg_read_all_data', 'member')
FROM pg_roles WHERE rolname = 'hanker_stats';   -- all f
```

### 3.6 Locking the plugin (Ted)

Sign the Neon plugin in again (`/mcp`) with: **Full access off** (read-only), **only the `wishlist` project**, and **Postgres role `hanker_stats`**. Ted chose the hard lock over keeping preview access through the same connection (2026-10-28): while locked, the MCP can't reach `wishlist-preview`; signing in again unlocks it.

**Acceptance**, run by Claude through the locked connection:

- `SELECT current_user` → `hanker_stats`;
- each `stats` view answers;
- `SELECT count(*) FROM users` and `SELECT * FROM drizzle.__drizzle_migrations` → permission denied;
- `list_projects` is hidden (the connection is scoped to one project);
- `run_sql` with `role_name` set to the owner is refused.

The last check is the one D102 rests on, and it depends on Neon, not on this code. If it fails, the lock isn't real: sign the plugin out, and treat production as closed to the MCP until it's resolved.

### 3.7 Tests

An integration test (`apps/api/test/*.int-spec.ts`) that, after migrations:

- creates a login role granted only `stats_reader`, connects as it, reads each view, and is refused `users`, `claims` and the `drizzle` schema;
- checks that every relation in schema `stats` is a view without `security_invoker`, so a future table or invoker view there can't slip through;
- seeds a few accounts, lists, items and claims, and checks the overview's numbers, including an over-claimed item counted once.

## 4. Privacy

`/privacy` needs no change *(Claude's call)*: the role can read only counts, sums, averages and week buckets, which aren't personal data, so no personal data reaches Anthropic. If a future view breaks the anti-goal in §1, `/privacy` must change with it, and it shouldn't be written.

## 5. Docs

- `docs/deployment.md`: §3.5 as a runbook section.
- `docs/operations.md`: `hanker_stats` in the credentials inventory, with no expiry and the note that its password isn't used.
- `AGENTS.md`: a Stats line (views in `stats` are aggregates only; never grant `stats_reader` a table; a column a view uses is dropped by recreating the view) and the Migrations note in §3.4.
- Main spec: D102 in the decision log, and §10 naming the second role.

## 6. Left to the builder

- View names, column names and types, and how the median is computed.
- Whether the views live in one migration file or the view SQL is generated from `schema.ts` with `pgSchema('stats').view(...)` alongside a custom file for the role and grants.
- The integration test's seed data.

## 7. Decision

- **D102:** Claude reads production only as `hanker_stats`, a SQL-created role whose sole grant is `stats_reader`, which can read the aggregate views in `stats`. The Neon MCP connection is locked to that role and the `wishlist` project (Ted, 2026-10-28). Rejected: Vercel Web Analytics (makes `/privacy` untrue and would collect share and manage tokens), the owner role with Claude restricting itself to aggregates (a rule, not a control), a console-created role (joins `neon_superuser`), and the daily cron logging counts (not needed once the role works).
