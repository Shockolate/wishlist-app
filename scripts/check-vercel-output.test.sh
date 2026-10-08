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
