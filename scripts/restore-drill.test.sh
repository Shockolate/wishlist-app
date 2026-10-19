#!/usr/bin/env bash
# Verifies restore-drill.sh with docker, age and curl stubbed on PATH: the container is
# in-memory, publishes no port and is always removed with its volumes (Review Focus #1); readiness
# goes over TCP (#2); and a stale dump or a missing table fails the drill (#5).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bin="$tmp/bin"
mkdir -p "$bin"

cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
args=" $* "
case "$1" in
  run) echo c0ffee ;;
  rm) ;;
  exec)
    if [[ "$args" == *" pg_isready "* ]]; then exit 0; fi
    if [[ "$args" == *"cat > /tmp/dump.pgc"* ]]; then cat > /dev/null; exit 0; fi
    if [[ "$args" == *" pg_restore --list "* ]]; then
      printf '%s\n' \
        '218; 1259 16386 TABLE drizzle __drizzle_migrations postgres' \
        '219; 1259 16389 TABLE public users postgres' \
        '220; 1259 16390 TABLE public items postgres' \
        '3458; 0 16389 TABLE DATA public users postgres'
      exit 0
    fi
    if [[ "$args" == *" pg_restore "* ]]; then exit "${STUB_RESTORE_EXIT:-0}"; fi
    if [[ "$args" == *"pg_tables"* ]]; then printf '%s\n' ${STUB_TABLES:-items users}; exit 0; fi
    if [[ "$args" == *"__drizzle_migrations"* ]]; then echo "${STUB_MIGRATIONS:-4}"; exit 0; fi
    if [[ "$args" == *"count(*)"* ]]; then echo 7; exit 0; fi
    echo "unexpected: docker $*" >&2; exit 99 ;;
  *) echo "unexpected: docker $*" >&2; exit 99 ;;
esac
EOF
cat > "$bin/age" <<'EOF'
#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
echo plaintext
EOF
cat > "$bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
printf '{"status":"ok","sha":"abc","db":{"ok":true,"migrationsApplied":%s}}\n' "${STUB_PROD_MIGRATIONS:-4}"
EOF
chmod +x "$bin"/*

export STUB_LOG="$tmp/log"
dump="$tmp/2026-10-20T071702Z.dump.age"
identity="$tmp/identity.age"
touch "$dump" "$identity"

# Runs the drill with the stubs; NAME=value arguments set env, the rest are passed to the script.
run() {
  : > "$STUB_LOG"
  local vars=() status=0
  while [[ "${1:-}" == *=* ]]; do vars+=("$1"); shift; done
  env PATH="$bin:$PATH" "${vars[@]}" "$here/restore-drill.sh" "$@" > "$tmp/out" 2>&1 || status=$?
  echo "$status"
}
fail() {
  echo "restore-drill.test: $*" >&2
  echo "--- output" >&2; cat "$tmp/out" >&2
  echo "--- commands" >&2; cat "$STUB_LOG" >&2
  exit 1
}
container() { sed -n 's/^docker run .*--name \([^ ]*\) .*/\1/p' "$STUB_LOG"; }
removed() { grep -qx "docker rm -fv $(container)" "$STUB_LOG"; }

# A clean drill.
[[ $(run "$dump" "$identity") == 0 ]] || fail "a clean drill should pass"
grep -q 'restore drill: ok' "$tmp/out" || fail "say the drill passed"
grep -Eq '^ +users +7$' "$tmp/out" || fail "print each table's row count"
name=$(container)
[[ "$name" == hanker-restore-drill-* ]] || fail "name the container hanker-restore-drill-*"
run_line=$(grep '^docker run ' "$STUB_LOG")
[[ "$run_line" == *" --label hanker.restore-drill=1 "* ]] || fail "label the container"
[[ "$run_line" == *" --tmpfs /var/lib/postgresql/data "* ]] || fail "keep the data directory in memory"
[[ "$run_line" == *" --tmpfs /tmp "* ]] || fail "keep the decrypted dump in memory"
[[ "$run_line" != *" -p "* && "$run_line" != *"--publish"* ]] || fail "publish no port"
[[ "$run_line" == *" $(cat "$here/postgres-image")" ]] || fail "use the pinned image"
if grep ' pg_isready ' "$STUB_LOG" | grep -qv -- ' -h 127.0.0.1 '; then
  fail "check readiness over TCP (-h 127.0.0.1), not the socket"
fi
grep -qx "age -d -i $identity $dump" "$STUB_LOG" || fail "decrypt with the given identity"
grep -q '^curl .*https://hanker\.dev/api/health$' "$STUB_LOG" || fail "compare with production's health"
removed || fail "remove the container and its volumes"
# Every docker exec and docker rm names this run's container as a whole word.
if grep -E '^docker (exec|rm) ' "$STUB_LOG" | grep -Eqv -- " $name( |\$)"; then
  fail "touch only the drill's own container"
fi

# Review Focus #5: a dump older than production's schema, or a lost table, fails the drill.
[[ $(run STUB_PROD_MIGRATIONS=5 "$dump" "$identity") != 0 ]] || fail "a migration mismatch must fail"
grep -q 'use a newer dump' "$tmp/out" || fail "a migration mismatch must say to use a newer dump"
removed || fail "a failed drill must still remove its container"

[[ $(run STUB_TABLES=users "$dump" "$identity") != 0 ]] || fail "a table missing from the restore must fail"
removed || fail "a failed drill must still remove its container"

[[ $(run STUB_RESTORE_EXIT=1 "$dump" "$identity") != 0 ]] || fail "a refused restore must fail"
removed || fail "a refused restore must still remove its container"

# --keep leaves a passing drill's container for a real recovery, but never a failed one's.
[[ $(run --keep "$dump" "$identity") == 0 ]] || fail "--keep should pass"
! grep -q '^docker rm ' "$STUB_LOG" || fail "--keep must leave the container running"
grep -q "docker rm -fv $(container)" "$tmp/out" || fail "--keep must print how to remove the container"
[[ $(run STUB_RESTORE_EXIT=1 --keep "$dump" "$identity") != 0 ]] || fail "--keep with a refused restore must fail"
removed || fail "--keep must still remove a failed drill's container"

# Bad arguments never start a container.
[[ $(run) != 0 ]] || fail "no arguments must fail"
[[ $(run "$tmp/missing.dump.age" "$identity") != 0 ]] || fail "a missing dump must fail"
! grep -q '^docker ' "$STUB_LOG" || fail "bad arguments must not start a container"

echo "restore-drill: ok"
