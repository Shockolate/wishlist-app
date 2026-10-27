# Infrastructure as code: design

**Status:** approved in conversation 2026-10-27, pending Ted's read of this document.
**Amends:** the [CI secret isolation addendum](2026-10-08-ci-secret-isolation-and-seeded-previews-design.md) §1 (property 1 gains a second named exception, §3.7 here; the "Project settings are pulled, not committed" decision, §3.1 here), and [deployment.md](../../deployment.md), [operations.md](../../operations.md) and [AGENTS.md](../../../AGENTS.md). Decisions continue from D92.

## 1. Why

Hanker's code is reviewed, tested and pinned. Most of its infrastructure isn't: DNS records, R2 bucket rules, monitors, GitHub environments and Vercel project settings were made in dashboards or with one-off `gh api` and `vercel api` calls, and live on only as runbooks in `deployment.md`. Nothing notices when one of them drifts, and some of them guard security (the `production` environment's `main`-only policy, the R2 bucket lock) or availability (CAA, DNSSEC, the apex records).

Ted wants to learn infrastructure as code by doing it properly on a real system, and to hold the infrastructure to the same standard as the code. The learning matters as much as the result. Every apply is Ted's, and each layer's PR body explains the concept it introduces (import, state, encryption, plan review, drift).

**Success is:**

- Every resource in scope (§3.1) is described in `infra/`, and `tofu plan` against production says **No changes**.
- An infrastructure change goes through a PR whose plan Ted reads before merging, and is applied from `main`.
- A dashboard change that nobody codified shows up within a month (§3.8).
- The runbooks in `deployment.md` for those resources become pointers to the code, keeping only the steps a person has to do (tokens, secrets).

**Non-goals:** applying from CI; managing secret values; Neon, Sentry, Resend or Email Routing (§3.1); modules, workspaces or multiple environments (there is one production); a Terraform Cloud-style service.

**Anti-goals (a failure even if it works):**

- An import recreates, replaces or changes any live resource. Importing changes nothing.
- A secret value appears in a commit, a log, a PR comment, a job summary or an artifact.
- The workflow policy tests get weaker. Every policy change here makes them stricter.
- CI can write state or change infrastructure.
- Ceremony out of proportion to a one-person, free-tier app.

## 2. Constraints

Everything in AGENTS.md applies, in particular: exact pins, stacked PRs with Conventional Commit titles, the workflow policy tests, no `paths:` or `branches:` filter on a `pull_request` workflow, and "ask a maintainer first" for cloud resources, secrets and the first `gh stack submit`.

**Ted's steps** (marked ⏸) create or change cloud resources, credentials or secrets, or run `tofu apply`. The builder writes the runbook for each and stops there; Ted runs it.

## 3. Design

### 3.1 Scope

**Decision (D95).** The first version manages these, and only these:

| Provider | Managed | Stays as it is |
| --- | --- | --- |
| **Cloudflare** (`cloudflare/cloudflare`) | `hanker.dev`'s DNS records for Vercel (apex, `www`) and Resend (both domains' `send` and `rsend` CNAMEs and DKIM), `_dmarc`, DNSSEC, the `hanker-backups` bucket, the Turnstile widget. The bucket's lifecycle and lock rules are **asserted, not managed** (below) | The zone itself (its ID is a local, not managed), zone settings, Email Routing and the records it creates, every API token |
| **GitHub** (`integrations/github`) | The repository's settings (secret scanning and push protection, visibility, features; amended 2026-10-27: auto-merge, delete-branch-on-merge, the merge methods and commit-message defaults are `ignore_changes`, because GitHub hides them from the read-only plan token, and vulnerability alerts weren't importable), the `main` ruleset, the `production`, `preview`, `infra-plan` and `infra-drift` environments with their reviewers and branch policies, the repo variables | Every secret, CodeQL default setup, the Renovate app |
| **Better Stack** (`BetterStackHQ/better-uptime`) | The Live, Site and Deep monitors | Both heartbeats (amended 2026-10-27: provider 0.22.4 doesn't mark a heartbeat's `url` sensitive, so a plan would print it), escalation and notification settings |
| **Vercel** (`vercel/vercel`) | Both projects' settings (root directory, framework, Node version, region, deployment protection), `hanker.dev` and `www.hanker.dev` with the 308 redirect | Every env var (amended 2026-10-27: all of the API's, `APP_ORIGIN` and `EMAIL_*` included, are Vercel type `sensitive`, so unreadable and never drift-checkable), the automation bypass (not managed by choice: `vercel_project` has no attribute for it, and the separate `vercel_project_protection_bypass` resource would put its secret in state, D96), the `*.vercel.app` domains, deployments, everything `vercel.json` already sets (install command, cron, `git.deploymentEnabled`) |

**The backup bucket's rules are asserted (amended 2026-10-27, Ted's choice).** Provider 5.28.1 can't import `r2_bucket_lifecycle` or `r2_bucket_lock`, and creating them would rewrite the rules that protect the backups. Data sources read them, and postconditions require an enabled `daily/` rule that deletes after 30 days and one that locks for 30 days. Every plan, the drift check included, fails if either is loosened. Changing a rule stays a dashboard step, with its assertion updated in the same PR.

**What the live zone held at import (2026-10-27).** Resend's records are CNAMEs to `forge.rmta.net` (`send` and `rsend`, on both domains), not the MX and SPF `deployment.md` described. There's **no CAA record**: the runbook in `deployment.md` was never applied. Adding one is an ordinary infra PR after the imports, not part of them.

**Out of scope:**

- **Neon:** two projects that never change, and CI owns their branches. The `hanker_backup` role would need owner credentials.
- **Sentry:** its provider is community-maintained. It's the first candidate for a later version.
- **Resend:** its DNS half is covered by Cloudflare.
- **Email Routing:** its records are Cloudflare-managed, and its destination is a personal address that doesn't belong in a public repo.
- **Anything CI creates or deletes:** `pr-*` branches, `preview-seed`, per-preview env vars and deployments.

**Vercel settings become code (D100).** The addendum rejected committing project settings because they "could drift from the live projects without anyone noticing". The drift check (§3.8) is the cure for exactly that, so the HCL becomes the source of truth for those settings. Builds don't change: the `settings` job still runs `vercel pull`, and nothing in `deploy.yml` or `preview.yml` reads `infra/`. A setting lives in `vercel.json` or in HCL, never both.

**Never use an authoritative resource or attribute over something the code doesn't own.** In particular, no inline `environment` block on `vercel_project` (it would own every env var on the project, and delete the sensitive ones and CI's), and no `git_repository` (the Git integration stays disabled). Env vars are individual `vercel_project_environment_variable` resources.

### 3.2 Layout and toolchain

**Decision (D93).** OpenTofu, one root module, in `infra/`, split into one file per provider plus `versions.tf` (pins), `backend.tf`, `encryption.tf` and `imports.tf`. No modules: nothing repeats.

- **OpenTofu is pinned exactly** in `infra/.opentofu-version`. `scripts/install-tofu.sh` installs that release after checking its sha256, following `scripts/install-sentry-cli.sh`, with an `install-tofu.test.sh`. CI uses only this script. Locally, Ted installs the same release the same way.
- **Providers are pinned exactly** (`version = "x.y.z"`), and `.terraform.lock.hcl` is committed with hashes for `linux_amd64` (`tofu providers lock -platform=linux_amd64`).
- **No CLI config:** CI sets `TF_CLI_CONFIG_FILE=/dev/null`, and the guard (§3.9) refuses any `.tofurc`, `.terraformrc` or `terraform.rc` in the repo. A CLI config's `dev_overrides` would bypass the lockfile.
- **IDs aren't secrets:** account, zone, team and project IDs go in `locals`. There's no `terraform.tfvars`.
- **`.gitignore`** gains `.terraform/`, `*.tfstate*`, `*.tfplan` and `*.tfvars`.
- **Renovate** opens provider and OpenTofu updates for review. They run next to secrets, so they never automerge, which D88 already guarantees. If Renovate can't refresh the lockfile hashes for OpenTofu (§5), provider bumps become a quarterly chore instead.

### 3.3 State and secrets in it

**Decision (D94).** State lives in a new private R2 bucket, `hanker-tofu-state`, through the `s3` backend, encrypted on the client before it leaves the machine.

- **Encryption:** the `pbkdf2` key provider with the `aes_gcm` method, for both **state and plan files**, each with `enforced = true` so unencrypted state is refused. The passphrase (`TOFU_STATE_PASSPHRASE`, at least 16 characters; generate 32 or more) lives in Ted's password manager and in the `infra-plan` and `infra-drift` environments.
- **The bucket:** made by hand (⏸), because the state can't describe the bucket that holds it. No public access and no custom domain. It has no bucket lock, because state is overwritten on every apply.
- **Locking:** `use_lockfile = true` locally if R2 supports conditional writes (§5). Otherwise none, since there is one person applying. CI always plans with `-lock=false` and a read-only bucket token, so CI can never write state.
- **Recovery:** losing the state or the passphrase doesn't touch live infrastructure. Start a fresh state and re-import everything from `imports.tf`'s history. The deployment.md runbook says so.

**Decision (D96).** Secret values stay out of IaC. A few providers still put a computed secret in state. These are accepted and listed:

| In state | Unlocks if leaked |
| --- | --- |
| The Turnstile widget's secret key | Little: verifying tokens against Hanker's widget |

After each import layer is applied, Ted decrypts the state locally and checks that nothing else sensitive is in it (⏸). Anything beyond this table stops the work until the spec is updated.

**The root module has no `output` blocks**, so nothing in state is printed on purpose.

### 3.4 Credentials

**Decision (D98).** Planning and applying use different credentials. CI gets the weakest token each provider offers. Write-capable tokens live only on Ted's machine.

| Provider | Plan (CI: `infra-plan`, `infra-drift`) | Apply (local only) |
| --- | --- | --- |
| R2 state bucket | Object Read, `hanker-tofu-state` only | Object Read & Write, `hanker-tofu-state` only |
| Cloudflare | Read-only, this zone and account's R2 and Turnstile | Edit for exactly the resource types in §3.1 |
| GitHub | Fine-grained token, this repo, read-only (administration, environments, variables, metadata) | Ted's `gh` login |
| Vercel | Its own token `tofu-plan`. Vercel has no read-only scope (§5), so it's full team access | Its own token `tofu-apply` |
| Better Stack | Its own token | Its own token |

- **Separate tokens** mean the CI ones can be revoked without touching deploys or Ted's.
- **None of these is `VERCEL_TOKEN`.**
- **Every CI token gets an expiry**, at most one year.
- **Every credential** gets a row in operations.md's Credentials table, with a Yearly rotation row (D83).
- **Locally**, credentials never sit in a tracked file, a shell history or argv. The builder picks the mechanism, for example `read -rs` exports or a password-manager CLI.

### 3.5 Changing infrastructure

**Decision (D97): CI plans, Ted applies.**

1. On a branch, edit `infra/` and run `tofu plan` locally.
2. Open the PR. Ted approves the `infra-plan` deployment after reading the diff, and CI posts the plan (§3.6).
3. Review and merge through the normal stacked-PR flow.
4. On `main`'s tip, Ted runs `tofu apply` (⏸). Apply re-plans; Ted checks it matches the PR's plan before typing `yes`. Applying from any other branch is never done. It would leave state ahead of `main`.

A dashboard change in an emergency is allowed. Codify or revert it in a PR afterwards. The drift check catches it if nobody does.

### 3.6 CI

**`infra` job in `ci.yml` (no secrets, required check).** It runs on every PR:
- `tofu fmt -check -recursive`
- `tofu init -backend=false`, which checks provider hashes against the lockfile
- `tofu validate`
- `scripts/infra-guard.sh`

Adding it to the required checks is a change to the ruleset, made through `infra/` once the ruleset is imported.

**`infra-plan.yml` (on `pull_request`, never `pull_request_target`):**

- **`changes`** (no secrets) decides whether the PR touches `infra/`, `infra-*.yml`, `install-tofu.sh` or `infra-guard.sh`. This replaces a `paths:` filter, which AGENTS.md forbids.
- **`plan`** runs only when it does, and only for same-repo, non-bot PRs (preview.yml's condition). It uses environment `infra-plan`, whose only protection is **Ted's required approval** (no branch policy, because PR branches vary; "prevent self-review" stays off, or nobody could approve). Its steps:
  1. Check out with `persist-credentials: false`.
  2. Install via `install-tofu.sh`.
  3. Run `infra-guard.sh`. Every step up to here holds no secret.
  4. `tofu init`, then `tofu plan -lock=false -out=…`. These, and the `tofu show` that reads the encrypted plan, are the only steps that get the credentials and the passphrase.
  5. Write `tofu show -no-color` of the plan to a text file, cut to fit a PR comment, and upload it as an artifact.
- **`comment`** (no secrets; `pull-requests: write`) downloads that text and posts or updates a sticky PR comment. The text is data and is never executed, like the addendum's safe artifacts.

The plan is advisory and not a required check. A provider outage shouldn't block merging, which matches `preview`. Bot and fork PRs get no plan. Ted plans a Renovate provider bump locally before merging it.

### 3.7 The trust model's second named exception

The addendum's property 1 says secrets never meet PR code. The `plan` job breaks that on purpose: HCL from the PR, and the providers it chooses, run with the plan credentials and the state passphrase. The passphrase decrypts the secrets listed in §3.3.

**Why the environment approval is the control that matters:** a `pull_request` run uses the PR's own workflow file, so a PR can delete the guard steps. It can't change the environment's protection rule, which lives in repository settings. Any job that names `infra-plan` waits for Ted, whatever the workflow says. The guard script and the policy tests are defence in depth for the honest-mistake case.

**What bounds it:**
- the approval
- same-repo, non-bot PRs only
- read-only tokens where they exist
- step-scoped secrets
- no outputs
- the guard
- a public log that GitHub masks for the injected tokens and passphrase (not for values read out of state, which is why the guard bans `nonsensitive()` and outputs)

**Accepted risk (Ted, 2026-10-27):** a PR that Ted approves without reading carefully could exfiltrate the Vercel and Better Stack plan tokens (which can write) and the secrets in §3.3. Agents act through Ted's `gh` login and could technically approve a pending deployment through the API. AGENTS.md's ask-first list gains "approving a pending deployment". That's a rule, not a technical control. Revisit when anyone else gets write access to the repo.

### 3.8 Drift check

**Decision (D99).** `infra-drift.yml` runs monthly on a schedule, and on `workflow_dispatch`.
- **Environment:** `infra-drift`, which accepts only `main` (a custom deployment branch policy), and the job also checks `github.ref == 'refs/heads/main'`. There's no reviewer, because the code is already reviewed. A scheduled run can't wait for an approval.
- **Credentials:** the same read-only plan credentials, the same install and guard steps.
- **The run:** `tofu plan -lock=false -detailed-exitcode`.
- **Results:** exit `2` (changes) fails the run with "infrastructure drift", and `1` fails it as an error. Both write the redacted plan to the job summary.
- **Notifications:** GitHub emails the person who last changed a scheduled workflow's cron line when it fails, so that line's author must be Ted.
- **Inactivity:** GitHub disables scheduled workflows on a public repo after 60 days without activity. Renovate's PRs keep the repo active, but if the run stops appearing, that's the first thing to check.

operations.md gains a Monthly row for following up (apply `main` to undo an uncodified change, or codify it), and a "When something breaks" row for a failed drift run.

### 3.9 Guards and policy tests

**`scripts/infra-guard.sh`**, with an `infra-guard.test.sh`, runs in the `infra` job and before any secret in `plan` and drift. It fails when:

- the lockfile names a provider outside the four in §3.1
- any `provisioner`, `data "external"`, `data "http"` or `module` block exists
- any `output` block or `nonsensitive(` call exists
- any `*_override.tf` file or CLI config file exists
- `encryption.tf` doesn't enforce encryption for both state and plans

It's grep-level, so it's defence in depth, not the boundary (§3.7).

**`scripts/workflow-policy.test.mjs` gains rules, each with a mutation test.** They require:
- secret jobs in `infra-*.yml` use only `infra-plan` or `infra-drift`
- `infra-plan`'s secret job keeps the same-repo and non-bot condition
- no workflow uses `pull_request_target`
- `install-tofu.sh` and `infra-guard.sh` run before the first secret-holding step, and no package runner runs in these jobs
- secrets appear only on `tofu init`, `tofu plan` and `tofu show` steps
- every `tofu plan` has `-lock=false`
- no workflow runs `tofu apply`, `import`, `state`, `destroy`, `force-unlock` or `taint`
- the drift job checks `refs/heads/main`

### 3.10 Importing what exists

**Decision (D101).** Each provider is brought in by its own layer, using `import` blocks. The gate for each is a plan that says **N to import, 0 to add, 0 to change, 0 to destroy**. If the plan wants a change, fix the HCL, never the resource. Deliberate changes come later, in their own PRs.

- **`lifecycle { prevent_destroy = true }` goes on:**
  - the apex, `www`, CAA and Resend records, and DNSSEC
  - the backups bucket and its rules
  - both Vercel projects and their domains
  - the repository, the ruleset and the `production` environment
- **After Ted applies the imports** (⏸), the `import` blocks are removed in the next stack, and Ted checks the state's secrets (§3.3).
- **The ruleset moves to code.** `.github/rulesets/main.json` is deleted in the GitHub layer, and the ruleset row in deployment.md's Repository settings points to `infra/github.tf`.
- **Environments:** the `infra-plan` and `infra-drift` environments are created through `infra/` in the CI layers. Everything else listed is imported.

## 4. Delivery

One concern per layer, and each layer passes CI on its own. Applies happen only from `main`, and some layers need an earlier one applied, so the layers ship as **four stacks merged in order**: A = 1, B = 2–5, C = 6, D = 7–8. Stack B's imports are applied together once B has merged. The plan has the details.

1. **Bootstrap:**
   - `infra/` with versions, backend, encryption and an empty provider set
   - `install-tofu.sh` and `infra-guard.sh` with their tests
   - the `infra` CI job
   - `.gitignore`
   - AGENTS.md's Layout row
   - ⏸ Ted creates the state bucket, its two tokens and the passphrase, then runs `tofu init`
2. **Cloudflare import.** ⏸ Ted plans it locally: N to import, 0 to change.
3. **GitHub import**, retiring `main.json`. ⏸ Ted plans it locally: N to import, 0 to change.
4. **Better Stack import.** ⏸ Ted plans it locally: N to import, 0 to change.
5. **Vercel import**, with D100 recorded in the addendum. ⏸ Ted plans it locally. Once stack B has merged, Ted applies all four imports from `main` and checks the state.
6. **The CI environments:**
   - `infra-plan` and `infra-drift` in HCL, plus the `infra` required check in the ruleset
   - ⏸ Ted applies, makes the plan tokens and stores them in both environments
   - This layer comes before any workflow names those environments. GitHub creates a missing environment, unprotected, the first time a job names one, and the HCL would then have to import it.
7. **CI plans:**
   - `infra-plan.yml`
   - the policy rules
   - AGENTS.md's ask-first additions
8. **Drift check and docs:**
   - `infra-drift.yml`
   - operations.md: the Monthly row, the Credentials rows, the "When something breaks" row
   - deployment.md: a new "Infrastructure as code" section (the change flow, bootstrap, recovery), with the runbooks for managed resources reduced to pointers
   - ⏸ Ted runs the workflow once by hand

**AGENTS.md changes:**
- **Layout:** an `infra/` row.
- **Conventions:** an "Infrastructure (D93–D101)" bullet covering the scope, the no-authoritative-resources rule, secrets out of IaC, apply only from `main`, and import with zero changes.
- **Ask a maintainer first:** `tofu apply`, and approving a pending deployment.
- **Never:** commit state, a plan file or a `.tfvars`; apply from a branch.

## 5. Check before building

These are facts the design depends on that weren't confirmed. Verify each first, and note what you found in the layer's PR.

1. **R2 and `use_lockfile`:** does R2 honour S3 conditional writes (`If-None-Match`)? If not, set `use_lockfile = false` locally and say why in `backend.tf`.
2. **R2 versioning:** does R2 offer object versioning for the state bucket? Enable it if so. If not, recovery is re-import (§3.3).
3. **Which attributes are sensitive:** heartbeat `url`, the Turnstile secret, the bypass secret. Check how each provider marks them, so that `tofu show` redacts them. Anything that isn't marked sensitive must not be managed, or must be `ignore_changes`, until it can be shown not to print.
4. **Read-only scopes:** confirm that each read-only token in §3.4 can refresh every managed resource. Confirm that Vercel and Better Stack really offer nothing narrower than full access; if they do, use it.
5. **Renovate:** does its `terraform` manager update OpenTofu's `.terraform.lock.hcl` hashes?
6. **The Cloudflare provider:** v5's resource names and the shapes it imports with. It's a large generated rewrite, so don't trust v4-era examples.
7. **OpenTofu:** the latest stable release at build time. Confirm that variables (or `TF_ENCRYPTION`) can feed the encryption passphrase in that release, and that `tofu init -backend=false` and `tofu validate` run without it, which the secret-free `infra` job needs. If they don't, the `infra` job runs `fmt` and the guard only, and says why.

## 6. Left to the builder

- **File contents** inside the layout in §3.2, and resource names in HCL.
- **The local credential mechanism**, within §3.4's rule.
- **The drift schedule's day and hour.**
- **The wording of runbooks and PR bodies**, in the docs' existing voice. Each PR body explains the IaC concept its layer introduces.

**Fixed:** the names `hanker-tofu-state`, `infra-plan`, `infra-drift`, `TOFU_STATE_PASSPHRASE`, `infra/`, `install-tofu.sh` and `infra-guard.sh`.

## 7. Decisions

- **D93:** OpenTofu, one root module in `infra/`, exact pins, binary by checksum, no CLI config.
- **D94:** state in R2 `hanker-tofu-state`, encrypted on the client (PBKDF2, AES-GCM, enforced for state and plans). CI never writes state.
- **D95:** v1 scope is Cloudflare, GitHub, Better Stack and Vercel as listed in §3.1, with the backup bucket's lifecycle and lock rules asserted rather than managed. Neon, Sentry, Resend and Email Routing are out, as are secret values and CI-owned resources. No authoritative resources over anything the code doesn't own.
- **D96:** secret values stay out of IaC. Only the computed secrets in §3.3 are accepted in state. No outputs.
- **D97:** CI plans on PRs behind the `infra-plan` environment and Ted's approval. Ted applies locally from `main`. This is the trust model's second named exception (§3.7).
- **D98:** separate plan and apply credentials. CI gets the weakest scope each provider offers, and write tokens stay local.
- **D99:** a monthly drift check from `main` in `infra-drift`. Drift fails the run.
- **D100:** Vercel project settings become code, amending the addendum's "pulled, not committed". Builds still pull.
- **D101:** import with a zero-change gate, `prevent_destroy` on the resources whose loss is an outage or a data loss, and `main.json` retired.
