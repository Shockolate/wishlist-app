# Vercel: both projects' settings and hanker.dev's domains (spec §3.1, D100). Builds still read the
# settings through vercel pull; nothing in deploy.yml or preview.yml reads infra/. A setting lives
# here or in apps/*/vercel.json, never both. No inline `environment` (it would own, and delete,
# every env var on a project) and no `git_repository` (the Git integration stays off).
# Authenticates from VERCEL_API_TOKEN.
provider "vercel" {
  team = local.vercel_team_id
}

# The API: one NestJS function in iad1, next to Neon. Unprotected: a Next.js rewrite can't attach
# the bypass header, and the API enforces its own auth (docs/deployment.md, Vercel projects).
resource "vercel_project" "api" {
  auto_assign_custom_domains                        = true
  automatically_expose_system_environment_variables = true
  build_machine_type                                = "basic"
  customer_success_code_visibility                  = false
  directory_listing                                 = false
  framework                                         = "nestjs"
  function_failover                                 = false
  git_fork_protection                               = true
  git_lfs                                           = false
  name                                              = "wishlist-api"
  node_version                                      = "24.x"
  oidc_token_config = {
    issuer_mode = "team"
  }
  on_demand_concurrent_builds = false
  passport = {
    deployment_type = "all"
    enabled         = false
  }
  preview_deployments_disabled = false
  prioritise_production_builds = true
  protected_sourcemaps         = true
  resource_config = {
    fluid                    = true
    function_default_regions = ["iad1"]
  }
  root_directory = "apps/api"
  team_id        = local.vercel_team_id
  vercel_authentication = {
    deployment_type = "none"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# The web app protects previews only. Standard Protection would also lock the production
# *.vercel.app URL, and with it the production smoke tests.
resource "vercel_project" "web" {
  auto_assign_custom_domains                        = true
  automatically_expose_system_environment_variables = true
  build_machine_type                                = "basic"
  customer_success_code_visibility                  = false
  directory_listing                                 = false
  framework                                         = "nextjs"
  function_failover                                 = false
  git_fork_protection                               = true
  git_lfs                                           = false
  name                                              = "wishlist-web"
  node_version                                      = "24.x"
  oidc_token_config = {
    issuer_mode = "team"
  }
  on_demand_concurrent_builds = false
  passport = {
    deployment_type = "all"
    enabled         = false
  }
  preview_deployments_disabled = false
  prioritise_production_builds = true
  protected_sourcemaps         = true
  resource_config = {
    fluid                    = true
    function_default_regions = ["iad1"]
  }
  root_directory = "apps/web"
  team_id        = local.vercel_team_id
  vercel_authentication = {
    deployment_type = "only_preview_deployments"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# hanker.dev is the canonical origin (APP_ORIGIN); www redirects to it.
resource "vercel_project_domain" "apex" {
  domain     = "hanker.dev"
  project_id = local.vercel_project_id_web
  team_id    = local.vercel_team_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "vercel_project_domain" "www" {
  domain               = "www.hanker.dev"
  project_id           = local.vercel_project_id_web
  redirect             = "hanker.dev"
  redirect_status_code = 308
  team_id              = local.vercel_team_id

  lifecycle {
    prevent_destroy = true
  }
}
