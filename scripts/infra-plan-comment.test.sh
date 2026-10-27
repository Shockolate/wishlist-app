#!/usr/bin/env bash
# Verifies infra-plan-comment.sh frames a plan for a PR comment and cuts one that GitHub would
# refuse (a comment body is at most 65,536 characters; Review Focus 3).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0
fail() { echo "infra-plan-comment.test: $1" >&2; failures=$((failures + 1)); }
sha=0123456789abcdef0123456789abcdef01234567

# short plan passes through whole
printf 'No changes. Your infrastructure matches the configuration.\n' > "$tmp/short.txt"
out=$("$here/infra-plan-comment.sh" "$tmp/short.txt" "$sha")
grep -qF 'No changes. Your infrastructure matches the configuration.' <<<"$out" || fail "short plan: text missing"
grep -qF 'Plan truncated' <<<"$out" && fail "short plan: says truncated"

# output contains the sha
grep -qF "$sha" <<<"$out" || fail "output doesn't name the commit"

# 70,000-character plan is cut to 60,000 and says "Plan truncated"
head -c 70000 /dev/zero | tr '\0' 'x' > "$tmp/long.txt"
out=$("$here/infra-plan-comment.sh" "$tmp/long.txt" "$sha")
xs=$(tr -cd 'x' <<<"$out" | wc -c)
(( xs == 60000 )) || fail "long plan: kept $xs characters of plan, want 60000"
grep -qF 'Plan truncated: run tofu plan locally for the rest.' <<<"$out" || fail "long plan: no truncation note"
(( ${#out} < 65536 )) || fail "long plan: comment is ${#out} characters, over GitHub's limit"

(( failures == 0 )) || exit 1
echo "infra-plan-comment: ok"
