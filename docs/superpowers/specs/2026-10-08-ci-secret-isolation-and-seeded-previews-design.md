# CI Secret Isolation & Seeded Preview Databases — Design

- **Date:** 2026-10-08
- **Status:** Draft, pending review
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md), §10 and decision D12, and adds decisions D24 and D25
- **Origin:** Plan 1's final review, findings I-1 (the structural part) and I-4. Ted decided both on 2026-10-08.
- **Must land before:** Plan 2 (accounts and auth), which brings the first real user data.

## 1. Intent

Two properties are required, and the workflow policy test enforces both:

1. **Secrets never meet untrusted code.** No secret is ever present in a job that runs workspace dependencies, their install scripts, or PR code. The secrets in scope are the Vercel token, the Neon API key, and every database URL. There is one named exception: the preview-only bypass secret in the `smoke` job (§3.4).
2. **No production data reaches a preview.** Preview databases descend from a branch that has never held production data.

### Constraints

- **Free tiers only.** GitHub Actions is unlimited on public repos. Neon Free allows 10 branches and 3 root branches.
- **Today's behavior is preserved:** a preview for every PR, the deploy order (migrate → API → health → web → smoke), the stale-commit guard, the `main`-only `production` environment, and skipping previews for bot and fork PRs.
- **Overhead is acceptable** at about +1 minute for production and +1–2 minutes for previews.

### Success criteria

1. `scripts/workflow-policy.test.mjs` encodes property 1 and fails if any workflow violates it.
2. A preview's database branch is shown, through the Neon API, to be a child of `preview-seed`, and `preview-seed` is shown to be a root branch with no parent.
3. The production deploy and a preview both pass end to end with the new job graphs.

### Decisions

- **Seed data starts empty.** `preview-seed` is the migrated schema with **no rows**, and each later plan adds fake data for what it builds through `db:seed`.
- **Project settings are pulled, not committed.** A token-holding `settings` job runs `vercel pull` with only the pinned CLI and passes `project.json` to the build jobs. (Rejected: committing settings to the repo, which could drift from the live projects without anyone noticing.)

## 2. Trust model

| Job kind | Secrets | May run |
|---|---|---|
| **Build** | none | Full `pnpm install`, gates, `vercel build` (proven to work with only `.vercel/project.json` and no login) |
| **Settings / deploy** | `VERCEL_TOKEN` | The pinned Vercel CLI through `npx`, with its version read from the root `package.json`; pinned actions; repo scripts (git, curl, jq). **No `pnpm install`** |
| **Database** | DB URLs and `NEON_API_KEY` | `pnpm install --prod --frozen-lockfile --ignore-scripts` (API only) to run the **built migrator**; pinned Neon actions; `psql`, curl, jq |
| **Smoke (preview)** | `VERCEL_AUTOMATION_BYPASS_SECRET` only | Full install (Playwright). This is the named exception: the secret only unlocks *viewing* protected previews |
| **Smoke (production)** | none | Full install |

**What crosses between jobs:** only explicit artifacts and non-secret outputs. That means each `project.json` (IDs and settings, never env files), each `.vercel/output`, the migrator (`apps/api/dist` plus `apps/api/drizzle`), and `api_url`.

**Shell:** every workflow sets `defaults: run: shell: bash`. GitHub runs that as `bash --noprofile --norc -eo pipefail`, so a failure anywhere in a pipeline (for example `vercel deploy | scripts/vercel-url.sh`) fails the step. This resolves review finding M-1.

**Never shared between jobs: `node_modules`.** Restoring a tree that an untrusted job produced into a trusted job would undo the isolation. Installing jobs restore only the **pnpm store** cache (`setup-node`, `cache: pnpm`), which is safe because pnpm verifies the integrity of store files before linking them, and GitHub scopes caches written by PRs to that PR.

**Why secret outputs can't be passed between jobs:** GitHub drops any job output that contains a masked value. That's why §3.2's `provision` job keeps the branch connection string, the migration, and the API deploy in one job.

## 3. Pipelines

### 3.1 Production (`deploy.yml`)

```
guard ──► settings ──┐
                     ├──► build ──► migrate ──► deploy-api ──► deploy-web ──► smoke
          (no deps)  ┘
```

| Job | Environment / secrets | Does |
|---|---|---|
| `guard` | none | Refuses to run if `GITHUB_SHA` isn't the tip of `main` |
| `settings` | `production`: `VERCEL_TOKEN` | `vercel pull --environment=production` for both projects; uploads each `project.json` |
| `build` | none | Install, then lint, typecheck and unit tests. `vercel build --prod` runs for the API, then for the web app with `API_ORIGIN` set to the API production alias, each into its own output folder. Uploads both outputs and the migrator |
| `migrate` | `production`: `DATABASE_URL_DIRECT` | `--prod --ignore-scripts` install of the API, then `node apps/api/dist/db/migrate-cli.js` |
| `deploy-api` | `production`: `VERCEL_TOKEN` | `vercel deploy --prebuilt --prod --env GIT_SHA=<sha>`, then `scripts/wait-for-health.sh` |
| `deploy-web` | `production`: `VERCEL_TOKEN` | `vercel deploy --prebuilt --prod` |
| `smoke` | none | Playwright smoke test (`BASE_URL` set to the web production origin, `EXPECTED_SHA`) |

All jobs run under the workflow-level concurrency group `production` with `cancel-in-progress: false`. Every job is gated with `if: github.ref == 'refs/heads/main'`.

### 3.2 Preview (`preview.yml`)

```
settings ──► build-api ──► provision ──► build-web ──► deploy-web ──► smoke ──► comment
```

| Job | Environment / secrets | Does |
|---|---|---|
| `settings` | `preview`: `VERCEL_TOKEN` | `vercel pull --environment=preview` for both projects |
| `build-api` | none | `vercel build` for the API; uploads the output and the migrator |
| `provision` | `preview`: `NEON_API_KEY`, `VERCEL_TOKEN` | Create or reuse `pr-<n>` with **`parent_branch: preview-seed`**, mask both database URLs, migrate with the direct URL, deploy the API preview (`DATABASE_URL` pooled, `APP_ORIGIN=https://<alias>`, `EMAIL_TRANSPORT=log`, `GIT_SHA`), wait for health. Outputs `api_url` |
| `build-web` | none | `vercel build` with `API_ORIGIN=<api_url>` |
| `deploy-web` | `preview`: `VERCEL_TOKEN` | `deploy --prebuilt`, then `alias set` to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` |
| `smoke` | `preview`: `VERCEL_AUTOMATION_BYPASS_SECRET` | Read-only smoke test through the alias |
| `comment` | none; `pull-requests: write` | Sticky comment with the web alias and the database branch (`pr-<n>` from `preview-seed`). **No API URL** |

**Unchanged:**
- Bot and fork PRs are skipped.
- Concurrency group `preview-<n>` with cancel-in-progress.

**Changed:** permissions are set per job, and only `comment` can write to the PR.

### 3.3 Seed branch (`preview-seed.yml`)

- **Triggers:** `workflow_dispatch`, with input `reset` (boolean, default false), and `push` to `main` with `paths: apps/api/drizzle/**`. This workflow isn't a required check, so a path filter is fine.
- **Jobs:** `build`, with no secrets, builds the migrator, then `seed` (environment `preview`, `NEON_API_KEY`, `if: github.ref == 'refs/heads/main'`) does the following:
  1. **Look up** the branches `main` and `preview-seed` by name (Neon API).
  2. **If `preview-seed` is missing, create it** through `POST /projects/{id}/branches` with `{"branch": {"name": "preview-seed", "parent_id": <main id>, "init_source": "schema-only"}, "endpoints": [{"type": "read_write"}]}`. This makes a root branch with no rows copied.
  3. **Refuse to continue unless the target is safe:** the target's branch ID must not be `main`'s ID, and its name must be `preview-seed`.
  4. **Fetch its direct connection string**, unpooled, through the API's connection-URI endpoint, and mask it.
  5. **Wipe it if the branch was just created or `reset` is true:** `DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, run with `psql -v ON_ERROR_STOP=1`. The wipe is required: a schema-only copy has drizzle's journal *table* but not its rows, so migrating it unwiped would try to re-create every table.
  6. **Migrate** with the built migrator: from zero after a wipe, incrementally otherwise.
  7. **Seed:** nothing yet. Plan 2 adds `db:seed` here.
- **Refresh in place; never delete.** Neon refuses to delete a branch that has children, and every `pr-*` branch is a child. Existing previews keep their copy-on-write snapshot.
- **Branch budget:** `main` plus `preview-seed` uses 2 of the 3 root branches Neon Free allows. Restores create backup root branches, so restoring production may require deleting old backups first. That leaves up to 8 `pr-*` branches under the 10-branch cap.
- **Fallback** (approved in advance, used only if the beta schema-only feature is unusable): create `preview-seed` as a normal child of `main` and wipe it in the same job, before its connection string is used for anything else.
  - **When it applies:** creating the branch is rejected, the branch is missing the `neondb_owner` role, or it can't be a parent.
  - **Its cost:** production rows exist for a few seconds in a branch only that job can reach.
  - **What it doesn't change:** no preview ever sees production data.

### 3.4 The one exception, stated precisely

The preview `smoke` job holds `VERCEL_AUTOMATION_BYPASS_SECRET` and runs a full install, because Playwright needs the workspace. If that secret leaks, someone can **view** protected previews, which hold seed data, never production data. They can't deploy, read databases, or reach production. The policy test allows exactly this secret, in exactly the job named `smoke`, in `preview.yml`.

## 4. The migrator

`apps/api/src/db/migrate-cli.ts` compiles to `apps/api/dist/db/migrate-cli.js`:

- **Input:** `DATABASE_URL_DIRECT`, which must match `^postgres(ql)?://`.
- **Behavior:** calls the existing `runMigrations(url)`, which uses the same `drizzle` folder and journal as `drizzle-kit` and the test harness. On success it prints `migrations applied`.
- **Failure:** if the input is missing or invalid, or migration fails, it exits 1 with a message that **never includes the URL**.
- **Why direct, not pooled:** the pooled URL goes through PgBouncer in transaction mode, where session state (`SET`, session advisory locks, `LISTEN`, SQL-level `PREPARE`) doesn't reliably persist between statements. Long DDL would also hold a pooled connection while competing with app traffic. Neon recommends direct connections for schema changes.
- **Local development** keeps `pnpm --filter @wishlist/api db:migrate` (`drizzle-kit`).

## 5. Enforcement and testing

**`scripts/workflow-policy.test.mjs`** gains these rules, each written to fail against the workflows as they are today:

1. **No secrets beside a full install.** A job that runs `pnpm install` without both `--prod` and `--ignore-scripts` references no `secrets.*` anywhere: workflow, job or step `env`, or `with:` inputs. The only exception is `VERCEL_AUTOMATION_BYPASS_SECRET` in the `preview.yml` job `smoke`.
2. **Secret-holding jobs stay minimal.** A job that references `VERCEL_TOKEN`, `NEON_API_KEY` or a `DATABASE_URL*` secret runs `vercel` only as `npx --yes vercel@"$VERCEL_CLI_VERSION"`. That variable is taken from the root `package.json`, so there's one version to update.
3. **Production environment discipline.** In `deploy.yml`, only `settings`, `migrate`, `deploy-api` and `deploy-web` use `environment: production`, and every job has `if: github.ref == 'refs/heads/main'`.
4. **Preview data and comment.** `preview.yml` uses `parent_branch: preview-seed`, and the comment step contains no API URL.
5. **Seed workflow safety.** `preview-seed.yml`'s `seed` job is gated to `main` and contains the "not main" check before the wipe.
6. **Pipefail everywhere.** Every workflow sets `defaults.run.shell: bash`.

The existing rules stay: actions pinned to SHAs, `persist-credentials: false`, the token scoped to steps, bot PRs skipped, the stale-commit guard, and the Renovate rules.

**Migrator tests:**
- **Unit:** a missing URL, or a non-postgres URL, exits 1 with a message that doesn't contain the input, and never calls `runMigrations`.
- **Integration** (Testcontainers): the built CLI applies every migration to an empty database, and a second run applies nothing.

**Live verification**, recorded in the PR bodies:
- **PR 1** (migrator and `preview-seed.yml`): after it merges, run `preview-seed.yml` with `reset=true`. The log must show the branch created schema-only (or the fallback, stated plainly), the not-`main` check passing, the wipe, and migrating from zero. The Neon API must then show `preview-seed` with no `parent_id`, and `rate_limits` must have 0 rows.
- **PR 2** (pipeline split): its own preview must create `pr-<n>` whose `parent_id` is `preview-seed`'s ID (checked through the Neon API), pass the smoke tests, and post a comment with no API URL. After merge, the production deploy must pass with the new job graph and serve the tip commit.

## 6. Spec and documentation changes (in PR 2)

- **Main spec §10:** rewrite the workflow table, the "Previews hold prod-cloned data" paragraph and the secrets table to match this design. Add `preview-seed.yml`.
- **Decision log, main spec §13:**
  - **D12 becomes** "Per-PR previews on Neon branches created from `preview-seed`, a seeded root branch that never holds production data". Its alternatives become "Clone production (original D12, superseded by I-4); shared staging; prod only".
  - **D24 (new):** "Secret-free build jobs; secrets only in jobs that run the pinned Vercel CLI, pinned actions, or a `--prod --ignore-scripts` install". Alternative: "One job with step-scoped secrets".
  - **D25 (new):** "`preview-seed` as a schema-only root branch, wiped and migrated from zero, refreshed in place". Alternatives: "Clone of production then anonymized; a schema-only root branch per PR (exceeds Neon Free's 3 root branches)".
- **`docs/deployment.md`:** the new job graphs, `preview-seed` bootstrap and reset, the fallback, and the updated Neon branch budget. Remove the "Still open" note under CI hardening.

## 7. Out of scope

- A fake-data generator. Each plan adds its own seed data.
- A Turborepo remote cache. It's still deferred (review finding M-2).
- Re-enabling Renovate automerge. It becomes *safe* after this design, but stays off until Ted chooses to turn it back on.
- The remaining deferred minors from Plan 1's review (M-1 and M-4 to M-10). M-1 (`pipefail`) is resolved by policy rule 6.
