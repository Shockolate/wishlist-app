# GitHub: the repository's settings, the main ruleset, the deploy environments and the repo
# variables (spec §3.1). Secrets are never managed here. Authenticates from GITHUB_TOKEN.
provider "github" {
  owner = "Shockolate"
}

# Settings the rest of the repo relies on: auto-merge for Renovate (D88), branch deletion on merge,
# secret scanning with push protection. Vulnerability alerts and CodeQL default setup weren't in the
# imported config, so they stay as gh api calls (docs/deployment.md, Repository settings).
resource "github_repository" "wishlist_app" {
  allow_auto_merge            = true
  allow_forking               = true
  allow_merge_commit          = true
  allow_rebase_merge          = true
  allow_squash_merge          = true
  allow_update_branch         = false
  archived                    = false
  auto_init                   = false
  delete_branch_on_merge      = true
  description                 = "A wishlist app for family and friends: one list, one secret link, no doubled-up gifts. Next.js, NestJS, Postgres."
  fork                        = "false"
  has_discussions             = false
  has_issues                  = true
  has_projects                = false
  has_wiki                    = false
  homepage_url                = "https://hanker.dev"
  is_template                 = false
  merge_commit_message        = "PR_TITLE"
  merge_commit_title          = "MERGE_MESSAGE"
  name                        = "wishlist-app"
  source_owner                = ""
  source_repo                 = ""
  squash_merge_commit_message = "COMMIT_MESSAGES"
  squash_merge_commit_title   = "COMMIT_OR_PR_TITLE"
  topics                      = ["drizzle-orm", "monorepo", "neon", "nestjs", "nextjs", "playwright", "postgresql", "turborepo", "typescript", "vercel", "vitest", "wishlist"]
  visibility                  = "public"
  web_commit_signoff_required = false
  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Required checks and squash-only merges on main. Was .github/rulesets/main.json.
resource "github_repository_ruleset" "main" {
  enforcement = "active"
  name        = "main"
  repository  = "wishlist-app"
  target      = "branch"
  conditions {
    ref_name {
      exclude = []
      include = ["~DEFAULT_BRANCH"]
    }
  }
  rules {
    creation                      = false
    deletion                      = true
    non_fast_forward              = true
    required_linear_history       = false
    required_signatures           = false
    update                        = false
    update_allows_fetch_and_merge = false
    pull_request {
      allowed_merge_methods             = ["squash"]
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_approving_review_count   = 0
      required_review_thread_resolution = true
    }
    required_status_checks {
      do_not_enforce_on_create             = false
      strict_required_status_checks_policy = false
      required_check {
        context        = "actionlint"
        integration_id = 15368
      }
      required_check {
        context        = "checks"
        integration_id = 15368
      }
      required_check {
        context        = "e2e"
        integration_id = 15368
      }
      required_check {
        context        = "integration"
        integration_id = 15368
      }
      required_check {
        context        = "migrations-lint"
        integration_id = 15368
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# production accepts only main (deployment.md, CI/CD supply-chain hardening); its secrets are never
# managed here.
resource "github_repository_environment" "production" {
  can_admins_bypass = true
  environment       = "production"
  repository        = "wishlist-app"
  wait_timer        = 0
  deployment_branch_policy {
    custom_branch_policies = true
    protected_branches     = false
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_environment_deployment_policy" "production_main" {
  branch_pattern = "main"
  environment    = "production"
  repository     = "wishlist-app"
}

# preview has no branch policy: every PR branch deploys a preview.
resource "github_repository_environment" "preview" {
  can_admins_bypass = true
  environment       = "preview"
  repository        = "wishlist-app"
  wait_timer        = 0
}

# Written by hand, not generated: config generation doesn't cover for_each imports.
resource "github_actions_variable" "repo" {
  for_each = local.github_repo_variables

  repository    = "wishlist-app"
  variable_name = each.key
  value         = each.value
}
