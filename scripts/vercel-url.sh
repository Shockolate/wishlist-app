#!/usr/bin/env bash
# Reads `vercel deploy` stdout and prints the deployment URL. The CLI prints a bare URL normally,
# but a JSON object ({"deployment":{"url":…}}) when it detects an AI agent; accept both, and fail
# rather than pass along something that isn't a URL.
set -euo pipefail

out=$(cat)
if [[ "$out" == \{* ]]; then
  url=$(jq -r '.deployment.url // empty' <<<"$out")
else
  url=$(tail -n 1 <<<"$out")
fi

if [[ "$url" != https://* ]]; then
  echo "vercel-url: no deployment URL in output: $out" >&2
  exit 1
fi
echo "$url"
