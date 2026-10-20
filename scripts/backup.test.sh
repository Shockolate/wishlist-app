#!/usr/bin/env bash
# Verifies backup.sh with docker, age and curl stubbed on PATH: the steps' order, that no secret
# reaches a command line, and that every failure uploads nothing wrong and reports to /fail.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bin="$tmp/bin"
mkdir -p "$bin"

cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [[ "${STUB_DUMP_FAILS:-}" == 1 ]]; then printf 'PGDMP-partial'; exit 1; fi
printf 'PGDMP-fake-dump'
EOF
cat > "$bin/age" <<'EOF'
#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
[[ "${STUB_NO_AGE_HEADER:-}" == 1 ]] || printf 'age-encryption.org/v1\n'
cat
EOF
cat > "$bin/curl" <<'EOF'
#!/usr/bin/env bash
args=" $* "
echo "curl $*" >> "$STUB_LOG"
if [[ "$args" == *" --config - "* ]]; then cat >> "$STUB_CONFIG"; fi
upload=
while (( $# )); do
  if [[ "$1" == -T ]]; then upload="$2"; fi
  shift
done
if [[ -n "$upload" ]]; then stat -c %s "$upload" > "$STUB_UPLOADED"; fi
if [[ "$args" == *" --head "* ]]; then
  printf 'HTTP/1.1 200 OK\r\ncontent-length: %s\r\n\r\n' "${STUB_STORED_SIZE:-$(cat "$STUB_UPLOADED")}"
fi
EOF
chmod +x "$bin"/*

export STUB_LOG="$tmp/log" STUB_CONFIG="$tmp/config" STUB_UPLOADED="$tmp/uploaded"
db_secret='db-secret-123'
r2_secret='r2-secret-456'
heartbeat='https://uptime.example/api/v1/heartbeat/hb-token'

# Runs backup.sh with every variable set; extra NAME=value arguments override them. Prints the status.
run() {
  : > "$STUB_LOG"
  : > "$STUB_CONFIG"
  rm -f "$STUB_UPLOADED"
  local status=0
  env PATH="$bin:$PATH" \
    DATABASE_URL_BACKUP="postgres://hanker_backup:$db_secret@ep-x.neon.tech/neondb?sslmode=require" \
    AGE_RECIPIENT=age1test R2_ACCOUNT_ID=acct R2_ACCESS_KEY_ID=akid \
    R2_SECRET_ACCESS_KEY="$r2_secret" R2_BUCKET=bucket BACKUP_HEARTBEAT_URL="$heartbeat" \
    "$@" "$here/backup.sh" > "$tmp/out" 2>&1 || status=$?
  echo "$status"
}
fail() {
  echo "backup.test: $*" >&2
  echo "--- output" >&2; cat "$tmp/out" >&2
  echo "--- commands" >&2; cat "$STUB_LOG" >&2
  exit 1
}
uploaded() { grep -q -- ' -T ' "$STUB_LOG"; }
pinged_ok() { grep -q -- " $heartbeat\$" "$STUB_LOG"; }
pinged_fail() { tail -n 1 "$STUB_LOG" | grep -q -- " $heartbeat/fail\$"; }

grep -Eqx 'postgres:17-alpine@sha256:[0-9a-f]{64}' "$here/postgres-image" \
  || fail "scripts/postgres-image must pin postgres:17-alpine by digest"

# A clean run: dump → encrypt → upload → size check → heartbeat, in that order.
[[ $(run) == 0 ]] || fail "a clean run should succeed"
mapfile -t lines < "$STUB_LOG"
[[ ${#lines[@]} == 5 ]] || fail "expected dump, encrypt, upload, size check, heartbeat"
# docker and age are the two ends of one pipeline, so they start together and log in either order.
mapfile -t pipeline < <(printf '%s\n' "${lines[@]:0:2}" | LC_ALL=C sort)
[[ ${pipeline[0]} == "age -r age1test" ]] || fail "encrypt to AGE_RECIPIENT"
[[ ${pipeline[1]} == "docker run --rm -e DATABASE_URL_BACKUP $(cat "$here/postgres-image") "* ]] \
  || fail "dump with the pinned image, the URL passed by name only"
[[ ${lines[2]} =~ \ -T\ .*\ https://acct\.r2\.cloudflarestorage\.com/bucket/daily/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$ ]] \
  || fail "upload to the bucket under daily/<timestamp>.dump.age"
[[ ${lines[3]} == *" --head "* ]] || fail "check the stored object after uploading"
[[ ${lines[4]} == *" $heartbeat" ]] || fail "ping the heartbeat last"
! grep -q '/fail' "$STUB_LOG" || fail "a clean run must not report a failure"
! grep -qF -e "$db_secret" -e "$r2_secret" "$STUB_LOG" || fail "a secret reached a command line"
grep -qxF 'user = "akid:r2-secret-456"' "$STUB_CONFIG" || fail "R2 credentials go to curl on stdin"

# Review Focus #4: each failure uploads nothing wrong and reports to /fail.
[[ $(run STUB_DUMP_FAILS=1) != 0 ]] || fail "a failed dump must fail the run"
! uploaded || fail "a failed dump must not be uploaded"
pinged_fail || fail "a failed dump must ping /fail"

[[ $(run STUB_NO_AGE_HEADER=1) != 0 ]] || fail "output without the age header must fail the run"
! uploaded || fail "output without the age header must never be uploaded"
pinged_fail || fail "a missing age header must ping /fail"

[[ $(run STUB_STORED_SIZE=1) != 0 ]] || fail "a size mismatch after upload must fail the run"
! pinged_ok || fail "a size mismatch must not ping success"
pinged_fail || fail "a size mismatch must ping /fail"

[[ $(run R2_BUCKET=) != 0 ]] || fail "a missing R2_BUCKET must fail the run"
! grep -q '^docker ' "$STUB_LOG" || fail "a missing variable must stop the run before the dump"
pinged_fail || fail "a missing variable must ping /fail"

[[ $(run BACKUP_HEARTBEAT_URL=) != 0 ]] || fail "a missing BACKUP_HEARTBEAT_URL must fail the run"
[[ ! -s "$STUB_LOG" ]] || fail "without a heartbeat URL nothing may run"

echo "backup: ok"
