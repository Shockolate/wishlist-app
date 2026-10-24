# Plan 11: Operations Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the operational gaps found in the 2026-10-24 audit: unwatched credential expiries, a missing root error page, stale docs, a floating Vercel CLI tree in secret jobs, an unmonitored daily cron, previews sharing production's Neon project, and Renovate's outdated no-automerge rule.

**Architecture:** Five independent stacks, delivered in order: A (docs and `global-error.tsx`), B (Vercel CLI as a lockfile-installed workspace package), C (cron heartbeat port), D (previews in their own Neon project), E (narrow Renovate automerge; needs B). Steps that touch cloud resources or secrets are ⏸ checkpoints for Ted.

**Tech Stack:** NestJS 12, Next.js 16, Vitest, bash script tests, GitHub Actions with `scripts/workflow-policy*.mjs`, Renovate, Neon API, Better Stack heartbeats.

**Spec:** [docs/superpowers/specs/2026-10-24-operations-hardening-design.md](../specs/2026-10-24-operations-hardening-design.md). Section numbers like §3.5 refer to it.

## Global Constraints

- Everything in AGENTS.md applies. In particular: exact pins, explicit `@Inject`, ports with fakes in `apps/api/src/testing/fakes.ts`, `.js` relative imports in the API, test-first behaviour changes, Conventional Commit PR titles, and a `Co-Authored-By:` trailer naming the model that wrote the commit.
- Never read, print or commit a secret value. Docs list names and metadata only. The heartbeat URL is a secret: it never appears in a log, a Sentry event, an error message or argv.
- The workflow policy tests only get stricter. Every rule removed is replaced by a stricter one in the same commit.
- Fixed names: `CRON_HEARTBEAT`, `CRON_HEARTBEAT_URL`, `@wishlist/vercel-cli` (at `tools/vercel-cli`), Neon project `wishlist-preview`.
- Ted runs every `gh stack submit` (auto mode blocks it): `! gh stack submit --auto --open`. Then set each PR's title and body with `gh pr edit`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Run under Node 24 (`nvm use`). Full verification is the command block in AGENTS.md "Verify before you say it's done". If you touch `.github/workflows/` or `scripts/`, also run both policy tests, the changed script's `*.test.sh` and actionlint.

## Review Focus

1. **A fetch error that carries the heartbeat URL.** Undici's errors can carry the URL in `cause`. The adapter must report a fixed string, never `err.message` or `err.cause`. Pinned in Task 4: `does not leak the URL when fetch rejects with it in the message`.
2. **A heartbeat endpoint that hangs.** The cron must still answer within about 5 s more than the cleanup takes. Pinned in Task 4: `gives up after 5 seconds and warns status=none`.
3. **`CRON_HEARTBEAT_URL` set to `http://…` or junk.** The API must refuse to boot, not ping in cleartext. Pinned in Task 4: an `env.spec.ts` case.
4. **The preview secrets pasted with the production project's ID during cutover.** Previews would branch inside production again, silently. My call, beyond the spec's text but within D87: the seed script refuses when `NEON_PROJECT_ID` equals the non-secret repo variable `NEON_PRODUCTION_PROJECT_ID`. Pinned in Task 7.
5. **An automerge rule that later widens to a runtime dependency or an action.** The policy test must catch it, not the reviewer. Pinned in Task 9's mutation cases.

---

## Stack A: credentials, root error page, stale docs (§3.1–3.3)

### Task 1: Docs layer: spec, plan, credential inventory, stale docs

**Files:**

- Add: `docs/superpowers/specs/2026-10-24-operations-hardening-design.md`, this plan (both already written, uncommitted on `main`'s working tree)
- Modify: `docs/operations.md` (new "Credentials" section; Yearly row for the Vercel token)
- Modify: `docs/deployment.md` (header, "Daily cron", "GitHub configuration")
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (8b → Done; add a Plan 11 row, Planned)

- [ ] **Step 1:** `git switch -c docs/plan-11` (moves the uncommitted spec and plan along), then `gh stack init` on it, per CONTRIBUTING.md.
- [ ] **Step 2: Credentials table (D83).** Add it to `operations.md` as specified in §3.1: the columns, every listed credential, and the expiry rules. Take the R2 secret names from `.github/workflows/backup.yml`. Vercel token expiry: "2027-10-08 (confirm under Vercel → Account Tokens)". `CRON_HEARTBEAT_URL` isn't added here; Task 5 adds it.
- [ ] **Step 3:** Add a Recurring row: Yearly, "Rotate the Vercel deploy token `github-actions-wishlist` before 2027-10-08; deploys and previews fail once it lapses", linking deployment.md#github-configuration. Below the table, add the calendar line from §3.1.
- [ ] **Step 4: Stale docs (§3.3).**
  - The roadmap: 8b → Done. Add a row 11 linking this plan, with the spec in the "Spec sections" column, status Planned.
  - `deployment.md`: the header (production is `hanker.dev`); "Daily cron" gains the gift-notes purge; "GitHub configuration" gains the missing secrets and variables.
  - Leave the `vercel@64.5.0` commands alone; Task 3 replaces them.
- [ ] **Step 5:** `pnpm format:check`. Expected: no differences.
- [ ] **Step 6:** Commit: `docs: plan 11 operations hardening, credentials inventory and stale docs`.

### Task 2: `global-error.tsx` (D84)

**Files:**

- Create: `apps/web/src/app/global-error.tsx`
- Reference: `apps/web/src/app/error.tsx`, `apps/web/src/lib/observability.ts`

Web tests are `*.spec.ts` in a node environment, with no component tests. The reporting decision, `shouldReportBoundaryError`, is already unit-tested. This task is therefore verified by typecheck, build and a manual check, not by a new test. Say so in the PR body.

- [ ] **Step 1:** `gh stack add web/global-error`.
- [ ] **Step 2:** Create `export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void })`.
  - `'use client'`.
  - It renders `<html lang="en"><body>…</body></html>` with the same copy and button as `error.tsx`, and imports `./globals.css`.
  - It reports exactly like `error.tsx`: a `useEffect` with `shouldReportBoundaryError` → `captureException`.
  - Give it a doc comment saying why it exists: it replaces the root layout when the layout itself throws.
- [ ] **Step 3: Manual check.**
  - Temporarily throw in `app/layout.tsx` under `next dev` and see the page and the console capture. Then revert, and confirm `git diff app/layout.tsx` is empty.
  - Check that Next's prop name is still `retry` in the installed version (`node_modules/next/dist/…/global-error` types). If it differs, match `error.tsx` and Next together, and flag it to Ted.
- [ ] **Step 4:** `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck build --filter @wishlist/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(web): a root error page that reports like error.tsx (D84)`.
- [ ] **Step 6:** Full verification (AGENTS.md). Then ⏸ Ted submits stack A.

## Stack B: the Vercel CLI from the lockfile (§3.4, D85)

### Task 3: `@wishlist/vercel-cli` and the secret jobs

**Files:**

- Create: `tools/vercel-cli/package.json`
- Modify: `pnpm-workspace.yaml` (`tools/*`), root `package.json` (drop `vercel` from `devDependencies`, optionally add a `vercel` script), `pnpm-lock.yaml`
- Modify: `.github/workflows/deploy.yml` and `preview.yml` (every job that runs `vercel`)
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`
- Modify: `docs/deployment.md` (every manual `vercel` command), `docs/development.md` if it mentions the CLI, `AGENTS.md` (Layout table: `tools/vercel-cli`)

**Interfaces:**

- Produces: a package named `@wishlist/vercel-cli`, which Task 9's Renovate exclusion matches. The install command is exactly `pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/vercel-cli`.

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init ci/vercel-cli-lockfile`.
- [ ] **Step 2: Write the failing policy changes first.**
  - In `workflow-policy.test.mjs`, replace `VERCEL_CLI` with `pnpm --filter @wishlist/vercel-cli exec vercel`, and add `VERCEL_INSTALL` (the exact install command above).
  - Rules:
    - (a) no `run` line in any workflow matches `/\b(npx|pnpx|pnpm dlx|bunx)\b[^\n]*\bvercel\b/`;
    - (b) every step that runs `vercel` comes after a step in the same job whose run is exactly `VERCEL_INSTALL`;
    - (c) the exact-version check moves from the root `package.json` to `tools/vercel-cli/package.json` `dependencies.vercel` (`/^\d+\.\d+\.\d+$/`), and the root `package.json` must not list `vercel`.
  - Keep "secret jobs restore no cache".
  - In `workflow-policy.mutations.test.mjs`:
    - replace the `vercel@latest` mutation with one that turns a deploy step back into `npx --yes vercel@64.7.0 deploy --prebuilt`;
    - add one that drops `--ignore-scripts` from `VERCEL_INSTALL`;
    - move the `^62.5.0` mutation to the tools package.
- [ ] **Step 3:** `node scripts/workflow-policy.test.mjs`. Expected: FAIL, listing the `npx … vercel` lines and the missing installs.
- [ ] **Step 4: Create the package and switch the jobs.**
  - `tools/vercel-cli/package.json`: `{"name":"@wishlist/vercel-cli","private":true,"type":"module","dependencies":{"vercel":"64.7.0"}}`. Use the version currently in the root `package.json`.
  - Then `pnpm install`.
  - In every job that runs `vercel` (both `settings`, both `deploy-api`, both `deploy-web`): checkout with `persist-credentials: false`, pnpm/action-setup, setup-node with no cache, `VERCEL_INSTALL`, then `VERCEL_CLI …`. Use the SHA pins already in the file.
  - Remove the `VERCEL_CLI_VERSION` steps.
- [ ] **Step 5:** `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`, plus actionlint (the pinned command from `ci.yml`). Expected: PASS, and every mutation is caught.
- [ ] **Step 6: People's command.**
  - Pick one form and use it everywhere in `deployment.md`: either `pnpm vercel …` through a root script `"vercel": "pnpm --filter @wishlist/vercel-cli exec vercel"`, or the long form.
  - Prove the piped form still reads stdin:
    ```bash
    printf x | pnpm vercel env add --help
    ```
    It must not hang, and it must not print the value. Also run `pnpm vercel --version` and expect 64.7.0.
  - Add `tools/vercel-cli` to the AGENTS.md Layout table.
- [ ] **Step 7:** Full verification. Commit: `ci: run the Vercel CLI from the lockfile in secret jobs (D85)`.
- [ ] **Step 8: ⏸ Ted submits.** The PR's own preview run is the proof: `settings`, `deploy-api` and `deploy-web` pass with `--ignore-scripts`. If one fails because a package needs its install script, stop and bring the package name and the error to Ted; don't add it to `allowBuilds`. After the merge, check the production Deploy run is green.

## Stack C: daily cron heartbeat (§3.5, D86)

### Task 4: The `CronHeartbeat` port and its Better Stack adapter

**Files:**

- Create: `apps/api/src/ops/cron-heartbeat.ts`, `apps/api/src/ops/cron-heartbeat.spec.ts`
- Modify: `apps/api/src/core/env.ts`, `apps/api/src/core/env.spec.ts`, `apps/api/src/testing/fakes.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface CronHeartbeat {
    succeeded(): Promise<void>;
    failed(): Promise<void>;
  }
  export const CRON_HEARTBEAT = Symbol('CRON_HEARTBEAT');
  export const NO_HEARTBEAT: CronHeartbeat; // resolves, does nothing
  export class BetterStackCronHeartbeat implements CronHeartbeat {
    constructor(url: string, reporter: ErrorReporter, fetchFn: typeof fetch = fetch);
  }
  // fakes.ts
  export class FakeCronHeartbeat implements CronHeartbeat {
    readonly pings: ('succeeded' | 'failed')[];
  }
  ```
- Env: `CRON_HEARTBEAT_URL: z.url({ protocol: /^https$/ }).optional()`, or the zod version's equivalent that rejects non-https.

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init api/cron-heartbeat`.
- [ ] **Step 2: Write the failing tests** in `cron-heartbeat.spec.ts`. Use the style of `tag-suggester.spec.ts`: a stub `fetchFn`, plus a `FakeErrorReporter`. The URL is `https://uptime.betterstack.com/api/v1/heartbeat/SECRETTOKEN`.
  - `pings the URL on success`: one call, to the URL, with method `GET`, and no warning.
  - `pings URL/fail on failure`: one call to `…/SECRETTOKEN/fail`.
  - `warns without the URL on a non-2xx`: the stub answers 500. Expect `warnings` to equal `[{ message: 'cron heartbeat failed status=500' }]`, and the serialized warnings not to contain `SECRETTOKEN`.
  - `does not leak the URL when fetch rejects with it in the message`: the stub rejects with `new TypeError('fetch failed https://…/SECRETTOKEN', { cause: new Error('…/SECRETTOKEN') })`. Expect the message `cron heartbeat failed status=none`, no `SECRETTOKEN` anywhere in the warnings, and `succeeded()` resolves.
  - `gives up after 5 seconds and warns status=none`: use fake timers. The stub honours `init.signal` and otherwise never settles. Advance 5000 ms; it resolves with one `status=none` warning.
  - In `env.spec.ts`: `http://…` is rejected, `not a url` is rejected, `https://…` parses, and unset is `undefined`.
- [ ] **Step 3:** `pnpm --filter @wishlist/api exec vitest run src/ops/cron-heartbeat.spec.ts src/core/env.spec.ts`. Expected: FAIL (the module is missing, and the env cases fail).
- [ ] **Step 4: Implement.**
  - The adapter: `fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(5000) })`. It catches everything and never throws. It warns `cron heartbeat failed status=<n|none>` through the reporter. Add a doc comment citing D86 and that the URL is a secret.
  - Add `NO_HEARTBEAT`, `FakeCronHeartbeat` and the env field, with a one-line doc comment as on its neighbours.
- [ ] **Step 5:** Re-run Step 3's command. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(api): a cron heartbeat port with a Better Stack adapter (D86)`.

### Task 5: Wire the heartbeat into the daily cron, and its docs

**Files:**

- Modify: `apps/api/src/ops/ops.module.ts`, `apps/api/src/ops/cron.controller.ts`
- Modify: `apps/api/test/support/auth-app.ts` (override `CRON_HEARTBEAT` with a `FakeCronHeartbeat`, expose it as `heartbeat`, clear it in `reset()`)
- Test: `apps/api/test/cron.int-spec.ts`
- Docs: `docs/deployment.md` (Monitoring table, "Daily cron", the env var table), `docs/operations.md` (a "When something breaks" row, a Credentials row), `AGENTS.md` (the port list in Layout)

**Interfaces:**

- Consumes: `CRON_HEARTBEAT`, `BetterStackCronHeartbeat`, `NO_HEARTBEAT`, `FakeCronHeartbeat` (Task 4); `ERROR_REPORTER`.

- [ ] **Step 1: Write the failing integration tests** in `cron.int-spec.ts`:
  - `pings succeeded once after an authorized run`: `t.heartbeat.pings` equals `['succeeded']`, and the response body still parses with `CleanupResultSchema`.
  - `pings nothing when unauthorized`: there's a `401`, and `pings` equals `[]`.
  - `pings failed and still fails when the cleanup throws`: make `runDaily` reject, using the test app's override or a `vi.spyOn` on the `CleanupService` instance from `t.app.get(CleanupService)`. Expect a `500` problem response and `pings` equal to `['failed']`.
- [ ] **Step 2:** `pnpm test:integration -- cron`. Expected: FAIL (`heartbeat` is undefined).
- [ ] **Step 3: Implement.**
  - The `OpsModule` provider: `inject: [ENV, ERROR_REPORTER]`, with the factory returning `BetterStackCronHeartbeat` when `CRON_HEARTBEAT_URL` is set, else `NO_HEARTBEAT`. The pattern is `TagSuggestModule`'s factory.
  - `CronController` gets `@Inject(CRON_HEARTBEAT)`. In `daily`, after the auth check: `try { const result = await this.cleanup.runDaily(); await this.heartbeat.succeeded(); return result; } catch (e) { await this.heartbeat.failed(); throw e; }`.
- [ ] **Step 4:** Re-run Step 2's command. Expected: PASS. Then `pnpm --filter @wishlist/api test`. Expected: PASS.
- [ ] **Step 5: Docs.**
  - **The heartbeat in Monitoring:** add a row to the Monitoring table ("Daily cron heartbeat", period 1 day, grace 2 hours, what it proves). Add a one-off setup paragraph there: create the heartbeat, then set the variable from a hidden prompt with the Task 3 command form, `--sensitive`.
  - **Other `deployment.md` sections:** a row in the env var table; a "Check it ran" line under "Daily cron" pointing at Better Stack.
  - **`operations.md`:** the When-something-breaks row from §3.5 and the Credentials row.
  - **`AGENTS.md`:** the cron heartbeat in the Layout ports list.
- [ ] **Step 6:** Full verification. Commit: `feat(api): the daily cron pings its heartbeat (D86)`.
- [ ] **Step 7: ⏸ Ted.**
  - Submit stack C and merge it. It's safe dark: the URL is unset, so nothing pings.
  - Create the Better Stack heartbeat "Hanker daily cron" (1 day, grace 2 h).
  - Set `CRON_HEARTBEAT_URL`, then redeploy.
  - Press Run under Vercel → wishlist-api → Cron Jobs, and check the heartbeat turns Up.
  - Then check that Sentry has no `cron heartbeat failed` warning.

## Stack D: previews in their own Neon project (§3.6, D87)

### Task 6: ⏸ Ted creates the preview project (before Task 7's preview run)

- [ ] **Step 1:** Ted creates Neon project `wishlist-preview` in organization Shockolate, with Postgres 17 and AWS us-east-1.
- [ ] **Step 2:** Ted creates a project-scoped organization API key for it. If the console doesn't offer one, stop: the §3.6 fallback needs his decision.
- [ ] **Step 3:** Ted sets the repo variable `gh variable set NEON_PRODUCTION_PROJECT_ID` to the **production** project's ID. It isn't secret. He doesn't change the `preview` secrets yet; Task 8 does.

### Task 7: The seed script and workflow for a separate project

**Files:**

- Modify: `scripts/preview-seed.sh`, `scripts/preview-seed.test.sh` (and its fixtures in `scripts/testdata/` if they need changes)
- Modify: `.github/workflows/preview-seed.yml` (drop `init_source`; pass `NEON_PRODUCTION_PROJECT_ID`), `.github/workflows/preview.yml` and `cleanup.yml` (pass the variable to every `preview-seed.sh` and `neon-sweep.sh` call)
- Modify: `scripts/neon-sweep.sh` and `scripts/neon-sweep.test.sh` (same refusal)
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`
- Docs: `docs/deployment.md` ("Previews", "Preview seed branch", "Neon", the root-branch budget, "CI/CD supply-chain hardening": the accepted Vercel risk), the spec addendum §3.3 and the main spec §10 Previews (D87 note), `AGENTS.md` if it mentions the seed's origin

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init ci/preview-neon-project`.
- [ ] **Step 2: Write the failing script tests** in `preview-seed.test.sh`:
  - `ensure` with no seed creates a body with `"parent_id":"br-main"` and **no** `init_source` key, and prints `root=false`.
  - `SEED_INIT_SOURCE=parent-data` is now ignored or rejected. Delete the old fallback cases; they are replaced by the first case and this one.
  - Every subcommand dies with a message containing `production project` when `NEON_PROJECT_ID == NEON_PRODUCTION_PROJECT_ID`. Test `ensure` and `check`.
  - In `neon-sweep.test.sh`: the same refusal for the sweep.
- [ ] **Step 3:** `bash scripts/preview-seed.test.sh && bash scripts/neon-sweep.test.sh`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Remove `SEED_INIT_SOURCE` and the `init_source` field. Create the seed as an ordinary child of the project's default branch, which is empty in `wishlist-preview`.
  - Add the guard at the top of both scripts, after the env checks: if `NEON_PRODUCTION_PROJECT_ID` is set and equal to `NEON_PROJECT_ID`, die.
  - Update the header comments (spec D87).
  - Keep the refusal to resolve to the default branch.
- [ ] **Step 5: Workflows and policy.**
  - Remove the `init_source` input and env. The wipe condition is unchanged: `root` is now always false, so it wipes every run, which costs nothing.
  - Rewrite the comment above "Wipe and rebuild from zero" for D87.
  - Policy: Rule 5 keeps "main only", "ensure before wipe" and "wipe when not root". Add: `preview-seed.yml` has no `init_source` input, and every step that runs `preview-seed.sh` or `neon-sweep.sh` has `NEON_PRODUCTION_PROJECT_ID: ${{ vars.NEON_PRODUCTION_PROJECT_ID }}` in its env.
  - Add a mutation for each.
- [ ] **Step 6:** `bash scripts/preview-seed.test.sh && bash scripts/neon-sweep.test.sh && node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`, plus actionlint. Expected: PASS.
- [ ] **Step 7: Docs.** Make the §3.6 doc changes. Include the accepted Vercel-token risk in "CI/CD supply-chain hardening", with its trigger for revisiting: someone else gets write access.
- [ ] **Step 8:** Full verification. Commit: `ci: previews in their own Neon project (D87)`.

### Task 8: ⏸ Ted's cutover

The order matters. The "Preview seed" workflow runs only on `main`, so the new script reaches the new project only after the merge. Until the seed exists there, previews fail at `provision`. That's expected: `preview` is advisory, not a required check.

- [ ] **Step 1:** Ted submits stack D. CI must be green. Its own preview runs the new script with the old secrets, which still point at production, so `provision` must **fail with the production-project refusal**. That failure is the live proof of Review Focus 4.
- [ ] **Step 2:** Ted replaces the `preview` secrets `NEON_PROJECT_ID` and `NEON_API_KEY` with the new project's values: `gh secret set … --env preview`, which prompts. Then he merges stack D.
- [ ] **Step 3:** Ted runs "Preview seed" on `main` with `reset`. Expected: it creates `preview-seed` in `wishlist-preview`, wipes it and migrates it, with every migration applied.
- [ ] **Step 4:** Ted opens a throwaway PR, or re-runs an open one. `provision`, both deploys and `smoke` must pass, and the `pr-*` branch must appear in `wishlist-preview`, not in production. Then he closes it; cleanup deletes the branch.
- [ ] **Step 5:** In the **production** project, Ted deletes `preview-seed` and any `pr-*` branches. Then he **revokes the old Neon API key**.
- [ ] **Step 6:** A week later: Neon → Usage on both projects. Previews no longer appear in production's CU-hours.

## Stack E: narrow Renovate automerge (§3.7, D88; after stack B is merged)

### Task 9: The automerge rule and its policy

**Files:**

- Modify: `renovate.json`, `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`
- Docs: `docs/deployment.md` ("CI/CD supply-chain hardening": the automerge line), `docs/operations.md` (the weekly Renovate row)

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init chore/renovate-automerge-dev-tools`.
- [ ] **Step 2: Write the failing policy.** Replace `no automerge until Ted decides…` with these checks:
  - (a) no top-level `automerge`;
  - (b) every `packageRules` entry with `automerge: true` has `matchDepTypes` exactly `["devDependencies"]`, `matchUpdateTypes` a non-empty subset of `["minor","patch"]`, `automergeType: "pr"`, and no `matchManagers` or `matchDatasources`;
  - (c) its `matchPackageNames` contains none of: `typescript`, `next`, `@nestjs/cli`, `@swc/core`, `esbuild`, `turbo`, `vercel`, `@wishlist/vercel-cli`, `@playwright/test`, `@types/node`, `undici-types` or `eslint-config-next`. It has no bare `*` or `**` pattern, and if it has `@types/**`, it also has `!@types/node`.

  Add mutations: a major in `matchUpdateTypes`; `matchDepTypes` widened to `dependencies`; `next` added to the names; a rule with `matchManagers: ["github-actions"]`; a top-level `automerge: true`.
- [ ] **Step 3:** `node scripts/workflow-policy.test.mjs`. Expected: PASS, because no automerge rule exists yet. `node scripts/workflow-policy.mutations.test.mjs`. Expected: PASS, with every new mutation caught.
- [ ] **Step 4: Add the rule.** One `packageRules` entry, with a `description` citing D88 in the file's existing style:
  - `matchDepTypes: ["devDependencies"]`, `matchUpdateTypes: ["minor","patch"]`, `automerge: true`, `automergeType: "pr"`;
  - `matchPackageNames`: the names from §3.7 **that exist in this repo**. Check them: `grep -h '"devDependencies"' -A40 package.json apps/*/package.json packages/*/package.json e2e/package.json`. Glob forms: `@types/**`, `!@types/node`, `@eslint/**`, `eslint-plugin-**`, `@vitest/**`, `@testcontainers/**`.
- [ ] **Step 5:** Validate the config:
  ```bash
  npx --yes --package renovate@<a version at least 3 days old, exact> renovate-config-validator renovate.json
  ```
  Expected: `Config validated successfully`. Then run both policy tests again. Expected: PASS.
- [ ] **Step 6: Docs.** Rewrite the automerge line from §3.7, including the accepted risk. Change the operations.md weekly row to "Review Renovate's PRs that didn't automerge, and skim what did".
- [ ] **Step 7:** Full verification. Commit: `chore(renovate): automerge dev-only tooling patches and minors (D88)`.
- [ ] **Step 8: ⏸ Ted submits and merges.** On the next Monday, check that a matching PR auto-merged after its checks, and that a non-matching one (for example a runtime dependency) didn't.

## Close-out

### Task 10: Roadmap and memory

- [ ] **Step 1:** Once stacks A–E have merged, open a small PR: the roadmap row 11 → Done, with `docs: mark Plan 11 done on the roadmap`.
- [ ] **Step 2:** Update the `plan-11-operations-hardening` memory: what merged, the main SHAs, and any open ⏸ checks (Neon usage after a week, Renovate's first automerge, the calendar reminders).
