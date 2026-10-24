#!/usr/bin/env bash
# Verifies preview-seed.sh's decisions against branch-listing fixtures (no network).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
fx="$here/testdata/neon-seed"
# Previews live in their own Neon project (D87); every call names both projects.
export NEON_PROJECT_ID=prj-preview NEON_PRODUCTION_PROJECT_ID=prj-prod
seed() { "$here/preview-seed.sh" "$@"; }
fail() { echo "preview-seed: FAIL: $1" >&2; exit 1; }

out=$(NEON_BRANCHES_FILE="$fx/with-seed.json" seed ensure)
[[ "$out" == $'id=br-seed\ncreated=false\nroot=true' ]] || fail "reuse existing seed: got '$out'"

# A seed with a parent may hold that parent's (production) rows, so the workflow must wipe it.
out=$(NEON_BRANCHES_FILE="$fx/seed-with-parent.json" seed ensure)
[[ "$out" == $'id=br-seed\ncreated=false\nroot=false' ]] || fail "seed with a parent: got '$out'"

# D87: the seed is an ordinary child of the preview project's (empty) default branch, so it is
# never a root branch and is wiped and rebuilt on every run. No schema-only mode crosses projects.
err=$(NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 seed ensure 2>&1 >/dev/null)
out=$(NEON_BRANCHES_FILE="$fx/no-seed.json" DRY_RUN=1 seed ensure 2>/dev/null)
[[ "$out" == $'id=dry-run\ncreated=true\nroot=false' ]] || fail "create when missing: got '$out'"
for want in '"name":"preview-seed"' '"parent_id":"br-main"'; do
  [[ "$err" == *"$want"* ]] || fail "create body missing $want: $err"
done
[[ "$err" != *init_source* ]] || fail "create body still sets init_source: $err"

# Review Focus 4: the preview secrets pasted with production's project ID.
for cmd in ensure check; do
  if err=$(NEON_PROJECT_ID=prj-prod NEON_BRANCHES_FILE="$fx/with-seed.json" seed "$cmd" 2>&1); then
    fail "$cmd ran against the production project"
  fi
  [[ "$err" == *"production project"* ]] || fail "$cmd production-project message: $err"
done
if NEON_PRODUCTION_PROJECT_ID='' NEON_BRANCHES_FILE="$fx/with-seed.json" seed check >/dev/null 2>&1; then
  fail "ran without NEON_PRODUCTION_PROJECT_ID, so the guard was off"
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
