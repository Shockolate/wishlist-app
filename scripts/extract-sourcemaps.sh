#!/usr/bin/env bash
# Takes the browser source maps out of a web build's deploy output (D52). sentry-cli first writes
# a debug ID into each chunk and its map, so Sentry pairs them without release bookkeeping. Each
# map then moves to <dest> with a copy of its chunk, and hanker.dev never serves it.
# Usage: scripts/extract-sourcemaps.sh <static-dir> <dest>   (sentry-cli on PATH)
set -euo pipefail

src="${1:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
dest="${2:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
mkdir -p "$dest"
# Always something to upload, so the sourcemaps job's download never fails on an empty artifact.
echo "Browser source maps for Sentry, from scripts/extract-sourcemaps.sh" > "$dest/README.txt"

if ! find "$src" -name '*.map' -print -quit | grep -q .; then
  echo "no source maps under $src; nothing to extract"
  exit 0
fi

sentry-cli sourcemaps inject "$src"
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
