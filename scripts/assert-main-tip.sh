#!/usr/bin/env bash
# Fails unless $GITHUB_SHA is the current tip of origin/main. Every job that touches production
# runs this right after checkout: "Re-run failed jobs" skips the `guard` job, so without it a re-run
# of an older deploy could roll production back.
set -euo pipefail

git fetch --no-tags --depth=1 origin main
tip=$(git rev-parse FETCH_HEAD)
if [[ "$tip" != "${GITHUB_SHA:?GITHUB_SHA is required}" ]]; then
  echo "::error::main is at $tip but this run is for $GITHUB_SHA; refusing to deploy a stale commit."
  exit 1
fi
echo "deploying main tip $tip"
