# Plan 5a — Backups & uptime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hanker's data can be recovered from an encrypted nightly dump up to 30 days old, a restore drill proves it, and Ted hears by email when the site, the database or the backup stops working.

**Architecture:**
- **API, one additive route (layer `api/health-live`).** `GET /api/health/live` returns `{ status: 'ok', sha }` and never touches the database, so a check every 3 minutes can't keep Neon awake (D47).
- **Backup (layer `ops/backup`).** `backup.yml` runs nightly and by hand in the `production` environment, and calls `scripts/backup.sh`. The script dumps production as the read-only `hanker_backup` role (D48) from a digest-pinned `postgres:17-alpine` image, encrypts it in the pipe with a checksum-pinned `age`, uploads it to R2 with the runner's `curl --aws-sigv4`, checks the stored size, and pings the Better Stack heartbeat, or its `/fail` URL on any error. The workflow policy test gains rules for `backup.yml`.
- **Restore drill (layer `ops/restore-drill`).** `scripts/restore-drill.sh` runs on Ted's machine. It decrypts a dump with his offline key and restores it into a throwaway, in-memory `postgres:17-alpine` container, then checks it against production's `/api/health` (D49). `--keep` leaves the container running for a real recovery.
- **Runbooks.** `docs/deployment.md` gains Backups, Restore drill and recovery, and Monitoring sections. Every account, secret and setting in them is Ted's to create.

**Tech Stack:** Bash, GitHub Actions, Docker (`postgres:17-alpine`), `age` v1.3.2, curl's SigV4 signing, Cloudflare R2's S3 API, Better Stack (uptime monitors and heartbeats), NestJS 12, Zod 4, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §10 Workflows (`backup.yml`), Recovery ("Backups and the restore drill"), Monitoring and maintenance, Secrets; decisions D46–D49. It was amended for this plan in `08a45d7`. Also [the CI isolation addendum](../specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md) §2, whose trust model the backup job lives under.

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1–4b still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`. Relative imports in `api` and `contracts` end in `.js`.
- Exact version pins. **No new npm dependency in this plan.**
- Explicit `@Inject(…)` on every Nest constructor parameter.
- Behavior changes are written test-first. Every script in `scripts/` has a `*.test.sh`, and CI's "Script tests" step runs it.
- Touching `.github/workflows/` or `scripts/` means running `node scripts/workflow-policy.test.mjs`, `node scripts/workflow-policy.mutations.test.mjs`, the changed script's `*.test.sh`, and actionlint (the pinned command is in `.github/workflows/ci.yml`).
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it: replace `<the model that wrote this commit>` in the commit steps below, e.g. `Claude Sonnet 5.5`.

**The secret rules (AGENTS.md "Never", spec §10).**
- No secret ever appears on a command line, in a log or in an Actions artifact. `backup.sh` passes the database URL to `pg_dump` through the container's environment and the R2 credentials to `curl` on stdin, and its test proves neither reaches argv.
- A job that holds secrets runs only pinned tools: the `postgres:17-alpine` image by digest, `age` by sha256, and the runner's own `curl`, `tar` and `docker`. No `pnpm`, `npx` or `node`, and no caches.
- **Nothing in Tasks 1–6 creates or changes a cloud resource, a secret or a production setting.** Task 7 lists Ted's steps; the controller only verifies them.

**Pins, verified 2026-10-19:**
- `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`: Postgres 17.11, built 2026-09-17. One file, `scripts/postgres-image`, holds it for both scripts.
- `age` `v1.3.2` (released 2026-08-29), `age-v1.3.2-linux-amd64.tar.gz`, sha256 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`. It matches the digest GitHub publishes for the asset.
- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, as in every other workflow.

**Docker etiquette (AGENTS.md).** The drill and its manual checks touch only containers they create, named `hanker-restore-drill-*` and labeled `hanker.restore-drill=1`. They remove them with `docker rm -fv`, so the image's anonymous data volume goes too.

## Review Focus

These are the failure modes most likely to hurt someone that the spec implies but no happy-path test would catch. Each one has a pinned test in the task named.

1. **The restored production data outlives the drill.** The `postgres` image declares a `VOLUME` for its data directory, so `docker rm -f` without `-v` leaves an anonymous volume holding real user data on Ted's disk. Pinned in Task 5: the run uses `--tmpfs` for the data directory and `/tmp`, and the removal is `docker rm -fv` of the container this run created, on success and on every failure.
2. **The drill passes against a half-started server.** While `initdb` runs, the image starts a temporary server on the Unix socket only, then restarts it. A socket readiness check can pass, and then the restore hits the restart. Pinned in Task 5: every `pg_isready` goes over TCP (`-h 127.0.0.1`).
3. **A secret reaches a command line.** Process listings and error messages print argv. Pinned in Task 2: the database URL and the R2 secret appear in no stubbed command's argv, and the credentials reach `curl` only through `--config -`.
4. **A failure that alerts nobody.** A dump that dies mid-stream, an `age` output without its header, a size mismatch after upload, or a missing secret must each end the run non-zero, upload nothing that's wrong, and ping `/fail`. Pinned in Task 2, one case each.
5. **A drill that "passes" against the wrong data.** A dump older than the latest migration, or a restore that dropped a table, must fail with a message saying what to do. Pinned in Task 5: a migration mismatch says "use a newer dump", and a table missing from the restore fails.

---

## Layers

| Layer | Branch | Tasks |
|---|---|---|
| 1 | `docs/plan-5a` | The spec amendment (`08a45d7`) and this plan |
| 2 | `api/health-live` | Task 1 |
| 3 | `ops/backup` | Tasks 2, 3, 4 |
| 4 | `ops/restore-drill` | Tasks 5, 6 |

Task 7 is the go-live checkpoint after Ted merges the stack.

---

### Task 1: `GET /api/health/live`

**Files:**
- Modify: `packages/contracts/src/health.ts`
- Modify: `packages/contracts/src/health.spec.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.controller.spec.ts`
- Modify: `apps/api/test/health.int-spec.ts`

**Interfaces:**
- Produces: `LiveResponseSchema` and `type LiveResponse = { status: 'ok'; sha: string }` from `@wishlist/contracts`. `GET /api/health/live` → `200`, `Cache-Control: no-store`, a `LiveResponse` body. Better Stack's "Live" monitor (Task 6 docs) polls it through `https://hanker.dev`.

- [ ] **Step 1: Write the failing contract test**

Append to `packages/contracts/src/health.spec.ts` (keep the existing `describe`; add `LiveResponseSchema` to its import from `./health.js`):

```ts
describe('LiveResponseSchema', () => {
  it('accepts ok with the deployed commit', () => {
    const body = { status: 'ok', sha: 'abc123' };
    expect(LiveResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects anything but ok, and an empty sha', () => {
    expect(LiveResponseSchema.safeParse({ status: 'degraded', sha: 'abc123' }).success).toBe(false);
    expect(LiveResponseSchema.safeParse({ status: 'ok', sha: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, `LiveResponseSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `packages/contracts/src/health.ts`:

```ts
/**
 * GET /api/health/live: the API function is up. It never touches the database, so the frequent
 * uptime check can't keep Neon awake past its free compute quota (spec §10 Monitoring, D47).
 */
export const LiveResponseSchema = z.object({
  status: z.literal('ok'),
  sha: z.string().min(1),
});

export type LiveResponse = z.infer<typeof LiveResponseSchema>;
```

Run: `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`
Expected: PASS, and the build succeeds (the API imports the built package).

- [ ] **Step 4: Write the failing controller tests**

In `apps/api/src/health/health.controller.spec.ts`, add `LiveResponseSchema` to the `@wishlist/contracts` import and append:

```ts
describe('GET /api/health/live', () => {
  it('reports ok with the deployed commit, never cached, without asking the database', async () => {
    let checks = 0;
    const db: DbHealth = {
      check: () => {
        checks += 1;
        return Promise.resolve({ ok: false });
      },
    };
    app = await createUnitApp({
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: testEnv({ GIT_SHA: 'abc123' }) },
        { provide: DB_HEALTH, useValue: db },
      ],
    });
    const res = await http(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(LiveResponseSchema.parse(res.body)).toEqual({ status: 'ok', sha: 'abc123' });
    expect(checks).toBe(0);
  });
});
```

The fake database reports "down" on purpose: if the route ever consulted it, the status or the call count would give it away.

- [ ] **Step 5: Write the failing integration test**

In `apps/api/test/health.int-spec.ts`, add `LiveResponseSchema` to the `@wishlist/contracts` import and add inside the existing `describe`:

```ts
  it('answers live at once while the database is unreachable', async () => {
    app = await createTestApp({
      databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
      env: { GIT_SHA: 'int-sha' },
    });
    const started = Date.now();
    const res = await http(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(LiveResponseSchema.parse(res.body)).toEqual({ status: 'ok', sha: 'int-sha' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm --filter @wishlist/api test -- health.controller`
Expected: FAIL with `404` for `/api/health/live`.

- [ ] **Step 7: Add the route**

In `apps/api/src/health/health.controller.ts`, change the contracts import to `import type { HealthResponse, LiveResponse } from '@wishlist/contracts';` and add after `get()`:

```ts
  /**
   * For the uptime check that runs every few minutes (D47). It never touches the pool: checking
   * /api/health that often would keep Neon awake past its free compute quota.
   */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LiveResponse {
    return { status: 'ok', sha: this.env.GIT_SHA };
  }
```

- [ ] **Step 8: Run the unit and integration tests**

Run: `pnpm --filter @wishlist/api test -- health.controller`
Expected: PASS (3 tests).

Run: `pnpm --filter @wishlist/api test:integration -- health` (Docker must be running)
Expected: PASS (3 tests).

- [ ] **Step 9: Run what CI runs**

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: all tasks succeed.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src/health.ts packages/contracts/src/health.spec.ts \
  apps/api/src/health/health.controller.ts apps/api/src/health/health.controller.spec.ts \
  apps/api/test/health.int-spec.ts
git commit -m "feat(api): add /api/health/live, an uptime check that never wakes the database

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 2: `scripts/backup.sh`

**Files:**
- Create: `scripts/postgres-image`
- Create: `scripts/backup.sh` (executable)
- Create: `scripts/backup.test.sh` (executable)
- Modify: `.github/workflows/ci.yml` (the "Script tests" step)

**Interfaces:**
- Produces: `scripts/backup.sh`, no arguments. It reads `DATABASE_URL_BACKUP`, `AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `BACKUP_HEARTBEAT_URL` from the environment; all are required. It needs `docker`, `age` and `curl` on `PATH`. It uploads `daily/<YYYY-MM-DDTHHMMSSZ>.dump.age` to the bucket. Task 3's workflow calls it.
- Produces: `scripts/postgres-image`, one line, the digest-pinned image. Task 5 reads it too.

- [ ] **Step 1: Pin the image**

Create `scripts/postgres-image` containing exactly this line:

```
postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
```

- [ ] **Step 2: Write the failing test**

Create `scripts/backup.test.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Verifies backup.sh with docker, age and curl stubbed on PATH: the steps' order, that no secret
# reaches a command line, and that every failure uploads nothing wrong and reports to /fail.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bin="$tmp/bin"
mkdir -p "$bin"

cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [[ "${STUB_DUMP_FAILS:-}" == 1 ]]; then printf 'PGDMP-partial'; exit 1; fi
printf 'PGDMP-fake-dump'
EOF
cat > "$bin/age" <<'EOF'
#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
[[ "${STUB_NO_AGE_HEADER:-}" == 1 ]] || printf 'age-encryption.org/v1\n'
cat
EOF
cat > "$bin/curl" <<'EOF'
#!/usr/bin/env bash
args=" $* "
echo "curl $*" >> "$STUB_LOG"
if [[ "$args" == *" --config - "* ]]; then cat >> "$STUB_CONFIG"; fi
upload=
while (( $# )); do
  if [[ "$1" == -T ]]; then upload="$2"; fi
  shift
done
if [[ -n "$upload" ]]; then stat -c %s "$upload" > "$STUB_UPLOADED"; fi
if [[ "$args" == *" --head "* ]]; then
  printf 'HTTP/1.1 200 OK\r\ncontent-length: %s\r\n\r\n' "${STUB_STORED_SIZE:-$(cat "$STUB_UPLOADED")}"
fi
EOF
chmod +x "$bin"/*

export STUB_LOG="$tmp/log" STUB_CONFIG="$tmp/config" STUB_UPLOADED="$tmp/uploaded"
db_secret='db-secret-123'
r2_secret='r2-secret-456'
heartbeat='https://uptime.example/api/v1/heartbeat/hb-token'

# Runs backup.sh with every variable set; extra NAME=value arguments override them. Prints the status.
run() {
  : > "$STUB_LOG"
  : > "$STUB_CONFIG"
  rm -f "$STUB_UPLOADED"
  local status=0
  env PATH="$bin:$PATH" \
    DATABASE_URL_BACKUP="postgres://hanker_backup:$db_secret@ep-x.neon.tech/neondb?sslmode=require" \
    AGE_RECIPIENT=age1test R2_ACCOUNT_ID=acct R2_ACCESS_KEY_ID=akid \
    R2_SECRET_ACCESS_KEY="$r2_secret" R2_BUCKET=bucket BACKUP_HEARTBEAT_URL="$heartbeat" \
    "$@" "$here/backup.sh" > "$tmp/out" 2>&1 || status=$?
  echo "$status"
}
fail() {
  echo "backup.test: $*" >&2
  echo "--- output" >&2; cat "$tmp/out" >&2
  echo "--- commands" >&2; cat "$STUB_LOG" >&2
  exit 1
}
uploaded() { grep -q -- ' -T ' "$STUB_LOG"; }
pinged_ok() { grep -q -- " $heartbeat\$" "$STUB_LOG"; }
pinged_fail() { tail -n 1 "$STUB_LOG" | grep -q -- " $heartbeat/fail\$"; }

grep -Eqx 'postgres:17-alpine@sha256:[0-9a-f]{64}' "$here/postgres-image" \
  || fail "scripts/postgres-image must pin postgres:17-alpine by digest"

# A clean run: dump → encrypt → upload → size check → heartbeat, in that order.
[[ $(run) == 0 ]] || fail "a clean run should succeed"
mapfile -t lines < "$STUB_LOG"
[[ ${#lines[@]} == 5 ]] || fail "expected dump, encrypt, upload, size check, heartbeat"
[[ ${lines[0]} == "docker run --rm -e DATABASE_URL_BACKUP $(cat "$here/postgres-image") "* ]] \
  || fail "dump with the pinned image, the URL passed by name only"
[[ ${lines[1]} == "age -r age1test" ]] || fail "encrypt to AGE_RECIPIENT"
[[ ${lines[2]} =~ \ -T\ .*\ https://acct\.r2\.cloudflarestorage\.com/bucket/daily/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$ ]] \
  || fail "upload to the bucket under daily/<timestamp>.dump.age"
[[ ${lines[3]} == *" --head "* ]] || fail "check the stored object after uploading"
[[ ${lines[4]} == *" $heartbeat" ]] || fail "ping the heartbeat last"
! grep -q '/fail' "$STUB_LOG" || fail "a clean run must not report a failure"
! grep -qF -e "$db_secret" -e "$r2_secret" "$STUB_LOG" || fail "a secret reached a command line"
grep -qxF 'user = "akid:r2-secret-456"' "$STUB_CONFIG" || fail "R2 credentials go to curl on stdin"

# Review Focus #4: each failure uploads nothing wrong and reports to /fail.
[[ $(run STUB_DUMP_FAILS=1) != 0 ]] || fail "a failed dump must fail the run"
! uploaded || fail "a failed dump must not be uploaded"
pinged_fail || fail "a failed dump must ping /fail"

[[ $(run STUB_NO_AGE_HEADER=1) != 0 ]] || fail "output without the age header must fail the run"
! uploaded || fail "output without the age header must never be uploaded"
pinged_fail || fail "a missing age header must ping /fail"

[[ $(run STUB_STORED_SIZE=1) != 0 ]] || fail "a size mismatch after upload must fail the run"
! pinged_ok || fail "a size mismatch must not ping success"
pinged_fail || fail "a size mismatch must ping /fail"

[[ $(run R2_BUCKET=) != 0 ]] || fail "a missing R2_BUCKET must fail the run"
! grep -q '^docker ' "$STUB_LOG" || fail "a missing variable must stop the run before the dump"
pinged_fail || fail "a missing variable must ping /fail"

[[ $(run BACKUP_HEARTBEAT_URL=) != 0 ]] || fail "a missing BACKUP_HEARTBEAT_URL must fail the run"
[[ ! -s "$STUB_LOG" ]] || fail "without a heartbeat URL nothing may run"

echo "backup: ok"
```

- [ ] **Step 3: Run it and watch it fail**

Run: `scripts/backup.test.sh`
Expected: FAIL with `backup.test: a clean run should succeed`; the output shows `backup.sh: No such file or directory`.

- [ ] **Step 4: Write the script**

Create `scripts/backup.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Nightly backup (spec §10 Recovery; D47, D48). Dumps production as the read-only role, encrypts
# the dump in the pipe with age, uploads it to R2, checks the stored size, and pings the Better
# Stack heartbeat. Any failure pings the heartbeat's /fail URL, so a broken backup alerts that night.
# Usage: scripts/backup.sh
# Env:   DATABASE_URL_BACKUP, AGE_RECIPIENT, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#        R2_BUCKET, BACKUP_HEARTBEAT_URL (all required)
set -euo pipefail

: "${BACKUP_HEARTBEAT_URL:?BACKUP_HEARTBEAT_URL must be set}"
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)

finish() {
  local status=$?
  rm -rf "$work"
  if (( status != 0 )); then
    curl -fsS --max-time 10 --retry 3 -o /dev/null "$BACKUP_HEARTBEAT_URL/fail" \
      || echo "::warning::couldn't report the failure to the backup heartbeat" >&2
  fi
  exit "$status"
}
trap finish EXIT

for name in DATABASE_URL_BACKUP AGE_RECIPIENT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::$name must be set" >&2
    exit 1
  fi
done

pg_image=$(<"$here/postgres-image")
key="daily/$(date -u +%Y-%m-%dT%H%M%SZ).dump.age"
url="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}"
file="$work/backup.dump.age"

# The URL reaches pg_dump through the container's environment, never argv, and the plaintext
# exists only inside the pipe.
docker run --rm -e DATABASE_URL_BACKUP "$pg_image" \
  sh -c 'exec pg_dump --dbname="$DATABASE_URL_BACKUP" --format=custom --no-owner --no-privileges' \
  | age -r "$AGE_RECIPIENT" > "$file"

if [[ "$(head -c 21 "$file")" != "age-encryption.org/v1" ]]; then
  echo "::error::the dump isn't age-encrypted; refusing to upload it" >&2
  exit 1
fi
size=$(stat -c %s "$file")

# Signs requests for R2's S3 API. The credentials reach curl on stdin, never argv. The payload
# hash is sent explicitly so the signature never depends on curl's default for the s3 service.
r2() {
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" \
    | curl --config - --aws-sigv4 'aws:amz:auto:s3' -fsS --max-time 300 "$@"
}
r2 -T "$file" -H "x-amz-content-sha256: $(sha256sum "$file" | cut -d ' ' -f 1)" -o /dev/null "$url"

empty_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stored=$(r2 --head -H "x-amz-content-sha256: $empty_sha256" "$url" \
  | tr -d '\r' | awk -F': *' 'tolower($1) == "content-length" { print $2 }')
if [[ "$stored" != "$size" ]]; then
  echo "::error::R2 stored ${stored:-nothing} bytes for $key, expected $size" >&2
  exit 1
fi

curl -fsS --max-time 10 --retry 3 -o /dev/null "$BACKUP_HEARTBEAT_URL"
echo "backup uploaded: $key ($size bytes)"
```

- [ ] **Step 5: Run the test**

Run: `scripts/backup.test.sh`
Expected: `backup: ok`.

- [ ] **Step 6: Add it to CI's script tests**

In `.github/workflows/ci.yml`, in the "Script tests" step, add `scripts/backup.test.sh` on its own line after `scripts/check-vercel-output.test.sh`.

- [ ] **Step 7: Run the policy tests and actionlint**

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`
Expected: `workflow-policy: ok` and `workflow-policy mutations: ok (… caught)`.

Run the actionlint command from `.github/workflows/ci.yml` (`docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 -color`).
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/postgres-image scripts/backup.sh scripts/backup.test.sh .github/workflows/ci.yml
git commit -m "feat(ops): add the backup script: dump as the read-only role, encrypt, upload to R2

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 3: `backup.yml` and its policy rules

**Files:**
- Create: `.github/workflows/backup.yml`
- Modify: `scripts/workflow-policy.test.mjs` (add Rule 8 before the `package.json` checks)
- Modify: `scripts/workflow-policy.mutations.test.mjs` (four mutations, the baseline list, one constant)

**Interfaces:**
- Consumes: `scripts/backup.sh` and its environment variables (Task 2).
- Produces: the `backup` workflow, run nightly at 07:17 UTC and by `gh workflow run backup.yml --ref main`. Task 7 dispatches it.

- [ ] **Step 1: Write the failing policy rule**

In `scripts/workflow-policy.test.mjs`, insert before the `// Secret jobs run \`npx vercel@<this version>\`` comment:

```js
// Rule 8 (Plan 5a; D48, spec §10 Recovery): the backup runs only on main, holds only its own
// secrets (never the owner role's DATABASE_URL_DIRECT), checks age's checksum before extracting
// it, and never uploads an artifact: on a public repo anyone can download one.
const BACKUP_SECRETS = [
  'DATABASE_URL_BACKUP',
  'AGE_RECIPIENT',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'BACKUP_HEARTBEAT_URL',
];
const backupJobs = Object.entries(byFile['backup.yml']?.jobs ?? {});
if (backupJobs.length === 0) fail('backup.yml: missing, or has no jobs');
for (const [jobName, job] of backupJobs) {
  const where = `backup.yml#${jobName}`;
  if (!String(job.if ?? '').includes("github.ref == 'refs/heads/main'"))
    fail(`${where}: must be gated with if: github.ref == 'refs/heads/main'`);
  const extra = secretsIn(job).filter((s) => !BACKUP_SECRETS.includes(s));
  if (extra.length)
    fail(`${where}: may hold only ${BACKUP_SECRETS.join(', ')} (got ${extra.join(', ')})`);
  const steps = job.steps ?? [];
  if (steps.some((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@')))
    fail(`${where}: never upload an artifact; anyone can download it from a public repo`);
  for (const step of steps.filter((s) => /FiloSottile\/age\/releases/.test(s.run ?? ''))) {
    const run = String(step.run);
    const verifyAt = run.indexOf('sha256sum -c');
    if (verifyAt === -1 || verifyAt > run.indexOf('tar '))
      fail(`${where}: check age's sha256 (sha256sum -c) before extracting it`);
  }
}
```

Run: `node scripts/workflow-policy.test.mjs`
Expected: FAIL with `backup.yml: missing, or has no jobs`.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/backup.yml`:

```yaml
name: Backup

# Nightly encrypted dump of production to R2 (spec §10 Recovery; D47, D48). 07:17 UTC, off the
# hour, because GitHub delays runs scheduled on the hour. Run it by hand to test the setup or to
# take a fresh dump for the restore drill.
on:
  schedule:
    - cron: '17 7 * * *'
  workflow_dispatch:

permissions:
  contents: read

defaults:
  run:
    shell: bash

# A manual run waits for a nightly one rather than racing it.
concurrency:
  group: backup
  cancel-in-progress: false

jobs:
  backup:
    name: backup
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment:
      name: production
      deployment: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Install age (pinned release, checksum checked)
        env:
          AGE_VERSION: v1.3.2
          AGE_SHA256: cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
        run: |
          curl -fsSL -o "$RUNNER_TEMP/age.tar.gz" "https://github.com/FiloSottile/age/releases/download/$AGE_VERSION/age-$AGE_VERSION-linux-amd64.tar.gz"
          echo "$AGE_SHA256  $RUNNER_TEMP/age.tar.gz" | sha256sum -c -
          tar -xzf "$RUNNER_TEMP/age.tar.gz" -C "$RUNNER_TEMP" age/age
          echo "$RUNNER_TEMP/age" >> "$GITHUB_PATH"
      - name: Dump, encrypt, upload and report
        env:
          DATABASE_URL_BACKUP: ${{ secrets.DATABASE_URL_BACKUP }}
          AGE_RECIPIENT: ${{ secrets.AGE_RECIPIENT }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          BACKUP_HEARTBEAT_URL: ${{ secrets.BACKUP_HEARTBEAT_URL }}
        run: scripts/backup.sh
```

The `deployment: false` keeps the nightly run out of the `production` deployment history, which lists only real deploys.

Run: `node scripts/workflow-policy.test.mjs`
Expected: `workflow-policy: ok`. The existing allowlist rule also applies to this job, because it names an environment: it runs only `curl`, `echo`, `tar` and `scripts/backup.sh`.

- [ ] **Step 3: Add the mutations**

In `scripts/workflow-policy.mutations.test.mjs`:
- After `PINNED_DOWNLOAD`, add `const PINNED_UPLOAD = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9';`.
- In the baseline loop, change `['deploy.yml', 'preview.yml', 'preview-seed.yml']` to `['deploy.yml', 'preview.yml', 'preview-seed.yml', 'backup.yml']`.
- Append to the `mutations` array:

```js
  [
    'the backup holds the owner database URL (D48)',
    'backup.yml',
    (wf) => {
      runStep(wf.jobs.backup, /scripts\/backup\.sh/).env.DATABASE_URL_BACKUP =
        '${{ secrets.DATABASE_URL_DIRECT }}';
    },
  ],
  [
    'the backup uploads its dump as an artifact',
    'backup.yml',
    (wf) => {
      wf.jobs.backup.steps.push({
        uses: PINNED_UPLOAD,
        with: { name: 'dump', path: '${{ runner.temp }}' },
      });
    },
  ],
  [
    'age extracted without its checksum',
    'backup.yml',
    (wf) => {
      const s = runStep(wf.jobs.backup, /FiloSottile\/age\/releases/);
      s.run = s.run
        .split('\n')
        .filter((l) => !l.includes('sha256sum'))
        .join('\n');
    },
  ],
  [
    'the backup runs from a branch other than main',
    'backup.yml',
    (wf) => {
      delete wf.jobs.backup.if;
    },
  ],
```

- [ ] **Step 4: Run the policy tests and actionlint**

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`
Expected: `workflow-policy: ok`, and the mutation count is four higher than before this task, with no `not caught:` lines.

Run the actionlint command from `.github/workflows/ci.yml`.
Expected: no output, exit 0.

Run: `pnpm format:check`
Expected: pass. If prettier reformats the YAML or JS, run `pnpm exec prettier --write` on those files and re-run the policy tests.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/backup.yml scripts/workflow-policy.test.mjs scripts/workflow-policy.mutations.test.mjs
git commit -m "feat(ops): run the backup nightly, under policy rules for its secrets and artifacts

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 4: The backup runbook

**Files:**
- Modify: `docs/deployment.md` (a new `## Backups` section after `## Daily cron`; the "Later plans add" line under `## Accounts`)

**Interfaces:**
- Consumes: the secret names (Task 3's workflow) and the script's behavior (Task 2).
- Produces: the steps Ted follows in Task 7, under the headings "One-off setup", "When it fails" and "Rotation and upgrades". Task 6 links to them.

- [ ] **Step 1: Update the accounts line**

Under `## Accounts`, replace:

```markdown
Later plans add: domain and DNS, Resend and Turnstile (Plan 2); Sentry, Cloudflare R2 backups and uptime monitoring (Plan 5).
```

with:

```markdown
Later plans add: domain and DNS, Resend and Turnstile (Plan 2); Cloudflare R2 backups and Better Stack uptime monitoring (Plan 5a, see [Backups](#backups) and [Monitoring](#monitoring)); Sentry (Plan 5b).
```

- [ ] **Step 2: Write the section**

Insert after the `## Daily cron` section (before `## Opening sign-up (end of Plan 4)`):

````markdown
## Backups

`.github/workflows/backup.yml` runs `scripts/backup.sh` every night at 07:17 UTC (spec §10 Recovery). It:

1. dumps production with `pg_dump` as `hanker_backup`, a role that can only read (D48);
2. encrypts the dump with `age` inside the pipe, so the plaintext never touches the runner's disk;
3. uploads it to R2 as `daily/<UTC timestamp>.dump.age`, and checks the stored size;
4. pings the Better Stack heartbeat, or its `/fail` URL if any step failed.

R2 keeps each dump for 30 days. Only the private `age` key, which never leaves your hands, can read one. The restore drill below proves they can be read.

### One-off setup

Do these in order. Each secret goes into the GitHub `production` environment with `gh secret set <NAME> --env production`, which prompts for the value without echoing it.

**1. The `age` key pair.** On your machine, install the same release the workflow uses:

```bash
curl -fsSL -o /tmp/age.tar.gz https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz
echo "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10  /tmp/age.tar.gz" | sha256sum -c -
tar -xzf /tmp/age.tar.gz -C /tmp && sudo install /tmp/age/age /tmp/age/age-keygen /usr/local/bin/
```

Generate the key straight into a passphrase-protected file. The private key never exists unencrypted on disk:

```bash
age-keygen | age -p -a > ~/hanker-backup-identity.age
```

`age-keygen` prints `Public key: age1…` to the terminal; that's the recipient, and it isn't secret. `age -p` asks for a passphrase. Then:

- **Prove the pair matches** before anything depends on it: `echo ok | age -r <public key> | age -d -i ~/hanker-backup-identity.age` must print `ok`. A recipient that doesn't match the key would make every dump unreadable, and nothing else would notice.
- **Store the identity file in two places you control**, for example a password-manager attachment and an offline USB drive, and the passphrase in your password manager. Losing either one makes every backup unreadable.
- **Set `AGE_RECIPIENT`** to the public key.

**2. The read-only role.** Roles created in the Neon console join `neon_superuser`, so create this one in SQL. Connect to the production branch as the owner role, using the direct (not `-pooler`) connection string from the Neon console:

```bash
read -rs OWNER_URL && psql "$OWNER_URL"; unset OWNER_URL
```

```sql
CREATE ROLE hanker_backup WITH LOGIN;
\password hanker_backup
GRANT pg_read_all_data TO hanker_backup;
```

`\password` prompts twice and sends only a hash, so the password never appears in a log or in history. Generate it with your password manager (Neon requires at least 60 bits of entropy) and keep it there.

If Neon refuses the `GRANT pg_read_all_data` (the docs don't confirm it's allowed), grant the same reads explicitly. The default privileges cover tables a future migration creates; `<owner>` is the role in `DATABASE_URL_DIRECT` (Neon's default is `neondb_owner`) and `<database>` its database (default `neondb`):

```sql
GRANT CONNECT ON DATABASE <database> TO hanker_backup;
GRANT USAGE ON SCHEMA public, drizzle TO hanker_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO hanker_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO hanker_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public, drizzle GRANT SELECT ON TABLES TO hanker_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public, drizzle GRANT SELECT ON SEQUENCES TO hanker_backup;
```

Prove it can read but not write, connected as `hanker_backup` this time:

```sql
SELECT count(*) FROM users;                        -- works
CREATE TABLE backup_write_probe (id int);          -- must fail: permission denied
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname = 'hanker_backup';     -- all f
```

Set `DATABASE_URL_BACKUP` to the role's **direct** connection string with `sslmode=require`. `pg_dump` doesn't work reliably through the pooler.

**3. R2.** In the Cloudflare dashboard, under R2:

- **Bucket:** create `hanker-backups` with automatic location and Standard storage. Keep it private: no public access, no custom domain.
- **Lifecycle rule:** under the bucket's Settings → Object lifecycle rules, add a rule for prefix `daily/` that deletes objects 30 days after upload.
- **Bucket lock:** under Settings → Bucket lock rules, add a rule for prefix `daily/` that retains objects for 30 days. A lock blocks deletes and overwrites, and takes precedence over the lifecycle rule, so a leaked token can't destroy the dumps already there.
- **Token:** under Manage API tokens, create a token with **Object Read & Write**, applied to `hanker-backups` only. Copy the Access Key ID and Secret Access Key; the secret is shown once.

Set `R2_ACCOUNT_ID` (on the R2 overview page), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` (`hanker-backups`).

**4. The heartbeat.** In Better Stack, under Uptime → Heartbeats, create "Hanker nightly backup", expected every **1 day**, with a **2 hour** grace period, alerting you by email. Set `BACKUP_HEARTBEAT_URL` to its URL. It's a secret because anyone holding it can send a fake "all good".

**5. First run.**

```bash
gh workflow run backup.yml --ref main
gh run watch "$(gh run list --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The log ends with `backup uploaded: daily/<timestamp>.dump.age (<n> bytes)`, the object appears in the bucket, and the heartbeat turns green. Then run the [restore drill](#restore-drill-and-recovery) against it.

### When it fails

The heartbeat emails you: right away if a run failed, or after the grace period if no run reported at all. Read the newest run with `gh run view --log-failed`.

| Symptom | Cause and fix |
|---|---|
| `permission denied for table …` | A migration added a table `hanker_backup` can't read. Only possible with the explicit-grant fallback: re-run its `GRANT SELECT ON ALL …` lines. |
| `403` from `r2.cloudflarestorage.com` | The R2 token was revoked, expired or scoped to another bucket. Create a new one and update the two `R2_*_KEY*` secrets. |
| `the dump isn't age-encrypted` | `age` failed or `AGE_RECIPIENT` isn't a valid public key. |
| No run at all | GitHub disables scheduled workflows in a public repository after 60 days without activity. Re-enable it with `gh workflow enable backup.yml`. |

### Rotation and upgrades

- **A new `age` key.** Dumps already in R2 stay readable only with the old key, so keep the old identity file until the last of them expires, 30 days after the switch. Re-run the drill with the new key.
- **The R2 token or the role's password.** Replace the secret, then dispatch a run to prove it.
- **Postgres.** `scripts/postgres-image` pins `postgres:17-alpine` by digest. When Neon's production moves to a new major version, pin the matching image, because `pg_dump` refuses servers newer than itself.
````

- [ ] **Step 3: Check the formatting**

Run: `pnpm format:check`
Expected: pass. If it fails on `docs/deployment.md`, run `pnpm exec prettier --write docs/deployment.md` and check the diff only re-wrapped tables.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add the backup runbook: key pair, read-only role, R2, heartbeat

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 5: `scripts/restore-drill.sh`

**Files:**
- Create: `scripts/restore-drill.sh` (executable)
- Create: `scripts/restore-drill.test.sh` (executable)
- Modify: `.github/workflows/ci.yml` (the "Script tests" step)

**Interfaces:**
- Consumes: `scripts/postgres-image` (Task 2). A dump made by `backup.sh` (`pg_dump --format=custom`, then `age`).
- Produces: `scripts/restore-drill.sh [--keep] <dump.age> <identity-file>`. Env: `HEALTH_URL` (default `https://hanker.dev/api/health`), `READY_SECONDS` (default `60`). It exits `0` and prints `restore drill: ok` when the dump decrypts, restores, matches production's migration count, and every `public` table in the dump came back. With `--keep`, a successful run leaves the container running and prints how to query and remove it; a failed run always removes it. Task 6 documents both uses.

- [ ] **Step 1: Write the failing test**

Create `scripts/restore-drill.test.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Verifies restore-drill.sh with docker, age and curl stubbed on PATH: the container is
# in-memory, publishes no port and is always removed with its volumes (Review Focus #1); readiness
# goes over TCP (#2); and a stale dump or a missing table fails the drill (#5).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bin="$tmp/bin"
mkdir -p "$bin"

cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
args=" $* "
case "$1" in
  run) echo c0ffee ;;
  rm) ;;
  exec)
    if [[ "$args" == *" pg_isready "* ]]; then exit 0; fi
    if [[ "$args" == *"cat > /tmp/dump.pgc"* ]]; then cat > /dev/null; exit 0; fi
    if [[ "$args" == *" pg_restore --list "* ]]; then
      printf '%s\n' \
        '218; 1259 16386 TABLE drizzle __drizzle_migrations postgres' \
        '219; 1259 16389 TABLE public users postgres' \
        '220; 1259 16390 TABLE public items postgres' \
        '3458; 0 16389 TABLE DATA public users postgres'
      exit 0
    fi
    if [[ "$args" == *" pg_restore "* ]]; then exit "${STUB_RESTORE_EXIT:-0}"; fi
    if [[ "$args" == *"pg_tables"* ]]; then printf '%s\n' ${STUB_TABLES:-items users}; exit 0; fi
    if [[ "$args" == *"__drizzle_migrations"* ]]; then echo "${STUB_MIGRATIONS:-4}"; exit 0; fi
    if [[ "$args" == *"count(*)"* ]]; then echo 7; exit 0; fi
    echo "unexpected: docker $*" >&2; exit 99 ;;
  *) echo "unexpected: docker $*" >&2; exit 99 ;;
esac
EOF
cat > "$bin/age" <<'EOF'
#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
echo plaintext
EOF
cat > "$bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
printf '{"status":"ok","sha":"abc","db":{"ok":true,"migrationsApplied":%s}}\n' "${STUB_PROD_MIGRATIONS:-4}"
EOF
chmod +x "$bin"/*

export STUB_LOG="$tmp/log"
dump="$tmp/2026-10-20T071702Z.dump.age"
identity="$tmp/identity.age"
touch "$dump" "$identity"

# Runs the drill with the stubs; NAME=value arguments set env, the rest are passed to the script.
run() {
  : > "$STUB_LOG"
  local vars=() status=0
  while [[ "${1:-}" == *=* ]]; do vars+=("$1"); shift; done
  env PATH="$bin:$PATH" "${vars[@]}" "$here/restore-drill.sh" "$@" > "$tmp/out" 2>&1 || status=$?
  echo "$status"
}
fail() {
  echo "restore-drill.test: $*" >&2
  echo "--- output" >&2; cat "$tmp/out" >&2
  echo "--- commands" >&2; cat "$STUB_LOG" >&2
  exit 1
}
container() { sed -n 's/^docker run .*--name \([^ ]*\) .*/\1/p' "$STUB_LOG"; }
removed() { grep -qx "docker rm -fv $(container)" "$STUB_LOG"; }

# A clean drill.
[[ $(run "$dump" "$identity") == 0 ]] || fail "a clean drill should pass"
grep -q 'restore drill: ok' "$tmp/out" || fail "say the drill passed"
grep -Eq '^ +users +7$' "$tmp/out" || fail "print each table's row count"
name=$(container)
[[ "$name" == hanker-restore-drill-* ]] || fail "name the container hanker-restore-drill-*"
run_line=$(grep '^docker run ' "$STUB_LOG")
[[ "$run_line" == *" --label hanker.restore-drill=1 "* ]] || fail "label the container"
[[ "$run_line" == *" --tmpfs /var/lib/postgresql/data "* ]] || fail "keep the data directory in memory"
[[ "$run_line" == *" --tmpfs /tmp "* ]] || fail "keep the decrypted dump in memory"
[[ "$run_line" != *" -p "* && "$run_line" != *"--publish"* ]] || fail "publish no port"
[[ "$run_line" == *" $(cat "$here/postgres-image")" ]] || fail "use the pinned image"
if grep ' pg_isready ' "$STUB_LOG" | grep -qv -- ' -h 127.0.0.1 '; then
  fail "check readiness over TCP (-h 127.0.0.1), not the socket"
fi
grep -qx "age -d -i $identity $dump" "$STUB_LOG" || fail "decrypt with the given identity"
grep -q '^curl .*https://hanker\.dev/api/health$' "$STUB_LOG" || fail "compare with production's health"
removed || fail "remove the container and its volumes"
# Every docker exec and docker rm names this run's container as a whole word.
if grep -E '^docker (exec|rm) ' "$STUB_LOG" | grep -Eqv -- " $name( |\$)"; then
  fail "touch only the drill's own container"
fi

# Review Focus #5: a dump older than production's schema, or a lost table, fails the drill.
[[ $(run STUB_PROD_MIGRATIONS=5 "$dump" "$identity") != 0 ]] || fail "a migration mismatch must fail"
grep -q 'use a newer dump' "$tmp/out" || fail "a migration mismatch must say to use a newer dump"
removed || fail "a failed drill must still remove its container"

[[ $(run STUB_TABLES=users "$dump" "$identity") != 0 ]] || fail "a table missing from the restore must fail"
removed || fail "a failed drill must still remove its container"

[[ $(run STUB_RESTORE_EXIT=1 "$dump" "$identity") != 0 ]] || fail "a refused restore must fail"
removed || fail "a refused restore must still remove its container"

# --keep leaves a passing drill's container for a real recovery, but never a failed one's.
[[ $(run --keep "$dump" "$identity") == 0 ]] || fail "--keep should pass"
! grep -q '^docker rm ' "$STUB_LOG" || fail "--keep must leave the container running"
grep -q "docker rm -fv $(container)" "$tmp/out" || fail "--keep must print how to remove the container"
[[ $(run STUB_RESTORE_EXIT=1 --keep "$dump" "$identity") != 0 ]] || fail "--keep with a refused restore must fail"
removed || fail "--keep must still remove a failed drill's container"

# Bad arguments never start a container.
[[ $(run) != 0 ]] || fail "no arguments must fail"
[[ $(run "$tmp/missing.dump.age" "$identity") != 0 ]] || fail "a missing dump must fail"
! grep -q '^docker ' "$STUB_LOG" || fail "bad arguments must not start a container"

echo "restore-drill: ok"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `scripts/restore-drill.test.sh`
Expected: FAIL with `restore-drill.test: a clean drill should pass`; the output shows `restore-drill.sh: No such file or directory`.

- [ ] **Step 3: Write the script**

Create `scripts/restore-drill.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Restore drill (spec §10 Recovery, D49). Proves a nightly dump decrypts with the key you kept and
# restores into a working database. It runs on the owner's machine, the only place the private key
# is, and restores into a throwaway container that it creates and removes. With --keep, a passing
# run leaves the container up for a real recovery (docs/deployment.md).
# Usage: scripts/restore-drill.sh [--keep] <dump.age> <identity-file>
# Env:   HEALTH_URL (default https://hanker.dev/api/health), READY_SECONDS (default 60)
set -euo pipefail

usage='usage: restore-drill.sh [--keep] <dump.age> <identity-file>'
keep=
if [[ "${1:-}" == --keep ]]; then keep=1; shift; fi
dump="${1:?$usage}"
identity="${2:?$usage}"
health_url="${HEALTH_URL:-https://hanker.dev/api/health}"
here=$(cd "$(dirname "$0")" && pwd)

die() {
  echo "restore drill FAILED: $*" >&2
  exit 1
}

for tool in docker age curl jq; do
  command -v "$tool" >/dev/null || die "$tool isn't installed"
done
[[ -f "$dump" ]] || die "no such dump: $dump"
[[ -f "$identity" ]] || die "no such identity file: $identity"

pg_image=$(<"$here/postgres-image")
name="hanker-restore-drill-$(date +%s)-$$"
passed=
# Removes only this run's container, and its volumes (-v), unless --keep and the drill passed.
cleanup() {
  if [[ -n "$keep" && -n "$passed" ]]; then return; fi
  docker rm -fv "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The data directory and /tmp are tmpfs: the decrypted dump and the restored rows stay in memory,
# and no anonymous volume outlives the container. No port is published; everything goes through
# docker exec.
docker run -d --name "$name" --label hanker.restore-drill=1 \
  --tmpfs /var/lib/postgresql/data --tmpfs /tmp \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=drill \
  "$pg_image" >/dev/null

# Over TCP, not the socket: while initdb runs, the image starts a temporary server that listens on
# the socket only, then restarts it, so a socket check can pass before the real server is up.
ready=
for (( i = 0; i < ${READY_SECONDS:-60}; i++ )); do
  if docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres -d drill; then
    ready=1
    break
  fi
  sleep 1
done
[[ -n "$ready" ]] || die "Postgres didn't start in $name"

sql() { docker exec "$name" psql -h 127.0.0.1 -U postgres -d drill -XtAq -v ON_ERROR_STOP=1 -c "$1"; }

echo "Decrypting $dump. age asks for the identity file's passphrase."
age -d -i "$identity" "$dump" | docker exec -i "$name" sh -c 'cat > /tmp/dump.pgc' \
  || die "couldn't decrypt $dump with $identity"
docker exec "$name" pg_restore -h 127.0.0.1 -U postgres -d drill \
  --exit-on-error --single-transaction --no-owner --no-privileges /tmp/dump.pgc \
  || die "pg_restore refused the dump"

listed=$(docker exec "$name" pg_restore --list /tmp/dump.pgc \
  | awk '$4 == "TABLE" && $5 == "public" { print $6 }' | LC_ALL=C sort)
restored=$(sql "select tablename from pg_tables where schemaname = 'public'" | LC_ALL=C sort)
[[ -n "$listed" ]] || die "the dump has no tables in public"
if [[ "$listed" != "$restored" ]]; then
  die "the restore doesn't have the dump's tables:
$(diff <(echo "$listed") <(echo "$restored") || true)"
fi

migrations=$(sql 'select count(*) from drizzle.__drizzle_migrations')
production=$(curl -fsS --max-time 15 "$health_url" | jq -r '.db.migrationsApplied') \
  || die "couldn't read $health_url"
if [[ "$migrations" != "$production" ]]; then
  die "the dump has $migrations migrations and production reports $production. If a migration shipped after this dump was taken, use a newer dump."
fi

echo "Rows per table:"
while IFS= read -r table; do
  printf '  %-24s %s\n' "$table" "$(sql "select count(*) from public.\"$table\"")"
done <<<"$restored"

passed=1
echo "restore drill: ok ($dump decrypted and restored; $migrations migrations, matching production)"
if [[ -n "$keep" ]]; then
  echo "Kept $name. Query it:  docker exec -it $name psql -h 127.0.0.1 -U postgres -d drill"
  echo "Remove it when done:  docker rm -fv $name"
fi
```

- [ ] **Step 4: Run the test**

Run: `scripts/restore-drill.test.sh`
Expected: `restore-drill: ok`.

- [ ] **Step 5: Prove it end to end with real Docker and age**

This is a local check, not a CI test. It uses a throwaway key and a throwaway source container, both made here and removed at the end, and a static health file. It needs Docker running and `age` from the pinned release (see `docs/deployment.md` Backups step 1, or extract it to a scratch directory and put that on `PATH`).

```bash
set -euo pipefail
scratch=$(mktemp -d); src="hanker-restore-drill-src-$$"
trap 'docker rm -fv "$src" >/dev/null 2>&1 || true; kill "$web" 2>/dev/null || true; rm -rf "$scratch"' EXIT
img=$(<scripts/postgres-image)
docker run -d --name "$src" --label hanker.restore-drill=1 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=src "$img" >/dev/null
until docker exec "$src" pg_isready -q -h 127.0.0.1 -U postgres -d src; do sleep 1; done
docker exec "$src" psql -h 127.0.0.1 -U postgres -d src -XqAt -c "
  create schema drizzle; create table drizzle.__drizzle_migrations (id int);
  insert into drizzle.__drizzle_migrations values (1), (2);
  create table public.users (id int); insert into public.users values (1), (2), (3);
  create table public.items (id int);"
age-keygen -o "$scratch/key.txt" 2>/dev/null
docker exec "$src" pg_dump -h 127.0.0.1 -U postgres -d src --format=custom --no-owner --no-privileges \
  | age -r "$(age-keygen -y "$scratch/key.txt")" > "$scratch/test.dump.age"
mkdir -p "$scratch/www/api"
echo '{"status":"ok","sha":"x","db":{"ok":true,"migrationsApplied":2}}' > "$scratch/www/api/health"
python3 -m http.server 38998 --bind 127.0.0.1 --directory "$scratch/www" >/dev/null 2>&1 & web=$!
sleep 1
HEALTH_URL=http://127.0.0.1:38998/api/health scripts/restore-drill.sh "$scratch/test.dump.age" "$scratch/key.txt"
docker ps -a --filter label=hanker.restore-drill=1 --format '{{.Names}}'
```

Expected: `Rows per table:` with `items 0` and `users 3`, then `restore drill: ok (… 2 migrations, matching production)`. The final `docker ps` lists only the source container `hanker-restore-drill-src-…`; the drill's own container is gone. Paste the output into the task report. (The identity here is a plain key file, so `age` doesn't prompt; Ted's real one is passphrase-protected.)

- [ ] **Step 6: Add it to CI's script tests**

In `.github/workflows/ci.yml`, in the "Script tests" step, add `scripts/restore-drill.test.sh` on its own line after `scripts/backup.test.sh`.

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`, then the actionlint command from `ci.yml`.
Expected: both policy tests pass, and actionlint prints nothing.

- [ ] **Step 7: Commit**

```bash
git add scripts/restore-drill.sh scripts/restore-drill.test.sh .github/workflows/ci.yml
git commit -m "feat(ops): add the restore drill: decrypt a dump and restore it into a throwaway container

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 6: The recovery and monitoring runbooks

**Files:**
- Modify: `docs/deployment.md` (new `## Restore drill and recovery` and `## Monitoring` sections after `## Backups`; the `Data:` line under `## Rollback`)
- Modify: `AGENTS.md` (one line under "Never")

**Interfaces:**
- Consumes: `scripts/restore-drill.sh [--keep] <dump.age> <identity-file>` (Task 5); `GET /api/health/live` (Task 1); the backup runbook's anchors `#backups` (Task 4).

- [ ] **Step 1: Write the restore and recovery section**

Insert after the `## Backups` section:

````markdown
## Restore drill and recovery

A backup job that passes proves only that bytes reached R2. The drill proves they come back as the data: that the dump is complete, that `AGE_RECIPIENT` matches the key you kept, and that you can still find and unlock that key (D49). Plan 5a counts as done only once a drill passes against a real nightly dump.

**Needs:** Docker running, `age` v1.3.2 ([Backups](#backups) step 1), `curl`, `jq`, and your identity file and its passphrase.

**Run the drill:**

1. In the Cloudflare dashboard, open R2 → `hanker-backups` → `daily/`, and download the newest `.dump.age`. It's encrypted, so it's safe on disk; delete it afterwards anyway.
2. Run:

   ```bash
   scripts/restore-drill.sh ~/Downloads/<timestamp>.dump.age ~/hanker-backup-identity.age
   ```

   `age` asks for the passphrase. The script restores into an in-memory `postgres:17-alpine` container named `hanker-restore-drill-*`, which publishes no port and is removed when it finishes, pass or fail.
3. A pass ends with `restore drill: ok`, after a row count per table. Check that the counts look like your data, for example that `users` has about as many rows as you have accounts.

| Failure | Meaning |
|---|---|
| `couldn't decrypt …` | Wrong passphrase, the wrong identity file, or `AGE_RECIPIENT` doesn't match this key. Fix it today: until you do, every backup is unreadable. |
| `pg_restore refused the dump` | The dump is incomplete or from a newer `pg_dump`. Read the error above it. |
| `… migrations and production reports …` | A migration shipped after the dump was taken. Use a newer dump. |
| `the restore doesn't have the dump's tables` | A table didn't restore. Read the `pg_restore` output above it. |

**Real recovery.** Within 6 hours of the bad change, use Neon's point-in-time restore instead (see [Rollback](#rollback)). Older than that, recover from a dump:

1. Pick the newest dump from before the bad change.
2. Restore it and keep the container: `scripts/restore-drill.sh --keep <dump> <identity>`. It prints the container's name and how to remove it.
3. Find what was lost, for example a deleted list's items:

   ```bash
   docker exec -it <container> psql -h 127.0.0.1 -U postgres -d drill
   ```

4. Copy those rows into production. Parents go before children: `users`, then `wishlists`, then `items`, then `claims`. Stream them straight across rather than restoring the whole dump over `main`, which would lose everything written since:

   ```bash
   read -rs OWNER_URL
   docker exec <container> psql -h 127.0.0.1 -U postgres -d drill -XqAt \
     -c "\copy (select * from items where wishlist_id = '<id>') to stdout with (format csv)" \
     | psql "$OWNER_URL" -v ON_ERROR_STOP=1 -c "\copy items from stdin with (format csv)"
   unset OWNER_URL
   ```

   This writes to production, so plan the statements first and try them on a Neon branch of `main` if the change is large.
5. Remove the container: `docker rm -fv <container>`.
````

- [ ] **Step 2: Write the monitoring section**

Insert after `## Restore drill and recovery`:

```markdown
## Monitoring

Better Stack's free plan watches the site and the backup, and emails you (D47). Create these in Better Stack → Uptime, with email alerts to you:

| Monitor | URL | Check every | Proves |
| --- | --- | --- | --- |
| Live | `https://hanker.dev/api/health/live` | 3 minutes | The web project, the `/api` rewrite and the API function are up |
| Site | `https://hanker.dev/` | 3 minutes | The landing page renders. It's static, so it touches neither the API nor the database |
| Deep | `https://hanker.dev/api/health` | 1 hour, or the longest the free plan offers | Neon is reachable and migrated. It answers `503` when not |
| Backup heartbeat | set up in [Backups](#backups) step 4 | expects a ping every 24 hours, with 2 hours of grace | The nightly backup ran and uploaded |

**Why only the deep check touches the database.** `/api/health` runs a query, which wakes Neon, and Neon Free scales to zero only after 5 idle minutes, with 100 CU-hours per project per month. A deep check every 3 minutes would keep it awake all month, about 180 CU-hours, and Neon would then suspend the database until the month ends. Hourly costs about 15 CU-hours; every 30 minutes, about 30. `/api/health/live` never touches the database. After the first week, check Neon → your project → Usage to see that compute stays well under the quota.

**When an alert comes:**
- **Live or Site down:** check Vercel's status and the newest deploy. Roll back if a deploy caused it ([Rollback](#rollback)).
- **Deep down but Live up:** the API is up and Neon isn't. Check Neon's status page and the project's compute quota.
- **Backup heartbeat:** see [Backups → When it fails](#when-it-fails).
```

- [ ] **Step 3: Point the rollback section at the dumps**

Under `## Rollback`, replace:

```markdown
Data: Neon point-in-time restore (6-hour window) from the Neon console.
```

with:

```markdown
Data: Neon point-in-time restore (6-hour window) from the Neon console. Older than that, recover the rows from a nightly dump ([Restore drill and recovery](#restore-drill-and-recovery)).
```

- [ ] **Step 4: Add the artifact rule to AGENTS.md**

Under `## Never` in `AGENTS.md`, after the "Give a CI build job a secret" line, add:

```markdown
- Put a database dump, decrypted or not, in an Actions artifact or a log. On a public repo anyone can download an artifact; backups go only to R2, encrypted (`scripts/backup.sh`).
```

- [ ] **Step 5: Check the formatting and the links**

Run: `pnpm format:check`
Expected: pass. If it fails on `docs/deployment.md`, run `pnpm exec prettier --write docs/deployment.md` and check the diff only re-wrapped tables.

Run: `grep -n '^## ' docs/deployment.md`
Expected: `## Backups`, `## Restore drill and recovery` and `## Monitoring` sit between `## Daily cron` and `## Opening sign-up (end of Plan 4)`, so the anchors `#backups`, `#restore-drill-and-recovery`, `#monitoring`, `#when-it-fails` and `#rollback` all resolve.

- [ ] **Step 6: Commit**

```bash
git add docs/deployment.md AGENTS.md
git commit -m "docs: add the restore drill, recovery and monitoring runbooks

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 7: Go-live checkpoint (after Ted merges the stack)

Not a coding task. The controller stops after the stack is submitted. Ted merges it, then does steps 1–4 himself: they create cloud resources and set secrets (AGENTS.md "Ask a maintainer first").

- [ ] **Step 1 (Ted): Set up the backup**, following `docs/deployment.md` → Backups → One-off setup, items 1–4: the `age` key pair, the `hanker_backup` role, R2 with its lifecycle rule, lock rule and token, and the heartbeat. Seven secrets go into the `production` environment.
- [ ] **Step 2 (Ted): Create the three uptime monitors** from `docs/deployment.md` → Monitoring.
- [ ] **Step 3 (Ted): Dispatch the first backup** (Backups item 5) and watch it pass.
- [ ] **Step 4 (Ted): Run the restore drill** against that dump (Restore drill and recovery), and tell the controller its last lines. Don't paste the row counts if you'd rather not; "ok, counts look right" is enough.
- [ ] **Step 5 (controller): Verify what's visible without secrets.**

  ```bash
  curl -fsS https://hanker.dev/api/health/live
  curl -fsS https://hanker.dev/api/health
  gh run list --workflow backup.yml --limit 3
  ```

  Expected: `{"status":"ok","sha":"<main's tip>"}`, health `ok` with the same sha, and the dispatched backup run `completed success`.
- [ ] **Step 6 (controller): Record it.** Update the memory file for this plan with the drill's date and result. The roadmap row 5a moves to Done in 5b's first docs layer, since Plan 5a's own layers merge before the drill can run.
