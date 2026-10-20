#!/usr/bin/env bash
# Nightly backup (spec §10 Recovery; D47, D48). Dumps production as the read-only role, encrypts
# the dump in the pipe with age, uploads it to R2, checks the stored size, and pings the Better
# Stack heartbeat. Any failure pings the heartbeat's /fail URL, so a broken backup alerts that night.
# Usage: scripts/backup.sh
# Env:   DATABASE_URL_BACKUP, AGE_RECIPIENT, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#        R2_BUCKET, BACKUP_HEARTBEAT_URL (all required)
set -euo pipefail

: "${BACKUP_HEARTBEAT_URL:?BACKUP_HEARTBEAT_URL must be set}"
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)

finish() {
  local status=$?
  rm -rf "$work"
  if (( status != 0 )); then
    curl -fsS --max-time 10 --retry 3 -o /dev/null "$BACKUP_HEARTBEAT_URL/fail" \
      || echo "::warning::couldn't report the failure to the backup heartbeat" >&2
  fi
  exit "$status"
}
trap finish EXIT

for name in DATABASE_URL_BACKUP AGE_RECIPIENT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::$name must be set" >&2
    exit 1
  fi
done

pg_image=$(<"$here/postgres-image")
key="daily/$(date -u +%Y-%m-%dT%H%M%SZ).dump.age"
url="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}"
file="$work/backup.dump.age"

# The URL reaches the container through its environment, so it's never on the runner's docker
# command line. Inside the container it's pg_dump's argument, visible only to that container.
# The plaintext exists only inside the pipe.
docker run --rm -e DATABASE_URL_BACKUP "$pg_image" \
  sh -c 'exec pg_dump --dbname="$DATABASE_URL_BACKUP" --format=custom --no-owner --no-privileges' \
  | age -r "$AGE_RECIPIENT" > "$file"

if [[ "$(head -c 21 "$file")" != "age-encryption.org/v1" ]]; then
  echo "::error::the dump isn't age-encrypted; refusing to upload it" >&2
  exit 1
fi
size=$(stat -c %s "$file")

# Signs requests for R2's S3 API. The credentials reach curl on stdin, never argv. The payload
# hash is sent explicitly so the signature never depends on curl's default for the s3 service.
r2() {
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" \
    | curl --config - --aws-sigv4 'aws:amz:auto:s3' -fsS --max-time 300 "$@"
}
r2 -T "$file" -H "x-amz-content-sha256: $(sha256sum "$file" | cut -d ' ' -f 1)" -o /dev/null "$url"

empty_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
stored=$(r2 --head -H "x-amz-content-sha256: $empty_sha256" "$url" \
  | tr -d '\r' | awk -F': *' 'tolower($1) == "content-length" { print $2 }')
if [[ "$stored" != "$size" ]]; then
  echo "::error::R2 stored ${stored:-nothing} bytes for $key, expected $size" >&2
  exit 1
fi

curl -fsS --max-time 10 --retry 3 -o /dev/null "$BACKUP_HEARTBEAT_URL"
echo "backup uploaded: $key ($size bytes)"
