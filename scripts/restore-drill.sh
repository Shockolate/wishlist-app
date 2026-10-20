#!/usr/bin/env bash
# Restore drill (spec §10 Recovery, D49). Proves a nightly dump decrypts with the key you kept and
# restores into a working database. It runs on the owner's machine, the only place the private key
# is, and restores into a throwaway container that it creates and removes. With --keep, a passing
# run leaves the container up for a real recovery (docs/deployment.md).
# Usage: scripts/restore-drill.sh [--keep] <dump.age> <identity-file>
# Env:   HEALTH_URL (default https://hanker.dev/api/health), READY_SECONDS (default 60)
set -euo pipefail

usage='usage: restore-drill.sh [--keep] <dump.age> <identity-file>'
keep=
if [[ "${1:-}" == --keep ]]; then keep=1; shift; fi
dump="${1:?$usage}"
identity="${2:?$usage}"
health_url="${HEALTH_URL:-https://hanker.dev/api/health}"
here=$(cd "$(dirname "$0")" && pwd)

die() {
  echo "restore drill FAILED: $*" >&2
  exit 1
}

for tool in docker age curl jq; do
  command -v "$tool" >/dev/null || die "$tool isn't installed"
done
[[ -f "$dump" ]] || die "no such dump: $dump"
[[ -f "$identity" ]] || die "no such identity file: $identity"

pg_image=$(<"$here/postgres-image")
name="hanker-restore-drill-$(date +%s)-$$"
passed=
# Removes only this run's container, and its volumes (-v), unless --keep and the drill passed.
cleanup() {
  if [[ -n "$keep" && -n "$passed" ]]; then return; fi
  docker rm -fv "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The data directory and /tmp are tmpfs: the decrypted dump and the restored rows stay in memory,
# and no anonymous volume outlives the container. No port is published; everything goes through
# docker exec.
docker run -d --name "$name" --label hanker.restore-drill=1 \
  --tmpfs /var/lib/postgresql/data --tmpfs /tmp \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=drill \
  "$pg_image" >/dev/null

# Over TCP, not the socket: while initdb runs, the image starts a temporary server that listens on
# the socket only, then restarts it, so a socket check can pass before the real server is up.
ready=
for (( i = 0; i < ${READY_SECONDS:-60}; i++ )); do
  if docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres -d drill; then
    ready=1
    break
  fi
  sleep 1
done
[[ -n "$ready" ]] || die "Postgres didn't start in $name"

sql() { docker exec "$name" psql -h 127.0.0.1 -U postgres -d drill -XtAq -v ON_ERROR_STOP=1 -c "$1"; }

echo "Decrypting $dump. age asks for the identity file's passphrase."
age -d -i "$identity" "$dump" | docker exec -i "$name" sh -c 'cat > /tmp/dump.pgc' \
  || die "couldn't decrypt $dump with $identity"
docker exec "$name" pg_restore -h 127.0.0.1 -U postgres -d drill \
  --exit-on-error --single-transaction --no-owner --no-privileges /tmp/dump.pgc \
  || die "pg_restore refused the dump"

listed=$(docker exec "$name" pg_restore --list /tmp/dump.pgc \
  | awk '$4 == "TABLE" && $5 == "public" { print $6 }' | LC_ALL=C sort)
restored=$(sql "select tablename from pg_tables where schemaname = 'public'" | LC_ALL=C sort)
[[ -n "$listed" ]] || die "the dump has no tables in public"
if [[ "$listed" != "$restored" ]]; then
  die "the restore doesn't have the dump's tables:
$(diff <(echo "$listed") <(echo "$restored") || true)"
fi

migrations=$(sql 'select count(*) from drizzle.__drizzle_migrations')
production=$(curl -fsS --max-time 15 "$health_url" | jq -r '.db.migrationsApplied') || production=
problem=
if [[ -z "$production" ]]; then
  problem="couldn't read $health_url"
elif [[ "$migrations" != "$production" ]]; then
  problem="the dump has $migrations migrations and production reports $production. If a migration shipped after this dump was taken, use a newer dump."
fi
# A recovery (--keep) restores a dump from before the bad change, which can predate a migration,
# and production may be the thing that's down. There the checks only warn; the drill fails on them.
if [[ -n "$problem" ]]; then
  [[ -n "$keep" ]] || die "$problem"
  echo "warning: $problem" >&2
  echo "Keeping the restore for recovery. If the migrations differ, name the columns when you copy rows back." >&2
fi

echo "Rows per table:"
while IFS= read -r table; do
  printf '  %-24s %s\n' "$table" "$(sql "select count(*) from public.\"$table\"")"
done <<<"$restored"

passed=1
if [[ -n "$problem" ]]; then
  echo "restored for recovery, not a passing drill: $dump ($migrations migrations; see the warning above)"
else
  echo "restore drill: ok ($dump decrypted and restored; $migrations migrations, matching production)"
fi
if [[ -n "$keep" ]]; then
  echo "Kept $name. Query it:  docker exec -it $name psql -h 127.0.0.1 -U postgres -d drill"
  echo "Remove it when done:  docker rm -fv $name"
fi
