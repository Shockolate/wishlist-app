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
