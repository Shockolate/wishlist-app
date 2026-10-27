# Better Stack: the three uptime monitors (spec §3.1). The two heartbeats stay in the dashboard:
# provider 0.22.4 doesn't mark a heartbeat's url sensitive, and that URL is a secret (spec §3.3).
# Authenticates from BETTERUPTIME_API_TOKEN.
provider "betteruptime" {}

# The web project, the /api rewrite and the API function are up. Never touches the database.
resource "betteruptime_monitor" "live" {
  call                  = false
  check_frequency       = 180
  confirmation_period   = 0
  critical_alert        = false
  domain_expiration     = -1
  email                 = true
  expected_status_codes = []
  expiration_policy_id  = 0
  follow_redirects      = true
  http_method           = "get"
  maintenance_days      = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  maintenance_from      = ""
  maintenance_timezone  = "Eastern Time (US & Canada)"
  maintenance_to        = ""
  monitor_group_id      = 0
  monitor_type          = "status"
  paused                = false
  playwright_script     = ""
  policy_id             = ""
  port                  = ""
  pronounceable_name    = "Live"
  proxy_host            = ""
  proxy_port            = 0
  push                  = false
  recovery_period       = 180
  regions               = ["us"]
  remember_cookies      = true
  request_body          = ""
  request_headers       = []
  request_timeout       = 30
  required_keyword      = ""
  sms                   = false
  ssl_expiration        = -1
  team_name             = "Your team"
  team_wait             = 180
  url                   = "https://hanker.dev/api/health/live"
  verify_ssl            = true
}

# The landing page renders. It's static, so it touches neither the API nor the database.
resource "betteruptime_monitor" "site" {
  call                  = false
  check_frequency       = 180
  confirmation_period   = 0
  critical_alert        = false
  domain_expiration     = -1
  email                 = true
  expected_status_codes = []
  expiration_policy_id  = 0
  follow_redirects      = true
  http_method           = "get"
  maintenance_days      = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  maintenance_from      = ""
  maintenance_timezone  = "Eastern Time (US & Canada)"
  maintenance_to        = ""
  monitor_group_id      = 0
  monitor_type          = "status"
  paused                = false
  playwright_script     = ""
  policy_id             = ""
  port                  = ""
  pronounceable_name    = "Site"
  proxy_host            = ""
  proxy_port            = 0
  push                  = false
  recovery_period       = 180
  regions               = ["us"]
  remember_cookies      = true
  request_body          = ""
  request_headers       = []
  request_timeout       = 30
  required_keyword      = ""
  sms                   = false
  ssl_expiration        = -1
  team_name             = "Your team"
  team_wait             = 180
  url                   = "https://hanker.dev/"
  verify_ssl            = true
}

# Neon is reachable and migrated. Every 30 minutes, the longest the free plan offers: each check
# wakes Neon, and a 3-minute check would use about 180 of the 100 CU-hours a month Neon Free allows
# (docs/deployment.md, Monitoring).
resource "betteruptime_monitor" "deep" {
  call                  = false
  check_frequency       = 1800
  confirmation_period   = 180
  critical_alert        = false
  domain_expiration     = -1
  email                 = true
  expected_status_codes = []
  expiration_policy_id  = 0
  follow_redirects      = true
  http_method           = "get"
  maintenance_days      = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  maintenance_from      = ""
  maintenance_timezone  = "Eastern Time (US & Canada)"
  maintenance_to        = ""
  monitor_group_id      = 0
  monitor_type          = "status"
  paused                = false
  playwright_script     = ""
  policy_id             = ""
  port                  = ""
  pronounceable_name    = "Deep"
  proxy_host            = ""
  proxy_port            = 0
  push                  = false
  recovery_period       = 60
  regions               = ["us"]
  remember_cookies      = true
  request_body          = ""
  request_headers       = []
  request_timeout       = 30
  required_keyword      = ""
  sms                   = false
  ssl_expiration        = -1
  team_name             = "Your team"
  team_wait             = 0
  url                   = "https://hanker.dev/api/health"
  verify_ssl            = true
}
