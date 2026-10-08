#!/usr/bin/env bash
# Verifies vercel-url.sh extracts the deployment URL from either form of `vercel deploy` stdout.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
fail() { echo "vercel-url: $1" >&2; exit 1; }

plain=$(printf 'https://wishlist-abc123-shockolate.vercel.app\n' | "$here/vercel-url.sh")
[[ "$plain" == "https://wishlist-abc123-shockolate.vercel.app" ]] || fail "plain form gave '$plain'"

json=$(printf '{\n  "status": "ok",\n  "deployment": { "url": "https://wishlist-def456-shockolate.vercel.app" }\n}\n' | "$here/vercel-url.sh")
[[ "$json" == "https://wishlist-def456-shockolate.vercel.app" ]] || fail "json form gave '$json'"

if printf 'Error: something broke\n' | "$here/vercel-url.sh" >/dev/null 2>&1; then
  fail "accepted output with no deployment URL"
fi

echo "vercel-url: ok"
