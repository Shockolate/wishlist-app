# IDs aren't secrets (spec §3.2), so they live here rather than in a .tfvars.
locals {
  # Cloudflare → R2 overview → Account ID. Also the R2 endpoint's host.
  cloudflare_account_id = "360ce0ccec8b699043f7a3bf2f8aa8f2"

  r2_endpoint = "https://${local.cloudflare_account_id}.r2.cloudflarestorage.com"
}
