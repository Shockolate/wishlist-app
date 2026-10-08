# Plan 1b: CI Secret Isolation & Seeded Previews — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two outcomes:

1. No secret ever sits in a job that runs workspace dependencies or PR code.
2. Preview databases come from `preview-seed`, a Neon branch that never holds production data.

**Architecture:**

- **`deploy.yml` and `preview.yml` are split into jobs by trust level.**
  - *Build jobs* run the full workspace and hold no secrets.
  - *Settings, deploy and database jobs* hold secrets but run only the pinned Vercel CLI (through `npx`, version read from `package.json`), pinned actions, and a `--prod --ignore-scripts` install for the built migrator.
- **A new `preview-seed.yml`** creates, wipes and migrates the `preview-seed` Neon branch. Every `pr-*` branch is created from it.
- **`scripts/workflow-policy.test.mjs`** enforces the trust model in CI.

**Tech Stack:** GitHub Actions (SHA-pinned), Vercel CLI 62.5.0, the Neon API v2 and `neondatabase/create-branch-action`, Drizzle's node-postgres migrator, Node 24, pnpm 12, Vitest, Testcontainers, bash and jq, `psql` (runner image, client 16).

**Spec:** [`docs/superpowers/specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md`](../specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md). It amends the [main spec](../specs/2026-10-07-wishlist-app-design.md) §10 and D12.

**Roadmap:** [`2026-10-07-roadmap.md`](2026-10-07-roadmap.md). This plan is 1b, between Plans 1 and 2.

## Global Constraints

Everything from Plan 1's Global Constraints still applies: Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`, exact version pins, Vitest, conventional commits with the `Co-Authored-By` trailer, PR bodies ending with the 🤖 line, and the ⏸ CHECKPOINT rules.

**Action pins.** Every action is pinned to these SHAs, with the version in a trailing comment:

| Action | SHA | Version |
|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| `pnpm/action-setup` | `ea17c68df8912ef543352723c149a84f56e3d413` | v6.1.0 |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v7.1.0 |
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | v7.0.2 |
| `actions/download-artifact` | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | v8.0.2 |
| `neondatabase/create-branch-action` | `fb620d43d4c565abaf088b848a4e28e5c4ea4d9c` | 6.3.1 |
| `marocchino/sticky-pull-request-comment` | `5770ad5eb8f42dd2c4f34da00c94c5381e49af88` | v3.0.5 |

**Workflow rules**

- **Checkouts:** every `actions/checkout` sets `persist-credentials: false`.
- **Shell:** every workflow sets `defaults: run: shell: bash`, which GitHub runs as `bash -eo pipefail`.
- **Where secrets go:** never at workflow level. `VERCEL_TOKEN` goes only in step-level `env`.
- **How secret-holding jobs call Vercel:** a job that references `VERCEL_TOKEN`, `NEON_API_KEY` or a `DATABASE_URL*` secret invokes Vercel only as `npx --yes vercel@"$VERCEL_CLI_VERSION"`, with `npm_config_ignore_scripts: 'true'` set on that step. Its only allowed `pnpm` command is `pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/api`.
- **The CLI version:** `VERCEL_CLI_VERSION` is read with `jq -r '.devDependencies.vercel' package.json`.
- **The one exception:** a job that runs a full `pnpm install` references no `secrets.*` at all, except `VERCEL_AUTOMATION_BYPASS_SECRET` in `preview.yml`'s `smoke` job.

**Artifacts**

- Uploads that contain Vercel output set `include-hidden-files: true`. Functions carry a `.vc-config.json` file, and uploads drop dotfiles by default.
- Every artifact uses `retention-days: 1`.
- `node_modules` is never uploaded.

**Neon**

- The seed branch is named `preview-seed`, and the database and role are `neondb` / `neondb_owner`.
- Previews are created with `parent_branch: preview-seed`.

**Migrator**

- It's invoked as `node apps/api/dist/db/migrate-cli.js` and reads only `DATABASE_URL_DIRECT`.
- It never prints the URL.

## Review Focus

These are the five failure modes the spec implies but nobody would think to test, most likely first. Each has a test in the task that owns it:

1. **A `pr-*` branch created before the switch is a production clone, and the Neon action reuses it.** A PR open across the change would keep previewing on production data. **Task 2:** `preview-seed.sh assert-child` fails, with a fix-it hint, when a branch's parent isn't `preview-seed`. **Task 4:** `provision` runs that check before migrating.
2. **"Re-run failed jobs" on an old deploy run skips `guard`.** Re-running a failed `deploy-api` would deploy a stale commit. **Task 4:** a policy rule requires every `production` job to run `scripts/assert-main-tip.sh` right after checkout, and the script has its own test.
3. **The artifact silently drops hidden files.** Without `include-hidden-files`, `.vc-config.json` files vanish and a broken deploy gets uploaded. **Task 4:** a policy rule, plus `scripts/check-vercel-output.sh` (with a test), which every deploy job runs before deploying.
4. **The migrator leaks the connection string on failure.** The URL or password could appear in an error message. **Task 1:** unit and integration tests assert stderr never contains either.
5. **`preview-seed` is missing** (never bootstrapped, or deleted), and `create-branch-action` fails with an unhelpful error. **Task 2:** `preview-seed.sh check` exits 1 naming the fix (run "Preview seed" with `reset=true`). **Task 4:** `provision` runs it first.

## Stacks

| Stack | Tasks | Branches (bottom → top) | Merges when |
|---|---|---|---|
| `ci-isolation-1` | 1–2 | `docs/ci-isolation-spec` (spec and this plan, already committed) → `ci/migrator-cli` → `ci/preview-seed` | Before Task 3. The bootstrap needs `preview-seed.yml` on `main` |
| `ci-isolation-2` | 4–5 | `ci/split-pipelines` → `docs/ci-isolation-docs` | After Task 3 |

## File Structure

```
apps/api/
├── src/db/migrate-cli.ts            NEW  CLI entry: DATABASE_URL_DIRECT → runMigrations, redacted errors
├── src/db/migrate-cli.spec.ts       NEW  unit tests (fake runner)
├── test/migrate-cli.int-spec.ts     NEW  integration: built CLI vs a fresh empty database
└── turbo.json                       NEW  test:integration also depends on the package's own build
scripts/
├── preview-seed.sh                  NEW  ensure | check | uri | describe | assert-child
├── preview-seed.test.sh             NEW
├── testdata/neon-seed/*.json        NEW  branch-listing fixtures
├── assert-main-tip.sh               NEW  stale-commit guard (shared by every production job)
├── assert-main-tip.test.sh          NEW
├── check-vercel-output.sh           NEW  fail fast if a downloaded .vercel/output is incomplete
├── check-vercel-output.test.sh      NEW
└── workflow-policy.test.mjs         MOD  rules for trust model, environments, preview data, seed safety, pipefail
.github/workflows/
├── preview-seed.yml                 NEW
├── deploy.yml                       REWRITE  guard → settings → build → migrate → deploy-api → deploy-web → smoke
├── preview.yml                      REWRITE  settings → build-api → provision → build-web → deploy-web → smoke → comment
├── ci.yml, cleanup.yml, dependency-review.yml   MOD  defaults.run.shell: bash; ci.yml runs the new script tests
docs/deployment.md, docs/superpowers/specs/2026-10-07-wishlist-app-design.md, docs/superpowers/plans/2026-10-07-roadmap.md   MOD
```

---

### Task 1: The migrator CLI

**Files:**
- Create: `apps/api/src/db/migrate-cli.ts`, `apps/api/turbo.json`
- Test: `apps/api/src/db/migrate-cli.spec.ts`, `apps/api/test/migrate-cli.int-spec.ts`

**Interfaces:**
- Consumes: `runMigrations(connectionString: string): Promise<void>` and `MIGRATIONS_DIR` from `apps/api/src/db/migrate.ts` (Plan 1, Task 5); `inject('databaseUrl')` from the integration harness.
- Produces:
  - **`migrateCli(env: NodeJS.ProcessEnv, io: MigrateCliIo): Promise<number>`**, where `MigrateCliIo = { run(url: string): Promise<void>; log(message: string): void; error(message: string): void }`.
  - **An executable entrypoint**, `node apps/api/dist/db/migrate-cli.js`: it exits `0` and prints `migrations applied` on success, and exits `1` with a redacted message otherwise.

- [ ] **Step 1: Start the stack layer**

```bash
git switch docs/ci-isolation-spec
gh stack add ci/migrator-cli
```

- [ ] **Step 2: Write the failing unit tests**

`apps/api/src/db/migrate-cli.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { migrateCli, type MigrateCliIo } from './migrate-cli.js';

function io(run: MigrateCliIo['run'] = () => Promise.resolve()) {
  const logs: string[] = [];
  const errors: string[] = [];
  const runner = vi.fn(run);
  return {
    io: { run: runner, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) },
    runner,
    logs,
    errors,
  };
}

const URL_WITH_PASSWORD = 'postgres://owner:s3cr3t-pass@ep-x.neon.tech/neondb';

describe('migrateCli', () => {
  it('refuses to run without DATABASE_URL_DIRECT', async () => {
    const t = io();
    await expect(migrateCli({}, t.io)).resolves.toBe(1);
    expect(t.runner).not.toHaveBeenCalled();
    expect(t.errors.join('\n')).toContain('DATABASE_URL_DIRECT');
  });

  it('refuses a non-postgres URL without echoing it', async () => {
    const t = io();
    await expect(migrateCli({ DATABASE_URL_DIRECT: 'mysql://u:hunter2@db/x' }, t.io)).resolves.toBe(1);
    expect(t.runner).not.toHaveBeenCalled();
    expect(t.errors.join('\n')).not.toContain('hunter2');
    expect(t.errors.join('\n')).not.toContain('mysql://');
  });

  it('runs the migrations and reports success', async () => {
    const t = io();
    await expect(migrateCli({ DATABASE_URL_DIRECT: URL_WITH_PASSWORD }, t.io)).resolves.toBe(0);
    expect(t.runner).toHaveBeenCalledWith(URL_WITH_PASSWORD);
    expect(t.logs).toEqual(['migrations applied']);
  });

  it('reports a failure without leaking the URL or its password', async () => {
    const t = io(() => Promise.reject(new Error(`could not connect to ${URL_WITH_PASSWORD}: s3cr3t-pass rejected`)));
    await expect(migrateCli({ DATABASE_URL_DIRECT: URL_WITH_PASSWORD }, t.io)).resolves.toBe(1);
    const message = t.errors.join('\n');
    expect(message).toContain('migration failed');
    expect(message).not.toContain(URL_WITH_PASSWORD);
    expect(message).not.toContain('s3cr3t-pass');
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/db/migrate-cli.spec.ts`
Expected: FAIL, because `./migrate-cli.js` can't be resolved.

- [ ] **Step 3: Implement the CLI**

`apps/api/src/db/migrate-cli.ts`:
```ts
import { pathToFileURL } from 'node:url';
import { runMigrations } from './migrate.js';

export interface MigrateCliIo {
  run(url: string): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}

const POSTGRES_URL = /^postgres(ql)?:\/\//;

/**
 * Applies the committed migrations to DATABASE_URL_DIRECT. CI jobs that hold database secrets run
 * this built file instead of drizzle-kit, so no devDependency code executes next to the secret
 * (spec addendum 2026-10-08, §4). Never prints the URL.
 */
export async function migrateCli(env: NodeJS.ProcessEnv, io: MigrateCliIo): Promise<number> {
  const url = env.DATABASE_URL_DIRECT;
  if (!url || !POSTGRES_URL.test(url)) {
    io.error('DATABASE_URL_DIRECT must be set to a postgres:// connection string');
    return 1;
  }
  try {
    await io.run(url);
    io.log('migrations applied');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(`migration failed: ${redact(message, url)}`);
    return 1;
  }
}

/** Removes the URL and its password (raw and percent-decoded) from a message. */
function redact(message: string, url: string): string {
  let out = message.split(url).join('<DATABASE_URL_DIRECT>');
  for (const secret of passwordForms(url)) out = out.split(secret).join('***');
  return out;
}

function passwordForms(url: string): string[] {
  try {
    const raw = new URL(url).password;
    return [...new Set([raw, decodeURIComponent(raw)])].filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

// Executed directly (`node dist/db/migrate-cli.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await migrateCli(process.env, {
    run: runMigrations,
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/db/migrate-cli.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Make the integration tests build the CLI first**

`apps/api/turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "extends": ["//"],
  "tasks": {
    "test:integration": {
      "dependsOn": ["^build", "build"],
      "cache": false,
      "passThroughEnv": ["DOCKER_HOST", "TESTCONTAINERS_*"]
    }
  }
}
```

**Why `build`:** `test/migrate-cli.int-spec.ts` runs the *built* `dist/db/migrate-cli.js`, which is the exact file CI ships, so the package must be built first. `cache` and `passThroughEnv` are repeated from the root config so this override keeps them.

- [ ] **Step 5: Write the failing integration test**

`apps/api/test/migrate-cli.int-spec.ts`:
```ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { openTestDatabase } from './support/database.js';

const CLI = fileURLToPath(new URL('../dist/db/migrate-cli.js', import.meta.url));
const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: unknown[];
};

const admin = openTestDatabase();
afterAll(() => admin.close());

function runCli(databaseUrl: string) {
  return spawnSync(process.execPath, [CLI], {
    env: { PATH: process.env.PATH, DATABASE_URL_DIRECT: databaseUrl },
    encoding: 'utf8',
  });
}

async function freshDatabase(): Promise<string> {
  const name = `cli_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(admin.url);
  url.pathname = `/${name}`;
  return url.toString();
}

async function appliedCount(url: string): Promise<number> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    return rows[0]?.n ?? 0;
  } finally {
    await pool.end();
  }
}

describe('migrate-cli (built)', () => {
  it('exists, because turbo builds the package before integration tests', () => {
    expect(existsSync(CLI), `missing ${CLI}; run via "pnpm turbo run test:integration"`).toBe(true);
  });

  it('applies every migration to an empty database, then nothing on a re-run', async () => {
    const url = await freshDatabase();

    const first = runCli(url);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('migrations applied');
    expect(await appliedCount(url)).toBe(journal.entries.length);

    const second = runCli(url);
    expect(second.status, second.stderr).toBe(0);
    expect(await appliedCount(url)).toBe(journal.entries.length);
  });

  it('exits 1 without leaking the URL or password when the database is unreachable', () => {
    const url = 'postgres://owner:p4ssw0rd-leak-check@127.0.0.1:1/nowhere';
    const result = runCli(url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('migration failed');
    expect(result.stderr).not.toContain('p4ssw0rd-leak-check');
    expect(result.stderr).not.toContain(url);
  });
});
```

Run, *without* building first: `rm -rf apps/api/dist && pnpm --filter @wishlist/api test:integration`
Expected: FAIL. The "exists" test reports `missing …/dist/db/migrate-cli.js`. (Docker Desktop must be running: `systemctl --user start docker-desktop`.)

- [ ] **Step 6: Run it through turbo, which builds first**

Run: `pnpm turbo run test:integration --filter=@wishlist/api`
Expected: PASS, 8 integration tests (5 existing and 3 new).

- [ ] **Step 7: Run the full gate, then commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm format:check
git add apps/api/src/db/migrate-cli.ts apps/api/src/db/migrate-cli.spec.ts apps/api/test/migrate-cli.int-spec.ts apps/api/turbo.json
git commit -F - <<'EOF'
feat(api): add a migrator CLI for secret-holding CI jobs

Runs the committed migrations against DATABASE_URL_DIRECT using only
drizzle-orm and pg, and never prints the URL, so CI jobs that hold
database secrets need no devDependencies (spec addendum 2026-10-08 §4).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate passes, and the PR's checks pass (its `integration` job builds the CLI first).

---

### Task 2: The `preview-seed` branch: script, workflow and policy

**Files:**
- Create: `scripts/preview-seed.sh`, `scripts/preview-seed.test.sh`, `scripts/testdata/neon-seed/with-seed.json`, `no-seed.json`, `seed-is-main.json`, `no-default.json`
- Create: `.github/workflows/preview-seed.yml`
- Modify: `.github/workflows/ci.yml`, `cleanup.yml`, `dependency-review.yml`, `deploy.yml`, `preview.yml` (add `defaults.run.shell: bash` only)
- Modify: `scripts/workflow-policy.test.mjs` (rules 5 and 6)

**Interfaces:**
- Consumes: `node apps/api/dist/db/migrate-cli.js` (Task 1).
- Produces `scripts/preview-seed.sh`, configured through the env vars `NEON_API_KEY`, `NEON_PROJECT_ID` and `SEED_INIT_SOURCE` (`schema-only` by default, or `parent-data`), with test seams `NEON_BRANCHES_FILE` and `DRY_RUN=1`. Its subcommands:
  - **`ensure`:** prints `id=<branch-id>` and `created=<true|false>`. It exits 1 if the result would be the default (production) branch.
  - **`check`:** prints `ok`, or exits 1 with a hint to run "Preview seed" with `reset=true`.
  - **`uri <branch-id>`:** prints the direct (unpooled) connection string.
  - **`describe <name>`:** prints `name=… id=… parent_id=<id|none> default=<bool>`.
  - **`assert-child <child> <parent>`:** prints `<child> descends from <parent> (<id>)`, or exits 1 with a fix-it hint.
- Produces the workflow `preview-seed.yml` ("Preview seed"), dispatchable with `-f reset=<bool> -f init_source=<schema-only|parent-data>`.

- [ ] **Step 1: Add the stack layer and fixtures**

```bash
gh stack add ci/preview-seed
mkdir -p scripts/testdata/neon-seed
```

`scripts/testdata/neon-seed/with-seed.json`:
```json
{
  "branches": [
    { "id": "br-main", "name": "main", "default": true },
    { "id": "br-seed", "name": "preview-seed", "default": false },
    { "id": "br-pr12", "name": "pr-12", "default": false, "parent_id": "br-seed" },
    { "id": "br-pr13", "name": "pr-13", "default": false, "parent_id": "br-main" }
  ]
}
```

`scripts/testdata/neon-seed/no-seed.json`:
```json
{
  "branches": [
    { "id": "br-main", "name": "main", "default": true },
    { "id": "br-pr13", "name": "pr-13", "default": false, "parent_id": "br-main" }
  ]
}
```

`scripts/testdata/neon-seed/seed-is-main.json`:
```json
{ "branches": [{ "id": "br-main", "name": "preview-seed", "default": true }] }
```

`scripts/testdata/neon-seed/no-default.json`:
```json
{ "branches": [{ "id": "br-seed", "name": "preview-seed", "default": false }] }
```

- [ ] **Step 2: Write the failing script test**

`scripts/preview-seed.test.sh`:
```bash
#!/usr/bin/env bash
# Verifies preview-seed.sh's decisions against branch-listing fixtures (no network).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
fx="$here/testdata/neon-seed"
seed() { "$here/preview-seed.sh" "$@"; }
fail() { echo "preview-seed: FAIL: $1" >&2; exit 1; }

out=$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed ensure)
[[ "$out" == $'id=br-seed\ncreated=false' ]] || fail "reuse existing seed: got '$out'"

err=$(NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 seed ensure 2>&1 >/dev/null)
out=$(NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 seed ensure 2>/dev/null)
[[ "$out" == $'id=dry-run\ncreated=true' ]] || fail "create when missing: got '$out'"
for want in '"name":"preview-seed"' '"parent_id":"br-main"' '"init_source":"schema-only"'; do
  [[ "$err" == *"$want"* ]] || fail "create body missing $want: $err"
done

err=$(NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 SEED_INIT_SOURCE=parent-data seed ensure 2>&1 >/dev/null)
[[ "$err" == *'"init_source":"parent-data"'* ]] || fail "fallback init_source: $err"

if NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 SEED_INIT_SOURCE=bogus seed ensure >/dev/null 2>&1; then
  fail "accepted an unknown SEED_INIT_SOURCE"
fi

if err=$(NEON_BRANCHES_FILE="$fx/seed-is-main.json" seed ensure 2>&1); then fail "returned production as the seed"; fi
[[ "$err" == *refusing* ]] || fail "seed-is-main message: $err"

if NEON_BRANCHES_FILE="$fx/no-default.json" seed ensure >/dev/null 2>&1; then fail "ran without a default branch"; fi

[[ "$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed check)" == ok ]] || fail "check with seed"
if err=$(NEON_BRANCHES_FILE="$fx/no-seed.json" seed check 2>&1); then fail "check passed without a seed"; fi
[[ "$err" == *"reset=true"* ]] || fail "check hint: $err"

out=$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed assert-child pr-12 preview-seed)
[[ "$out" == "pr-12 descends from preview-seed (br-seed)" ]] || fail "assert-child ok: '$out'"
if err=$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed assert-child pr-13 preview-seed 2>&1); then
  fail "accepted a branch cloned from production"
fi
[[ "$err" == *"close and reopen the PR"* ]] || fail "assert-child hint: $err"

out=$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed describe preview-seed)
[[ "$out" == "name=preview-seed id=br-seed parent_id=none default=false" ]] || fail "describe: '$out'"

echo "preview-seed: ok"
```

```bash
chmod +x scripts/preview-seed.test.sh
scripts/preview-seed.test.sh
```

Expected: FAIL, with `scripts/preview-seed.sh: No such file or directory`.

- [ ] **Step 3: Implement the script**

`scripts/preview-seed.sh`:
```bash
#!/usr/bin/env bash
# Manages `preview-seed`, the Neon branch every pr-* preview database is created from. It never
# holds production data (spec addendum 2026-10-08, §3.3).
#
# Usage:
#   scripts/preview-seed.sh ensure                       # prints id=<id> and created=<true|false>
#   scripts/preview-seed.sh check                        # exit 1 with a fix-it hint if it's missing
#   scripts/preview-seed.sh uri <branch-id>              # direct (unpooled) connection string
#   scripts/preview-seed.sh describe <name>              # name, id, parent_id and default flag
#   scripts/preview-seed.sh assert-child <child> <parent>
# Env: NEON_API_KEY, NEON_PROJECT_ID, SEED_INIT_SOURCE (schema-only | parent-data; default
# schema-only; parent-data is the approved fallback, §3.3).
# Test seams: NEON_BRANCHES_FILE replaces the branch listing; DRY_RUN=1 prints the create request
# to stderr instead of sending it.
set -euo pipefail

seed_name="preview-seed"
api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID:-}"
auth=(-H "Authorization: Bearer ${NEON_API_KEY:-}" -H "Accept: application/json")

die() { echo "preview-seed: $*" >&2; exit 1; }

list_branches() {
  if [[ -n "${NEON_BRANCHES_FILE:-}" ]]; then cat "$NEON_BRANCHES_FILE"; else curl -fsS "${auth[@]}" "$api/branches"; fi
}

field_by_name() { # <branches-json> <name> <field>
  jq -r --arg n "$2" --arg f "$3" '[.branches[] | select(.name == $n)][0][$f] // empty' <<<"$1"
}

wait_ready() {
  local id="$1" state=""
  for _ in $(seq 1 30); do
    state=$(curl -fsS "${auth[@]}" "$api/branches/$id" | jq -r '.branch.current_state // empty')
    [[ "$state" == "ready" ]] && return 0
    sleep 2
  done
  die "branch $id not ready after 60s (last state: ${state:-unknown})"
}

case "${1:-}" in
  ensure)
    init_source="${SEED_INIT_SOURCE:-schema-only}"
    [[ "$init_source" == schema-only || "$init_source" == parent-data ]] ||
      die "SEED_INIT_SOURCE must be schema-only or parent-data, got '$init_source'"
    branches=$(list_branches)
    main_id=$(jq -r '[.branches[] | select(.default == true)][0].id // empty' <<<"$branches")
    [[ -n "$main_id" ]] || die "no default (production) branch found"
    seed_id=$(field_by_name "$branches" "$seed_name" id)
    created=false
    if [[ -z "$seed_id" ]]; then
      body=$(jq -nc --arg n "$seed_name" --arg p "$main_id" --arg s "$init_source" \
        '{branch: {name: $n, parent_id: $p, init_source: $s}, endpoints: [{type: "read_write"}]}')
      if [[ "${DRY_RUN:-}" == "1" ]]; then
        echo "would create: $body" >&2
        seed_id="dry-run"
      else
        seed_id=$(curl -fsS -X POST "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/branches" | jq -r '.branch.id')
        wait_ready "$seed_id"
      fi
      created=true
    fi
    # The check that matters most: never hand production's branch to a job that wipes.
    [[ "$seed_id" != "$main_id" ]] || die "refusing: '$seed_name' resolved to the production branch ($main_id)"
    echo "id=$seed_id"
    echo "created=$created"
    ;;
  check)
    branches=$(list_branches)
    [[ -n "$(field_by_name "$branches" "$seed_name" id)" ]] ||
      die "the '$seed_name' branch does not exist. Run the 'Preview seed' workflow with reset=true first (docs/deployment.md)."
    echo "ok"
    ;;
  uri)
    id="${2:-}"
    [[ -n "$id" ]] || die "usage: uri <branch-id>"
    curl -fsS "${auth[@]}" "$api/connection_uri?branch_id=$id&database_name=neondb&role_name=neondb_owner&pooled=false" | jq -r '.uri'
    ;;
  describe)
    name="${2:-}"
    [[ -n "$name" ]] || die "usage: describe <name>"
    branches=$(list_branches)
    jq -r --arg n "$name" \
      '[.branches[] | select(.name == $n)][0] | "name=\(.name) id=\(.id) parent_id=\(.parent_id // "none") default=\(.default // false)"' \
      <<<"$branches"
    ;;
  assert-child)
    child="${2:-}" parent="${3:-}"
    [[ -n "$child" && -n "$parent" ]] || die "usage: assert-child <child> <parent>"
    branches=$(list_branches)
    parent_id=$(field_by_name "$branches" "$parent" id)
    [[ -n "$parent_id" ]] || die "no '$parent' branch"
    child_parent=$(field_by_name "$branches" "$child" parent_id)
    [[ "$child_parent" == "$parent_id" ]] ||
      die "'$child' does not descend from '$parent' (its parent is ${child_parent:-none}); it was probably cloned from production before previews switched to '$parent'. Delete it in Neon, or close and reopen the PR, then re-run."
    echo "$child descends from $parent ($parent_id)"
    ;;
  *) die "usage: preview-seed.sh ensure | check | uri <id> | describe <name> | assert-child <child> <parent>" ;;
esac
```

```bash
chmod +x scripts/preview-seed.sh
scripts/preview-seed.test.sh
```

Expected: `preview-seed: ok`.

- [ ] **Step 4: Write the failing policy rules (5 and 6)**

In `scripts/workflow-policy.test.mjs`, insert this block immediately **before** the line `const renovate = JSON.parse(`:
```js
// Rule 6 (spec addendum §2): every run step fails on any error in a pipeline.
for (const { file, wf } of workflows) {
  if (wf.defaults?.run?.shell !== 'bash') {
    fail(`${file}: set defaults.run.shell: bash (GitHub runs it with -eo pipefail)`);
  }
}

// Rule 5 (spec addendum §3.3): the seed job only runs on main and resolves the branch, refusing
// production, before anything can wipe it.
const seedJob = byFile['preview-seed.yml']?.jobs?.seed;
if (!String(seedJob?.if ?? '').includes("github.ref == 'refs/heads/main'")) {
  fail("preview-seed.yml#seed: must only run on main (if: github.ref == 'refs/heads/main')");
}
const seedSteps = (seedJob?.steps ?? []).map((s) => s.name);
const ensureAt = seedSteps.indexOf('Ensure the seed branch exists (never main)');
const wipeAt = seedSteps.indexOf('Wipe and rebuild from zero');
if (ensureAt === -1 || wipeAt === -1 || ensureAt > wipeAt) {
  fail('preview-seed.yml#seed: "Ensure the seed branch exists (never main)" must run before "Wipe and rebuild from zero"');
}
```

Run: `node scripts/workflow-policy.test.mjs`
Expected: FAIL. Five `defaults.run.shell` violations (one per existing workflow), plus both `preview-seed.yml#seed` violations, because the file doesn't exist yet.

- [ ] **Step 5: Add pipefail to the existing workflows**

```bash
python3 - <<'PY'
import pathlib
for f in ['ci.yml', 'cleanup.yml', 'dependency-review.yml', 'deploy.yml', 'preview.yml']:
    p = pathlib.Path('.github/workflows') / f
    s = p.read_text()
    assert s.count('\njobs:\n') == 1, f
    p.write_text(s.replace('\njobs:\n', '\ndefaults:\n  run:\n    shell: bash\n\njobs:\n'))
PY
```

- [ ] **Step 6: Write the seed workflow**

`.github/workflows/preview-seed.yml`:
```yaml
name: Preview seed

# Keeps `preview-seed` current: the Neon branch every pr-* preview database is created from. It
# never holds production data (spec addendum 2026-10-08, §3.3). Trust model (§2): `build` runs
# the workspace with no secrets; `seed` holds the Neon key and runs only the built migrator after
# a --prod --ignore-scripts install, plus curl, jq and psql.
on:
  push:
    branches: [main]
    paths: ['apps/api/drizzle/**']
  workflow_dispatch:
    inputs:
      reset:
        description: Wipe preview-seed and rebuild it by replaying every migration from zero
        type: boolean
        default: false
      init_source:
        description: How to create preview-seed if it is missing (parent-data is the approved fallback)
        type: choice
        options: [schema-only, parent-data]
        default: schema-only

concurrency:
  group: preview-seed
  cancel-in-progress: false

permissions:
  contents: read

defaults:
  run:
    shell: bash

jobs:
  build:
    name: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build the migrator
        run: pnpm turbo run build --filter=@wishlist/api
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: migrator
          path: apps/api/dist
          retention-days: 1

  seed:
    name: seed
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: preview
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      # Production dependencies only, and no install scripts: the only code that runs next to the
      # Neon key is ours plus drizzle-orm and pg.
      - run: pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/api
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: migrator
          path: apps/api/dist

      - name: Ensure the seed branch exists (never main)
        id: seed
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
          SEED_INIT_SOURCE: ${{ inputs.init_source || 'schema-only' }}
        run: scripts/preview-seed.sh ensure | tee -a "$GITHUB_OUTPUT"

      - name: Describe the seed branch
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
        run: scripts/preview-seed.sh describe preview-seed

      - name: Fetch the seed branch's direct connection string
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
          SEED_BRANCH_ID: ${{ steps.seed.outputs.id }}
        run: |
          uri=$(scripts/preview-seed.sh uri "$SEED_BRANCH_ID")
          echo "::add-mask::$uri"
          echo "SEED_DATABASE_URL=$uri" >> "$GITHUB_ENV"

      # A schema-only branch copies drizzle's journal *table* but not its rows, so it must be wiped
      # and rebuilt from zero; that also proves every migration still replays on an empty database.
      - name: Wipe and rebuild from zero
        if: steps.seed.outputs.created == 'true' || inputs.reset
        run: psql "$SEED_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

      - name: Migrate
        run: DATABASE_URL_DIRECT="$SEED_DATABASE_URL" node apps/api/dist/db/migrate-cli.js

      - name: Report contents (seed data only; empty until Plan 2)
        run: psql "$SEED_DATABASE_URL" -tAc "select 'rate_limits rows: ' || count(*) from rate_limits"
```

- [ ] **Step 7: Run the script test in CI**

In `.github/workflows/ci.yml`, change the `Script tests` step's `run:` block from:
```yaml
          scripts/vercel-url.test.sh
          node scripts/workflow-policy.test.mjs
```
to:
```yaml
          scripts/vercel-url.test.sh
          scripts/preview-seed.test.sh
          node scripts/workflow-policy.test.mjs
```

- [ ] **Step 8: Watch the policy go green, then run everything**

```bash
node scripts/workflow-policy.test.mjs
scripts/preview-seed.test.sh
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 -color
pnpm format:check
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
```

Expected: `workflow-policy: ok`, `preview-seed: ok`, actionlint prints nothing, Prettier is clean, and the gate passes.

- [ ] **Step 9: Commit and submit**

```bash
git add scripts/preview-seed.sh scripts/preview-seed.test.sh scripts/testdata/neon-seed .github/workflows scripts/workflow-policy.test.mjs
git commit -F - <<'EOF'
ci: add the preview-seed Neon branch workflow and pipefail everywhere

preview-seed is a schema-only root branch, wiped and rebuilt by replaying
every migration from zero, that every pr-* preview will branch from so
previews never hold production data (spec addendum 2026-10-08 §3.3).
preview-seed.sh refuses to resolve the seed to the production branch, and
can verify a branch descends from the seed. All workflows now run bash
with -eo pipefail (Plan 1 review M-1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: all checks green on the `ci-isolation-1` PRs. The current `preview.yml` still clones production. That's intended until Task 4.

---

### Task 3: ⏸ Merge stack 1, bootstrap `preview-seed`, verify

**Files:** none (operations).

**Interfaces:**
- Consumes: the `Preview seed` workflow (Task 2).
- Produces: a live `preview-seed` Neon branch. Task 4's previews depend on it.

- [ ] **Step 1: ⏸ CHECKPOINT — Ted reviews and merges `ci-isolation-1`**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

Expected: the deploy that this merge triggers passes. Nothing in it changes production behavior.

- [ ] **Step 2: Bootstrap the seed branch**

```bash
gh workflow run preview-seed.yml -f reset=true -f init_source=schema-only
RID=$(gh run list --workflow preview-seed.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 10
gh run view "$RID" --log | grep -E "id=|created=|name=preview-seed|DROP SCHEMA|CREATE SCHEMA|migrations applied|rate_limits rows"
```

Expected, in order:
- `id=br-…` and `created=true`
- `name=preview-seed id=br-… parent_id=none default=false`, a root branch
- the wipe's `DROP SCHEMA` and `CREATE SCHEMA`
- `migrations applied`
- `rate_limits rows: 0`

- [ ] **Step 3: Use the fallback only if the schema-only path fails**

If Step 2 fails, read the log, then apply the decision rule:
- The create request rejected `init_source`, **or**
- `uri`/`psql` reports that role `neondb_owner` or database `neondb` doesn't exist, **or**
- a later preview can't use it as a parent.

In any of those cases, use the approved fallback (spec addendum §3.3). There's nothing to clean up first: a failed create leaves no branch. If a broken `preview-seed` *was* created, ⏸ ask Ted to delete it in the Neon console. Then run:

```bash
gh workflow run preview-seed.yml -f reset=true -f init_source=parent-data
```

Re-run Step 2's checks. Expected: the same lines, except `parent_id=<main's id>`. Production data existed only between creation and the wipe step, inside that one job. Record which path was used in the PR 2 body.

- [ ] **Step 4: Re-run the seed workflow without `reset` (proves it's idempotent)**

```bash
gh workflow run preview-seed.yml -f reset=false
```

Expected: `created=false`, the wipe step is **skipped**, `migrations applied` (nothing new), and `rate_limits rows: 0`.

---

### Task 4: Split the pipelines and enforce the trust model

**Files:**
- Create: `scripts/assert-main-tip.sh`, `scripts/assert-main-tip.test.sh`, `scripts/check-vercel-output.sh`, `scripts/check-vercel-output.test.sh`
- Rewrite: `.github/workflows/deploy.yml`, `.github/workflows/preview.yml`, `scripts/workflow-policy.test.mjs`
- Modify: `.github/workflows/ci.yml` (`Script tests`)

**Interfaces:**
- Consumes: `migrate-cli.js` (Task 1); `preview-seed.sh check` and `assert-child` (Task 2); the live `preview-seed` (Task 3); `scripts/wait-for-health.sh` and `scripts/vercel-url.sh` (Plan 1).
- Produces:
  - **`scripts/assert-main-tip.sh`:** exits 0 if `$GITHUB_SHA` equals the tip of `origin/main`, otherwise 1.
  - **`scripts/check-vercel-output.sh <dir>`:** exits 0 if `<dir>/config.json` exists and at least one `.vc-config.json` is present, otherwise 1.
  - **Job names in `deploy.yml`:** `guard`, `settings`, `build`, `migrate`, `deploy-api`, `deploy-web`, `smoke`.
  - **Job names in `preview.yml`:** `settings`, `build-api`, `provision`, `build-web`, `deploy-web`, `smoke`, `comment`.

- [ ] **Step 1: Start stack 2**

```bash
git switch main && git pull --ff-only
gh stack init ci/split-pipelines
```

- [ ] **Step 2: Write the failing tests for the two new scripts**

`scripts/assert-main-tip.test.sh`:
```bash
#!/usr/bin/env bash
# Verifies assert-main-tip.sh against a throwaway origin with two commits on main.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q --bare -b main "$work/origin.git"
git clone -q "$work/origin.git" "$work/clone" 2>/dev/null
cd "$work/clone"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m one
old=$(git rev-parse HEAD)
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m two
tip=$(git rev-parse HEAD)
git push -q origin main

GITHUB_SHA="$tip" "$here/assert-main-tip.sh" >/dev/null || { echo "assert-main-tip: FAIL: rejected the tip" >&2; exit 1; }
if GITHUB_SHA="$old" "$here/assert-main-tip.sh" >/dev/null 2>&1; then
  echo "assert-main-tip: FAIL: accepted a stale commit" >&2
  exit 1
fi
echo "assert-main-tip: ok"
```

`scripts/check-vercel-output.test.sh`:
```bash
#!/usr/bin/env bash
# Verifies check-vercel-output.sh catches an output whose hidden files were dropped.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/good/functions/index.func" "$work/stripped/functions/index.func"
echo '{}' > "$work/good/config.json"
echo '{}' > "$work/good/functions/index.func/.vc-config.json"
echo '{}' > "$work/stripped/config.json"

"$here/check-vercel-output.sh" "$work/good" >/dev/null || { echo "check-vercel-output: FAIL: rejected a complete output" >&2; exit 1; }
if "$here/check-vercel-output.sh" "$work/stripped" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted an output without .vc-config.json" >&2
  exit 1
fi
if "$here/check-vercel-output.sh" "$work/missing" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted a missing directory" >&2
  exit 1
fi
echo "check-vercel-output: ok"
```

```bash
chmod +x scripts/assert-main-tip.test.sh scripts/check-vercel-output.test.sh
scripts/assert-main-tip.test.sh; scripts/check-vercel-output.test.sh
```

Expected: both FAIL with `No such file or directory` for the scripts under test.

- [ ] **Step 3: Implement both scripts**

`scripts/assert-main-tip.sh`:
```bash
#!/usr/bin/env bash
# Fails unless $GITHUB_SHA is the current tip of origin/main. Every job that touches production
# runs this right after checkout: "Re-run failed jobs" skips the `guard` job, so without it a re-run
# of an older deploy could roll production back.
set -euo pipefail

git fetch --no-tags --depth=1 origin main
tip=$(git rev-parse FETCH_HEAD)
if [[ "$tip" != "${GITHUB_SHA:?GITHUB_SHA is required}" ]]; then
  echo "::error::main is at $tip but this run is for $GITHUB_SHA; refusing to deploy a stale commit."
  exit 1
fi
echo "deploying main tip $tip"
```

`scripts/check-vercel-output.sh`:
```bash
#!/usr/bin/env bash
# Fails fast if a downloaded .vercel/output is incomplete. Functions carry a hidden
# .vc-config.json, which actions/upload-artifact drops unless include-hidden-files is set.
# Usage: scripts/check-vercel-output.sh <dir>
set -euo pipefail

dir="${1:?usage: check-vercel-output.sh <dir>}"
[[ -f "$dir/config.json" ]] || { echo "::error::$dir/config.json is missing; the build output was not downloaded" >&2; exit 1; }
if ! find "$dir" -name .vc-config.json -print -quit | grep -q .; then
  echo "::error::$dir has no .vc-config.json; hidden files were dropped from the artifact (include-hidden-files)" >&2
  exit 1
fi
echo "build output complete: $dir"
```

```bash
chmod +x scripts/assert-main-tip.sh scripts/check-vercel-output.sh
scripts/assert-main-tip.test.sh; scripts/check-vercel-output.test.sh
```

Expected: `assert-main-tip: ok` and `check-vercel-output: ok`.

- [ ] **Step 4: Rewrite the policy test with the full trust model (failing)**

Replace `scripts/workflow-policy.test.mjs` entirely with:
```js
#!/usr/bin/env node
// Asserts the CI/CD trust model (spec addendum 2026-10-08 §2, §5; Plan 1 review I-1, I-2, M-1,
// M-3) so a later edit can't quietly undo it. Run: node scripts/workflow-policy.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, '.github/workflows');
const failures = [];
const fail = (msg) => failures.push(msg);

const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((file) => ({ file, wf: parse(readFileSync(join(dir, file), 'utf8')) }));
const byFile = Object.fromEntries(workflows.map(({ file, wf }) => [file, wf]));

const VERCEL_CLI = 'npx --yes vercel@"$VERCEL_CLI_VERSION"';
const PROD_INSTALL = 'pnpm install --prod --frozen-lockfile --ignore-scripts';
const DEPLOY_SECRET = /^(VERCEL_TOKEN|NEON_API_KEY|DATABASE_URL\w*)$/;
const secretsIn = (value) => [
  ...new Set([...JSON.stringify(value ?? {}).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])),
];
const runsOf = (job) => (job.steps ?? []).map((s) => s.run ?? '').join('\n');
const isFullInstall = (runs) =>
  runs.split('\n').some((l) => /\bpnpm install\b/.test(l) && !l.includes(PROD_INSTALL));
const envName = (job) => (typeof job.environment === 'string' ? job.environment : job.environment?.name);

for (const { file, wf } of workflows) {
  // Rule 6: every run step fails on any error in a pipeline.
  if (wf.defaults?.run?.shell !== 'bash') fail(`${file}: set defaults.run.shell: bash (-eo pipefail)`);
  if (secretsIn(wf.env).length) fail(`${file}: secrets at workflow level; scope them to steps`);

  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const where = `${file}#${jobName}`;
    const secrets = secretsIn(job);
    const runs = runsOf(job);

    if (job.env && 'VERCEL_TOKEN' in job.env) fail(`${where}: VERCEL_TOKEN at job level; scope it to the steps that deploy`);

    for (const step of job.steps ?? []) {
      const uses = step.uses;
      if (!uses) continue;
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses)) fail(`${where}: action not pinned to a commit SHA: ${uses}`);
      if (uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        fail(`${where}: checkout must set persist-credentials: false`);
      }
      // Review Focus #3: functions carry a hidden .vc-config.json that uploads drop by default.
      if (uses.startsWith('actions/upload-artifact@') && /output/.test(String(step.with?.path)) && step.with?.['include-hidden-files'] !== true) {
        fail(`${where}: Vercel output contains dotfiles; upload it with include-hidden-files: true`);
      }
    }

    // Rule 1: a job that runs a full install (workspace and install-script code) holds no secrets.
    if (isFullInstall(runs)) {
      const allowed = file === 'preview.yml' && jobName === 'smoke' ? ['VERCEL_AUTOMATION_BYPASS_SECRET'] : [];
      const leaked = secrets.filter((s) => !allowed.includes(s));
      if (leaked.length) fail(`${where}: full pnpm install next to secrets (${leaked.join(', ')})`);
    }

    // Rule 2: a job holding deploy or database secrets runs only the pinned CLI and a prod install.
    if (secrets.some((s) => DEPLOY_SECRET.test(s))) {
      for (const line of runs.split('\n')) {
        if (/\bpnpm\b/.test(line) && !line.includes(PROD_INSTALL)) fail(`${where}: secret-holding job may only run "${PROD_INSTALL}": ${line.trim()}`);
        if (/\bvercel (pull|build|deploy|alias)\b/.test(line) && !line.includes(VERCEL_CLI)) fail(`${where}: invoke the Vercel CLI as ${VERCEL_CLI}: ${line.trim()}`);
      }
    }
  }
}

// Rule 3: production is reachable only from main, only by the jobs that need it, and every job
// that touches it re-checks that it is deploying main's tip (Review Focus #2).
const PROD_JOBS = ['settings', 'migrate', 'deploy-api', 'deploy-web'];
for (const [jobName, job] of Object.entries(byFile['deploy.yml']?.jobs ?? {})) {
  const where = `deploy.yml#${jobName}`;
  if (!String(job.if ?? '').includes("github.ref == 'refs/heads/main'")) fail(`${where}: must be gated with if: github.ref == 'refs/heads/main'`);
  const isProd = envName(job) === 'production';
  if (isProd !== PROD_JOBS.includes(jobName)) fail(`${where}: only ${PROD_JOBS.join(', ')} may use environment: production`);
  if (isProd || jobName === 'guard') {
    const at = (job.steps ?? []).findIndex((s) => s.run === 'scripts/assert-main-tip.sh');
    if (at !== 1) fail(`${where}: must run scripts/assert-main-tip.sh immediately after checkout`);
  }
}
for (const name of ['guard', ...PROD_JOBS, 'build', 'smoke']) {
  if (!byFile['deploy.yml']?.jobs?.[name]) fail(`deploy.yml: missing job ${name}`);
}

// Rule 4: previews skip forks and bots, branch from preview-seed, verify that, and never post the API URL.
const preview = byFile['preview.yml']?.jobs ?? {};
const settingsIf = String(preview.settings?.if ?? '');
if (!settingsIf.includes('head.repo.full_name == github.repository') || !settingsIf.includes("github.event.pull_request.user.type != 'Bot'")) {
  fail('preview.yml#settings: fork and bot PRs must not get previews');
}
for (const [jobName, job] of Object.entries(preview)) {
  if (jobName !== 'settings' && !job.needs) fail(`preview.yml#${jobName}: must need an earlier job so the fork/bot skip propagates`);
}
const provisionSteps = preview.provision?.steps ?? [];
const branchStep = provisionSteps.find((s) => String(s.uses).startsWith('neondatabase/create-branch-action@'));
if (branchStep?.with?.parent_branch !== 'preview-seed') fail('preview.yml#provision: create pr-* branches with parent_branch: preview-seed');
const runsAt = (re) => provisionSteps.findIndex((s) => re.test(s.run ?? ''));
const checkAt = runsAt(/preview-seed\.sh check/);
const childAt = runsAt(/preview-seed\.sh assert-child/);
const migrateAt = runsAt(/migrate-cli\.js/);
const branchAt = provisionSteps.indexOf(branchStep);
if (!(checkAt !== -1 && checkAt < branchAt && branchAt < childAt && childAt < migrateAt)) {
  fail('preview.yml#provision: order must be preview-seed check → create branch → assert-child → migrate');
}
const comment = (preview.comment?.steps ?? []).find((s) => String(s.uses).startsWith('marocchino/sticky-pull-request-comment@'));
if (!comment || /api_url|\/api\/health/.test(String(comment.with?.message))) fail('preview.yml#comment: post the web alias only, never the API preview URL');

// Rule 5: the seed job only runs on main and resolves the branch, refusing production, before any wipe.
const seedJob = byFile['preview-seed.yml']?.jobs?.seed;
if (!String(seedJob?.if ?? '').includes("github.ref == 'refs/heads/main'")) fail("preview-seed.yml#seed: must only run on main (if: github.ref == 'refs/heads/main')");
const seedSteps = (seedJob?.steps ?? []).map((s) => s.name);
const ensureAt = seedSteps.indexOf('Ensure the seed branch exists (never main)');
const wipeAt = seedSteps.indexOf('Wipe and rebuild from zero');
if (ensureAt === -1 || wipeAt === -1 || ensureAt > wipeAt) fail('preview-seed.yml#seed: "Ensure the seed branch exists (never main)" must run before "Wipe and rebuild from zero"');

const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
if (!renovate.extends?.includes('helpers:pinGitHubActionDigests')) fail('renovate.json: extends must include helpers:pinGitHubActionDigests');
if (!renovate.minimumReleaseAge) fail('renovate.json: minimumReleaseAge must be set');
if (JSON.stringify(renovate).includes('"automerge":true')) fail('renovate.json: no automerge until Ted decides to re-enable it');

if (failures.length > 0) {
  console.error(`workflow-policy: ${failures.length} violation(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('workflow-policy: ok');
```

Run: `node scripts/workflow-policy.test.mjs`
Expected: FAIL, with violations including:
- `deploy.yml#deploy: full pnpm install next to secrets`;
- `missing job guard` (and the other new job names);
- `preview.yml#preview: full pnpm install next to secrets`;
- `preview.yml#settings: fork and bot PRs must not get previews`;
- `preview.yml#provision: create pr-* branches with parent_branch: preview-seed`.

- [ ] **Step 5: Rewrite `deploy.yml`**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy

# Production deploys run only from main, one at a time. A deploy already running is never
# cancelled (it may be mid-migration). GitHub keeps only the newest *queued* run, so merging a
# stack of N PRs ships the tip without deploying every intermediate commit.
#
# Trust model (spec addendum 2026-10-08 §2): `build` and `smoke` run workspace code and hold no
# secrets. `settings`, `migrate`, `deploy-api` and `deploy-web` hold secrets and run only the
# pinned Vercel CLI, pinned actions, or a --prod --ignore-scripts install for the built migrator.
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: production
  cancel-in-progress: false

permissions:
  contents: read

defaults:
  run:
    shell: bash

jobs:
  guard:
    name: guard
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh

  settings:
    name: settings
    needs: guard
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment: production
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - name: Pull project settings (IDs and settings only, never env files)
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          API_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
          WEB_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
          npm_config_ignore_scripts: 'true'
        run: |
          for app in api web; do
            id_var="${app^^}_PROJECT_ID"
            VERCEL_PROJECT_ID="${!id_var}" npx --yes vercel@"$VERCEL_CLI_VERSION" pull --yes --environment=production
            mkdir -p "vercel-settings/$app"
            cp .vercel/project.json "vercel-settings/$app/project.json"
            rm -rf .vercel
          done
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: vercel-settings
          path: vercel-settings/
          retention-days: 1

  build:
    name: build
    needs: settings
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      API_ORIGIN: ${{ vars.API_PRODUCTION_ORIGIN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Runs cold: there is no remote Turborepo cache (Plan 1 review M-2).
      - name: Gates
        run: pnpm turbo run lint typecheck test
      - name: Build the migrator
        run: pnpm turbo run build --filter=@wishlist/api
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - name: Build both apps (no secrets in this job)
        run: |
          for app in api web; do
            rm -rf .vercel && mkdir -p .vercel
            cp "vercel-settings/$app/project.json" .vercel/project.json
            pnpm exec vercel build --prod
            mv .vercel/output "$app-output"
          done
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: api-output
          path: api-output
          include-hidden-files: true
          retention-days: 1
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: web-output
          path: web-output
          include-hidden-files: true
          retention-days: 1
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: migrator
          path: apps/api/dist
          retention-days: 1

  migrate:
    name: migrate
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      # Production dependencies only, and no install scripts: the only code that runs next to the
      # database secret is ours plus drizzle-orm and pg.
      - run: pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/api
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: migrator
          path: apps/api/dist
      # Before the new API ships. Migrations must be backward-compatible with the API that is
      # currently live (expand/contract, spec §10).
      - name: Migrate production database
        env:
          DATABASE_URL_DIRECT: ${{ secrets.DATABASE_URL_DIRECT }}
        run: node apps/api/dist/db/migrate-cli.js

  deploy-api:
    name: deploy-api
    needs: migrate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      API_ORIGIN: ${{ vars.API_PRODUCTION_ORIGIN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: api-output
          path: .vercel/output
      - run: scripts/check-vercel-output.sh .vercel/output
      - name: Deploy API
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
          npm_config_ignore_scripts: 'true'
        run: |
          cp vercel-settings/api/project.json .vercel/project.json
          npx --yes vercel@"$VERCEL_CLI_VERSION" deploy --prebuilt --prod --env GIT_SHA="$GITHUB_SHA"
      - name: Wait for the new API to serve traffic
        run: scripts/wait-for-health.sh "$API_ORIGIN/api/health" "$GITHUB_SHA" 180

  # After the API, so the new web app never talks to an older API.
  deploy-web:
    name: deploy-web
    needs: deploy-api
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: production
      url: ${{ vars.APP_PRODUCTION_ORIGIN }}
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: web-output
          path: .vercel/output
      - run: scripts/check-vercel-output.sh .vercel/output
      - name: Deploy web
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
          npm_config_ignore_scripts: 'true'
        run: |
          cp vercel-settings/web/project.json .vercel/project.json
          npx --yes vercel@"$VERCEL_CLI_VERSION" deploy --prebuilt --prod

  smoke:
    name: smoke
    needs: deploy-web
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium
      - name: Smoke test production
        run: pnpm --filter @wishlist/e2e test:smoke
        env:
          BASE_URL: ${{ vars.APP_PRODUCTION_ORIGIN }}
          EXPECTED_SHA: ${{ github.sha }}
```

- [ ] **Step 6: Rewrite `preview.yml`**

`.github/workflows/preview.yml`:
```yaml
name: Preview

# No `branches:` filter: every layer of a stack gets its own preview.
#
# Trust model (spec addendum 2026-10-08 §2): `build-api`, `build-web` and `comment` hold no
# secrets; `smoke` holds only the preview bypass secret; `settings`, `provision` and `deploy-web`
# hold deploy or database secrets and run only the pinned Vercel CLI, pinned actions, or a
# --prod --ignore-scripts install for the built migrator.
on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read

defaults:
  run:
    shell: bash

env:
  PR_NUMBER: ${{ github.event.pull_request.number }}
  HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  # Deterministic, so the API can be told the web origin before the web preview exists
  # (spec §10; spike C).
  WEB_ALIAS: ${{ vars.PREVIEW_ALIAS_PREFIX }}${{ github.event.pull_request.number }}.vercel.app

jobs:
  settings:
    name: settings
    # Fork PRs receive no secrets, and bot PRs (Renovate) must not run unreviewed dependency code
    # next to deploy credentials: both get CI but no preview. Every other job needs this one, so
    # the skip propagates.
    if: >-
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.user.type != 'Bot'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment: preview
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - name: Pull project settings (IDs and settings only, never env files)
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          API_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
          WEB_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
          npm_config_ignore_scripts: 'true'
        run: |
          for app in api web; do
            id_var="${app^^}_PROJECT_ID"
            VERCEL_PROJECT_ID="${!id_var}" npx --yes vercel@"$VERCEL_CLI_VERSION" pull --yes --environment=preview
            mkdir -p "vercel-settings/$app"
            cp .vercel/project.json "vercel-settings/$app/project.json"
            rm -rf .vercel
          done
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: vercel-settings
          path: vercel-settings/
          retention-days: 1

  build-api:
    name: build-api
    needs: settings
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build the migrator
        run: pnpm turbo run build --filter=@wishlist/api
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - name: Build the API preview (no secrets in this job)
        run: |
          mkdir -p .vercel
          cp vercel-settings/api/project.json .vercel/project.json
          pnpm exec vercel build
          mv .vercel/output api-output
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: api-output
          path: api-output
          include-hidden-files: true
          retention-days: 1
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: migrator
          path: apps/api/dist
          retention-days: 1

  # One job for everything that needs the branch's connection string: GitHub drops job outputs
  # that contain masked values, so the URL can't be handed to another job.
  provision:
    name: provision
    needs: build-api
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: preview
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    outputs:
      api_url: ${{ steps.api.outputs.url }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      # Production dependencies only, and no install scripts (spec addendum §2).
      - run: pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/api
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: migrator
          path: apps/api/dist
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: api-output
          path: .vercel/output

      - name: Check preview-seed exists
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
        run: scripts/preview-seed.sh check

      - name: Create or reuse the PR's database branch (from preview-seed)
        id: db
        uses: neondatabase/create-branch-action@fb620d43d4c565abaf088b848a4e28e5c4ea4d9c # 6.3.1
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch_name: pr-${{ github.event.pull_request.number }}
          parent_branch: preview-seed

      - name: Mask database credentials
        env:
          DB_URL: ${{ steps.db.outputs.db_url }}
          DB_URL_POOLED: ${{ steps.db.outputs.db_url_pooled }}
        run: |
          echo "::add-mask::$DB_URL"
          echo "::add-mask::$DB_URL_POOLED"

      # Review Focus #1: a pr-* branch created before previews switched to preview-seed is a
      # production clone, and the action above reuses existing branches.
      - name: Refuse a branch that descends from production
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
        run: scripts/preview-seed.sh assert-child "pr-$PR_NUMBER" preview-seed

      - name: Migrate the PR's database branch
        env:
          DATABASE_URL_DIRECT: ${{ steps.db.outputs.db_url }}
        run: node apps/api/dist/db/migrate-cli.js

      - run: scripts/check-vercel-output.sh .vercel/output

      - name: Deploy API preview
        id: api
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
          DATABASE_URL: ${{ steps.db.outputs.db_url_pooled }}
          npm_config_ignore_scripts: 'true'
        run: |
          cp vercel-settings/api/project.json .vercel/project.json
          # EMAIL_TRANSPORT=log: a preview never emails anyone, whatever data it holds (spec §10).
          url=$(npx --yes vercel@"$VERCEL_CLI_VERSION" deploy --prebuilt \
            --env DATABASE_URL="$DATABASE_URL" \
            --env APP_ORIGIN="https://$WEB_ALIAS" \
            --env EMAIL_TRANSPORT=log \
            --env GIT_SHA="$HEAD_SHA" | scripts/vercel-url.sh)
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Wait for the API preview
        env:
          API_URL: ${{ steps.api.outputs.url }}
        run: scripts/wait-for-health.sh "$API_URL/api/health" "$HEAD_SHA" 180

  build-web:
    name: build-web
    needs: provision
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      API_ORIGIN: ${{ needs.provision.outputs.api_url }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - name: Build the web preview (no secrets in this job)
        run: |
          mkdir -p .vercel
          cp vercel-settings/web/project.json .vercel/project.json
          pnpm exec vercel build
          mv .vercel/output web-output
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: web-output
          path: web-output
          include-hidden-files: true
          retention-days: 1

  deploy-web:
    name: deploy-web
    needs: build-web
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: preview
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Pin the Vercel CLI to the repo's version
        run: echo "VERCEL_CLI_VERSION=$(jq -r '.devDependencies.vercel' package.json)" >> "$GITHUB_ENV"
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: vercel-settings
          path: vercel-settings
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: web-output
          path: .vercel/output
      - run: scripts/check-vercel-output.sh .vercel/output
      - name: Deploy the web preview and alias it
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
          npm_config_ignore_scripts: 'true'
        run: |
          cp vercel-settings/web/project.json .vercel/project.json
          url=$(npx --yes vercel@"$VERCEL_CLI_VERSION" deploy --prebuilt | scripts/vercel-url.sh)
          npx --yes vercel@"$VERCEL_CLI_VERSION" alias set "$url" "$WEB_ALIAS"

  smoke:
    name: smoke
    needs: deploy-web
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: preview
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium
      # The one exception to "no secrets next to a full install" (spec addendum §3.4): the bypass
      # secret only unlocks viewing protected previews, which hold seed data, never production data.
      - name: Smoke test the preview
        run: pnpm --filter @wishlist/e2e test:smoke
        env:
          BASE_URL: https://${{ env.WEB_ALIAS }}
          EXPECTED_SHA: ${{ env.HEAD_SHA }}
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}

  comment:
    name: comment
    needs: smoke
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      pull-requests: write
    steps:
      - name: Comment preview links
        uses: marocchino/sticky-pull-request-comment@5770ad5eb8f42dd2c4f34da00c94c5381e49af88 # v3.0.5
        with:
          header: preview
          message: |
            **Preview** for ${{ env.HEAD_SHA }}

            - Web: https://${{ env.WEB_ALIAS }} (Vercel login required)
            - Database: Neon branch `pr-${{ env.PR_NUMBER }}`, created from `preview-seed` (seed data only, never production). Email is log-only.
```

- [ ] **Step 7: Run the new script tests in CI**

In `.github/workflows/ci.yml`, change the `Script tests` step's `run:` block from:
```yaml
          scripts/preview-seed.test.sh
          node scripts/workflow-policy.test.mjs
```
to:
```yaml
          scripts/preview-seed.test.sh
          scripts/assert-main-tip.test.sh
          scripts/check-vercel-output.test.sh
          node scripts/workflow-policy.test.mjs
```

- [ ] **Step 8: Watch the policy go green, then run everything**

```bash
node scripts/workflow-policy.test.mjs
for t in scripts/*.test.sh; do "$t"; done
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 -color
pnpm format:check
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
```

Expected: `workflow-policy: ok`, every script test `ok`, actionlint silent, Prettier clean, and the gate passing.

- [ ] **Step 9: Commit and submit; this PR's own preview is the end-to-end test**

```bash
git add .github/workflows scripts
git commit -F - <<'EOF'
ci: split deploy and preview into secret-free build jobs and minimal secret jobs

Build jobs run the workspace with no secrets; settings/deploy/database jobs
hold secrets but run only the pinned Vercel CLI, pinned actions, or a
--prod --ignore-scripts install for the built migrator. Previews now branch
from preview-seed (never production data), verify that, and no longer post
the API URL. Every production job re-checks it is deploying main's tip, and
every deploy checks the downloaded build output is complete. The workflow
policy test enforces all of it (spec addendum 2026-10-08).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Then verify on the PR:
```bash
PR=$(gh pr list --head ci/split-pipelines --json number --jq '.[0].number')
gh pr checks "$PR" --watch --interval 20
RID=$(gh run list --workflow preview.yml --branch ci/split-pipelines --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RID" --log | grep -E "descends from preview-seed|migrations applied|build output complete"
gh pr view "$PR" --json comments --jq '.comments[] | select(.body | contains("**Preview**")) | .body'
```

Expected:
- All checks are green, including the seven preview jobs.
- The log shows `pr-<n> descends from preview-seed (br-…)`, `migrations applied`, and `build output complete` (twice).
- The comment shows the web alias and `created from preview-seed`, and **no** API URL.

---

### Task 5: Spec, deployment guide and roadmap

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`, `docs/deployment.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`

**Interfaces:**
- Consumes: everything above. Produces: docs only.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add docs/ci-isolation-docs
```

- [ ] **Step 2: Amend the main spec (§10 and the decision log)**

```bash
python3 - <<'PY'
p = 'docs/superpowers/specs/2026-10-07-wishlist-app-design.md'
s = open(p).read()
def swap(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)

swap("| Preview (per PR) | Vercel preview, **protected** | Vercel preview, unprotected | Neon branch `pr-<n>`, cloned from prod | **Log only, never sent** |",
     "| Preview (per PR) | Vercel preview, **protected** | Vercel preview, unprotected | Neon branch `pr-<n>`, created from `preview-seed` (never holds production data) | **Log only, never sent** |")
swap("- **Why preview email is log-only.** The preview database is cloned from production, so sending would mean real people get emails triggered by tests.",
     "- **Why preview email is log-only.** Preview databases hold only seed data, but log-only email means a preview can never send mail to anyone, whatever data it holds.\n"
     "- **Why previews never clone production.** API previews are public and run unreviewed PR code, so preview databases branch from `preview-seed`, a schema-only root branch rebuilt from the migrations ([addendum 2026-10-08](2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)).")
old_preview = s[s.index("| `preview.yml` | PR opened, synchronized or reopened |"):]
old_preview = old_preview[:old_preview.index("\n")]
swap(old_preview, "| `preview.yml` | PR opened, synchronized or reopened | `settings` (pull project settings) → `build-api` (no secrets) → `provision` (check `preview-seed` → create or reuse `pr-<n>` from it → assert it descends from `preview-seed` → migrate with the built migrator → deploy the API preview → wait for health) → `build-web` (no secrets) → `deploy-web` (deploy, alias) → `smoke` → `comment` (web alias only). Concurrency `preview-<n>`, cancel-in-progress |")
old_deploy = s[s.index("| `deploy.yml` | Push to `main` |"):]
old_deploy = old_deploy[:old_deploy.index("\n")]
swap(old_deploy, "| `deploy.yml` | Push to `main` | `guard` (stale-commit check) → `settings` → `build` (gates and `vercel build` for both apps, no secrets) → `migrate` (built migrator) → `deploy-api` → health → `deploy-web` → `smoke` → upload Sentry source maps (Plan 5). Every production job re-checks it is deploying `main`'s tip. Concurrency `production`, `cancel-in-progress: false` |")
old_cleanup = s[s.index("| `cleanup.yml` | PR closed; nightly |"):]
old_cleanup = old_cleanup[:old_cleanup.index("\n")]
swap(old_cleanup, old_cleanup + "\n| `preview-seed.yml` | Manual (`reset`, `init_source`); push to `main` touching migrations | Ensure `preview-seed` exists (schema-only root branch, never `main`) → wipe and replay migrations from zero when created or reset → migrate incrementally otherwise |")
swap("| D12 | Per-PR previews with Neon branches | Shared staging; prod only |",
     "| D12 | Per-PR previews on Neon branches created from `preview-seed`, which never holds production data (amended 2026-10-08) | Clone production (the original D12, superseded by review finding I-4); shared staging; prod only |")
old_d23 = s[s.index("| D23 |"):]
old_d23 = old_d23[:old_d23.index("\n")]
swap(old_d23, old_d23
     + "\n| D24 | Secret-free build jobs; secrets only in jobs that run the pinned Vercel CLI, pinned actions, or a `--prod --ignore-scripts` install (2026-10-08) | One job with step-scoped secrets |"
     + "\n| D25 | `preview-seed` as a schema-only root branch, wiped and migrated from zero, refreshed in place (2026-10-08) | Clone of production then anonymized; a schema-only root branch per PR (exceeds Neon Free's 3 root branches) |")
open(p, 'w').write(s)
PY
grep -nE "preview-seed|D24|D25" docs/superpowers/specs/2026-10-07-wishlist-app-design.md | cut -c1-120
```

Expected: matches for the environments row, the new bullet, the three workflow rows, D12, D24 and D25.

- [ ] **Step 3: Update `docs/deployment.md`**

```bash
python3 - <<'PY'
p = 'docs/deployment.md'
s = open(p).read()
def section(title):
    start = s.index(f"## {title}\n")
    end = s.index("\n## ", start + 1) + 1
    return s[start:end]

new_cd = """## Continuous deployment

`.github/workflows/deploy.yml` runs on every push to `main`, one at a time, as separate jobs split by trust level ([addendum 2026-10-08](superpowers/specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)):

| Job | Secrets | Does |
|---|---|---|
| `guard` | none | Refuses a stale commit (`scripts/assert-main-tip.sh`) |
| `settings` | `VERCEL_TOKEN` | `vercel pull` for both projects; passes on only each `project.json` |
| `build` | **none** | Gates, then `vercel build --prod` for the API and the web app, and the migrator |
| `migrate` | `DATABASE_URL_DIRECT` | `--prod --ignore-scripts` install, then `node apps/api/dist/db/migrate-cli.js` |
| `deploy-api` | `VERCEL_TOKEN` | `deploy --prebuilt --prod`, then waits until `/api/health` reports the commit |
| `deploy-web` | `VERCEL_TOKEN` | `deploy --prebuilt --prod` |
| `smoke` | none | Playwright smoke tests against the production origin |

**How the jobs are kept safe:**
- **Secret-holding jobs run almost nothing.** Only the pinned Vercel CLI runs, through `npx`, at the version in the root `package.json`; never `pnpm exec`.
- **Every job that touches production re-checks the commit.** It confirms it's deploying `main`'s tip, because "Re-run failed jobs" skips `guard`.
- **Every deploy job checks its build output first** (`scripts/check-vercel-output.sh`).

A deploy that's already running is never cancelled. Of the runs queued behind it, only the newest is kept, so merging a stack ships its tip once.

If a deploy fails after `migrate`, production still runs the previous code against the new schema. That's safe by construction, because every migration is backward-compatible (expand/contract). Fix forward, or roll back the code (see Rollback).

"""
new_previews = """## Previews

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

"""
s = s.replace(section("Continuous deployment"), new_cd)
s = s.replace(section("Previews"), new_previews)
old_open = s[s.index("**Still open (needs a decision):**"):]
old_open = old_open[:old_open.index("\n") + 1]
s = s.replace(old_open, "**Done (2026-10-08):** each pipeline is split into secret-free build jobs and deploy-only jobs (see Continuous deployment and Previews).\n")
open(p, 'w').write(s)
PY
grep -nE "^## |Done \(2026-10-08\)" docs/deployment.md
```

Expected: headings `Continuous deployment`, `Previews`, `Preview seed branch` (new), the rest unchanged, and the "Done (2026-10-08)" line replacing "Still open".

- [ ] **Step 4: Add Plan 1b to the roadmap**

```bash
python3 - <<'PY'
p = 'docs/superpowers/plans/2026-10-07-roadmap.md'
s = open(p).read()
row1 = s[s.index("| 1 | [Walking skeleton"):]
row1 = row1[:row1.index("\n")]
assert s.count(row1) == 1
s = s.replace(row1, row1 + "\n| 1b | [CI secret isolation & seeded previews](2026-10-08-plan-1b-ci-isolation-and-seeded-previews.md) | §10 (amended), [addendum 2026-10-08](../specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md) | Secret-free build jobs and deploy-only secret jobs; built migrator; `preview-seed` Neon branch; previews never clone production; trust model enforced by the policy test | Done |")
open(p, 'w').write(s)
PY
grep -n "| 1b |" docs/superpowers/plans/2026-10-07-roadmap.md | cut -c1-80
```

- [ ] **Step 5: Format, commit and submit**

```bash
pnpm format:check
git add docs/superpowers/specs/2026-10-07-wishlist-app-design.md docs/deployment.md docs/superpowers/plans/2026-10-07-roadmap.md
git commit -F - <<'EOF'
docs: amend spec D12, add D24-D25, and document the split pipelines and preview-seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: all checks green on both `ci-isolation-2` PRs.

---

### Task 6: ⏸ Merge stack 2 and verify production

**Files:** none (operations).

- [ ] **Step 1: ⏸ CHECKPOINT — Ted reviews and merges `ci-isolation-2`**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 2: Watch the first split production deploy**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15
gh run view "$RID" --json conclusion,jobs --jq '"conclusion: " + .conclusion, (.jobs[] | "  " + .conclusion + "  " + .name)'
curl -fsS "$(gh variable get APP_PRODUCTION_ORIGIN)/api/health"
```

Expected:
- `conclusion: success`, with all seven jobs (`guard`, `settings`, `build`, `migrate`, `deploy-api`, `deploy-web`, `smoke`) succeeding.
- Production health reports `sha` equal to `git rev-parse HEAD`, with `db.ok`.

- [ ] **Step 3: Confirm the cleanup removed the merged PRs' branches**

```bash
gh workflow run cleanup.yml -f dry_run=true
```

Expected: the dry run lists no `pr-*` branches for the merged PRs. Their `delete-pr-branch` jobs ran when they closed.
