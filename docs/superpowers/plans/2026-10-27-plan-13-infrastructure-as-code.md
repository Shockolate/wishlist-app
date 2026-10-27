# Plan 13: Infrastructure as Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Hanker's Cloudflare, GitHub, Better Stack and Vercel configuration under OpenTofu. Imports change nothing. State is encrypted on the client in R2, CI plans on PRs behind Ted's approval, Ted applies locally from `main`, and a monthly drift check runs.

**Architecture:** One root module in `infra/`. Four stacks merged in order, with Ted's applies between them:

- **A:** tooling and bootstrap
- **B:** the four imports, applied together once merged
- **C:** the CI environments
- **D:** the plan and drift workflows, and the docs

Every step that needs a credential is a ⏸ checkpoint for Ted. Agents never hold IaC credentials.

**Tech Stack:** OpenTofu (exact pin), providers `cloudflare/cloudflare` (v5), `integrations/github`, `BetterStackHQ/better-uptime` and `vercel/vercel`; the `s3` backend on Cloudflare R2; bash script tests; GitHub Actions with `scripts/workflow-policy*.mjs`.

**Spec:** [docs/superpowers/specs/2026-10-27-infrastructure-as-code-design.md](../specs/2026-10-27-infrastructure-as-code-design.md). Section numbers like §3.5 refer to it.

## Global Constraints

- **AGENTS.md applies.** In particular: exact pins, Conventional Commit PR titles, a `Co-Authored-By:` trailer naming the model that wrote the commit, and the workflow policy tests only get stricter.
- **Ted runs every `gh stack submit`** (auto mode blocks it): `! gh stack submit --auto --open`. Then set each PR's title and body with `gh pr edit`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, and each explains the IaC concept its layer introduces (§6).
- **Agents run only credential-free `tofu` commands:** `fmt`, `validate`, `init -backend=false`, `providers lock`, `providers schema`. Every `tofu plan` and `apply` against the backend, and every `-generate-config-out`, is Ted's (⏸). Agents never run `tofu apply`, never approve a pending deployment, and never read a secret value.
- **Reading live config is fine.** Agents may use `gh api` GET calls and the read-only Vercel and Better Stack MCP tools to find import IDs and settings.
- **Fixed names:** `infra/`, `infra/.opentofu-version`, bucket `hanker-tofu-state`, state key `infra/terraform.tfstate`, environments `infra-plan` and `infra-drift`, workflows `infra-plan.yml` and `infra-drift.yml`, CI job `infra`, scripts `scripts/install-tofu.sh`, `scripts/infra-guard.sh` and `scripts/infra-plan-comment.sh`, each with a `.test.sh`.
- **CI secret names** (in both `infra-plan` and `infra-drift`):
  - `TOFU_STATE_PASSPHRASE` → `TF_VAR_state_passphrase`
  - `TOFU_R2_ACCESS_KEY_ID` → `AWS_ACCESS_KEY_ID`, and `TOFU_R2_SECRET_ACCESS_KEY` → `AWS_SECRET_ACCESS_KEY`
  - `TOFU_CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_API_TOKEN`
  - `TOFU_GITHUB_TOKEN` → `GITHUB_TOKEN`
  - `TOFU_VERCEL_API_TOKEN` → `VERCEL_API_TOKEN`
  - `TOFU_BETTERSTACK_API_TOKEN` → the Better Stack provider's env var (confirm its name in Task 8)

  Locally, Ted exports the right-hand names.
- **Every job that runs `tofu`** sets `TF_CLI_CONFIG_FILE: /dev/null`, `TF_IN_AUTOMATION: 1` and `TF_INPUT: 0`.
- **Run under Node 24** (`nvm use`). Full verification is the command block in AGENTS.md. Any task touching `.github/workflows/` or `scripts/` also runs both policy tests, the changed script's `*.test.sh` and actionlint (the pinned command in `ci.yml`).

## Review Focus

1. **A computed secret printed in a public plan.** If a provider doesn't mark the heartbeat `url`, the Turnstile `secret` or the bypass secret `sensitive`, any plan that touches that resource prints it in the PR comment. Pinned in Tasks 6, 8 and 9: a `tofu providers schema -json` check before the resource is managed. If the attribute isn't sensitive, the resource stays out (§5.3).
2. **Generated config committed with secret values in it.** `-generate-config-out` writes every configurable attribute, values included. Pinned in Task 3: the guard refuses a `generated_*.tf` file, and `.gitignore` has `infra/generated_*.tf`.
3. **A plan bigger than a PR comment.** GitHub refuses a body over 65,536 characters, so the comment job would fail. Pinned in Task 12: `infra-plan-comment.test.sh` truncates a 70,000-character plan and says so.
4. **A Renovate or fork PR that touches `infra/`.** It must get no plan and no secret. Pinned in Task 12: a mutation that drops the bot condition from `plan` must fail the policy test.
5. **A drift run dispatched from a branch.** It must not get credentials. Pinned in Task 13: a mutation that removes the `refs/heads/main` check must fail the policy test.

---

## Stack A: tooling and bootstrap (spec §4 layer 1)

### Task 1: Docs layer: spec, plan, roadmap

**Files:**
- Add: the spec and this plan (both already written, uncommitted on `main`'s working tree)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (add a row 13 linking this plan, with the spec in the "Spec sections" column, D93–D101, status Planned)

- [ ] **Step 1:** `git switch -c docs/plan-13`, which carries the uncommitted files along. Then `gh stack init` on it, per CONTRIBUTING.md.
- [ ] **Step 2:** Add the roadmap row. Its "Ships" text: "OpenTofu over Cloudflare, GitHub, Better Stack and Vercel, imported with no changes; encrypted state in R2; CI plans behind Ted's approval, local applies; monthly drift check".
- [ ] **Step 3:** `pnpm format:check`. Expected: no differences.
- [ ] **Step 4:** Commit: `docs: plan 13 infrastructure as code`.

### Task 2: `install-tofu.sh`

**Files:**
- Create: `scripts/install-tofu.sh`, `scripts/install-tofu.test.sh`, `infra/.opentofu-version`
- Modify: `.github/workflows/ci.yml` (add the test to the script-test step)

**Interfaces:**
- Produces: `scripts/install-tofu.sh <dir>`, which installs `tofu` into `<dir>`. It reads the version from `infra/.opentofu-version` (one line, `X.Y.Z`), and the sha256 of the `linux_amd64` zip is pinned in the script.

- [ ] **Step 1:** `gh stack add ci/install-tofu`.
- [ ] **Step 2: Write the failing test**, modelled on `install-sentry-cli.test.sh`. It asserts:
  - (a) `infra/.opentofu-version` matches `^[0-9]+\.[0-9]+\.[0-9]+$`;
  - (b) the script has `^sha256=[0-9a-f]{64}$`;
  - (c) with a fake `curl` that writes the wrong bytes, the script exits non-zero and leaves no `tofu` in `<dir>`;
  - (d) the script's download URL contains `$version`, so the pin and the file can't disagree.
- [ ] **Step 3:** `bash scripts/install-tofu.test.sh`. Expected: FAIL, because the script is missing.
- [ ] **Step 4: Write the script and pin the version.**
  - Download `tofu_${version}_linux_amd64.zip` from `github.com/opentofu/opentofu/releases`, check its sha256, then unzip only `tofu`.
  - **§5.7:** use the latest stable release, at least 3 days old. Take the checksum from that release's `SHA256SUMS`, after verifying it against the release's signature.
- [ ] **Step 5:** `bash scripts/install-tofu.test.sh`, then a real run: `scripts/install-tofu.sh "$tmp" && "$tmp/tofu" version`. Expected: PASS, then the pinned version.
- [ ] **Step 6:** Add the test to `ci.yml`. Full verification, then commit: `ci: pinned OpenTofu installer (D93)`.

### Task 3: `infra-guard.sh`

**Files:**
- Create: `scripts/infra-guard.sh`, `scripts/infra-guard.test.sh`, fixtures under `scripts/testdata/infra-guard/`
- Modify: `.github/workflows/ci.yml` (the script-test step)

**Interfaces:**
- Produces: `scripts/infra-guard.sh [dir]` (default `infra`). It exits 0 when clean. Otherwise it exits 1 and prints one `infra-guard: <reason>` line per finding.
- **Provider allowlist:** `registry.opentofu.org/cloudflare/cloudflare`, `registry.opentofu.org/integrations/github`, `registry.opentofu.org/betterstackhq/better-uptime`, `registry.opentofu.org/vercel/vercel`.

- [ ] **Step 1:** `gh stack add ci/infra-guard`.
- [ ] **Step 2: Write the failing tests**, one fixture directory per case. The clean fixture passes. Each other fixture fails, and its reason line names the rule:
  - `refuses a provider outside the allowlist` (`hashicorp/external` in the lockfile)
  - `refuses a provisioner`
  - `refuses data external` and `refuses data http`
  - `refuses a module block`
  - `refuses an output block`
  - `refuses nonsensitive()`
  - `refuses an override file` (`x_override.tf`)
  - `refuses a CLI config` (`.tofurc`, `.terraformrc` or `terraform.rc` anywhere in the repo)
  - `refuses a generated config file` (`generated_vercel.tf`)
  - `refuses unenforced encryption` (an `encryption.tf` without `enforced = true` in both its `state` and `plan` blocks)
  - **Also:** a directory with no `.terraform.lock.hcl` passes, as Stack A's has none yet.
- [ ] **Step 3:** `bash scripts/infra-guard.test.sh`. Expected: FAIL.
- [ ] **Step 4: Implement it with `grep`/`awk` over `*.tf` and the lockfile.** Ignore comment lines (`#`, `//`). The header comment says it's defence in depth, not the boundary (§3.7).
- [ ] **Step 5:** `bash scripts/infra-guard.test.sh`. Expected: PASS. Add it to `ci.yml`. Commit: `ci: infra guard for the OpenTofu root module (§3.9)`.

### Task 4: The `infra/` root module, the `infra` CI job and the bootstrap docs

**Files:**
- Create: `infra/versions.tf` (`required_version` = the pinned version; empty `required_providers`), `infra/backend.tf`, `infra/encryption.tf`, `infra/variables.tf` (`state_passphrase`, `sensitive = true`, no default)
- Modify: `.gitignore` (`.terraform/`, `*.tfstate*`, `*.tfplan`, `*.tfvars`, `infra/generated_*.tf`)
- Modify: `.github/workflows/ci.yml` (new job `infra`)
- Modify: `AGENTS.md` (Layout row for `infra/`)
- Modify: `docs/deployment.md` (new section "Infrastructure as code": bootstrap, local credentials, the change flow from §3.5, recovery from §3.3)

**Interfaces:**
- Produces:
  - the backend: bucket `hanker-tofu-state`, key `infra/terraform.tfstate`, the R2 endpoint built from the Cloudflare account ID in `locals`
  - the encryption: key provider `pbkdf2` from `var.state_passphrase`, method `aes_gcm`, `state` and `plan` both `enforced = true`
  - the `infra` job: runs `install-tofu.sh`, then `tofu fmt -check -recursive infra`, `tofu -chdir=infra init -backend=false`, `tofu -chdir=infra validate`, then `scripts/infra-guard.sh`

- [ ] **Step 1:** `gh stack add ci/infra-root-module`.
- [ ] **Step 2: Write the root module.**
  - Use the R2 backend settings: region `auto`, the `skip_*` validation flags, path-style addressing, `use_lockfile`.
  - **§5.1:** check Cloudflare's R2 docs for conditional-write (`If-None-Match`) support. If it's unsupported, set `use_lockfile = false` with a one-line comment saying why.
  - **§5.2:** check whether R2 has object versioning. Record the answer in the deployment.md section.
- [ ] **Step 3:** Locally, run `tofu fmt -check -recursive infra && tofu -chdir=infra init -backend=false && tofu -chdir=infra validate && scripts/infra-guard.sh`. Expected: all pass with no passphrase set. That's the second half of §5.7. If `init` or `validate` demands the passphrase, the `infra` job runs `fmt` and the guard only, with a comment saying why.
- [ ] **Step 4: Add the `infra` job** to `ci.yml`: no secrets, checkout with `persist-credentials: false`, the env from Global Constraints. Run actionlint and both policy tests. Expected: PASS.
- [ ] **Step 5: Docs.**
  - **The deployment.md section:**
    - The local credential block: `read -rs` for each name in Global Constraints, then `export`. `GITHUB_TOKEN` comes from `gh auth token`. Nothing goes in a file or argv.
    - The bootstrap runbook for Task 5.
    - The change flow from §3.5.
    - Recovery: re-import, and what's lost without versioning.
  - **§5.5:** check whether Renovate's `terraform` manager refreshes `.terraform.lock.hcl` for OpenTofu. Record the answer there. If it doesn't, add a Quarterly row to operations.md ("Provider and OpenTofu bumps by hand").
  - **The AGENTS.md Layout row.**
- [ ] **Step 6:** Full verification. Commit: `feat(infra): OpenTofu root module with encrypted R2 state (D93, D94)`.

### Task 5: ⏸ Ted's bootstrap

- [ ] **Step 1:** Ted submits stack A, and it merges once green.
- [ ] **Step 2: Ted creates the bucket and the apply token** in the Cloudflare dashboard:
  - bucket `hanker-tofu-state`: private, automatic location, no custom domain, no lock rule, no lifecycle rule
  - an R2 token with Object Read & Write on that bucket only

  Ted generates the passphrase (32+ characters) in his password manager.
- [ ] **Step 3:** On `main`, Ted exports the credentials (the deployment.md block) and runs `tofu -chdir=infra init`. Expected: "Successfully configured the backend "s3"".
- [ ] **Step 4:** Ted runs `tofu -chdir=infra plan`. Expected: "No changes". If `use_lockfile` is on, Ted runs two plans at once to prove the second is refused with a lock error. A plan doesn't write state, so the state object first appears in Task 10.
- [ ] **Step 5: Ted makes the local apply tokens** that stack B's plans need, from the §3.4 Apply column:
  - Cloudflare: Edit for exactly §3.1's resource types
  - Vercel: `tofu-apply`
  - Better Stack: one token
  - GitHub: Ted's `gh auth token`, so nothing to make

  They go only into his password manager. Each gets an expiry where the service allows one. Task 13 adds them to the Credentials table.

---

## Stack B: imports (spec §4 layers 2–5, §3.10)

**Every import task follows the same loop.** Each task below lists only what differs.

- **a.** `gh stack add feat/infra-<provider>`.
- **b.** Add the provider to `versions.tf` with an exact `version`. Run `tofu -chdir=infra init -backend=false` and `tofu -chdir=infra providers lock -platform=linux_amd64`.
- **c. Sensitive-attribute check.** `tofu -chdir=infra providers schema -json | jq` for each resource type in the task. Record which attributes are `sensitive: true`. Any attribute that holds a secret but isn't marked sensitive means that resource isn't managed: say so in the PR body (Review Focus 1).
- **d.** Find each resource's import ID through read-only APIs. Write `import` blocks in `imports.tf` and a provider block with no credentials in it.
- **e.** ⏸ Ted runs `tofu -chdir=infra plan -generate-config-out=generated_<provider>.tf`.
- **f. Fold the generated config into `infra/<provider>.tf`, then delete the generated file:**
  - Drop attributes that are computed or equal to the default, unless a value matters (say so in a comment).
  - Move IDs to `locals`.
  - Add `prevent_destroy` where §3.10 lists the resource.
  - Never copy a secret value. If the generated config holds one, the resource is out of scope.
- **g.** Run `tofu fmt`, `validate` and `scripts/infra-guard.sh`. ⏸ Ted runs `tofu -chdir=infra plan`. Expected: `Plan: N to import, 0 to add, 0 to change, 0 to destroy.` A change means the HCL gets fixed, never the resource. Repeat g until it passes, and paste the summary line into the PR body.
- **h.** Full verification. Commit with the message given in the task.

### Task 6: Cloudflare

**Files:** `infra/cloudflare.tf`, `infra/imports.tf`, `infra/versions.tf`, `.terraform.lock.hcl`

**Resources:**
- the zone, as a `data` lookup by name (`hanker.dev`)
- `cloudflare_dns_record` for: apex and `www`; Resend's MX and SPF on `send.mail.hanker.dev` and `send.hanker.dev`; DKIM on `resend._domainkey.mail.hanker.dev` and `resend._domainkey.hanker.dev`; `_dmarc`; the apex CAA
- `cloudflare_zone_dnssec`
- `cloudflare_r2_bucket`, `cloudflare_r2_bucket_lifecycle` and `cloudflare_r2_bucket_lock` for `hanker-backups`
- `cloudflare_turnstile_widget` "Hanker"

**Not managed:** the apex MX/SPF that Email Routing created (§3.1).

- [ ] **Step 1: Check v5's resource names (§5.6).** Confirm them in the provider docs of the pinned version, along with their import ID formats.
- [ ] **Step 2:** ⏸ Ted lists record IDs: `! curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/zones/<zone_id>/dns_records?per_page=100" | jq -r '.result[] | [.id, .type, .name] | @tsv'`. IDs, types and names aren't secret.
- [ ] **Step 3:** Run the loop a–h. Turnstile's `secret` is expected to be sensitive (§3.3). The step c check decides whether it stays.
- [ ] **Step 4:** Commit: `feat(infra): import Cloudflare DNS, DNSSEC, R2 backup rules and Turnstile (D95)`.

### Task 7: GitHub

**Files:**
- Modify: `infra/github.tf`, `infra/imports.tf`, `infra/versions.tf`, `.terraform.lock.hcl`
- Delete: `.github/rulesets/main.json`
- Modify: `docs/deployment.md` (Repository settings: the ruleset row points to `infra/github.tf`; "Required checks" stays as prose)

**Resources:**
- `github_repository` `wishlist-app`, with `archive_on_destroy = true`, `prevent_destroy`, auto-merge, `security_and_analysis` and vulnerability alerts
- `github_repository_ruleset` for `main`
- `github_repository_environment` for `production` and `preview`
- the deployment branch policy that limits `production` to `main`
- a `github_actions_variable` for each repo variable in deployment.md's "GitHub configuration" table

**Not managed:** secrets, CodeQL default setup, the Renovate app.

- [ ] **Step 1:** Find IDs with `gh api repos/Shockolate/wishlist-app/rulesets`, `…/environments` and `…/actions/variables` (GET only).
- [ ] **Step 2:** Run the loop a–h. The generated ruleset must match `main.json` rule for rule. Diff the two before deleting `main.json`.
- [ ] **Step 3:** `git grep -n 'rulesets/main.json'`. Update every hit, and expect no hits once done.
- [ ] **Step 4:** Commit: `feat(infra): import GitHub repo settings, ruleset, environments and variables (D95, D101)`.

### Task 8: Better Stack

**Files:** `infra/betterstack.tf`, `infra/imports.tf`, `infra/versions.tf`, `.terraform.lock.hcl`

**Resources:**
- `betteruptime_monitor` for Live, Site and Deep, at the URLs and intervals in deployment.md "Monitoring"
- `betteruptime_heartbeat` for "Hanker nightly backup" and the daily cron heartbeat, each with a 1-day period and 2-hour grace

- [ ] **Step 1:** Find IDs with the Better Stack MCP `monitors` and `heartbeats` tools, which are read-only. Confirm the provider's token env var name, and update Global Constraints' mapping in the deployment.md block.
- [ ] **Step 2:** Run the loop a–h. Step c decides the heartbeats: if `url` isn't sensitive, they're left out and recorded in the PR body and the spec's §3.3 table.
- [ ] **Step 3:** Add a comment above Deep recording why it checks every 30 minutes (Neon's compute quota, deployment.md "Monitoring"). Commit: `feat(infra): import Better Stack monitors and heartbeats (D95)`.

### Task 9: Vercel

**Files:**
- Modify: `infra/vercel.tf`, `infra/imports.tf`, `infra/versions.tf`, `.terraform.lock.hcl`
- Modify: the CI isolation addendum §1 Decisions: after "Project settings are pulled, not committed", add "Amended 2026-10-27 (D100): the settings are now code in `infra/vercel.tf`; builds still pull."

**Resources:**
- `vercel_project` for `wishlist-api` and `wishlist-web`: root directory, files outside root, framework, Node 24.x, deployment protection (`wishlist-web` previews only, `wishlist-api` none), automation bypass on `wishlist-web`. **No `environment` attribute and no `git_repository`** (§3.1).
- `vercel_project_domain` for `hanker.dev`, and `www.hanker.dev` with a 308 redirect to the apex
- `vercel_project_environment_variable` for `APP_ORIGIN`, `EMAIL_TRANSPORT`, `EMAIL_FROM` and `CLOUDFLARE_ACCOUNT_ID` (production, `wishlist-api`)

- [ ] **Step 1:** Find IDs with the Vercel MCP `list_projects`, `get_project`, `list_project_domains` and `filter_project_envs` tools. Never decrypt a value.
- [ ] **Step 2:** Run the loop a–h. Step c covers the bypass secret.
- [ ] **Step 3: No overlap with `vercel.json`.** Drop any attribute that `apps/*/vercel.json` sets (install command, crons, `git.deploymentEnabled`) from the HCL.
- [ ] **Step 4:** Commit: `feat(infra): import Vercel projects, domains and plain env vars (D100)`.

### Task 10: ⏸ Ted merges and applies stack B

- [ ] **Step 1:** Ted submits stack B, and it merges once green.
- [ ] **Step 2:** On `main`'s tip, Ted runs `tofu -chdir=infra apply`. It re-plans, and must show the four layers' imports summed, with 0 to add, change or destroy. Then he types `yes`.
- [ ] **Step 3: The state check (§3.3).** `tofu -chdir=infra state pull | jq -r '.resources[] | "\(.type).\(.name) \([.instances[].sensitive_attributes[]?] | tostring)"'` prints attribute paths, never values.
  - Ted also reads `tofu -chdir=infra show` for anything secret-looking that isn't `(sensitive value)`.
  - Expected: nothing sensitive beyond the §3.3 table. Anything more stops the plan until the spec says otherwise.
- [ ] **Step 4:** `tofu -chdir=infra plan`. Expected: "No changes".

---

## Stack C: the CI environments (spec §4 layer 6)

### Task 11: `infra-plan`, `infra-drift` and the `infra` required check

**Files:** `infra/imports.tf` (deleted), `infra/github.tf`

**Interfaces:**
- Produces:
  - environment `infra-plan`: Ted's user ID as its only required reviewer, `prevent_self_review = false`, no deployment branch policy
  - environment `infra-drift`: a custom deployment branch policy for `main` only, no reviewers
  - the ruleset gains the required check `infra` (`integration_id` 15368, as for the others)

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init feat/infra-ci-environments`.
- [ ] **Step 2:** Delete `imports.tf`, since it's applied. Add the two environments and the required check. Get Ted's ID with `gh api user --jq .id`.
- [ ] **Step 3:** `tofu fmt`, `validate` and the guard. ⏸ Ted plans. Expected: `2 to add` (plus the branch policy resource), `1 to change` (the ruleset), `0 to destroy`.
- [ ] **Step 4:** Commit: `feat(infra): environments for CI plans and the drift check (D97, D99)`.
- [ ] **Step 5:** ⏸ Ted submits, merges and applies from `main`.
- [ ] **Step 6: ⏸ Ted makes the plan tokens** from the §3.4 Plan column: R2 Object Read on `hanker-tofu-state`, Cloudflare read-only, a GitHub fine-grained read-only token, `tofu-plan` on Vercel, and one Better Stack token. Each gets an expiry of at most one year. Ted stores each one under its Global Constraints name in **both** environments: `gh secret set <NAME> --env infra-plan` (it prompts), then the same with `--env infra-drift`.
- [ ] **Step 7: Prove the plan tokens are enough (§5.4).** ⏸ In a fresh shell with only the plan tokens exported, Ted runs `tofu -chdir=infra plan -lock=false`. Expected: "No changes" and no 401 or 403. Ted records in operations.md's Credentials table whether Vercel and Better Stack offered a narrower scope.

---

## Stack D: plan and drift workflows, and docs (spec §4 layers 7–8)

### Task 12: `infra-plan.yml` and its policy

**Files:**
- Create: `.github/workflows/infra-plan.yml`, `scripts/infra-plan-comment.sh`, `scripts/infra-plan-comment.test.sh`
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`, `.github/workflows/ci.yml` (script-test step)
- Modify: `AGENTS.md` (Ask a maintainer first: "`tofu apply`" and "approving a pending deployment")

**Interfaces:**
- Produces: `scripts/infra-plan-comment.sh <plan.txt> <head-sha>` prints Markdown to stdout: a heading `**OpenTofu plan** for <sha>`, the plan in a fenced block, and when the plan is over 60,000 characters, the first 60,000 followed by `Plan truncated: run tofu plan locally for the rest.`
- Jobs:
  - `changes` (no secrets): output `infra=true|false` from `git diff --name-only "$BASE_SHA" "$HEAD_SHA"` (`fetch-depth: 0`) against `^(infra/|\.github/workflows/infra-|scripts/install-tofu\.sh|scripts/infra-guard\.sh)`
  - `plan` (environment `infra-plan`)
  - `comment` (no secrets; `pull-requests: write`; `marocchino/sticky-pull-request-comment` at preview.yml's pin, `header: infra-plan`, `path:` the comment file)
  - Artifact `infra-plan-text`.

- [ ] **Step 1:** `git switch main && git pull --ff-only && gh stack init ci/infra-plan`.
- [ ] **Step 2: Write the failing comment test:**
  - `infra-plan-comment.test.sh: short plan passes through whole`
  - `… 70,000-character plan is cut to 60,000 and says "Plan truncated"`
  - `… output contains the sha`

  Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the script. Run the test. Expected: PASS.
- [ ] **Step 4: Write the failing policy rules.** Each gets a mutation in `workflow-policy.mutations.test.mjs`:
  1. `infra-plan.yml` exists, and its trigger is `pull_request`. No workflow anywhere uses `pull_request_target`.
  2. `infra-plan.yml#plan`:
     - `needs: changes`
     - its `if` contains `needs.changes.outputs.infra == 'true'`, `head.repo.full_name == github.repository` and `github.event.pull_request.user.type != 'Bot'`
     - `envName` is `infra-plan`
  3. Only `infra-plan.yml#plan` uses `infra-plan`. Only `infra-drift.yml#drift` uses `infra-drift` (that rule passes vacuously until Task 13).
  4. In any job that uses `infra-plan` or `infra-drift`:
     - `scripts/install-tofu.sh` and then `scripts/infra-guard.sh` run before the first step whose `secretsIn` is non-empty
     - every step with secrets has run lines that all start with `tofu -chdir=infra init`, `tofu -chdir=infra plan` or `tofu -chdir=infra show`
     - the job env sets `TF_CLI_CONFIG_FILE: /dev/null`
  5. In every workflow, every `tofu … plan` line has `-lock=false`, and no line matches `\btofu\b.*\b(apply|import|state|destroy|force-unlock|taint|untaint)\b`.
  6. `changes` and `comment` hold no secrets and no environment.

  Mutations: drop the Bot condition (Review Focus 4); switch to `pull_request_target`; run `tofu apply`; drop `-lock=false`; move the guard after `init`; add `pnpm install` to `plan`; put a secret on the `comment` job.

  Run both policy tests. Expected: FAIL on rule 1.
- [ ] **Step 5: Write `infra-plan.yml`.**
  - It follows preview.yml's conventions: header comment on the trust model (spec §3.7), `defaults.run.shell: bash`, `concurrency` per PR with `cancel-in-progress: true`, SHA-pinned actions and `persist-credentials: false`.
  - `plan`'s steps:
    1. checkout of the head SHA
    2. install
    3. guard
    4. `tofu -chdir=infra init` (R2 credentials and the passphrase)
    5. `tofu -chdir=infra plan -lock=false -out=pr.tfplan` (all credentials)
    6. `tofu -chdir=infra show -no-color pr.tfplan > plan.txt` (the passphrase)
    7. `scripts/infra-plan-comment.sh plan.txt "$HEAD_SHA" > plan-comment.md` (no secrets)
    8. upload `plan-comment.md` as `infra-plan-text`
- [ ] **Step 6:** Both policy tests, the comment test and actionlint. Expected: PASS, with every mutation caught. Full verification. Commit: `ci: OpenTofu plans on PRs behind the infra-plan environment (D97)`.

### Task 13: `infra-drift.yml`, and the docs

**Files:**
- Create: `.github/workflows/infra-drift.yml`
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`
- Modify: `docs/operations.md` (Monthly row; Credentials rows for every new token and the passphrase, plus their Yearly rotation rows; a "When something breaks" row for a red drift run)
- Modify: `docs/deployment.md` (the sections for managed resources become pointers to `infra/<file>.tf`, keeping only the human steps: tokens, secrets, Email Routing, the R2 tokens)
- Modify: `AGENTS.md` (Conventions bullet "Infrastructure (D93–D101)"; Never: "commit state, a plan file or a `.tfvars`" and "`tofu apply` from a branch")

**Interfaces:**
- Produces: job `drift`, triggered by `schedule: cron: '41 7 1 * *'` and `workflow_dispatch`. Its `if` is `github.ref == 'refs/heads/main'`, its environment is `infra-drift`, and its steps are:
  1. install
  2. guard
  3. init
  4. plan: `tofu -chdir=infra plan -lock=false -detailed-exitcode -out=drift.tfplan`, with `id: plan` and `continue-on-error: true`
  5. show: `tofu -chdir=infra show -no-color drift.tfplan >> "$GITHUB_STEP_SUMMARY"`, with `id: show` and `if: always()`
  6. a final step with no secrets that fails with `::error::infrastructure drift` when plan failed and show succeeded, `::error::drift check could not plan` when plan failed and show didn't, and passes otherwise

- [ ] **Step 1:** `gh stack add ci/infra-drift`.
- [ ] **Step 2: Failing policy rules and mutations.** `infra-drift.yml#drift`:
  - its `if` includes `github.ref == 'refs/heads/main'`
  - its env is `infra-drift`
  - its plan has `-detailed-exitcode`
  - its triggers are only `schedule` and `workflow_dispatch`

  Mutations: drop the ref check (Review Focus 5); add a `pull_request` trigger. Run both policy tests. Expected: FAIL.
- [ ] **Step 3:** Write the workflow. Both policy tests and actionlint. Expected: PASS.
- [ ] **Step 4: Docs.**
  - **operations.md:**
    - Monthly row: "Read the drift check's run (Actions → Infra drift). On drift, either apply `main` to undo an uncodified change, or codify it in a PR"
    - Yearly rows for each plan token and the R2 tokens
    - "When something breaks": the two error messages
    - the 60-day inactivity note from §3.8
  - **deployment.md pointers:** check each runbook step against `infra/`. A step stays only if a person must do it.
  - **AGENTS.md.**
- [ ] **Step 5:** `pnpm format:check` and full verification. Commit: `ci: monthly OpenTofu drift check, and IaC docs (D99)`.

### Task 14: ⏸ Ted submits stack D and proves it

- [ ] **Step 1:** Ted submits stack D. The `infra-plan` run on the Task 12 PR touches `infra-plan.yml`, so `plan` shows **Waiting** for review. Ted approves it after reading the diff. Expected: a sticky comment showing "No changes".
- [ ] **Step 2:** Merge. Ted runs Actions → Infra drift → Run workflow on `main`. Expected: green, with "No changes" in the summary.
- [ ] **Step 3: Drift drill.** Ted renames the Better Stack Site monitor in the dashboard, then runs the drift check. Expected: red, with `infrastructure drift` and the rename in the summary. Ted runs `tofu -chdir=infra apply` from `main` to undo it, then runs the check again. Expected: green.

## Close-out

### Task 15: Roadmap and memory

- [ ] **Step 1:** Once stacks A–D have merged, open a small PR moving the roadmap row 13 to Done, titled `docs: mark Plan 13 done on the roadmap`.
- [ ] **Step 2:** Write a `plan-13-infrastructure-as-code` memory covering:
  - what merged, with the `main` SHAs
  - the §5 answers (R2 locking and versioning, Renovate, sensitive attributes, token scopes)
  - token expiry dates
  - anything left out of scope because a secret wasn't marked sensitive
