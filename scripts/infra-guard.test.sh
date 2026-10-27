#!/usr/bin/env bash
# Verifies infra-guard.sh refuses every construct spec §3.9 bans, and passes a clean root module.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0
fail() { echo "infra-guard.test: $1" >&2; failures=$((failures + 1)); }

# A minimal root module the guard must accept. Built here, never committed: a committed fixture
# holding a CLI config would trip the guard's repo-wide check.
clean() {
  local d="$tmp/$1"
  mkdir -p "$d"
  cat > "$d/encryption.tf" <<'TF'
terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }
    state {
      method   = method.aes_gcm.main
      enforced = true
    }
    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}
TF
  cat > "$d/main.tf" <<'TF'
# A comment that mentions a provisioner, an output and nonsensitive() is fine.
resource "cloudflare_dns_record" "apex" {
  name = "hanker.dev"
}
TF
  cat > "$d/.terraform.lock.hcl" <<'TF'
provider "registry.opentofu.org/cloudflare/cloudflare" {
  version = "5.0.0"
}
provider "registry.opentofu.org/vercel/vercel" {
  version = "3.0.0"
}
TF
  echo "$d"
}

# expect_refused <case> <reason substring>: the guard exits 1 and names the reason.
expect_refused() {
  local d="$tmp/$1" out
  if out=$("$here/infra-guard.sh" "$d" 2>&1); then
    fail "$1: passed, want refused ($2)"
  elif ! grep -qF -- "$2" <<<"$out"; then
    fail "$1: refused without naming \"$2\": $out"
  fi
}

d=$(clean ok)
"$here/infra-guard.sh" "$d" >/dev/null 2>&1 || fail "clean module: refused: $("$here/infra-guard.sh" "$d" 2>&1)"

d=$(clean no-lockfile) && rm "$d/.terraform.lock.hcl"
"$here/infra-guard.sh" "$d" >/dev/null 2>&1 || fail "a module with no lockfile yet: refused"

d=$(clean provider) && printf 'provider "registry.opentofu.org/hashicorp/external" {\n  version = "2.3.0"\n}\n' >> "$d/.terraform.lock.hcl"
expect_refused provider 'provider outside the allowlist'

d=$(clean provisioner) && printf 'resource "terraform_data" "x" {\n  provisioner "local-exec" {\n    command = "id"\n  }\n}\n' >> "$d/main.tf"
expect_refused provisioner 'provisioner'

d=$(clean external) && printf 'data "external" "x" {\n  program = ["id"]\n}\n' >> "$d/main.tf"
expect_refused external 'data "external"'

d=$(clean http) && printf 'data "http" "x" {\n  url = "https://example.com"\n}\n' >> "$d/main.tf"
expect_refused http 'data "http"'

d=$(clean module) && printf 'module "x" {\n  source = "git::https://example.com/x.git"\n}\n' >> "$d/main.tf"
expect_refused module 'module block'

d=$(clean output) && printf 'output "x" {\n  value = 1\n}\n' >> "$d/main.tf"
expect_refused output 'output block'

d=$(clean nonsensitive) && printf 'locals {\n  x = nonsensitive(var.state_passphrase)\n}\n' >> "$d/main.tf"
expect_refused nonsensitive 'nonsensitive()'

d=$(clean override) && printf 'locals {}\n' > "$d/x_override.tf"
expect_refused override 'override file'

d=$(clean cli-config) && printf 'provider_installation {}\n' > "$d/.tofurc"
expect_refused cli-config 'CLI config'

# A CLI config elsewhere in the checkout counts too.
d=$(clean repo/infra) && printf 'provider_installation {}\n' > "$tmp/repo/.terraformrc"
git -C "$tmp/repo" init -q && git -C "$tmp/repo" add -A
expect_refused repo/infra 'CLI config'

d=$(clean generated) && printf 'locals {}\n' > "$d/generated_vercel.tf"
expect_refused generated 'generated config file'

# Credentials belong in a password manager. Even a file of op:// references stays outside the repo.
d=$(clean env-file) && printf 'AWS_ACCESS_KEY_ID=op://Private/x/y\n' > "$d/tofu.env"
expect_refused env-file 'env file'

d=$(clean dotenv) && printf 'X=1\n' > "$d/.env"
expect_refused dotenv 'env file'

d=$(clean json) && printf '{}\n' > "$d/extra.tf.json"
expect_refused json 'JSON config'

# OpenTofu also reads *.tofu files, so they're scanned like *.tf.
d=$(clean tofu-file) && printf 'output "x" {\n  value = 1\n}\n' > "$d/extra.tofu"
expect_refused tofu-file 'output block'

d=$(clean unenforced) && sed -i '0,/enforced = true/s//enforced = false/' "$d/encryption.tf"
expect_refused unenforced 'encryption'

d=$(clean plan-unenforced) && awk '/plan \{/{p=1} p && /enforced/{next} {print}' "$d/encryption.tf" > "$d/e" && mv "$d/e" "$d/encryption.tf"
expect_refused plan-unenforced 'encryption'

d=$(clean no-encryption) && rm "$d/encryption.tf"
expect_refused no-encryption 'encryption'

(( failures == 0 )) || exit 1
echo "infra-guard: ok"
