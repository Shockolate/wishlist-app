#!/usr/bin/env bash
# Verifies wait-for-health.sh against a static health document served locally.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
server_pid=""
trap '[[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null; rm -rf "$root"' EXIT

mkdir -p "$root/api"
echo '{"status":"ok","sha":"abc123","db":{"ok":true,"migrationsApplied":1}}' > "$root/api/health"
python3 -m http.server 38999 --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
server_pid=$!
curl -fsS --retry 20 --retry-connrefused --retry-delay 0 -o /dev/null http://127.0.0.1:38999/api/health

export POLL_SECONDS=1
"$here/wait-for-health.sh" http://127.0.0.1:38999/api/health abc123 5

if "$here/wait-for-health.sh" http://127.0.0.1:38999/api/health other-sha 2; then
  echo "expected a timeout when the deployed sha never matches" >&2
  exit 1
fi

echo "wait-for-health: ok"
