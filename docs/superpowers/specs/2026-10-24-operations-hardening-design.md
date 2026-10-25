# Operations hardening: design

**Status:** approved in conversation 2026-10-24, pending Ted's read of this document.
**Amends:** the main spec §10 (Monitoring and maintenance, Secrets, Workflows) and the [CI secret isolation addendum](2026-10-08-ci-secret-isolation-and-seeded-previews-design.md) §3.3 (the seed branch). Decisions continue from D82.

## 1. Why

Hanker is live, with sign-up open since 2026-10-19, and is run by one person on free tiers. An audit on 2026-10-24 found the basics in place: backups with a tested restore, uptime monitors, Sentry with scrubbing, a CI trust model, pins and runbooks. The gaps are places where something will break or lapse **without anyone being told**, plus some trust-model debt carried since Plan 1b. Success is: every expiring credential has a date someone will see; every privacy promise backed by a scheduled job is watched; a preview compromise can't reach the production database; and the tools that hold deploy secrets are pinned all the way down.

**Goals:** the seven items in §3, each shippable on its own.

**Non-goals:** SLOs, on-call, a public status page, load testing, Vercel Pro (log drains, longer log retention), multi-region. Vercel Hobby keeps runtime logs for one hour; Sentry plus `requestId` is the durable record, and that is accepted (§3.7).

**Anti-goals (a failure even if it works):**

- A secret, a heartbeat URL or a token value appears in a log, a Sentry event, a doc, a commit or argv.
- The workflow policy tests get weaker. Every policy change in this design makes them stricter.
- A heartbeat or a ping failure makes the daily cleanup fail or skip work.
- An automerged Renovate PR changes what production runs (code or build tooling) without review.

## 2. Constraints

Everything in [AGENTS.md](../../../AGENTS.md) applies, in particular: exact pins, ports with fakes in `src/testing/fakes.ts`, explicit `@Inject`, test-first behaviour changes, stacked PRs with Conventional Commit titles, and "ask a maintainer first" for cloud resources, secrets and the first `gh stack submit` of a stack.

**Ted's steps** (marked ⏸ below) are the ones that create or change cloud resources or secrets. The builder writes the runbook for each and stops there; Ted runs it.

## 3. Items

Order of delivery: **3.1 + 3.2 + 3.3** (one stack) → **3.4** → **3.5** → **3.6** → **3.7**. 3.7 depends on 3.4 having landed; the rest are independent.

### 3.1 Credential inventory (D83)

**Problem.** `docs/deployment.md` ("GitHub configuration") says the Vercel token `github-actions-wishlist` expires after one year, but `docs/operations.md`'s Recurring table has no row for it. It was created around 2026-10-08 (commit d58dacb), so every deploy and preview stops working around **2027-10-08**. Other credentials' expiries are scattered across runbooks.

**Decision (D83).** Add one **Credentials** section to `docs/operations.md`: a table with one row per credential, with these columns:

| Credential | Stored in | Expires | Unlocks if leaked | Rotate |

Rows, at least: `VERCEL_TOKEN` (production and preview envs), `VERCEL_AUTOMATION_BYPASS_SECRET`, `NEON_API_KEY` (preview env), `DATABASE_URL_DIRECT` (Neon owner role), the API's `DATABASE_URL`, `DATABASE_URL_BACKUP` (`hanker_backup`), the R2 token secrets (exact names from `backup.yml`), the `age` identity and passphrase, `BACKUP_HEARTBEAT_URL`, `CRON_HEARTBEAT_URL` (once 3.5 lands), `SENTRY_AUTH_TOKEN`, `CRON_SECRET`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, the `gmail-send-as` Resend key, `BRIGHT_DATA_API_KEY`, `ETSY_API_KEY` and `CLOUDFLARE_AI_TOKEN`.

- **Expires:** a date where one is known (Vercel token: 2027-10-08, Ted to confirm in Vercel → Account Tokens; Workers AI token: about 2027-10-23). Otherwise "no expiry" or "check dashboard", never a guess shown as fact.
- **Unlocks if leaked:** one plain line, for example "deploy any code to production" for `VERCEL_TOKEN`.
- **Rotate:** a link to the runbook section. Where a credential has no rotation runbook, the cell says so; writing new runbooks is out of scope.
- Add a **Yearly** row for the Vercel token to the Recurring table, and a line under the table: put each dated expiry in your calendar, as you do for the restore drill (D53).
- Everything comes from docs and workflow files, never from reading a secret. The builder may list names and metadata only.

### 3.2 A root error page (D84)

**Problem.** There's no `apps/web/src/app/global-error.tsx`. An error thrown in the root layout renders Next's bare default page, and `error.tsx`, which reports client-side errors to Sentry, never runs.

**Decision (D84).** Add `global-error.tsx`. Its behaviour matches `app/error.tsx`:

- the same copy ("Something went wrong." and the retry text);
- never the error's own text (spec §9);
- reports through `captureException` only when `shouldReportBoundaryError(error)` is true (`lib/observability.ts`);
- the same retry prop name as `error.tsx` uses (`retry`).

It renders its own `<html lang="en">` and `<body>`, because it replaces the root layout, and imports `globals.css` so the theme tokens apply. **Builder's call:** fonts, and whether to share a component with `error.tsx`. Sharing is fine if it stays small.

### 3.3 Stale docs (no decision)

Fix each of these to match what's true today:

- **Roadmap:** row 8b says Planned. It merged at f59516c, so mark it Done. Add a row for this design's plan (Plan 11), status Planned.
- **The top of `deployment.md`:** it still shows the `*.vercel.app` production URLs and "Plan 2 adds a custom domain". Show `hanker.dev`, and keep the `vercel.app` names only as the projects' own URLs if they're still useful.
- **"Daily cron" in `deployment.md`:** add the Your gifts notes purge (30 days, D79/D80) to the list of purges.
- **"GitHub configuration" in `deployment.md`:** add the missing names, taken from the workflow files:
  - the production secrets `SENTRY_AUTH_TOKEN`, `DATABASE_URL_BACKUP`, `AGE_RECIPIENT`, `BACKUP_HEARTBEAT_URL` and the R2 secrets;
  - the repo variables `SENTRY_DSN_WEB`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` and `PREVIEW_ALIAS_PREFIX`.
- **The `npx --yes vercel@64.5.0` commands in `deployment.md`:** the pin is 64.7.0. Leave them alone here. 3.4 replaces them with one command that can't drift. If 3.4 is dropped, update the version instead.

### 3.4 The Vercel CLI from the lockfile in secret jobs (D85)

**Problem.** The jobs that hold `VERCEL_TOKEN` run `npx --yes vercel@"$VERCEL_CLI_VERSION"`. That pins only the top-level package, so its transitive dependencies float in exactly the jobs that hold deploy credentials. These are `settings`, `deploy-api` and `deploy-web` in both `deploy.yml` and `preview.yml`. The version is read from the root `package.json` `devDependencies.vercel` (64.7.0).

**Decision (D85).** The CLI becomes a workspace package that the secret jobs install from the lockfile, the same way `migrate` already installs `@wishlist/api`:

- **The package:** `tools/vercel-cli/package.json` is `@wishlist/vercel-cli`, private, `dependencies: { "vercel": "<the current exact pin>" }`. Add `tools/*` to `pnpm-workspace.yaml`. Remove `vercel` from the root `devDependencies`.
- **In secret jobs:** `pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/vercel-cli`, then run the CLI through pnpm from that package (for example `pnpm --filter @wishlist/vercel-cli exec vercel …`). The `VERCEL_CLI_VERSION` step goes away.
- **For people:** one documented form, used for every manual command in `deployment.md` (env add/rm, rollback, manual deploy). A root script, `pnpm vercel …`, is acceptable if the stdin piping in the `env add` examples still works through it. **Builder's call**, but verify the piping.
- **The workflow policy** (`scripts/workflow-policy.test.mjs`, with a matching case in `workflow-policy.mutations.test.mjs`):
  - no job runs `npx`, `pnpx` or `pnpm dlx` with `vercel`;
  - every job that runs `vercel` installs exactly `--prod --frozen-lockfile --ignore-scripts --filter @wishlist/vercel-cli` before it, and restores no cache (as today).
  - The existing "a range would float" check moves to `tools/vercel-cli/package.json`: an exact version.
- **Renovate** updates the package like any other dependency. It's excluded from automerge (3.7).
- **AGENTS.md:** add `tools/vercel-cli` to the Layout table.

**Risk to check first.** Some package in Vercel's tree may need its install script under `--ignore-scripts` for `pull`, `deploy --prebuilt` or `alias set`. Prove it on a preview run before production uses it. If a script is truly needed, stop and bring it to Ted rather than allowing it.

### 3.5 A heartbeat for the daily cron (D86)

**Problem.** `GET /api/internal/cron/daily` (`apps/api/src/ops/`) deletes Your gifts notes after 30 days, and `/privacy` promises that. It also purges unverified accounts, expired tokens and sessions. If Hobby's cron stops calling it, or every run fails, nothing tells anyone.

**Decision (D86).** The API pings a Better Stack heartbeat at the end of each authorized run.

- **Port:** `CRON_HEARTBEAT = Symbol('CRON_HEARTBEAT')`, in `apps/api/src/ops/cron-heartbeat.ts`. Interface: `{ succeeded(): Promise<void>; failed(): Promise<void> }`. A recording fake goes in `src/testing/fakes.ts`.
- **Adapter:**
  - `succeeded` sends `GET <url>` and `failed` sends `GET <url>/fail`, using platform `fetch` with `AbortSignal.timeout(5000)`.
  - Neither ever throws. A non-2xx answer or a network error sends one Sentry warning through `ERROR_REPORTER`, as `cron heartbeat failed status=<n|none>`, and **never the URL** (it contains the heartbeat's token).
- **Env:** `CRON_HEARTBEAT_URL` is optional and must be `https:` (zod). If it's unset, the no-op adapter is used and nothing is pinged. That's the case in previews, CI and local runs.
- **Wiring (`CronController.daily`):**
  - An unauthorized request is refused as today and pings nothing.
  - An authorized run calls `cleanup.runDaily()`. If that resolves, it awaits `succeeded()` and returns the counts unchanged.
  - If it throws, it awaits `failed()` and rethrows, so the response and the existing error reporting are unchanged.
- **Tests (unit):**
  - success pings `succeeded` once;
  - a throwing cleanup pings `failed` once and still rejects;
  - unauthorized pings nothing;
  - the adapter's warning for a 500 and for a timeout carries no part of the URL;
  - an unset URL means no fetch.
- **⏸ Ted:**
  - Create a heartbeat in Better Stack, "Hanker daily cron", period 1 day, grace 2 hours. Hobby runs the cron at any point within 09:00–09:59 UTC, so the gap between runs is 23–25 h.
  - Set `CRON_HEARTBEAT_URL` as a sensitive production variable on `wishlist-api`, from a hidden prompt.
  - Redeploy, then press Run under Cron Jobs and see the heartbeat go up.
- **Docs:**
  - the Monitoring table and "Daily cron" in `deployment.md`;
  - a "When something breaks" row in `operations.md` for a missed or failed heartbeat: check Cron Jobs in Vercel, the run's log, and Sentry;
  - the 3.1 credentials row;
  - the AGENTS.md ports list.

### 3.6 Previews in their own Neon project (D87)

**Problem.** The preview environment's `NEON_API_KEY` belongs to the production Neon project, so it can read `main`'s connection string. Previews also share production's 100 CU-hours a month and its 10-branch cap, so busy previews could suspend production's database.

**Decision (D87).** Previews move to a new Neon project, `wishlist-preview`, in the same organization (`Shockolate`), Postgres 17, AWS us-east-1. Its key is a **project-scoped organization API key**. This stays on Neon's Free plan: it allows 100 projects, and compute (100 CU-hours a month), branches (10) and data transfer (5 GB a month) are all per project. Storage is 1 GB per project and 20 GB across all projects, and previews hold only a schema and test data. One line in Neon's compute FAQ omits "per project". The after-a-week usage check (step 8 below) confirms which is true.

- **`preview-seed`** becomes an ordinary child of the preview project's empty default branch. It's still wiped and rebuilt by replaying every migration from zero, so it holds no production rows **by construction**: no production data exists in that project. The `schema-only` creation mode (which can't cross projects) and the `init_source` input are removed. `preview-seed.sh`'s refusal to resolve to the default branch stays.
- **No changes needed in:** `preview.yml` (pr-* branches from `preview-seed`, the assert-child check, migrate), `cleanup.yml` and `neon-sweep.sh`. They keep the secret names `NEON_API_KEY` and `NEON_PROJECT_ID` in the `preview` environment; only the values change. If a workflow or a script assumes the production project anywhere, fix that.
- **Policy rules 4 and 5** keep their intent. Update rule 5's wording and checks only where they reference schema-only creation, and keep "runs only on `main`" and "resolve before wipe".
- **Branch budget:** the preview project's default branch plus `preview-seed` leave 8 PRs with previews, the same as today. Production's project goes back to `main` plus restore backups only. Remove the "root-branch budget" note about `preview-seed` from `deployment.md`.
- **⏸ Ted, in order:**
  1. Create the project.
  2. Create the project-scoped key.
  3. Replace the two `preview` secrets, from a hidden prompt.
  4. Run "Preview seed" with `reset`.
  5. Open a test PR and see the preview pass.
  6. Delete the old `preview-seed` and any `pr-*` branches from the production project.
  7. **Revoke the old key.** Until then, the old key still reaches production.
  8. Check Neon → Usage on both projects after a week.
- **If Neon won't create a project-scoped key** (the console doesn't offer it for this organization), use an organization API key instead and carry on with the move. Previews still get their own compute and branch limits, which is most of the benefit. The key can still read production, though, so record that in `deployment.md`'s "CI/CD supply-chain hardening" as an accepted risk next to the Vercel token's. Ask Ted before choosing this fallback, because it changes what D87 delivers.
- **Spec text:** the addendum's §3.3 and the main spec §10 (Previews) describe the new project. D12's history stays as superseded.
- **Vercel's half is accepted, not fixed (Ted, 2026-10-24).** One Vercel token can still deploy to production from the preview jobs. Project-scoped Vercel tokens don't separate preview from production. The real fix, separate preview projects, is deferred until someone else gets write access. The preview jobs run only on same-repo, non-bot PRs, and only upload output built by a secret-free job, so the realistic way in is the tools they run, and 3.4 closes that. Record this in `deployment.md`'s "CI/CD supply-chain hardening" as an accepted risk with that trigger for revisiting it.

### 3.7 Renovate automerge for dev-only tooling (D88)

**Problem.** `deployment.md` says Renovate "never automerges… at least until builds run in a job with no deploy credentials". That has been true since 2026-10-08, so the stated reason is out of date, and the weekly review spends most of its time on dev tooling updates.

**Decision (D88).** Renovate automerges **minor and patch updates of dev-only tooling that never shapes the production build and runs only in secret-free jobs**. Everything else stays manual.

- **Automerge:**
  - `@types/*` except `@types/node`, which moves by hand with `undici-types`;
  - `eslint`, `@eslint/*`, `typescript-eslint`, `eslint-plugin-*` and `globals`, but not `eslint-config-next`, which is grouped with Next;
  - `prettier`;
  - `vitest` and `@vitest/*`;
  - `testcontainers` and `@testcontainers/*`.

  These count only as `devDependencies`, and only for `minor` and `patch` updates. The builder checks each name against the actual `package.json` files, and only names that exist go in.
- **Never automerge:**
  - runtime dependencies;
  - anything that builds or bundles: TypeScript, Next, Nest CLI, `@swc/core`, esbuild, Turbo;
  - the `@wishlist/vercel-cli` package;
  - the `playwright` group;
  - GitHub Actions digests, because those actions run next to secrets;
  - container images;
  - every major.
- **Mechanics:**
  - One `packageRules` entry with `automerge: true` and `automergeType: "pr"`, which uses GitHub's auto-merge (already enabled) behind the required checks and the squash-only ruleset.
  - `minimumReleaseAge: "3 days"` and the Monday schedule stay.
  - Validate the config with Renovate's config validator at a pinned version.
- **Accepted risk.** A dev-only bump can still change how the lockfile resolves a transitive package that runtime code shares. The 3-day minimum age and the required checks catch most of that.
- **Docs:** rewrite the automerge line in `deployment.md` with this rule and its reason. Change the weekly Renovate row in `operations.md` to "Review Renovate's PRs that didn't automerge, and skim what did".
- **Depends on 3.4**, so the Vercel CLI is a named package that the rule can exclude.

## 4. What's left to the builder

- The stack and layer layout, as long as each layer passes CI on its own and has one concern.
- File placement inside the patterns above. Names given here (`CRON_HEARTBEAT`, `CRON_HEARTBEAT_URL`, `@wishlist/vercel-cli`, `wishlist-preview`) are fixed.
- The wording of runbooks, in the docs' existing voice.

## 5. Decisions

- **D83:** one credentials table in `operations.md` with expiry and blast radius, plus a Yearly row for the Vercel token (renew before 2027-10-08).
- **D84:** `global-error.tsx` mirrors `error.tsx`'s copy and its reporting.
- **D85:** secret jobs run the Vercel CLI from `@wishlist/vercel-cli`, installed from the lockfile with `--ignore-scripts`. `npx vercel` is banned by the policy test.
- **D86:** the daily cron pings a Better Stack heartbeat (`CRON_HEARTBEAT_URL`, optional) on success, and `/fail` on failure. A ping never affects the run.
- **D87:** previews live in the `wishlist-preview` Neon project with a project-scoped key, and `preview-seed` is rebuilt from migrations there. The Vercel token's shared reach is an accepted risk until someone else gets write access.
- **D88:** Renovate automerges minor and patch updates of named dev-only tooling. Builds, runtime, Actions, images and majors stay manual.
