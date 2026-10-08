#!/usr/bin/env bash
# Polls an API health endpoint until it reports status "ok" for the expected commit.
# Usage: wait-for-health.sh <health-url> <expected-sha> [timeout-seconds] [extra curl args...]
# Env:   POLL_SECONDS (default 5)
set -euo pipefail

url="$1"
expected="$2"
timeout="${3:-120}"
shift $(( $# < 3 ? $# : 3 ))
poll="${POLL_SECONDS:-5}"
deadline=$(( $(date +%s) + timeout ))

while :; do
  body=$(curl -fsS --max-time 10 "$@" "$url" 2>/dev/null || true)
  status=$(jq -r '.status // empty' <<<"$body" 2>/dev/null || true)
  sha=$(jq -r '.sha // empty' <<<"$body" 2>/dev/null || true)
  if [[ "$status" == "ok" && "$sha" == "$expected" ]]; then
    echo "healthy: $body"
    exit 0
  fi
  if (( $(date +%s) >= deadline )); then
    echo "timed out after ${timeout}s waiting for $url to report sha $expected (last: ${body:-<no response>})" >&2
    exit 1
  fi
  sleep "$poll"
done
