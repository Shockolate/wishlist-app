# IDs aren't secrets (spec §3.2), so they live here rather than in a .tfvars.
locals {
  # Cloudflare → R2 overview → Account ID. Also the R2 endpoint's host.
  cloudflare_account_id = "360ce0ccec8b699043f7a3bf2f8aa8f2"

  r2_endpoint = "https://${local.cloudflare_account_id}.r2.cloudflarestorage.com"

  # Cloudflare → hanker.dev → Overview → Zone ID. The zone itself isn't managed (spec §3.1).
  cloudflare_zone_id = "2d4a0a82d238dceecad61db089606518"

  # Vercel team shockolate and its two projects (.vercel/project.json, the domains API).
  vercel_team_id        = "team_kZIbcFHusXbiHiV3SWBz5UNr"
  vercel_project_id_api = "prj_DkQ7Rtg40eIk15tVOQCRHkMrpG6j"
  vercel_project_id_web = "prj_FzYar7oVdpt6hEG2NEZvFvfUgO2P"

  # The repo-level Actions variables (docs/deployment.md, GitHub configuration). None is secret:
  # each is public already (an origin, a public site key, the browser's Sentry DSN) or an ID.
  github_repo_variables = {
    API_PRODUCTION_ORIGIN      = "https://wishlist-api-five.vercel.app"
    APP_PRODUCTION_ORIGIN      = "https://hanker.dev"
    NEON_PRODUCTION_PROJECT_ID = "steep-dew-42117248"
    PREVIEW_ALIAS_PREFIX       = "shockolate-wishlist-pr-"
    SENTRY_DSN_WEB             = "https://59d40d3d8a303bfe3f4853350989d507@o4512288706723840.ingest.us.sentry.io/4512291187785728"
    SENTRY_ORG                 = "ted-armstrong"
    SENTRY_PROJECT_WEB         = "hanker-web"
    TURNSTILE_SITE_KEY         = "0x4AAAAAAFTQuj5atNoaYNuH"
  }
}
