#!/usr/bin/env bash
# Verifies install-sentry-cli.sh pins one release and refuses a download that fails its checksum.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
# A curl that "downloads" the wrong bytes to wherever -o points.
cat > "$tmp/bin/curl" <<'INNER'
#!/usr/bin/env bash
while (( $# )); do
  if [[ "$1" == -o ]]; then printf 'not sentry-cli' > "$2"; fi
  shift
done
INNER
chmod +x "$tmp/bin/curl"

grep -q '^version=3\.8\.0$' "$here/install-sentry-cli.sh" || { echo "install-sentry-cli.test: pin version=3.8.0" >&2; exit 1; }
grep -Eq '^sha256=[0-9a-f]{64}$' "$here/install-sentry-cli.sh" || { echo "install-sentry-cli.test: pin a sha256" >&2; exit 1; }

if PATH="$tmp/bin:$PATH" "$here/install-sentry-cli.sh" "$tmp/out" >/dev/null 2>&1; then
  echo "install-sentry-cli.test: accepted a download that failed its checksum" >&2
  exit 1
fi
[[ ! -e "$tmp/out/sentry-cli" ]] || { echo "install-sentry-cli.test: left a binary behind after refusing it" >&2; exit 1; }
echo "install-sentry-cli: ok"
