#!/usr/bin/env bash
# Installs OpenTofu for the infra jobs (D93): one pinned release whose sha256 is checked before it
# runs, never a package manager. The version lives in infra/.opentofu-version; bump it and the
# sha256 together, taking the hash from the release's SHA256SUMS after checking its signature.
# Usage: scripts/install-tofu.sh <dir>   (then add <dir> to PATH)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(<"$root/infra/.opentofu-version")
sha256=723bebb0df8411daff1e5fc3862e28ff5581fe5634087f4c29a9aa41d78208b5

dir="${1:?usage: install-tofu.sh <dir>}"
mkdir -p "$dir"
download="$dir/tofu.zip.download"
curl -fsSL -o "$download" "https://github.com/opentofu/opentofu/releases/download/v${version}/tofu_${version}_linux_amd64.zip"
if ! echo "$sha256  $download" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$download"
  echo "::error::OpenTofu $version failed its checksum; refusing to run it" >&2
  exit 1
fi
unzip -q -o -j "$download" tofu -d "$dir"
rm -f "$download"
echo "OpenTofu $version installed in $dir"
