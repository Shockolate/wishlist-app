# Deployment

Production runs on free tiers: **Vercel Hobby** (two projects), **Neon Free** (Postgres 17) and **GitHub Actions**. GitHub Actions is the only thing that deploys; Vercel's Git integration is disabled (`apps/*/vercel.json`). See spec §3 and §10 for the reasoning.

```
Browser ──► wishlist-web (Next.js) ──rewrite /api/*──► wishlist-api (NestJS, one Vercel Function) ──► Neon
```

|     | Production URL                       |
| --- | ------------------------------------ |
| Web | https://wishlist-web-gold.vercel.app |
| API | https://wishlist-api-five.vercel.app |

Vercel assigned these names because `wishlist-web.vercel.app` and `wishlist-api.vercel.app` were already taken. Plan 2 adds a custom domain.

## Accounts

| Service | Plan                                                               | Used for                     |
| ------- | ------------------------------------------------------------------ | ---------------------------- |
| GitHub  | Free (public repo)                                                 | Code, Actions, rulesets      |
| Vercel  | Hobby (non-commercial), team `shockolate`                          | Hosting both apps            |
| Neon    | Free, created in the **Neon console** (not the Vercel integration) | Postgres 17, per-PR branches |

**Why Neon is set up directly, not through the Vercel integration:** our GitHub Actions own preview branching and env wiring. The integration would add a second system creating branches against Neon's 10-branch cap, and it would inject database credentials into projects outside our control. It would also tie the database account to the hosting account.

Later plans add: domain and DNS, Resend and Turnstile (Plan 2); Sentry, Cloudflare R2 backups and uptime monitoring (Plan 5).

## Neon

- Project `wishlist`, Postgres 17, region AWS us-east-1 (next to Vercel's `iad1`).
- **Pooled** connection string → the API's runtime `DATABASE_URL` (stored in Vercel as a sensitive variable).
- **Direct** connection string → migrations only (`DATABASE_URL_DIRECT`).
- The free plan scales compute to zero after 5 idle minutes. The first query afterwards takes a few hundred ms longer.
- Point-in-time restore covers **6 hours** on the free plan. Nightly backups arrive in Plan 5.

## Vercel projects

Both projects were created and configured from the CLI, so the setup is reproducible and checkable through the API instead of dashboard clicks:

```bash
pnpm exec vercel project add wishlist-api --scope shockolate
pnpm exec vercel project add wishlist-web --scope shockolate

printf '%s' '{"rootDirectory":"apps/api","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nestjs","ssoProtection":null}' \
  | pnpm exec vercel api /v9/projects/wishlist-api -X PATCH --input - --scope shockolate
printf '%s' '{"rootDirectory":"apps/web","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nextjs","ssoProtection":{"deploymentType":"preview"}}' \
  | pnpm exec vercel api /v9/projects/wishlist-web -X PATCH --input - --scope shockolate
```

| Setting                          | wishlist-api | wishlist-web                                  |
| -------------------------------- | ------------ | --------------------------------------------- |
| Root Directory                   | `apps/api`   | `apps/web`                                    |
| Include files outside root       | On           | On                                            |
| Framework preset                 | NestJS       | Next.js                                       |
| Node.js                          | 24.x         | 24.x                                          |
| Vercel Authentication            | Disabled     | **Previews only** (`deploymentType: preview`) |
| Protection Bypass for Automation | —            | Enabled (secret in GitHub `preview` env)      |

**Why the protection settings look like this:**

- **The web app protects previews only, not "Standard Protection".** Standard Protection (`all_except_custom_domains`) would also put the production `*.vercel.app` URL behind a Vercel login until a custom domain exists, which would lock out real users and the production smoke tests.
- **The API is unprotected.** A Next.js rewrite can't attach the bypass header, and the API enforces its own auth.

The bypass secret was generated through the API and piped straight into GitHub, so it was never printed:

```bash
printf '%s' '{"generate":{"note":"GitHub Actions smoke tests (wishlist-app)"}}' \
  | pnpm exec vercel api /v1/projects/wishlist-web/protection-bypass -X PATCH --input - --scope shockolate \
  | jq -r '.protectionBypass | to_entries | map(select(.value.scope == "automation-bypass")) | .[0].key' \
  | gh secret set VERCEL_AUTOMATION_BYPASS_SECRET --env preview
```

## Environment variables

| Where                              | Name                       | Value                                              |
| ---------------------------------- | -------------------------- | -------------------------------------------------- |
| Vercel `wishlist-api` → Production | `DATABASE_URL` (sensitive) | Neon pooled string                                 |
| Vercel `wishlist-api` → Production | `APP_ORIGIN`               | Web production origin                              |
| Set per deploy by CI               | `GIT_SHA`                  | The commit being deployed                          |
| Set at build by CI                 | `API_ORIGIN` (web)         | API production origin, or the PR's API preview URL |

## GitHub configuration

| Kind      | Scope            | Names                                                                                                                                                   |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets   | env `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `DATABASE_URL_DIRECT`                                                |
| Secrets   | env `preview`    | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET` |
| Variables | repo             | `API_PRODUCTION_ORIGIN`, `APP_PRODUCTION_ORIGIN`                                                                                                        |

The Vercel token (`github-actions-wishlist`, scoped to the `shockolate` team) expires after one year; rotate it before then.

## Continuous deployment

`.github/workflows/deploy.yml` runs on every push to `main`, one at a time, as separate jobs split by trust level ([addendum 2026-10-08](superpowers/specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)):

| Job          | Secrets               | Does                                                                                                                              |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `guard`      | none                  | Refuses a stale commit (`scripts/assert-main-tip.sh`)                                                                             |
| `settings`   | `VERCEL_TOKEN`        | `vercel pull` for both projects; passes on only each `project.json`                                                               |
| `build`      | **none**              | Gates, then `vercel build --prod --standalone` for the API and the web app (each output passed on as a tarball), and the migrator |
| `migrate`    | `DATABASE_URL_DIRECT` | `--prod --ignore-scripts` install, then `node apps/api/dist/db/migrate-cli.js`                                                    |
| `deploy-api` | `VERCEL_TOKEN`        | `deploy --prebuilt --prod`, then waits until `/api/health` reports the commit                                                     |
| `deploy-web` | `VERCEL_TOKEN`        | `deploy --prebuilt --prod`                                                                                                        |
| `smoke`      | none                  | Playwright smoke tests against the production origin                                                                              |

**How the jobs are kept safe:**

- **Secret-holding jobs run almost nothing.** Only the pinned Vercel CLI runs, through `npx`, at the version in the root `package.json`; never `pnpm exec`.
- **Every job that touches production re-checks the commit.** It confirms it's deploying `main`'s tip, because "Re-run failed jobs" skips `guard`.
- **Every deploy job checks its build output first** (`scripts/check-vercel-output.sh`). The output must be complete and self-contained, and no symlink in it may point outside it, because the deploy job holds `VERCEL_TOKEN` and `vercel deploy` uploads whatever a symlink points to.

A deploy that's already running is never cancelled. Of the runs queued behind it, only the newest is kept, so merging a stack ships its tip once.

If a deploy fails after `migrate`, production still runs the previous code against the new schema. That's safe by construction, because every migration is backward-compatible (expand/contract). Fix forward, or roll back the code (see Rollback).

## Previews

Each PR, including each layer of a stack, gets (`.github/workflows/preview.yml`):

1. A Neon branch `pr-<n>` created from **`preview-seed`**, never from production. The job checks the branch really descends from `preview-seed`, then migrates it.
2. An API preview using that branch. `EMAIL_TRANSPORT=log` means no email is ever sent.
3. A web preview built against that API, aliased to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` (currently `shockolate-wishlist-pr-<n>.vercel.app`).
4. Read-only smoke tests and a sticky PR comment with the **web** link only.

The jobs follow the same trust split as deploys: `build-api` and `build-web` hold no secrets, and `smoke` holds only the bypass secret. Bot (Renovate) and fork PRs get CI but no preview.

**Fixing an old preview branch.** If `provision` fails with "does not descend from preview-seed", the PR's branch was cloned from production before this change. Close and reopen the PR: cleanup deletes the old branch, and the next run creates a fresh one from `preview-seed`.

Cleanup (`.github/workflows/cleanup.yml`): closing a PR deletes its Neon branch, and a nightly sweep deletes any `pr-*` branch whose PR is closed. Neon Free allows 10 branches per project. `main` and `preview-seed` take two, so at most 8 PRs can have previews at once.

To check the sweep by hand: Actions → "Cleanup previews" → Run workflow (dry run defaults to on).

## Preview seed branch

`preview-seed` is the parent of every preview database. It never holds production data.

- **Created** by `.github/workflows/preview-seed.yml` as a **schema-only** root branch of `main`. It's then wiped and rebuilt by replaying every migration from zero. The schema-only copy has drizzle's journal table but not its rows, so the rebuild is required.
- **Kept current** by the same workflow on every push to `main` that touches `apps/api/drizzle/**`, which migrates it incrementally.
- **Reset** with Actions → "Preview seed" → Run workflow with `reset` checked.
- **Fallback** (approved, only if schema-only branches stop working): run with `init_source = parent-data`. That creates it as a normal child of `main` and wipes it in the same job, before its connection string is used for anything else.
- **Safety:** `scripts/preview-seed.sh` refuses to resolve the seed to the production branch, and the workflow only runs on `main`.
- **Never delete it.** Neon won't delete a branch that has children, and every open preview is one; refresh it in place instead.
- **Root-branch budget:** `main` plus `preview-seed` use 2 of Neon Free's 3 root branches. A production restore can create backup root branches, so delete old backups if a restore is refused.

## Manual deploy (bootstrap or emergency only)

This is exactly what CI runs. It works from the repo root with the org and project IDs in the environment, so no link files need switching.

```bash
export VERCEL_ORG_ID=<team id>
# API
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel build --prod
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel deploy --prebuilt --prod --env GIT_SHA="$(git rev-parse HEAD)"
# Web (after the API is healthy)
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-web id> API_ORIGIN=https://wishlist-api-five.vercel.app pnpm exec vercel build --prod
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel deploy --prebuilt --prod
```

Migrate production first if the deploy includes a migration. Use the direct string, and the guard below refuses anything that isn't a Neon URL:

```bash
read -rs DATABASE_URL_DIRECT && export DATABASE_URL_DIRECT && [[ "$DATABASE_URL_DIRECT" == *neon.tech* ]] \
  && pnpm --filter @wishlist/api db:migrate || echo "Refusing: not a Neon URL"; unset DATABASE_URL_DIRECT
```

## Rollback

Code: Vercel Instant Rollback, **web first, then API**. Rolling the API back first could leave a newer web app calling an older API.

```bash
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel rollback
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel rollback
```

Data: Neon point-in-time restore (6-hour window) from the Neon console.

## Known issues

- **CLI output changes when an AI agent runs it.** When the Vercel CLI detects an agent, `vercel deploy` prints a JSON object on stdout instead of a bare deployment URL. Scripts must read the URL from either form.

## CI/CD supply-chain hardening

These came out of Plan 1's final review. `scripts/workflow-policy.test.mjs` enforces them in CI.

- **The `production` environment only accepts `main`** (a custom deployment branch policy), and the deploy job also checks `github.ref == 'refs/heads/main'`. Without both, a `workflow_dispatch` from any branch could migrate production or read `DATABASE_URL_DIRECT`.
- **Stale deploys are refused.** The deploy job stops before migrating if `GITHUB_SHA` is no longer the tip of `main`, so re-running an old failed deploy can't roll production back.
- **Every action is pinned to a commit SHA** (version in a trailing comment), and the actionlint image is pinned by digest. Renovate's `helpers:pinGitHubActionDigests` keeps them current.
- **Checkouts use `persist-credentials: false`**, so later steps (dependency install scripts included) can't read the `GITHUB_TOKEN` from `.git/config`.
- **`VERCEL_TOKEN` is scoped to the steps that deploy**, not the whole job.
- **Bot PRs (Renovate) get CI but no preview.** Unreviewed dependency code never runs next to deploy credentials, and bot PRs don't use up Neon's 10-branch cap.
- **Renovate waits 3 days after a release** (`minimumReleaseAge`) and **never automerges**. That holds at least until builds run in a job with no deploy credentials.

**Done (2026-10-08):** each pipeline is split into secret-free build jobs and deploy-only jobs (see Continuous deployment and Previews).

## Repository settings

Applied once, from the files in this repo:

| Setting                           | Source                       | How                                                                                                                           |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ruleset on `main`                 | `.github/rulesets/main.json` | `gh api -X POST repos/Shockolate/wishlist-app/rulesets --input .github/rulesets/main.json` (update: `-X PUT …/rulesets/<id>`) |
| CodeQL                            | default setup                | `gh api -X PATCH repos/Shockolate/wishlist-app/code-scanning/default-setup -f state=configured`                               |
| Secret scanning + push protection | repo security settings       | `gh api -X PATCH repos/Shockolate/wishlist-app` with `security_and_analysis` enabled                                          |
| Dependabot alerts                 | repo security settings       | `gh api -X PUT repos/Shockolate/wishlist-app/vulnerability-alerts`                                                            |
| Auto-merge (used by Renovate)     | repo settings                | `gh repo edit --enable-auto-merge`                                                                                            |
| Renovate                          | GitHub App                   | install from https://github.com/apps/renovate for this repo only                                                              |

Required checks: `checks`, `actionlint`, `integration`, `migrations-lint`, `e2e`. `preview` is advisory: a Vercel or Neon outage, or Neon's branch cap, shouldn't block merging code that passed CI.
