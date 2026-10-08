#!/usr/bin/env bash
# Verifies check-vercel-output.sh catches an output whose hidden files were dropped.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/good/functions/index.func" "$work/stripped/functions/index.func" "$work/linked/functions/index.func"
echo '{}' > "$work/good/config.json"
echo '{}' > "$work/good/functions/index.func/.vc-config.json"
echo '{}' > "$work/stripped/config.json"
echo '{}' > "$work/linked/config.json"
echo '{"filePathMap":{"node_modules/zod":"node_modules/zod"}}' > "$work/linked/functions/index.func/.vc-config.json"

"$here/check-vercel-output.sh" "$work/good" >/dev/null || { echo "check-vercel-output: FAIL: rejected a complete output" >&2; exit 1; }
if "$here/check-vercel-output.sh" "$work/stripped" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted an output without .vc-config.json" >&2
  exit 1
fi
if "$here/check-vercel-output.sh" "$work/missing" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted a missing directory" >&2
  exit 1
fi
if "$here/check-vercel-output.sh" "$work/linked" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted a function that reads files from the workspace (filePathMap)" >&2
  exit 1
fi
# pnpm's layout survives as relative symlinks inside the output; those are fine.
mkdir -p "$work/good/functions/index.func/node_modules/.pnpm/zod/node_modules/zod"
ln -s .pnpm/zod/node_modules/zod "$work/good/functions/index.func/node_modules/zod"
"$here/check-vercel-output.sh" "$work/good" >/dev/null || { echo "check-vercel-output: FAIL: rejected an internal symlink" >&2; exit 1; }

# The output comes from an untrusted build job but is read by a deploy job holding VERCEL_TOKEN:
# a symlink that leaves the output would make `vercel deploy` upload that job's files.
for target in /proc/self/environ ../../../../outside; do
  rm -rf "$work/escape" && cp -R "$work/good" "$work/escape"
  ln -s "$target" "$work/escape/functions/index.func/leak"
  if "$here/check-vercel-output.sh" "$work/escape" >/dev/null 2>&1; then
    echo "check-vercel-output: FAIL: accepted a symlink that leaves the output ($target)" >&2
    exit 1
  fi
done
echo "check-vercel-output: ok"
