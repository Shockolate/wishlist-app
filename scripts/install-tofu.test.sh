#!/usr/bin/env bash
# Verifies install-tofu.sh pins one release, reads its version from infra/.opentofu-version, and
# refuses a download that fails its checksum (D93).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
# A curl that "downloads" a well-formed zip holding the wrong tofu to wherever -o points, so only
# the checksum can refuse it.
printf '#!/bin/sh\necho impostor\n' > "$tmp/tofu"
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1], "w").write(sys.argv[2], "tofu")' "$tmp/impostor.zip" "$tmp/tofu"
cat > "$tmp/bin/curl" <<INNER
#!/usr/bin/env bash
while (( \$# )); do
  if [[ "\$1" == -o ]]; then cp "$tmp/impostor.zip" "\$2"; fi
  shift
done
INNER
chmod +x "$tmp/bin/curl"

fail() { echo "install-tofu.test: $1" >&2; exit 1; }

grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' "$root/infra/.opentofu-version" 2>/dev/null \
  || fail "infra/.opentofu-version must be one exact X.Y.Z version"
grep -Eq '^sha256=[0-9a-f]{64}$' "$here/install-tofu.sh" || fail "pin a sha256"
grep -Eq 'releases/download/v\$\{?version\}?/tofu_\$\{?version\}?_linux_amd64\.zip' "$here/install-tofu.sh" \
  || fail "build the download URL from \$version, so the pin and the version file can't disagree"

if PATH="$tmp/bin:$PATH" "$here/install-tofu.sh" "$tmp/out" >/dev/null 2>&1; then
  fail "accepted a download that failed its checksum"
fi
[[ ! -e "$tmp/out/tofu" ]] || fail "left a binary behind after refusing it"
echo "install-tofu: ok"
