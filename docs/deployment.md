# Deployment

Production runs on free tiers: **Vercel Hobby** (two projects), **Neon Free** (Postgres 17) and **GitHub Actions**. GitHub Actions is the only thing that deploys; Vercel's Git integration is disabled (`apps/*/vercel.json`). See spec §3 and §10 for the reasoning.

```
Browser ──► wishlist-web (Next.js) ──rewrite /api/*──► wishlist-api (NestJS, one Vercel Function) ──► Neon
```

|     | Production URL                       |
| --- | ------------------------------------ |
| Web | https://wishlist-web-gold.vercel.app |
| API | https://wishlist-api-five.vercel.app |

Vercel assigned these names because `wishlist-web.vercel.app` and `wishlist-api.vercel.app` were already taken. Plan 2 adds a custom domain.

## Accounts

| Service | Plan                                                               | Used for                     |
| ------- | ------------------------------------------------------------------ | ---------------------------- |
| GitHub  | Free (public repo)                                                 | Code, Actions, rulesets      |
| Vercel  | Hobby (non-commercial), team `shockolate`                          | Hosting both apps            |
| Neon    | Free, created in the **Neon console** (not the Vercel integration) | Postgres 17, per-PR branches |

**Why Neon is set up directly, not through the Vercel integration:** our GitHub Actions own preview branching and env wiring. The integration would add a second system creating branches against Neon's 10-branch cap, and it would inject database credentials into projects outside our control. It would also tie the database account to the hosting account.

Later plans add: domain and DNS, Resend and Turnstile (Plan 2); Cloudflare R2 backups and Better Stack uptime monitoring (Plan 5a, see [Backups](#backups) and [Monitoring](#monitoring)); Sentry (Plan 5b).

## Neon

- Project `wishlist`, Postgres 17, region AWS us-east-1 (next to Vercel's `iad1`).
- **Pooled** connection string → the API's runtime `DATABASE_URL` (stored in Vercel as a sensitive variable).
- **Direct** connection string → migrations only (`DATABASE_URL_DIRECT`).
- The free plan scales compute to zero after 5 idle minutes. The first query afterwards takes a few hundred ms longer.
- Point-in-time restore covers **6 hours** on the free plan. Nightly backups arrive in Plan 5.

## Vercel projects

Both projects were created and configured from the CLI, so the setup is reproducible and checkable through the API instead of dashboard clicks:

```bash
pnpm exec vercel project add wishlist-api --scope shockolate
pnpm exec vercel project add wishlist-web --scope shockolate

printf '%s' '{"rootDirectory":"apps/api","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nestjs","ssoProtection":null}' \
  | pnpm exec vercel api /v9/projects/wishlist-api -X PATCH --input - --scope shockolate
printf '%s' '{"rootDirectory":"apps/web","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nextjs","ssoProtection":{"deploymentType":"preview"}}' \
  | pnpm exec vercel api /v9/projects/wishlist-web -X PATCH --input - --scope shockolate
```

| Setting                          | wishlist-api | wishlist-web                                  |
| -------------------------------- | ------------ | --------------------------------------------- |
| Root Directory                   | `apps/api`   | `apps/web`                                    |
| Include files outside root       | On           | On                                            |
| Framework preset                 | NestJS       | Next.js                                       |
| Node.js                          | 24.x         | 24.x                                          |
| Vercel Authentication            | Disabled     | **Previews only** (`deploymentType: preview`) |
| Protection Bypass for Automation | —            | Enabled (secret in GitHub `preview` env)      |

**Why the protection settings look like this:**

- **The web app protects previews only, not "Standard Protection".** Standard Protection (`all_except_custom_domains`) would also put the production `*.vercel.app` URL behind a Vercel login until a custom domain exists, which would lock out real users and the production smoke tests.
- **The API is unprotected.** A Next.js rewrite can't attach the bypass header, and the API enforces its own auth.

The bypass secret was generated through the API and piped straight into GitHub, so it was never printed:

```bash
printf '%s' '{"generate":{"note":"GitHub Actions smoke tests (wishlist-app)"}}' \
  | pnpm exec vercel api /v1/projects/wishlist-web/protection-bypass -X PATCH --input - --scope shockolate \
  | jq -r '.protectionBypass | to_entries | map(select(.value.scope == "automation-bypass")) | .[0].key' \
  | gh secret set VERCEL_AUTOMATION_BYPASS_SECRET --env preview
```

## Domain and DNS

`hanker.dev` is registered at Cloudflare, and DNS stays there (spec §10).

| Record                                                                                                                                | Points at                                                                                         | Proxy                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `hanker.dev` and `www.hanker.dev`                                                                                                     | The records Vercel → `wishlist-web` → Settings → Domains shows. `www` redirects to the apex (308) | **DNS only (grey cloud).** Proxying breaks Vercel's certificates and caching |
| Resend's records for `mail.hanker.dev`: MX and SPF `TXT` on `send.mail.hanker.dev`, DKIM `TXT` on `resend._domainkey.mail.hanker.dev` | The records Resend → Domains shows                                                                | DNS only                                                                     |
| `_dmarc.hanker.dev` (`TXT`)                                                                                                           | `v=DMARC1; p=none;`. Monitor first, then tighten                                                  | DNS only                                                                     |

- **Turnstile:** Cloudflare → Turnstile → widget "Hanker", hostname `hanker.dev`, mode Managed. The site key is the `TURNSTILE_SITE_KEY` repo variable. The secret key stays offline until sign-up opens.
- **The canonical origin:** `APP_ORIGIN` and the `APP_PRODUCTION_ORIGIN` repo variable are both `https://hanker.dev`. State-changing calls from any other origin, including the `*.vercel.app` production alias, get `403 FORBIDDEN_ORIGIN`.

## Environment variables

| Where                              | Name                                                                                                                          | Value                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel `wishlist-api` → Production | `DATABASE_URL` (sensitive)                                                                                                    | Neon pooled string                                                                                                                                                                                                               |
| Vercel `wishlist-api` → Production | `APP_ORIGIN`                                                                                                                  | Web production origin. The CSRF guard compares it exactly, and email links use it                                                                                                                                                |
| Vercel `wishlist-api` → Production | `CRON_SECRET` (sensitive)                                                                                                     | 48 random bytes, base64. Vercel Cron sends it as a bearer token. Unset means the cron refuses everyone                                                                                                                           |
| Vercel `wishlist-api` → Production | `TURNSTILE_SECRET_KEY` (sensitive)                                                                                            | **Unset until the end of Plan 4 (D31).** While unset, sign-up, resend-verification and reset-request answer `503 CAPTCHA_UNAVAILABLE`, and the web app says sign-ups are paused. Setting it opens sign-up: see "Opening sign-up" |
| Vercel `wishlist-api` → Production | `EMAIL_TRANSPORT=resend`, `EMAIL_FROM=Hanker <no-reply@mail.hanker.dev>`, `RESEND_API_KEY` (sensitive)                        | Set in Plan 2b. The API refuses to boot in production with Turnstile set and `EMAIL_TRANSPORT=log`                                                                                                                               |
| Set per preview by CI              | `DATABASE_URL`, `APP_ORIGIN`, `EMAIL_TRANSPORT=log`, `TURNSTILE_SECRET_KEY` (Cloudflare's always-pass test secret), `GIT_SHA` | See `.github/workflows/preview.yml`                                                                                                                                                                                              |
| Set per deploy by CI               | `GIT_SHA`                                                                                                                     | The commit being deployed                                                                                                                                                                                                        |
| Set at build by CI                 | `API_ORIGIN` (web)                                                                                                            | API production origin, or the PR's API preview URL                                                                                                                                                                               |
| GitHub repo variable               | `TURNSTILE_SITE_KEY`                                                                                                          | The production widget's public site key (Cloudflare → Turnstile → Hanker). The production web build fails without it                                                                                                             |
| Set at build by CI                 | `TURNSTILE_SITE_KEY` (web)                                                                                                    | The repo variable in `deploy.yml`; Cloudflare's always-pass test key in CI and previews                                                                                                                                          |

Set a sensitive production variable without it touching disk or shell history. For example, `CRON_SECRET`:

```bash
openssl rand -base64 48 | tr -d '\n' \
  | npx --yes vercel@64.5.0 env add CRON_SECRET production --sensitive --project wishlist-api --scope shockolate
```

Runtime variables apply to the **next** deployment. Redeploy, or merge to `main`, after changing one.

## Daily cron

`apps/api/vercel.json` schedules `GET /api/internal/cron/daily` for 09:00 UTC. Hobby runs it once a day, at some point within that hour, and only on production deployments. Each run purges:

- unverified accounts older than 7 days, which cascades to their wishlists, tokens and sessions;
- expired email tokens and sessions;
- rate-limit windows older than a day.

The response lists the counts.

- **Check it ran:** Vercel → `wishlist-api` → Settings → Cron Jobs shows the schedule and has a **Run** button. The run's logs show the JSON counts.
- **It refuses** any request without `Authorization: Bearer $CRON_SECRET` with a `401`.

## Backups

`.github/workflows/backup.yml` runs `scripts/backup.sh` every night at 07:17 UTC (spec §10 Recovery). It:

1. dumps production with `pg_dump` as `hanker_backup`, a role that can only read (D48);
2. encrypts the dump with `age` inside the pipe, so the plaintext never touches the runner's disk;
3. uploads it to R2 as `daily/<UTC timestamp>.dump.age`, and checks the stored size;
4. pings the Better Stack heartbeat, or its `/fail` URL if any step failed.

R2 keeps each dump for 30 days. Only the private `age` key, which never leaves your hands, can read one. The restore drill below proves they can be read.

### One-off setup

Do these in order. Each secret goes into the GitHub `production` environment with `gh secret set <NAME> --env production`, which prompts for the value without echoing it.

**1. The `age` key pair.** On your machine, install the same release the workflow uses:

```bash
curl -fsSL -o /tmp/age.tar.gz https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz
echo "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10  /tmp/age.tar.gz" | sha256sum -c -
tar -xzf /tmp/age.tar.gz -C /tmp && sudo install /tmp/age/age /tmp/age/age-keygen /usr/local/bin/
```

Generate the key straight into a passphrase-protected file. The private key never exists unencrypted on disk:

```bash
age-keygen | age -p -a > ~/hanker-backup-identity.age
```

`age-keygen` prints `Public key: age1…` to the terminal; that's the recipient, and it isn't secret. `age -p` asks for a passphrase. Then:

- **Prove the pair matches** before anything depends on it: `echo ok | age -r <public key> | age -d -i ~/hanker-backup-identity.age` must print `ok`. A recipient that doesn't match the key would make every dump unreadable, and nothing else would notice.
- **Store the identity file in two places you control**, for example a password-manager attachment and an offline USB drive, and the passphrase in your password manager. Losing either one makes every backup unreadable.
- **Set `AGE_RECIPIENT`** to the public key.

**2. The read-only role.** Roles created in the Neon console join `neon_superuser`, so create this one in SQL. Connect to the production branch as the owner role, using the direct (not `-pooler`) connection string from the Neon console:

```bash
read -rs OWNER_URL && psql "$OWNER_URL"; unset OWNER_URL
```

```sql
CREATE ROLE hanker_backup WITH LOGIN;
\password hanker_backup
GRANT pg_read_all_data TO hanker_backup;
```

`\password` prompts twice and sends only a hash, so the password never appears in a log or in history. Generate it with your password manager (Neon requires at least 60 bits of entropy) and keep it there.

If Neon refuses the `GRANT pg_read_all_data` (the docs don't confirm it's allowed), grant the same reads explicitly. The default privileges cover tables a future migration creates; `<owner>` is the role in `DATABASE_URL_DIRECT` (Neon's default is `neondb_owner`) and `<database>` its database (default `neondb`):

```sql
GRANT CONNECT ON DATABASE <database> TO hanker_backup;
GRANT USAGE ON SCHEMA public, drizzle TO hanker_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO hanker_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO hanker_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public, drizzle GRANT SELECT ON TABLES TO hanker_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public, drizzle GRANT SELECT ON SEQUENCES TO hanker_backup;
```

Prove it can read but not write, connected as `hanker_backup` this time:

```sql
SELECT count(*) FROM users;                        -- works
CREATE TABLE backup_write_probe (id int);          -- must fail: permission denied
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname = 'hanker_backup';     -- all f
```

Set `DATABASE_URL_BACKUP` to the role's **direct** connection string with `sslmode=require`. `pg_dump` doesn't work reliably through the pooler.

**3. R2.** In the Cloudflare dashboard, under R2:

- **Bucket:** create `hanker-backups` with automatic location and Standard storage. Keep it private: no public access, no custom domain.
- **Lifecycle rule:** under the bucket's Settings → Object lifecycle rules, add a rule for prefix `daily/` that deletes objects 30 days after upload.
- **Bucket lock:** under Settings → Bucket lock rules, add a rule for prefix `daily/` that retains objects for 30 days. A lock blocks deletes and overwrites, and takes precedence over the lifecycle rule, so a leaked token can't destroy the dumps already there.
- **Token:** under Manage API tokens, create a token with **Object Read & Write**, applied to `hanker-backups` only. Copy the Access Key ID and Secret Access Key; the secret is shown once.

Set `R2_ACCOUNT_ID` (on the R2 overview page), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` (`hanker-backups`).

**4. The heartbeat.** In Better Stack, under Uptime → Heartbeats, create "Hanker nightly backup", expected every **1 day**, with a **2 hour** grace period, alerting you by email. Set `BACKUP_HEARTBEAT_URL` to its URL. It's a secret because anyone holding it can send a fake "all good".

**5. First run.**

```bash
gh workflow run backup.yml --ref main
gh run watch "$(gh run list --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The log ends with `backup uploaded: daily/<timestamp>.dump.age (<n> bytes)`, the object appears in the bucket, and the heartbeat turns green. Then run the [restore drill](#restore-drill-and-recovery) against it.

### When it fails

The heartbeat emails you: right away if a run failed, or after the grace period if no run reported at all. Read the newest run with `gh run view --log-failed`.

| Symptom                               | Cause and fix                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission denied for table …`       | A migration added a table `hanker_backup` can't read. Only possible with the explicit-grant fallback: re-run its `GRANT SELECT ON ALL …` lines. |
| `403` from `r2.cloudflarestorage.com` | The R2 token was revoked, expired or scoped to another bucket. Create a new one and update the two `R2_*_KEY*` secrets.                         |
| `the dump isn't age-encrypted`        | `age` failed or `AGE_RECIPIENT` isn't a valid public key.                                                                                       |
| No run at all                         | GitHub disables scheduled workflows in a public repository after 60 days without activity. Re-enable it with `gh workflow enable backup.yml`.   |

### Rotation and upgrades

- **A new `age` key.** Dumps already in R2 stay readable only with the old key, so keep the old identity file until the last of them expires, 30 days after the switch. Re-run the drill with the new key.
- **The R2 token or the role's password.** Replace the secret, then dispatch a run to prove it.
- **Postgres.** `scripts/postgres-image` pins `postgres:17-alpine` by digest. When Neon's production moves to a new major version, pin the matching image, because `pg_dump` refuses servers newer than itself.

## Restore drill and recovery

A backup job that passes proves only that bytes reached R2. The drill proves they come back as the data: that the dump is complete, that `AGE_RECIPIENT` matches the key you kept, and that you can still find and unlock that key (D49). Plan 5a counts as done only once a drill passes against a real nightly dump.

**Needs:** Docker running, `age` v1.3.2 ([Backups](#backups) step 1), `curl`, `jq`, and your identity file and its passphrase.

**Run the drill:**

1. In the Cloudflare dashboard, open R2 → `hanker-backups` → `daily/`, and download the newest `.dump.age`. It's encrypted, so it's safe on disk; delete it afterwards anyway.
2. Run:

   ```bash
   scripts/restore-drill.sh ~/Downloads/<timestamp>.dump.age ~/hanker-backup-identity.age
   ```

   `age` asks for the passphrase. The script restores into an in-memory `postgres:17-alpine` container named `hanker-restore-drill-*`, which publishes no port and is removed when it finishes, pass or fail.

3. A pass ends with `restore drill: ok`, after a row count per table. Check that the counts look like your data, for example that `users` has about as many rows as you have accounts.

| Failure                                      | Meaning                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `couldn't decrypt …`                         | Wrong passphrase, the wrong identity file, or `AGE_RECIPIENT` doesn't match this key. Fix it today: until you do, every backup is unreadable. |
| `pg_restore refused the dump`                | The dump is incomplete or from a newer `pg_dump`. Read the error above it.                                                                    |
| `… migrations and production reports …`      | A migration shipped after the dump was taken. Use a newer dump.                                                                               |
| `the restore doesn't have the dump's tables` | A table didn't restore. Read the `pg_restore` output above it.                                                                                |

**Real recovery.** Within 6 hours of the bad change, use Neon's point-in-time restore instead (see [Rollback](#rollback)). Older than that, recover from a dump:

1. Pick the newest dump from before the bad change.
2. Restore it and keep the container: `scripts/restore-drill.sh --keep <dump> <identity>`. It prints the container's name and how to remove it.
3. Find what was lost, for example a deleted list's items:

   ```bash
   docker exec -it <container> psql -h 127.0.0.1 -U postgres -d drill
   ```

4. Copy those rows into production. Parents go before children: `users`, then `wishlists`, then `items`, then `claims`. Stream them straight across rather than restoring the whole dump over `main`, which would lose everything written since:

   ```bash
   read -rs OWNER_URL
   docker exec <container> psql -h 127.0.0.1 -U postgres -d drill -XqAt \
     -c "\copy (select * from items where wishlist_id = '<id>') to stdout with (format csv)" \
     | psql "$OWNER_URL" -v ON_ERROR_STOP=1 -c "\copy items from stdin with (format csv)"
   unset OWNER_URL
   ```

   This writes to production, so plan the statements first and try them on a Neon branch of `main` if the change is large.

5. Remove the container: `docker rm -fv <container>`.

## Monitoring

Better Stack's free plan watches the site and the backup, and emails you (D47). Create these in Better Stack → Uptime, with email alerts to you:

| Monitor          | URL                                  | Check every                                          | Proves                                                                                |
| ---------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Live             | `https://hanker.dev/api/health/live` | 3 minutes                                            | The web project, the `/api` rewrite and the API function are up                       |
| Site             | `https://hanker.dev/`                | 3 minutes                                            | The landing page renders. It's static, so it touches neither the API nor the database |
| Deep             | `https://hanker.dev/api/health`      | 1 hour, or the longest the free plan offers          | Neon is reachable and migrated. It answers `503` when not                             |
| Backup heartbeat | set up in [Backups](#backups) step 4 | expects a ping every 24 hours, with 2 hours of grace | The nightly backup ran and uploaded                                                   |

**Why only the deep check touches the database.** `/api/health` runs a query, which wakes Neon, and Neon Free scales to zero only after 5 idle minutes, with 100 CU-hours per project per month. A deep check every 3 minutes would keep it awake all month, about 180 CU-hours, and Neon would then suspend the database until the month ends. Hourly costs about 15 CU-hours; every 30 minutes, about 30. `/api/health/live` never touches the database. After the first week, check Neon → your project → Usage to see that compute stays well under the quota.

**When an alert comes:**

- **Live or Site down:** check Vercel's status and the newest deploy. Roll back if a deploy caused it ([Rollback](#rollback)).
- **Deep down but Live up:** the API is up and Neon isn't. Check Neon's status page and the project's compute quota.
- **Backup heartbeat:** see [Backups → When it fails](#when-it-fails).

## Opening sign-up (end of Plan 4)

Sign-up is dark until the Turnstile secret is set (D29, D31). To open it:

```bash
read -rs TURNSTILE_SECRET && printf %s "$TURNSTILE_SECRET" \
  | npx --yes vercel@64.5.0 env add TURNSTILE_SECRET_KEY production --sensitive --project wishlist-api --scope shockolate
unset TURNSTILE_SECRET
```

A runtime variable applies to the next deployment, so deploy `main` again and wait for every job to pass:

```bash
gh workflow run deploy.yml --ref main
```

Then check, without making an account: a sign-up with a made-up Turnstile token is now refused with `400 CAPTCHA_FAILED`, not `503 CAPTCHA_UNAVAILABLE`. Finally, sign up with a real address on https://hanker.dev, and check that the verification email arrives from `no-reply@mail.hanker.dev`.

If it still answers `503`, the API's runtime log says why (Vercel → `wishlist-api` → Logs, filter `captcha`):

- **No `captcha unavailable` line:** the deployment has no secret. Check the variable is in `wishlist-api`'s Production environment, then deploy again.
- **`siteverify answered HTTP 400 (invalid-input-secret)`:** Cloudflare doesn't recognise the stored value. The site key and the secret key both start `0x4AAAAAAA`, so check it's the widget's **Secret Key**. Replace it with `vercel env rm TURNSTILE_SECRET_KEY production` and the steps above, then deploy again.
- **A network error or another status:** Cloudflare can't be reached from the function.

## GitHub configuration

| Kind      | Scope            | Names                                                                                                                                                   |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets   | env `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `DATABASE_URL_DIRECT`                                                |
| Secrets   | env `preview`    | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET` |
| Variables | repo             | `API_PRODUCTION_ORIGIN`, `APP_PRODUCTION_ORIGIN`, `TURNSTILE_SITE_KEY`                                                                                  |

The Vercel token (`github-actions-wishlist`, scoped to the `shockolate` team) expires after one year; rotate it before then.

## Continuous deployment

`.github/workflows/deploy.yml` runs on every push to `main`, one at a time, as separate jobs split by trust level ([addendum 2026-10-08](superpowers/specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)):

| Job          | Secrets               | Does                                                                                                            |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `guard`      | none                  | Refuses a stale commit (`scripts/assert-main-tip.sh`)                                                           |
| `settings`   | `VERCEL_TOKEN`        | `vercel pull` for both projects; passes on only each `project.json`                                             |
| `build`      | **none**              | Gates, then `vercel build --prod --standalone` for the API and the web app (each output passed on as a tarball) |
| `migrate`    | `DATABASE_URL_DIRECT` | Cache-free `--prod --ignore-scripts` install, then `node apps/api/src/db/migrate-cli.ts` from the checkout      |
| `deploy-api` | `VERCEL_TOKEN`        | `deploy --prebuilt --prod`, then waits until `/api/health` reports the commit                                   |
| `deploy-web` | `VERCEL_TOKEN`        | `deploy --prebuilt --prod`                                                                                      |
| `smoke`      | none                  | Playwright smoke tests against the production origin                                                            |

**How the jobs are kept safe:**

- **Secret-holding jobs run almost nothing.** Only the pinned Vercel CLI runs, through `npx`, at the version in the root `package.json`; never `pnpm exec`.
- **Nothing a build job wrote is executed next to a secret.** Secret-holding jobs restore no cache and run the migrator from the checkout, because a job that ran install scripts could tamper with any cache or artifact it saves.
- **Every job that touches production re-checks the commit.** It confirms it's deploying `main`'s tip, because "Re-run failed jobs" skips `guard`.
- **Every deploy job checks its build output first** (`scripts/check-vercel-output.sh`). The output must be complete and self-contained, and no symlink in it may point outside it. The symlink check is defence in depth: the Vercel CLI uploads a symlink's link text, not its target.

A deploy that's already running is never cancelled. Of the runs queued behind it, only the newest is kept, so merging a stack ships its tip once.

If a deploy fails after `migrate`, production still runs the previous code against the new schema. That's safe by construction, because every migration is backward-compatible (expand/contract). Fix forward, or roll back the code (see Rollback).

## Previews

Each PR, including each layer of a stack, gets (`.github/workflows/preview.yml`):

1. A Neon branch `pr-<n>` created from **`preview-seed`**, never from production. The job checks the branch really descends from `preview-seed`, then migrates it.
2. An API preview using that branch. `EMAIL_TRANSPORT=log` means no email is ever sent.
3. A web preview built against that API, aliased to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` (currently `shockolate-wishlist-pr-<n>.vercel.app`).
4. Read-only smoke tests and a sticky PR comment with the **web** link only.

The jobs follow the same trust split as deploys: `build-api` and `build-web` hold no secrets, and `smoke` holds only the bypass secret. Bot (Renovate) and fork PRs get CI but no preview.

**Fixing an old preview branch.** If `provision` fails with "does not descend from preview-seed", the PR's branch was cloned from production before this change. Close and reopen the PR: cleanup deletes the old branch, and the next run creates a fresh one from `preview-seed`.

Cleanup (`.github/workflows/cleanup.yml`): closing a PR deletes its Neon branch, and a nightly sweep deletes any `pr-*` branch whose PR is closed. Neon Free allows 10 branches per project. `main` and `preview-seed` take two, so at most 8 PRs can have previews at once.

To check the sweep by hand: Actions → "Cleanup previews" → Run workflow (dry run defaults to on).

## Preview seed branch

`preview-seed` is the parent of every preview database. It never holds production data.

- **Created** by `.github/workflows/preview-seed.yml` as a **schema-only** root branch of `main`. It's then wiped and rebuilt by replaying every migration from zero. The schema-only copy has drizzle's journal table but not its rows, so the rebuild is required.
- **Kept current** by the same workflow on every push to `main` that touches `apps/api/drizzle/**`, which migrates it incrementally.
- **Reset** with Actions → "Preview seed" → Run workflow with `reset` checked.
- **Fallback** (approved, only if schema-only branches stop working): run with `init_source = parent-data`. That creates it as a normal child of `main` and wipes it in the same job, before its connection string is used for anything else.
- **Safety:** `scripts/preview-seed.sh` refuses to resolve the seed to the production branch, and the workflow only runs on `main`. A seed that isn't a root branch (the fallback, or one made by hand) may hold production rows, so the workflow wipes it on every run. Don't create `preview-seed` by hand.
- **Never delete it.** Neon won't delete a branch that has children, and every open preview is one; refresh it in place instead.
- **Root-branch budget:** `main` plus `preview-seed` use 2 of Neon Free's 3 root branches. A production restore can create backup root branches, so delete old backups if a restore is refused.

## Manual deploy (bootstrap or emergency only)

This is exactly what CI runs. It works from the repo root with the org and project IDs in the environment, so no link files need switching.

```bash
export VERCEL_ORG_ID=<team id>
# API
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel build --prod
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel deploy --prebuilt --prod --env GIT_SHA="$(git rev-parse HEAD)"
# Web (after the API is healthy)
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-web id> API_ORIGIN=https://wishlist-api-five.vercel.app pnpm exec vercel build --prod
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel deploy --prebuilt --prod
```

Migrate production first if the deploy includes a migration. Use the direct string, and the guard below refuses anything that isn't a Neon URL:

```bash
read -rs DATABASE_URL_DIRECT && export DATABASE_URL_DIRECT && [[ "$DATABASE_URL_DIRECT" == *neon.tech* ]] \
  && pnpm --filter @wishlist/api db:migrate || echo "Refusing: not a Neon URL"; unset DATABASE_URL_DIRECT
```

## Rollback

Code: Vercel Instant Rollback, **web first, then API**. Rolling the API back first could leave a newer web app calling an older API.

```bash
VERCEL_PROJECT_ID=<wishlist-web id> pnpm exec vercel rollback
VERCEL_PROJECT_ID=<wishlist-api id> pnpm exec vercel rollback
```

Data: Neon point-in-time restore (6-hour window) from the Neon console. Older than that, recover the rows from a nightly dump ([Restore drill and recovery](#restore-drill-and-recovery)).

## Known issues

- **CLI output changes when an AI agent runs it.** When the Vercel CLI detects an agent, `vercel deploy` prints a JSON object on stdout instead of a bare deployment URL. Scripts must read the URL from either form.

## CI/CD supply-chain hardening

These came out of Plan 1's final review. `scripts/workflow-policy.test.mjs` enforces them in CI.

- **The `production` environment only accepts `main`** (a custom deployment branch policy), and the deploy job also checks `github.ref == 'refs/heads/main'`. Without both, a `workflow_dispatch` from any branch could migrate production or read `DATABASE_URL_DIRECT`.
- **Stale deploys are refused.** The deploy job stops before migrating if `GITHUB_SHA` is no longer the tip of `main`, so re-running an old failed deploy can't roll production back.
- **Every action is pinned to a commit SHA** (version in a trailing comment), and the actionlint image is pinned by digest. Renovate's `helpers:pinGitHubActionDigests` keeps them current.
- **Checkouts use `persist-credentials: false`**, so later steps (dependency install scripts included) can't read the `GITHUB_TOKEN` from `.git/config`.
- **`VERCEL_TOKEN` is scoped to the steps that deploy**, not the whole job.
- **Bot PRs (Renovate) get CI but no preview.** Unreviewed dependency code never runs next to deploy credentials, and bot PRs don't use up Neon's 10-branch cap.
- **Renovate waits 3 days after a release** (`minimumReleaseAge`) and **never automerges**. That holds at least until builds run in a job with no deploy credentials.

**Done (2026-10-08):** each pipeline is split into secret-free build jobs and deploy-only jobs (see Continuous deployment and Previews).

## Repository settings

Applied once, from the files in this repo:

| Setting                           | Source                       | How                                                                                                                           |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ruleset on `main`                 | `.github/rulesets/main.json` | `gh api -X POST repos/Shockolate/wishlist-app/rulesets --input .github/rulesets/main.json` (update: `-X PUT …/rulesets/<id>`) |
| CodeQL                            | default setup                | `gh api -X PATCH repos/Shockolate/wishlist-app/code-scanning/default-setup -f state=configured`                               |
| Secret scanning + push protection | repo security settings       | `gh api -X PATCH repos/Shockolate/wishlist-app` with `security_and_analysis` enabled                                          |
| Dependabot alerts                 | repo security settings       | `gh api -X PUT repos/Shockolate/wishlist-app/vulnerability-alerts`                                                            |
| Auto-merge (used by Renovate)     | repo settings                | `gh repo edit --enable-auto-merge`                                                                                            |
| Renovate                          | GitHub App                   | install from https://github.com/apps/renovate for this repo only                                                              |

Required checks: `checks`, `actionlint`, `integration`, `migrations-lint`, `e2e`. `preview` is advisory: a Vercel or Neon outage, or Neon's branch cap, shouldn't block merging code that passed CI.
