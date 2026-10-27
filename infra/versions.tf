terraform {
  # The release scripts/install-tofu.sh installs (infra/.opentofu-version). Bump both together.
  required_version = "1.13.2"

  # Exact pins (D93). Each provider joins in its import layer.
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
    github = {
      source  = "integrations/github"
      version = "6.13.0"
    }
    betteruptime = {
      source  = "BetterStackHQ/better-uptime"
      version = "0.22.4"
    }
  }
}
