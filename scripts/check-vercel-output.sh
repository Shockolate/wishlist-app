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
echo "build output complete: $dir"
