#!/usr/bin/env bash
# Installs sentry-cli for the jobs that inject and upload browser source maps (D52): one pinned
# release whose sha256 is checked before it runs, never a package manager.
# Usage: scripts/install-sentry-cli.sh <dir>   (then add <dir> to PATH)
set -euo pipefail

version=3.8.0
sha256=13f8cb34ae01a6a272d7d7c22e277a105286615b4020de900ea95a8de47cdbb6

dir="${1:?usage: install-sentry-cli.sh <dir>}"
mkdir -p "$dir"
download="$dir/sentry-cli.download"
curl -fsSL -o "$download" "https://github.com/getsentry/sentry-cli/releases/download/$version/sentry-cli-Linux-x86_64"
if ! echo "$sha256  $download" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$download"
  echo "::error::sentry-cli $version failed its checksum; refusing to run it" >&2
  exit 1
fi
chmod +x "$download"
mv "$download" "$dir/sentry-cli"
echo "sentry-cli $version installed in $dir"
