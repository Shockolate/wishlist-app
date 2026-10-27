#!/usr/bin/env bash
# Verifies infra-drift-result.sh tells drift from a plan that couldn't run (final review I-1):
# OpenTofu writes a plan file, and tofu show succeeds, even when planning failed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0
fail() { echo "infra-drift-result.test: $1" >&2; failures=$((failures + 1)); }

# expect <case> <plan outcome> <plan text, or - for no file> <exit> <message substring>
expect() {
  local name=$1 outcome=$2 text=$3 want_exit=$4 want=$5 out code=0
  rm -f "$tmp/drift.txt" "$tmp/summary.md"
  [[ "$text" == - ]] || printf '%s\n' "$text" > "$tmp/drift.txt"
  out=$("$here/infra-drift-result.sh" "$outcome" "$tmp/drift.txt" "$tmp/summary.md" 2>&1) || code=$?
  (( code == want_exit )) || fail "$name: exit $code, want $want_exit"
  grep -qF -- "$want" <<<"$out" || fail "$name: output lacks \"$want\": $out"
}

expect 'no changes passes' success 'No changes. Your infrastructure matches the configuration.' 0 'No drift'
expect 'changes are drift' failure $'  # cloudflare_dns_record.www will be updated in-place\nPlan: 0 to add, 1 to change, 0 to destroy.' 1 '::error::infrastructure drift'
expect 'a failed refresh is an error, not drift' failure $'Planning failed. OpenTofu encountered an error while generating this plan.\n403 Forbidden' 1 '::error::drift check could not plan'
expect 'a failed postcondition is an error, not drift' failure 'OpenTofu planned the following actions, but then encountered a problem:' 1 '::error::drift check could not plan'
expect 'no plan file is an error' failure - 1 '::error::drift check could not plan'
expect 'a skipped plan is an error' skipped - 1 '::error::drift check could not plan'

# The summary holds the plan inside a fence, so its "# resource" lines don't render as headings.
printf '  # x will be updated in-place\n' > "$tmp/drift.txt"
"$here/infra-drift-result.sh" failure "$tmp/drift.txt" "$tmp/summary.md" >/dev/null 2>&1 || true
grep -q '^~~~~~~$' "$tmp/summary.md" || fail "summary: plan not fenced with ~~~~~~"
grep -qF '  # x will be updated in-place' "$tmp/summary.md" || fail "summary: plan text missing"

(( failures == 0 )) || exit 1
echo "infra-drift-result: ok"
