#!/usr/bin/env bash
# Takes the browser source maps out of a web build's deploy output (D52). sentry-cli first writes
# a debug ID into each chunk and its map, so Sentry pairs them without release bookkeeping. Each
# map then moves to <dest> with a copy of its chunk, and hanker.dev never serves it.
# Sentry tooling must never block a release: if sentry-cli is missing or inject fails, the maps
# are useless without debug IDs, so they are deleted (never served), the skip is noted in
# <dest>/README.txt, and the script still exits 0 with a ::warning::.
# Usage: scripts/extract-sourcemaps.sh <static-dir> <dest>   (sentry-cli on PATH)
set -euo pipefail

src="${1:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
dest="${2:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
# A trailing slash would leave the "/" in front of each path, so the relative path below would
# keep the absolute prefix.
src="${src%/}"
mkdir -p "$dest"
# Always something to upload, so the sourcemaps job's download never fails on an empty artifact.
echo "Browser source maps for Sentry, from scripts/extract-sourcemaps.sh" > "$dest/README.txt"

if ! find "$src" -name '*.map' -print -quit | grep -q .; then
  echo "no source maps under $src; nothing to extract"
  exit 0
fi

skip_maps() {
  echo "::warning::$1; dropping the source maps, so this release deploys without them"
  find "$src" -name '*.map' -delete
  echo "Skipped: $1. No source maps were extracted for this release." >> "$dest/README.txt"
  exit 0
}
command -v sentry-cli >/dev/null 2>&1 || skip_maps "sentry-cli isn't on PATH"
sentry-cli sourcemaps inject "$src" || skip_maps "sentry-cli sourcemaps inject failed"
moved=0
while IFS= read -r -d '' map; do
  rel="${map#"$src"/}"
  mkdir -p "$dest/$(dirname "$rel")"
  if [[ -f "${map%.map}" ]]; then cp "${map%.map}" "$dest/${rel%.map}"; fi
  mv "$map" "$dest/$rel"
  moved=$((moved + 1))
done < <(find "$src" -name '*.map' -print0)

if find "$src" -name '*.map' -print -quit | grep -q .; then
  echo "::error::source maps remain under $src after extraction" >&2
  exit 1
fi
echo "moved $moved source maps to $dest"
