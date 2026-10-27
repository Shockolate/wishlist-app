# Cloudflare: hanker.dev's DNS for Vercel and Resend, DNSSEC, the backup bucket and the Turnstile
# widget (spec §3.1). Authenticates from CLOUDFLARE_API_TOKEN.
provider "cloudflare" {}

# Vercel serves the site. Both are CNAMEs; Cloudflare flattens the apex one. DNS only: proxying
# breaks Vercel's certificates and caching.
resource "cloudflare_dns_record" "apex" {
  content                 = "e9c66ca6c6b05175.vercel-dns-017.com"
  include_shadow_metadata = false
  name                    = "hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 1
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "www" {
  content                 = "e9c66ca6c6b05175.vercel-dns-017.com"
  include_shadow_metadata = false
  name                    = "www.hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 1
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

# Resend sends as both mail.hanker.dev (no-reply@) and hanker.dev (hello@ through Gmail): a send
# and rsend CNAME and a DKIM key for each.
resource "cloudflare_dns_record" "resend_send" {
  content                 = "send.forge.rmta.net"
  include_shadow_metadata = false
  name                    = "send.hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "resend_rsend" {
  content                 = "rsend.forge.rmta.net"
  include_shadow_metadata = false
  name                    = "rsend.hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "resend_dkim" {
  content                 = "\"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1yQAZHNcHjGvuvQY9yT309zAknjenF2NWbEO+C46az3s/XutAza12O0/BCHFxPmVlJLNhIl1SD0QYl8GvKtNzlKIbZjniGgblqyiPfm6F6Ikqn3aKEUiXMXgptYUWg7jU1iJVDTtPez+iRumqGPsLE6FfDIJMGxquGWMNcIAkRQIDAQAB\""
  include_shadow_metadata = false
  name                    = "resend._domainkey.hanker.dev"
  proxied                 = false
  tags                    = []
  ttl                     = 3600
  type                    = "TXT"
  zone_id                 = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "resend_mail_send" {
  content                 = "send.forge.rmta.net"
  include_shadow_metadata = false
  name                    = "send.mail.hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "resend_mail_rsend" {
  content                 = "rsend.forge.rmta.net"
  include_shadow_metadata = false
  name                    = "rsend.mail.hanker.dev"
  proxied                 = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "resend_mail_dkim" {
  content                 = "\"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDFTqv3jNSIrp/arXXYuc9kKDmeUyhne2EjNI6ND868wpdtJJ5JZpba/Ge7hrWMfo26rJPZK64S4uPp5Nib9712hvJQVQvSZJa3giD4HF2PQFCDov1ZCqK0Ps0uogSaoHwziCZOlhZ13elIN/K/6XxTPCHbjCsyJ7PBa7bp4f8rhQIDAQAB\""
  include_shadow_metadata = false
  name                    = "resend._domainkey.mail.hanker.dev"
  proxied                 = false
  tags                    = []
  ttl                     = 3600
  type                    = "TXT"
  zone_id                 = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

# Monitor first, then tighten (docs/deployment.md, Domain and DNS).
resource "cloudflare_dns_record" "dmarc" {
  content                 = "\"v=DMARC1; p=none;\""
  include_shadow_metadata = false
  name                    = "_dmarc.hanker.dev"
  proxied                 = false
  tags                    = []
  ttl                     = 1
  type                    = "TXT"
  zone_id                 = local.cloudflare_zone_id
}

# Only Let's Encrypt, Vercel's CA, may issue for the apex. Once any CAA record exists, Cloudflare
# adds hidden ones for Universal SSL's CAs, which aren't managed here; www follows its CNAME to
# Vercel's own. No prevent_destroy: deleting this is the rollback for a certificate error
# (docs/deployment.md, DNSSEC and CAA).
resource "cloudflare_dns_record" "caa" {
  name    = "hanker.dev"
  ttl     = 1
  type    = "CAA"
  zone_id = local.cloudflare_zone_id
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

# Cloudflare is the registrar too, so it publishes the DS record itself. Turning this off while the
# DS record stands makes the domain unresolvable (docs/deployment.md, DNSSEC and CAA).
resource "cloudflare_zone_dnssec" "hanker" {
  status  = "active"
  zone_id = local.cloudflare_zone_id

  lifecycle {
    prevent_destroy = true
  }
}

# Nightly age-encrypted dumps (docs/deployment.md, Backups). Its rules are asserted below.
resource "cloudflare_r2_bucket" "backups" {
  account_id    = local.cloudflare_account_id
  jurisdiction  = "default"
  location      = "ENAM"
  name          = "hanker-backups"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# The sign-up, resend and reset forms' widget. Its secret key is TURNSTILE_SECRET_KEY on the API
# and the one secret here (spec §3.3); the provider marks it sensitive.
resource "cloudflare_turnstile_widget" "hanker" {
  account_id      = local.cloudflare_account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["hanker.dev"]
  ephemeral_id    = false
  mode            = "managed"
  name            = "Hanker"
  offlabel        = false
  page            = 1
  per_page        = 25
  region          = "world"
}

# The backup bucket's lifecycle and lock rules can't be imported (provider 5.28.1), so they're
# asserted rather than managed: every plan, the monthly drift check included, fails if either is
# loosened in the dashboard. Change a rule in the dashboard and this assertion in the same PR
# (docs/deployment.md, Backups → One-off setup step 3).
data "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = local.cloudflare_account_id
  bucket_name = "hanker-backups"

  lifecycle {
    postcondition {
      condition = anytrue([
        for r in self.rules : r.enabled && try(r.conditions.prefix, "") == "daily/"
        && try(r.delete_objects_transition.condition.type, "") == "Age"
        && try(r.delete_objects_transition.condition.max_age, 0) == 2592000
      ])
      error_message = "hanker-backups must delete daily/ objects 30 days (2592000 s) after upload, through an enabled lifecycle rule."
    }
  }
}

data "cloudflare_r2_bucket_lock" "backups" {
  account_id  = local.cloudflare_account_id
  bucket_name = "hanker-backups"

  lifecycle {
    postcondition {
      condition = anytrue([
        for r in self.rules : r.enabled && r.prefix == "daily/"
        && try(r.condition.type, "") == "Age"
        && try(r.condition.max_age_seconds, 0) == 2592000
      ])
      error_message = "hanker-backups must lock daily/ objects for 30 days (2592000 s) through an enabled bucket lock rule, so a leaked token can't delete the dumps."
    }
  }
}
