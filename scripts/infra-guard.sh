#!/usr/bin/env bash
# Refuses OpenTofu constructs that could run code, print a secret or loosen state encryption
# (spec 2026-10-27 §3.9). It runs before any secret in the infra jobs, and in the secret-free `infra`
# CI job. It's grep-level defence in depth, not the boundary: the `infra-plan` environment's
# required approval is (§3.7).
# Usage: scripts/infra-guard.sh [dir]   (default: infra)
set -euo pipefail

dir="${1:-infra}"
[[ -d "$dir" ]] || { echo "infra-guard: no directory $dir" >&2; exit 1; }

ALLOWED_PROVIDERS=(
  registry.opentofu.org/cloudflare/cloudflare
  registry.opentofu.org/integrations/github
  registry.opentofu.org/betterstackhq/better-uptime
  registry.opentofu.org/vercel/vercel
)

findings=0
refuse() {
  echo "infra-guard: $1"
  findings=$((findings + 1))
}

# Every file below dir, minus the provider cache tofu init writes.
files() { find "$dir" -path '*/.terraform' -prune -o -type f -print; }
# OpenTofu reads both *.tf and *.tofu (a .tofu file shadows its .tf twin).
config_files() { files | grep -E '\.(tf|tofu)$' || true; }
# Config without comment lines, prefixed with file:line for the reason.
config_lines() {
  local f
  while IFS= read -r f; do
    grep -nHvE '^[[:space:]]*(#|//)' "$f" || true
  done < <(config_files)
}

while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    override.tf | override.tofu | *_override.tf | *_override.tofu | *override.tf.json | *override.tofu.json)
      refuse "override file: $f" ;;
    *.tf.json | *.tofu.json) refuse "JSON config isn't used here, so it isn't scanned: $f" ;;
    generated_*.tf) refuse "generated config file (fold it into a reviewed .tf, then delete it): $f" ;;
    .tofurc | .terraformrc | terraform.rc) refuse "CLI config (its dev_overrides would bypass the lockfile): $f" ;;
  esac
done < <(files)

# A CLI config anywhere in the repo, when run from a checkout.
if root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null); then
  while IFS= read -r f; do
    [[ -n "$f" ]] && refuse "CLI config (its dev_overrides would bypass the lockfile): $f"
  done < <(git -C "$root" ls-files | grep -E '(^|/)(\.tofurc|\.terraformrc|terraform\.rc)$' || true)
fi

lines=$(config_lines)
check() { # check <ERE> <reason>
  local hit
  while IFS= read -r hit; do
    [[ -n "$hit" ]] && refuse "$2: ${hit%%:*}"
  done < <(grep -E "$1" <<<"$lines" || true)
}
check ':[0-9]+:[[:space:]]*provisioner[[:space:]]+"' 'provisioner'
check ':[0-9]+:[[:space:]]*data[[:space:]]+"external"' 'data "external"'
check ':[0-9]+:[[:space:]]*data[[:space:]]+"http"' 'data "http"'
check ':[0-9]+:[[:space:]]*module[[:space:]]+"' 'module block'
check ':[0-9]+:[[:space:]]*output[[:space:]]+"' 'output block'
check 'nonsensitive[[:space:]]*\(' 'nonsensitive()'

lockfile="$dir/.terraform.lock.hcl"
if [[ -f "$lockfile" ]]; then
  while IFS= read -r provider; do
    allowed=false
    for a in "${ALLOWED_PROVIDERS[@]}"; do [[ "$provider" == "$a" ]] && allowed=true; done
    $allowed || refuse "provider outside the allowlist: $provider"
  done < <(sed -nE 's/^provider "([^"]+)".*/\1/p' "$lockfile" | tr '[:upper:]' '[:lower:]')
fi

# Both the state and plan blocks of encryption.tf say enforced = true.
encryption="$dir/encryption.tf"
if [[ ! -f "$encryption" ]]; then
  refuse "encryption: $encryption is missing"
else
  for block in state plan; do
    awk -v block="$block" '
      /^[[:space:]]*(#|\/\/)/ { next }
      !inside && $0 ~ "^[[:space:]]*" block "[[:space:]]*[{]" { inside = 1; depth = 0 }
      inside {
        if ($0 ~ /^[[:space:]]*enforced[[:space:]]*=[[:space:]]*true[[:space:]]*$/ && depth == 1) found = 1
        depth += gsub(/[{]/, "{") - gsub(/[}]/, "}")
        if (depth == 0) inside = 0
      }
      END { exit found ? 0 : 1 }
    ' "$encryption" || refuse "encryption: the $block block doesn't set enforced = true"
  done
fi

(( findings == 0 ))
