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
# A filePathMap makes `vercel deploy --prebuilt` read files from the workspace (node_modules), which
# deploy jobs deliberately don't install. `vercel build --standalone` inlines them instead.
while IFS= read -r -d '' config; do
  if [[ "$(jq '.filePathMap // {} | length' "$config")" != 0 ]]; then
    echo "::error::$config reads files from the workspace (filePathMap); build with vercel build --standalone" >&2
    exit 1
  fi
done < <(find "$dir" -name .vc-config.json -print0)

# The output is built by a job that runs untrusted code but deployed by one that holds
# VERCEL_TOKEN, which follows symlinks when it uploads. Every symlink (pnpm's layout) must stay
# inside the output, or a crafted one could publish that job's files (e.g. /proc/self/environ).
root=$(realpath "$dir")
while IFS= read -r -d '' link; do
  target=$(readlink "$link")
  resolved=$(realpath -m "$link")
  if [[ "$target" == /* || "$resolved" != "$root"/* ]]; then
    echo "::error::$link points outside the build output ($target); refusing to deploy" >&2
    exit 1
  fi
done < <(find "$dir" -type l -print0)
echo "build output complete: $dir"
