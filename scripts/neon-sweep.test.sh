#!/usr/bin/env bash
# Verifies neon-sweep.sh's selection: only pr-<number> branches whose PR is closed are deleted.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(NEON_BRANCHES_FILE="$here/testdata/neon-branches.json" OPEN_PRS="12 14" "$here/neon-sweep.sh" --dry-run)
expected=$'keep         pr-12 (PR #12 is open)\nwould delete pr-13 (br-c)\nkeep         pr-14 (PR #14 is open)\nwould delete pr-140 (br-e)'

if [[ "$out" != "$expected" ]]; then
  echo "unexpected output:" >&2
  diff <(echo "$expected") <(echo "$out") >&2 || true
  exit 1
fi
echo "neon-sweep: ok"
