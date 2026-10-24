#!/usr/bin/env bash
# Verifies neon-sweep.sh's selection: only pr-<number> branches whose PR is closed are deleted.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(NEON_PROJECT_ID=prj-preview NEON_PRODUCTION_PROJECT_ID=prj-prod \
  NEON_BRANCHES_FILE="$here/testdata/neon-branches.json" OPEN_PRS="12 14" "$here/neon-sweep.sh" --dry-run)
expected=$'keep         pr-12 (PR #12 is open)\nwould delete pr-13 (br-c)\nkeep         pr-14 (PR #14 is open)\nwould delete pr-140 (br-e)'

if [[ "$out" != "$expected" ]]; then
  echo "unexpected output:" >&2
  diff <(echo "$expected") <(echo "$out") >&2 || true
  exit 1
fi
# D87: never sweep the production project, and never run without knowing which one it is.
for prod in prj-preview ''; do
  if err=$(NEON_PROJECT_ID=prj-preview NEON_PRODUCTION_PROJECT_ID="$prod" \
    NEON_BRANCHES_FILE="$here/testdata/neon-branches.json" OPEN_PRS="" "$here/neon-sweep.sh" --dry-run 2>&1); then
    echo "swept with NEON_PRODUCTION_PROJECT_ID='$prod'" >&2
    exit 1
  fi
  [[ "$err" == *"production project"* ]] || { echo "sweep guard message: $err" >&2; exit 1; }
done
echo "neon-sweep: ok"
