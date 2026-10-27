# Existing resources adopted into state (D101). Each one must plan as an import with nothing to
# add, change or destroy. These blocks are removed once Ted has applied them (stack C).

# Cloudflare. Not imported: the apex MX and SPF TXT and cf2024-1._domainkey, which Email Routing
# owns (spec §3.1). Import IDs are <zone_id>/<record_id>, from the zone's DNS records API.
import {
  to = cloudflare_dns_record.apex
  id = "${local.cloudflare_zone_id}/deacfc1168d937c9009f270b07ba45d4"
}
import {
  to = cloudflare_dns_record.www
  id = "${local.cloudflare_zone_id}/3772abb366935ada82caf05b105043c4"
}
import {
  to = cloudflare_dns_record.resend_send
  id = "${local.cloudflare_zone_id}/ea5d473223c9e2cc6cf9461fe87b107c"
}
import {
  to = cloudflare_dns_record.resend_rsend
  id = "${local.cloudflare_zone_id}/f83601bf61be99b27a33bc685b91361a"
}
import {
  to = cloudflare_dns_record.resend_dkim
  id = "${local.cloudflare_zone_id}/b32b7c5755c8c09ea7858aeba6d23c9c"
}
import {
  to = cloudflare_dns_record.resend_mail_send
  id = "${local.cloudflare_zone_id}/239f0012d93b3b59568226343c0cddd8"
}
import {
  to = cloudflare_dns_record.resend_mail_rsend
  id = "${local.cloudflare_zone_id}/7658f0f8a74064d25b1d965b5ff7ced4"
}
import {
  to = cloudflare_dns_record.resend_mail_dkim
  id = "${local.cloudflare_zone_id}/2db1511c4063464277b82bca5ce51746"
}
import {
  to = cloudflare_dns_record.dmarc
  id = "${local.cloudflare_zone_id}/1e1125ff18259635da4c364e9c565dc8"
}
import {
  to = cloudflare_zone_dnssec.hanker
  id = local.cloudflare_zone_id
}
import {
  to = cloudflare_r2_bucket.backups
  id = "${local.cloudflare_account_id}/hanker-backups/default"
}
import {
  to = cloudflare_turnstile_widget.hanker
  # The site key is public: it's the TURNSTILE_SITE_KEY repo variable.
  id = "${local.cloudflare_account_id}/0x4AAAAAAFTQuj5atNoaYNuH"
}

# GitHub. Import IDs from the REST API (GET only): <repo>, <repo>:<ruleset_id>, <repo>:<env>,
# <repo>:<env>:<policy_id> and <repo>:<variable>.
import {
  to = github_repository.wishlist_app
  id = "wishlist-app"
}
import {
  to = github_repository_ruleset.main
  id = "wishlist-app:24731525"
}
import {
  to = github_repository_environment.production
  id = "wishlist-app:production"
}
import {
  to = github_repository_environment.preview
  id = "wishlist-app:preview"
}
import {
  to = github_repository_environment_deployment_policy.production_main
  id = "wishlist-app:production:62387137"
}
import {
  for_each = local.github_repo_variables
  to       = github_actions_variable.repo[each.key]
  id       = "wishlist-app:${each.key}"
}

# Better Stack. Import IDs are the monitor IDs (the number in the dashboard's URL). The heartbeats
# aren't imported: provider 0.22.4 doesn't mark their url sensitive, so a plan would print it.
import {
  to = betteruptime_monitor.live
  id = "5098645"
}
import {
  to = betteruptime_monitor.site
  id = "5098650"
}
import {
  to = betteruptime_monitor.deep
  id = "5098697"
}

# Vercel. Import IDs are <team_id>/<project_id>[/<domain>]. The *.vercel.app domains are Vercel's
# own and aren't imported; neither are env vars (every API one is type sensitive, so unreadable).
import {
  to = vercel_project.api
  id = "${local.vercel_team_id}/${local.vercel_project_id_api}"
}
import {
  to = vercel_project.web
  id = "${local.vercel_team_id}/${local.vercel_project_id_web}"
}
import {
  to = vercel_project_domain.apex
  id = "${local.vercel_team_id}/${local.vercel_project_id_web}/hanker.dev"
}
import {
  to = vercel_project_domain.www
  id = "${local.vercel_team_id}/${local.vercel_project_id_web}/www.hanker.dev"
}
