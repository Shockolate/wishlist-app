# Deployment

Production runs on free tiers: **Vercel Hobby** (two projects), **Neon Free** (Postgres 17) and **GitHub Actions**. GitHub Actions is the only thing that deploys; Vercel's Git integration is disabled (`apps/*/vercel.json`). See spec §3 and §10 for the reasoning.

```
Browser ──► wishlist-web (Next.js) ──rewrite /api/*──► wishlist-api (NestJS, one Vercel Function) ──► Neon
```

|     | Production URL                                                                           | Vercel's own URL                     |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| Web | https://hanker.dev ([Domain and DNS](#domain-and-dns))                                   | https://wishlist-web-gold.vercel.app |
| API | https://hanker.dev/api/, through the web project's rewrite. People never see its own URL | https://wishlist-api-five.vercel.app |

Vercel assigned these names because `wishlist-web.vercel.app` and `wishlist-api.vercel.app` were already taken. State-changing calls only work from `https://hanker.dev` ([Domain and DNS](#domain-and-dns), "The canonical origin").

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
- **Previews live in a second project, `wishlist-preview`** (D87), in the same organization, Postgres 17, AWS us-east-1. It holds `preview-seed` and the `pr-*` branches and never any production data. Its key is a project-scoped organization API key, so the preview environment can't reach production's project, and previews get their own compute quota and 10-branch cap. Neon's Free plan allows 100 projects, with compute, branches and data transfer counted per project.
- **Pooled** connection string → the API's runtime `DATABASE_URL` (stored in Vercel as a sensitive variable).
- **Direct** connection string → migrations only (`DATABASE_URL_DIRECT`).
- The free plan scales compute to zero after 5 idle minutes. The first query afterwards takes a few hundred ms longer.
- Point-in-time restore covers **6 hours** on the free plan. Nightly backups arrive in Plan 5.

## Vercel projects

**Managed in [`infra/vercel.tf`](../infra/vercel.tf) since 2026-10-27 (D100):** the settings below and both domains. Change them in a PR ([Infrastructure as code](#infrastructure-as-code)), not with these commands. Env vars and the automation bypass stay here: Vercel can't read sensitive values back, and the provider has no bypass attribute.

Both projects were created and configured from the CLI, so the setup is reproducible and checkable through the API instead of dashboard clicks:

```bash
pnpm vercel project add wishlist-api --scope shockolate
pnpm vercel project add wishlist-web --scope shockolate

printf '%s' '{"rootDirectory":"apps/api","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nestjs","ssoProtection":null}' \
  | pnpm vercel api /v9/projects/wishlist-api -X PATCH --input - --scope shockolate
printf '%s' '{"rootDirectory":"apps/web","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x","framework":"nextjs","ssoProtection":{"deploymentType":"preview"}}' \
  | pnpm vercel api /v9/projects/wishlist-web -X PATCH --input - --scope shockolate
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
  | pnpm vercel api /v1/projects/wishlist-web/protection-bypass -X PATCH --input - --scope shockolate \
  | jq -r '.protectionBypass | to_entries | map(select(.value.scope == "automation-bypass")) | .[0].key' \
  | gh secret set VERCEL_AUTOMATION_BYPASS_SECRET --env preview
```

## Domain and DNS

`hanker.dev` is registered at Cloudflare, and DNS stays there (spec §10). **The Vercel, Resend and DMARC records and DNSSEC are managed in [`infra/cloudflare.tf`](../infra/cloudflare.tf)** (2026-10-27); change them in a PR. Email Routing's records stay in the dashboard.

| Record                                                                                                                                                                                                                             | Points at                                                                                         | Proxy                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `hanker.dev` and `www.hanker.dev`                                                                                                                                                                                                  | The records Vercel → `wishlist-web` → Settings → Domains shows. `www` redirects to the apex (308) | **DNS only (grey cloud).** Proxying breaks Vercel's certificates and caching |
| Resend's records for `mail.hanker.dev`: `send` and `rsend` CNAMEs to `forge.rmta.net`, DKIM `TXT` on `resend._domainkey.mail.hanker.dev`                                                                                           | The records Resend → Domains shows                                                                | DNS only                                                                     |
| `hanker.dev` `CAA` (`0 issue "letsencrypt.org"`). **Not applied yet** (none existed at the 2026-10-27 import): add it in `infra/cloudflare.tf`. Cloudflare adds hidden records for its own CAs ([DNSSEC and CAA](#dnssec-and-caa)) | Not an address: it limits which CAs may issue certificates                                        | Not proxiable                                                                |
| `_dmarc.hanker.dev` (`TXT`)                                                                                                                                                                                                        | `v=DMARC1; p=none;`. Monitor first, then tighten                                                  | DNS only                                                                     |
| `hanker.dev` MX and SPF `TXT` and `cf2024-1._domainkey` (Email Routing, not managed in code); Resend's records for `hanker.dev`: `send` and `rsend` CNAMEs to `forge.rmta.net`, DKIM `TXT` on `resend._domainkey.hanker.dev`       | The records Cloudflare → Email Routing and Resend → Domains show                                  | DNS only                                                                     |

- **Turnstile:** Cloudflare → Turnstile → widget "Hanker", hostname `hanker.dev`, mode Managed. The site key is the `TURNSTILE_SITE_KEY` repo variable. The secret key stays offline until sign-up opens.
- **The canonical origin:** `APP_ORIGIN` and the `APP_PRODUCTION_ORIGIN` repo variable are both `https://hanker.dev`. State-changing calls from any other origin, including the `*.vercel.app` production alias, get `403 FORBIDDEN_ORIGIN`.

### DNSSEC and CAA

internet.nl's website test (2026-10-21) flagged both as missing.

- **DNSSEC** stops a resolver from accepting forged answers for `hanker.dev`.
- **CAA** limits which certificate authorities may issue certificates for it.

A mistake in either can take the site offline. Do A, wait for its check to pass, then do B.

**A. DNSSEC**

1. Cloudflare → **Domain Registration** → **Manage domains** → `hanker.dev` → **Manage** → **Configuration** → **Enable DNSSEC**. Cloudflare is both the registrar and the DNS host, so it signs the zone and sends the DS record to the `.dev` registry itself. There's nothing to copy.
2. Wait. Cloudflare says publishing the DS record can take one to two days.

**Check:**

1. Cloudflare → `hanker.dev` → **DNS** → **Settings** → **DNSSEC** shows a confirmed status.
2. `dig +short DS hanker.dev` returns a record.
3. https://dnsviz.net/d/hanker.dev/dnssec/ shows no errors.
4. https://hanker.dev loads, and a password-reset email still arrives.

Turn DNSSEC off only with the same **Configuration** → **Disable DNSSEC**. Before moving DNS away from Cloudflare, turn it off and wait until `dig +short DS hanker.dev` returns nothing. A DS record left pointing at Cloudflare's keys makes the domain unresolvable for every validating resolver.

**B. CAA**

Vercel issues the certificates for `hanker.dev` and `www.hanker.dev` from Let's Encrypt, over HTTP-01.

1. Cloudflare → `hanker.dev` → **DNS** → **Records** → **Add record**:
   - **Type** CAA
   - **Name** `@`
   - **Flags** `0`
   - **Tag** `issue` (the dashboard may call it "Only allow specific hostnames")
   - **CA domain name** `letsencrypt.org`

   **Save**.

2. Don't add an `issuewild` record. Universal SSL is on for the zone, so once any CAA record exists, Cloudflare adds its own `issue` and `issuewild` records. These cover Let's Encrypt, Google Trust Services, SSL.com and Sectigo, and Cloudflare may change the list. They show only in `dig`, not in the dashboard. That's expected: the zone still goes from allowing every public CA to allowing those four.

`www.hanker.dev` is a CNAME to Vercel. A CA checking CAA for it follows the CNAME, so Vercel's own policy may apply there. Vercel says that's expected, and you can't add CAA at that name.

**Check:**

1. `dig +short CAA hanker.dev` includes `0 issue "letsencrypt.org"`.
2. https://letsdebug.net reports no problems for `hanker.dev` and for `www.hanker.dev`, both with method HTTP-01.
3. Vercel → `wishlist-web` → **Settings** → **Domains** shows both domains as valid.

The real proof is the next automatic renewal. If Vercel then reports a certificate error, delete the CAA record first and investigate afterwards.

**Not done, on purpose** (from the same internet.nl run, and securityheaders.com's A+):

- **IPv6:** Vercel doesn't support IPv6, so there's no `AAAA` record to add.
- **`security.txt` `Encryption` and signature:** both optional in RFC 9116. They would add a PGP key to guard, and a re-signing every time `Expires` is renewed. The first Contact, GitHub's private advisory form, is already a private channel.
- **CSP `style-src 'unsafe-inline'` and `img-src https:`:** see spec §6.9. React and `next/font` set style attributes, which a nonce can't cover. Item photos load from the shops' own domains.

## Contact email

`hello@hanker.dev` is the address on the footer, the privacy and terms pages and `security.txt` (D57). Mail to it is forwarded to Ted's inbox by Cloudflare Email Routing, and Ted replies as `hello@hanker.dev` from Gmail through Resend's SMTP server, so his personal address never shows. Nothing showing the address may merge before Steps A and B pass their checks.

### A. Receive: Cloudflare Email Routing

1. Cloudflare dashboard → the `hanker.dev` zone → **Email** → **Email Routing** → **Get started** (or **Enable Email Routing**).
2. **Destination addresses** → **Add destination address** → your personal address. Open the verification email Cloudflare sends and click its link. The address shows **Verified**.
3. **Routing rules** → **Custom addresses** → **Create address**. Custom address `hello`, action **Send to an email**, destination the address from step 2. **Save**.
4. When Cloudflare offers to add its DNS records, choose **Add records and enable**. It adds MX records and an SPF `TXT` record at the apex `hanker.dev`. The apex had neither before, so nothing is replaced.
5. In **DNS** → **Records**, confirm Resend's existing records on `send.mail.hanker.dev` and `resend._domainkey.mail.hanker.dev`, and `_dmarc.hanker.dev`, are unchanged.

**Check:** from an account that isn't yours (or a phone's other mail app), send a message to `hello@hanker.dev`. It arrives in your inbox. Then trigger a password reset for your own Hanker account at https://hanker.dev/reset-password: the email from `no-reply@mail.hanker.dev` still arrives.

### B. Reply as hello@: Resend SMTP and Gmail

The free plan allows three verified domains; this uses the second. These replies share the free plan's 100-a-day cap with Hanker's own emails.

1. Resend → **Domains** → **Add domain** → `hanker.dev`, in the same region as `mail.hanker.dev`.
2. Add each record Resend shows (MX and SPF `TXT` on `send.hanker.dev`, DKIM `TXT` on `resend._domainkey.hanker.dev`) in Cloudflare → **DNS** → **Records**, **DNS only**. They sit next to Email Routing's apex records; don't edit those. Back in Resend, **Verify DNS Records**. The domain shows **Verified**.
3. Resend → **API Keys** → **Create API Key**. Name `gmail-send-as`, permission **Sending access**, domain `hanker.dev`. Copy the key straight into step 5; don't save it anywhere else. It is not the production key, so revoking it never touches the app.
4. Look up the current SMTP host, port and username in Resend's SMTP documentation (at the time of writing: host `smtp.resend.com`, port `465` with SSL, username `resend`).
5. Gmail → gear → **See all settings** → **Accounts and Import** → **Send mail as** → **Add another email address**. Name `Hanker`, address `hello@hanker.dev`, **Next step**. Enter the SMTP server, port and username from step 4 and the key from step 3 as the password, choose **Secured connection using SSL**, **Add Account**. Gmail sends a confirmation to `hello@hanker.dev`; it arrives through Step A. Click its link.
6. Still under **Send mail as**, choose **Reply from the same address the message was sent to**.

**Check:** reply, from Gmail, to the test message from Step A's check. In the outside account, the reply is from `Hanker <hello@hanker.dev>`. Its **Show original** (or the equivalent) shows `DKIM: PASS` for `hanker.dev` and `DMARC: PASS`, and your personal address appears nowhere in the headers.

### C. Sentry: confirm IP addresses aren't stored

The privacy page says Sentry's error reports have IP addresses removed. [Sentry → One-off setup](#one-off-setup-1) step 2 turned this on; confirm it's still on before the `/privacy` page merges. In each of `hanker-api` and `hanker-web`: Settings → **Security & Privacy** → **Prevent Storing of IP Addresses** is on. **Check:** send a test event as [Sentry → Check it works](#check-it-works) describes; the event's **User** section shows no IP address.

## Environment variables

| Where                              | Name                                                                                                                          | Value                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel `wishlist-api` → Production | `DATABASE_URL` (sensitive)                                                                                                    | Neon pooled string                                                                                                                                                                                                               |
| Vercel `wishlist-api` → Production | `APP_ORIGIN`                                                                                                                  | Web production origin. The CSRF guard compares it exactly, and email links use it                                                                                                                                                |
| Vercel `wishlist-api` → Production | `CRON_SECRET` (sensitive)                                                                                                     | 48 random bytes, base64. Vercel Cron sends it as a bearer token. Unset means the cron refuses everyone                                                                                                                           |
| Vercel `wishlist-api` → Production | `TURNSTILE_SECRET_KEY` (sensitive)                                                                                            | **Unset until the end of Plan 4 (D31).** While unset, sign-up, resend-verification and reset-request answer `503 CAPTCHA_UNAVAILABLE`, and the web app says sign-ups are paused. Setting it opens sign-up: see "Opening sign-up" |
| Vercel `wishlist-api` → Production | `BRIGHT_DATA_API_KEY` (sensitive)                                                                                             | Bright Data API key, free tier with no deposit (D68). Unset means Amazon links take the page fetch. See "Turning on Amazon lookups"                                                                                              |
| Vercel `wishlist-api` → Production | `ETSY_API_KEY` (sensitive)                                                                                                    | Etsy Open API key, as `keystring:shared_secret`. Unset means Etsy links take the page fetch. See "Turning on Etsy lookups"                                                                                                       |
| Vercel `wishlist-api` → Production | `CLOUDFLARE_ACCOUNT_ID`                                                                                                       | Cloudflare account ID, from the account's overview page. Set together with the token or not at all. Unset means no tag suggestions. See "Turning on tag suggestions"                                                             |
| Vercel `wishlist-api` → Production | `CLOUDFLARE_AI_TOKEN` (sensitive)                                                                                             | API token with Account → Workers AI → Read and Edit, on that account only. Unset means no tag suggestions. See "Turning on tag suggestions"                                                                                      |
| Vercel `wishlist-api` → Production | `CRON_HEARTBEAT_URL` (sensitive)                                                                                              | The daily cron's Better Stack heartbeat URL, `https:` only (D86). It carries the heartbeat's token, so treat it as a secret. Unset means no ping. See "Daily cron"                                                               |
| Vercel `wishlist-api` → Production | `EMAIL_TRANSPORT=resend`, `EMAIL_FROM=Hanker <no-reply@mail.hanker.dev>`, `RESEND_API_KEY` (sensitive)                        | Set in Plan 2b. The API refuses to boot in production with Turnstile set and `EMAIL_TRANSPORT=log`                                                                                                                               |
| Set per preview by CI              | `DATABASE_URL`, `APP_ORIGIN`, `EMAIL_TRANSPORT=log`, `TURNSTILE_SECRET_KEY` (Cloudflare's always-pass test secret), `GIT_SHA` | See `.github/workflows/preview.yml`                                                                                                                                                                                              |
| Set per deploy by CI               | `GIT_SHA`                                                                                                                     | The commit being deployed                                                                                                                                                                                                        |
| Set at build by CI                 | `API_ORIGIN` (web)                                                                                                            | API production origin, or the PR's API preview URL                                                                                                                                                                               |
| GitHub repo variable               | `TURNSTILE_SITE_KEY`                                                                                                          | The production widget's public site key (Cloudflare → Turnstile → Hanker). The production web build fails without it                                                                                                             |
| Set at build by CI                 | `TURNSTILE_SITE_KEY` (web)                                                                                                    | The repo variable in `deploy.yml`; Cloudflare's always-pass test key in CI and previews                                                                                                                                          |

Set a sensitive production variable without it touching disk or shell history. For example, `CRON_SECRET`:

```bash
openssl rand -base64 48 | tr -d '\n' \
  | pnpm vercel env add CRON_SECRET production --sensitive --project wishlist-api --scope shockolate
```

Runtime variables apply to the **next** deployment. Redeploy, or merge to `main`, after changing one.

## Daily cron

`apps/api/vercel.json` schedules `GET /api/internal/cron/daily` for 09:00 UTC. Hobby runs it once a day, at some point within that hour, and only on production deployments. Each run purges:

- unverified accounts older than 7 days, which cascades to their wishlists, tokens and sessions;
- expired email tokens and sessions;
- rate-limit windows older than a day;
- Your gifts notes, 30 days after their claim went (D79, D80): it stamps `gone_at` on notes that have none, then deletes those stamped more than 30 days ago. `/privacy` promises this.

The response lists the counts.

- **Check it ran:** Vercel → `wishlist-api` → Settings → Cron Jobs shows the schedule and has a **Run** button. The run's logs show the JSON counts.
- **The heartbeat (D86):** each authorized run pings Better Stack's "Hanker daily cron" heartbeat at `CRON_HEARTBEAT_URL`, or its `/fail` URL when the cleanup throws, so a cron that stops running or keeps failing sends an alert. A ping that fails is a Sentry warning, `cron heartbeat failed status=<n|none>`, and never changes the run. To set it up: in Better Stack → Uptime → Heartbeats, create "Hanker daily cron" with a period of 1 day and 2 hours of grace (Hobby runs the cron at any point within 09:00–09:59 UTC, so runs are 23 to 25 hours apart). Copy its URL, then store it from a hidden prompt:
  ```bash
  read -rs URL && printf %s "$URL" | pnpm vercel env add CRON_HEARTBEAT_URL production --sensitive --project wishlist-api --scope shockolate; unset URL
  ```
  Redeploy, press **Run** under Cron Jobs, and check the heartbeat turns Up.
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

**2. The read-only role.** Roles created in the Neon console join `neon_superuser`, so create this one in SQL. Connect to the production branch as the owner role, using the direct (not `-pooler`) connection string from the Neon console, with the password removed, so psql prompts for it and it never appears in a process list:

```bash
psql 'postgresql://neondb_owner@<direct-host>/neondb?sslmode=require'   # psql prompts for the password
```

```sql
CREATE ROLE hanker_backup WITH LOGIN;
\password hanker_backup
GRANT pg_read_all_data TO hanker_backup;
```

`\password` prompts twice and sends only a hash, so the password never appears in a log or in history. Generate it with your password manager (Neon requires at least 60 bits of entropy) and keep it there. If Neon refuses the hash, run `\set HISTFILE /dev/null` first and then `ALTER ROLE hanker_backup PASSWORD '…';`, so the password doesn't land in `~/.psql_history`.

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

**3. R2.** In the Cloudflare dashboard, under R2. The bucket is now managed in `infra/cloudflare.tf`. Its lifecycle and lock rules can't be imported, so they stay dashboard settings, and `postcondition`s there fail every plan if either is loosened: change a rule here and its assertion in the same PR.

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

| Symptom                                            | Cause and fix                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission denied for table …`                    | A migration added a table `hanker_backup` can't read. Only possible with the explicit-grant fallback: re-run its `GRANT SELECT ON ALL …` lines. |
| `curl: (22) The requested URL returned error: 403` | The R2 token was revoked, expired or scoped to another bucket. Create a new one and update the two `R2_*_KEY*` secrets.                         |
| `age: error: …`                                    | `age` refused to encrypt, usually because `AGE_RECIPIENT` isn't a valid `age1…` public key. Set it again from your key pair.                    |
| `the dump isn't age-encrypted`                     | `age` exited cleanly but wrote no header. That shouldn't happen; check the "Install age" step installed v1.3.2.                                 |
| No run at all                                      | GitHub disables scheduled workflows in a public repository after 60 days without activity. Re-enable it with `gh workflow enable backup.yml`.   |

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
2. Restore it and keep the container: `scripts/restore-drill.sh --keep <dump> <identity>`. It prints the container's name and how to remove it. With `--keep`, a dump that predates a migration, or a production that's down, gets a warning instead of a failure, because recovery needs exactly that dump.
3. Find what was lost, for example a deleted list's items:

   ```bash
   docker exec -it <container> psql -h 127.0.0.1 -U postgres -d drill
   ```

4. Copy those rows into production. Parents go before children: `users`, then `wishlists`, then `items`, then `claims`. Stream them straight across rather than restoring the whole dump over `main`, which would lose everything written since. If the drill warned that the migrations differ, name the columns on both sides (`select id, wishlist_id, … from items` and `\copy items (id, wishlist_id, …) from stdin`), since `select *` no longer lines up:

   ```bash
   docker exec <container> psql -h 127.0.0.1 -U postgres -d drill -XqAt \
     -c "\copy (select * from items where wishlist_id = '<id>') to stdout with (format csv)" \
     | psql 'postgresql://neondb_owner@<direct-host>/neondb?sslmode=require' -v ON_ERROR_STOP=1 -c "\copy items from stdin with (format csv)"
   ```

   psql asks for the owner's password on the terminal even while its input is the pipe. This writes to production, so plan the statements first and try them on a Neon branch of `main` if the change is large.

5. Remove the container: `docker rm -fv <container>`.

## Monitoring

Better Stack's free plan watches the site and the backup, and emails you (D47). **The three monitors are managed in [`infra/betterstack.tf`](../infra/betterstack.tf)** (2026-10-27); change them in a PR. The two heartbeats stay in the dashboard: the provider doesn't mark a heartbeat's URL sensitive, so a plan would print it. They were created in Better Stack → Uptime, with email alerts to you:

| Monitor              | URL                                  | Check every                                              | Proves                                                                                        |
| -------------------- | ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Live                 | `https://hanker.dev/api/health/live` | 3 minutes                                                | The web project, the `/api` rewrite and the API function are up                               |
| Site                 | `https://hanker.dev/`                | 3 minutes                                                | The landing page renders. It's static, so it touches neither the API nor the database         |
| Deep                 | `https://hanker.dev/api/health`      | 30 minutes (the longest Better Stack's free plan offers) | Neon is reachable and migrated. It answers `503` when not                                     |
| Backup heartbeat     | set up in [Backups](#backups) step 4 | expects a ping every 24 hours, with 2 hours of grace     | The nightly backup ran and uploaded                                                           |
| Daily cron heartbeat | set up in [Daily cron](#daily-cron)  | expects a ping every 24 hours, with 2 hours of grace     | The daily cleanup ran and succeeded, so `/privacy`'s 30 days for Your gifts notes holds (D86) |

**Why only the deep check touches the database.** `/api/health` runs a query, which wakes Neon, and Neon Free scales to zero only after 5 idle minutes, with 100 CU-hours per project per month. A deep check every 3 minutes would keep it awake all month, about 180 CU-hours, and Neon would then suspend the database until the month ends. Every 30 minutes costs about 30 CU-hours, since Neon sleeps for 25 of every 30 minutes. `/api/health/live` never touches the database. Check Neon → your project → Usage after the first week; if compute trends past about 70% of the quota, pause the Deep monitor. The backup heartbeat still proves the database daily.

**When an alert comes:**

- **Live or Site down:** check Vercel's status and the newest deploy. Roll back if a deploy caused it ([Rollback](#rollback)).
- **Deep down but Live up:** the API is up and Neon isn't. Check Neon's status page and the project's compute quota.
- **Backup heartbeat:** see [Backups → When it fails](#when-it-fails).
- **Daily cron heartbeat:** see "When something breaks" in [operations.md](operations.md#when-something-breaks).

## Sentry

Errors from both apps go to Sentry's free Developer plan (spec §10 Monitoring, D50). Every event passes a scrubber that removes share, manage and email tokens and email addresses, and the SDKs collect nothing on their own: no cookies, headers, bodies or local variables. Only production reports. Previews, CI and local builds have no DSN.

### One-off setup

1. **Account and projects.** Create a Sentry account on the Developer plan, then two projects: `hanker-api` (platform Node.js) and `hanker-web` (platform Browser JavaScript).
2. **Privacy settings, in each project:** under Settings → Security & Privacy, keep **Data Scrubber** and **Use Default Scrubbers** on, and turn on **Prevent Storing of IP Addresses**.
3. **Alerts.** Keep the default alert rule that emails you on a new issue.
4. **The API's DSN:** copy `hanker-api`'s DSN (Settings → Client Keys), then set it on the API's Vercel production environment. A DSN isn't secret, so there's no `--sensitive`, but the value still comes from a hidden prompt rather than argv. Paste the DSN at the silent prompt:
   ```bash
   read -rs DSN && printf %s "$DSN" | pnpm vercel env add SENTRY_DSN production --project wishlist-api --scope shockolate; unset DSN
   ```
5. **The web's DSN, and the names the upload needs.** DSNs are public by design, so these are variables, not secrets:
   ```bash
   gh variable set SENTRY_DSN_WEB      # hanker-web's DSN
   gh variable set SENTRY_ORG          # your organization slug
   gh variable set SENTRY_PROJECT_WEB  # hanker-web
   ```
6. **The upload token.** Create an organization auth token under Settings → Auth Tokens; its default scopes cover source-map uploads. Then:
   ```bash
   gh secret set SENTRY_AUTH_TOKEN --env production
   ```
7. **Redeploy.** Merge anything to `main`, or re-run the latest deploy. The API reads `SENTRY_DSN` at runtime, and the web DSN is inlined at build.

### Check it works

Open `https://hanker.dev` and run this in the browser console:

```js
setTimeout(() => {
  throw new Error('sentry check /c/AAAAAAAAAAAAAAAAAAAAAA');
});
```

Within a minute, `hanker-web` has a new issue whose message reads `sentry check /c/[redacted]`. That one event proves three things: the DSN is inlined, the CSP lets the report out, and the scrubber runs. It has no app frames, so it says nothing about source maps. There's no safe way to force a production API `500`, so the API's wiring is proven by its tests and by its first real error.

To check the maps, look at the latest Deploy run's `sourcemaps` job log, which reports the files it uploaded, or at Sentry → Settings → Source Maps (Artifact Bundles), which shows a bundle for the commit.

### Source maps

The production build emits browser source maps. The build job, which holds no secrets, writes debug IDs into them and moves them out of the deploy output into the `web-sourcemaps` artifact (`scripts/extract-sourcemaps.sh`), so `hanker.dev` never serves them; `scripts/check-vercel-output.sh` refuses to deploy one. The `sourcemaps` job uploads them with a checksum-pinned `sentry-cli`. Until `SENTRY_AUTH_TOKEN` is set, it skips the upload with a notice. No release waits on the upload: a red `sourcemaps` job means the browser maps are missing for that release, not that the release failed. If `sentry-cli` can't be installed or inject fails, the build drops the maps with a warning and deploys without them. Both servers translate stack traces from their own deployed maps at runtime, so they need no upload.

## Opening sign-up (end of Plan 4)

Sign-up is dark until the Turnstile secret is set (D29, D31). To open it:

```bash
read -rs TURNSTILE_SECRET && printf %s "$TURNSTILE_SECRET" \
  | pnpm vercel env add TURNSTILE_SECRET_KEY production --sensitive --project wishlist-api --scope shockolate
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

## Turning on Amazon lookups

Amazon product links are looked up through Bright Data (D64), only while `BRIGHT_DATA_API_KEY` is set on the API. The `/privacy` page names Bright Data, so set the key **before** merging the release that carries that page (Plan 8a ruling 1).

1. **Account (once).** Sign up at brightdata.com on the free tier, with no card. Account settings → API keys → create a key. A new account answers `400 Customer is not active` until the dashboard shows it as active.
2. **Never add funds (D68).** With no deposit, spent credits make lookups fail, and owners type the details in, never charges.
3. **Store the key.** Paste it at the silent prompt:
   ```bash
   read -rs K && printf %s "$K" \
     | pnpm vercel env add BRIGHT_DATA_API_KEY production --sensitive --project wishlist-api --scope shockolate
   unset K
   ```
4. **Deploy.** A runtime variable applies to the next deployment: merge, or `gh workflow run deploy.yml --ref main`, and wait for every job to pass.
5. **Check it (V1).** On your own list in production, paste a slow Amazon link, e.g. `https://www.amazon.com/Cephalofair-Games-115005-Frosthaven-Surface/dp/B0D169YKJW/` (about 20 seconds in the spike). Expect the waiting panel, then a prefilled title, photo and price. Then paste an `amzn.to` link, then a link from another shop, which behaves as before. Within the hour, the API's runtime logs should have no `LOOKUP_UNAVAILABLE` line, and Sentry no Bright Data warning.

**To turn it off,** remove the variable (`pnpm vercel env rm BRIGHT_DATA_API_KEY production --project wishlist-api --scope shockolate`) and redeploy. Amazon links go back to the page fetch, which Amazon answers with a bot check. Then remove Bright Data from `/privacy`.

**To rotate the key,** create a new one in Bright Data, `env rm` then step 3, redeploy, then delete the old key in Bright Data.

## Turning on Etsy lookups

Etsy listing links are looked up through Etsy's Open API (D65), only while `ETSY_API_KEY` is set on the API. `/terms` carries Etsy's trademark statement and `/privacy` names Etsy, so set the key **before** merging the release that carries those pages (Plan 8b ruling 5). The answer only prefills the add form, and is never stored beyond what the owner saves or refreshed from Etsy (D69), as Etsy's terms limit how old displayed listing content may be.

1. **App (once).** Register a Personal App at https://www.etsy.com/developers/register and wait for Etsy's approval. Its keystring and shared secret are under "Apps You've Made". The app's limits are 5 requests a second and 5,000 a day.
2. **Store the key.** Paste the keystring at the first silent prompt and the shared secret at the second:
   ```bash
   read -rs K && read -rs S && printf '%s:%s' "$K" "$S" \
     | pnpm vercel env add ETSY_API_KEY production --sensitive --project wishlist-api --scope shockolate
   unset K S
   ```
3. **Deploy.** A runtime variable applies to the next deployment: merge, or `gh workflow run deploy.yml --ref main`, and wait for every job to pass.
4. **Check it (V1).** On your own list in production, paste an Etsy listing link with a slug and `?ref=`, e.g. one copied from Etsy's address bar. Expect the plain "Reading the page…" line, then a prefilled title, photo and price. Then paste an `etsy.me` link from Etsy's Share button, then a link from another shop, which behaves as before. Within the hour, the API's runtime logs should have no `LOOKUP_UNAVAILABLE … provider=etsy` line, and Sentry no Etsy warning. If only the `etsy.me` link fails, the API logs `unfurl NO_METADATA host=etsy.me` and the owner sees "We couldn’t find the details on that page…". That means the short link didn't redirect straight to a listing: it was refused, or it passed through another page first. Listing links still work.

**To turn it off,** remove the variable (`pnpm vercel env rm ETSY_API_KEY production --project wishlist-api --scope shockolate`) and redeploy. Etsy links go back to the page fetch, which Etsy refuses. Then remove Etsy from `/privacy`, and its statement from `/terms`.

**To rotate the key,** reset the shared secret under "Apps You've Made", `env rm` then step 2, and redeploy.

## Turning on tag suggestions

Tag suggestions come from Cloudflare Workers AI (D70), only while `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` are both set on the API. `/privacy` and `/terms` say what is sent, so set both **before** merging the release that carries those pages (Plan 9). Previews and CI never hold them, so they show no suggestions.

1. **C1. Confirm the Workers plan is Free.** In the Cloudflare dashboard, Workers & Pages → Plans, check the account is on **Workers Free**, not Workers Paid. On Paid, usage past the allowance is billed. This is the step that makes "no surprise bill" true. R2 is billed separately and isn't affected.
2. **C2. Create an account API token** (when the feature is ready to turn on). Manage Account → Account API Tokens → Create Token → Custom token. An account token belongs to the account, not to your login, and Workers AI accepts it (checked live, 2026-10-23):
   - Permissions: Account → **Workers AI** → **Read** and **Edit**.
   - No IP filtering.
   - TTL: **one year**. An expired token makes every call answer `401`: suggestions stop and Sentry warns `Workers AI answered 401`, but nothing else breaks. The yearly rotation in [operations.md](operations.md) renews it first.

   Copy the token, and the **Account ID** from the account's overview page. Don't paste them anywhere yet.

3. **C3. Store both in production,** at hidden prompts, piped straight into Vercel:
   ```bash
   read -rs A && printf %s "$A" \
     | pnpm vercel env add CLOUDFLARE_ACCOUNT_ID production --sensitive --project wishlist-api --scope shockolate
   read -rs T && printf %s "$T" \
     | pnpm vercel env add CLOUDFLARE_AI_TOKEN production --sensitive --project wishlist-api --scope shockolate
   unset A T
   ```
   Then redeploy: `gh workflow run deploy.yml --ref main`, and wait for every job to pass. The redeploy is only needed when turning the feature on after its code is already merged; when both are stored before merging (the planned path), the merge's own deploy picks them up.
4. **V1. After it's turned on,** in production on your own list: add an Amazon link, a page-fetch link, an Etsy link and an idea, and edit one existing item. Check that each gets sensible suggestions, that existing tags are reused, and that turning the setting off removes the row. Within the hour, the API's runtime logs should have no `tag-suggest UNAVAILABLE` line, and Sentry no `Workers AI answered` warning.

**To turn it off for everyone,** remove both variables (`pnpm vercel env rm CLOUDFLARE_AI_TOKEN production --project wishlist-api --scope shockolate`, then the same for `CLOUDFLARE_ACCOUNT_ID`) and redeploy. The route answers `[]` and the settings switch stays. Then take Cloudflare's AI out of `/privacy` and `/terms`. An owner can turn it off for their own list in Settings.

**To rotate the token** (yearly, before it expires): create a new account token as in C2, `pnpm vercel env rm CLOUDFLARE_AI_TOKEN production --project wishlist-api --scope shockolate`, store the new one with the token half of C3, redeploy, then delete the old token in Cloudflare.

## GitHub configuration

| Kind      | Scope            | Names                                                                                                                                                                                                                                                                                                                    |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets   | env `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `DATABASE_URL_DIRECT`; `SENTRY_AUTH_TOKEN` ([Sentry](#sentry)); `DATABASE_URL_BACKUP`, `AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_HEARTBEAT_URL` ([Backups](#backups))        |
| Secrets   | env `preview`    | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`                                                                                                                                                                  |
| Variables | repo             | `API_PRODUCTION_ORIGIN`, `APP_PRODUCTION_ORIGIN`, `TURNSTILE_SITE_KEY`, `PREVIEW_ALIAS_PREFIX` ([Previews](#previews)); `SENTRY_DSN_WEB`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` ([Sentry](#sentry)); `NEON_PRODUCTION_PROJECT_ID`, which the preview Neon scripts refuse ([Preview seed branch](#preview-seed-branch), D87) |

Every credential, with its expiry and what it unlocks, is listed in [operations.md → Credentials](operations.md#credentials).

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

- **Secret-holding jobs run almost nothing.** Only the Vercel CLI runs, from `tools/vercel-cli` (`@wishlist/vercel-cli`, D85): `pnpm install --frozen-lockfile --ignore-scripts --filter @wishlist/vercel-cli`, then `tools/vercel-cli/node_modules/.bin/vercel` by path from the repo root. The lockfile pins its whole dependency tree by integrity hash; `npx` would pin only the top-level package. `vercel` is a devDependency of that package, so `pnpm audit --prod` gates only what production runs and the CLI's advisories are the monthly dev-tooling audit's (operations.md). Without `--prod`, pnpm also installs the root's few devDependencies (Prettier, Turbo, TypeScript, yaml); they're pinned the same way, get no install scripts, and nothing in these jobs runs them. Run it by hand as `pnpm vercel …`, the root script that calls the same binary.
- **Nothing a build job wrote is executed next to a secret.** Secret-holding jobs restore no cache and run the migrator from the checkout, because a job that ran install scripts could tamper with any cache or artifact it saves.
- **Every job that touches production re-checks the commit.** It confirms it's deploying `main`'s tip, because "Re-run failed jobs" skips `guard`.
- **Every deploy job checks its build output first** (`scripts/check-vercel-output.sh`). The output must be complete and self-contained, and no symlink in it may point outside it. The symlink check is defence in depth: the Vercel CLI uploads a symlink's link text, not its target.

A deploy that's already running is never cancelled. Of the runs queued behind it, only the newest is kept, so merging a stack ships its tip once.

If a deploy fails after `migrate`, production still runs the previous code against the new schema. That's safe by construction, because every migration is backward-compatible (expand/contract). Fix forward, or roll back the code (see Rollback).

## Previews

Each PR, including each layer of a stack, gets (`.github/workflows/preview.yml`):

1. A Neon branch `pr-<n>` in the **`wishlist-preview`** project, created from **`preview-seed`**, never from production. The job checks the branch really descends from `preview-seed`, then migrates it.
2. An API preview using that branch. `EMAIL_TRANSPORT=log` means no email is ever sent.
3. A web preview built against that API, aliased to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` (currently `shockolate-wishlist-pr-<n>.vercel.app`).
4. Read-only smoke tests and a sticky PR comment with the **web** link only.

The jobs follow the same trust split as deploys: `build-api` and `build-web` hold no secrets, and `smoke` holds only the bypass secret. Bot (Renovate) and fork PRs get CI but no preview.

**Fixing an old preview branch.** If `provision` fails with "does not descend from preview-seed", the PR's branch was cloned from production before this change. Close and reopen the PR: cleanup deletes the old branch, and the next run creates a fresh one from `preview-seed`.

Cleanup (`.github/workflows/cleanup.yml`): closing a PR deletes its Neon branch, and a nightly sweep deletes any `pr-*` branch whose PR is closed. Neon Free allows 10 branches per project. In `wishlist-preview`, its default branch and `preview-seed` take two, so at most 8 PRs can have previews at once.

To check the sweep by hand: Actions → "Cleanup previews" → Run workflow (dry run defaults to on).

## Preview seed branch

`preview-seed` is the parent of every preview database. It lives in the `wishlist-preview` project, which never holds production data (D87).

- **Created** by `.github/workflows/preview-seed.yml` as an ordinary child of the preview project's empty default branch. It's then wiped and rebuilt by replaying every migration from zero, on every run.
- **Kept current** by the same workflow on every push to `main` that touches `apps/api/drizzle/**`, which migrates it incrementally.
- **Reset** with Actions → "Preview seed" → Run workflow with `reset` checked.
- **Safety:** `scripts/preview-seed.sh` and `scripts/neon-sweep.sh` refuse to run when `NEON_PROJECT_ID` is production's project, and when they don't know which project that is: every step that runs them passes the repo variable `NEON_PRODUCTION_PROJECT_ID` (production's project ID, not a secret), and the workflow policy checks it. The seed script also refuses to resolve the seed to the project's default branch, and the workflow only runs on `main`. Don't create `preview-seed` by hand.
- **Never delete it.** Neon won't delete a branch that has children, and every open preview is one; refresh it in place instead.
- **Root branches:** production's project has only `main` plus any backup root branches a restore creates (Neon Free allows 3); delete old backups if a restore is refused.

## Manual deploy (bootstrap or emergency only)

This is exactly what CI runs. It works from the repo root with the org and project IDs in the environment, so no link files need switching.

```bash
export VERCEL_ORG_ID=<team id>
# API
VERCEL_PROJECT_ID=<wishlist-api id> pnpm vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-api id> pnpm vercel build --prod
VERCEL_PROJECT_ID=<wishlist-api id> pnpm vercel deploy --prebuilt --prod --env GIT_SHA="$(git rev-parse HEAD)"
# Web (after the API is healthy)
VERCEL_PROJECT_ID=<wishlist-web id> pnpm vercel pull --yes --environment=production
VERCEL_PROJECT_ID=<wishlist-web id> API_ORIGIN=https://wishlist-api-five.vercel.app pnpm vercel build --prod
VERCEL_PROJECT_ID=<wishlist-web id> pnpm vercel deploy --prebuilt --prod
```

Migrate production first if the deploy includes a migration. Use the direct string, and the guard below refuses anything that isn't a Neon URL:

```bash
read -rs DATABASE_URL_DIRECT && export DATABASE_URL_DIRECT && [[ "$DATABASE_URL_DIRECT" == *neon.tech* ]] \
  && pnpm --filter @wishlist/api db:migrate || echo "Refusing: not a Neon URL"; unset DATABASE_URL_DIRECT
```

## Rollback

Code: Vercel Instant Rollback, **web first, then API**. Rolling the API back first could leave a newer web app calling an older API.

```bash
VERCEL_PROJECT_ID=<wishlist-web id> pnpm vercel rollback
VERCEL_PROJECT_ID=<wishlist-api id> pnpm vercel rollback
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
- **Accepted risk (Ted, 2026-10-24; D87): one Vercel token serves both environments.** The preview jobs' token can still deploy to production. Vercel's project-scoped tokens don't separate preview from production; separate preview projects would. Those jobs run only on same-repo, non-bot PRs and only upload output built by a secret-free job, so the realistic way in is the tools they run, which D85 pins. Revisit when anyone else gets write access to the repo.
- **The preview environment's Neon key reaches only `wishlist-preview`** (D87), a project-scoped key, so a preview compromise can't read production's connection strings.
- **Bot PRs (Renovate) get CI but no preview.** Unreviewed dependency code never runs next to deploy credentials, and bot PRs don't use up Neon's 10-branch cap.
- **Renovate waits 3 days after a release** (`minimumReleaseAge`) and **automerges only dev-only tooling** (D88): minor and patch updates of `@types/*` (not `@types/node`), ESLint, Prettier, Vitest and Testcontainers, once the required checks pass. These run only in secret-free jobs and never shape the production build. Everything else waits for review: runtime dependencies, anything that builds or bundles (TypeScript, Next, Nest CLI, SWC, esbuild, Turbo), `@wishlist/vercel-cli`, the Playwright group, GitHub Actions digests (they run next to secrets), container images and every major. An automerged PR still deploys to production, like any merge to `main`. The accepted risk: a dev-only bump can change how the lockfile resolves a transitive package that runtime code shares; the 3-day minimum age and the required checks catch most of that. `scripts/workflow-policy.test.mjs` refuses any automerge rule wider than this.

**Done (2026-10-08):** each pipeline is split into secret-free build jobs and deploy-only jobs (see Continuous deployment and Previews).

## Repository settings

Applied once, from the files in this repo:

| Setting                           | Source                 | How                                                                                             |
| --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Ruleset on `main`                 | `infra/github.tf`      | Managed by OpenTofu ([Infrastructure as code](#infrastructure-as-code))                         |
| CodeQL                            | default setup          | `gh api -X PATCH repos/Shockolate/wishlist-app/code-scanning/default-setup -f state=configured` |
| Secret scanning + push protection | repo security settings | `gh api -X PATCH repos/Shockolate/wishlist-app` with `security_and_analysis` enabled            |
| Dependabot alerts                 | repo security settings | `gh api -X PUT repos/Shockolate/wishlist-app/vulnerability-alerts`                              |
| Auto-merge (used by Renovate)     | repo settings          | `gh repo edit --enable-auto-merge`                                                              |
| Renovate                          | GitHub App             | install from https://github.com/apps/renovate for this repo only                                |

Required checks: `checks`, `actionlint`, `integration`, `migrations-lint`, `e2e`. `preview` is advisory: a Vercel or Neon outage, or Neon's branch cap, shouldn't block merging code that passed CI.

## Infrastructure as code

`infra/` is an OpenTofu root module ([spec 2026-10-27](superpowers/specs/2026-10-27-infrastructure-as-code-design.md), D93–D101). It describes the Cloudflare, GitHub, Better Stack and Vercel settings listed in the spec's §3.1. Secret values, Neon, Sentry, Resend and Email Routing stay outside it, with their runbooks above.

**The rules:**

- **Apply only from `main`'s tip.** Applying a branch leaves the state ahead of `main`.
- **Only Ted applies.** CI plans, with read-only tokens where a provider offers them, and never writes state.
- **Change a managed setting in a PR, not a dashboard.** In an emergency, change the dashboard and codify or revert it afterwards; the monthly drift check catches it otherwise.

### Local setup

Install the pinned release the same way CI does, then put it on your `PATH`:

```bash
scripts/install-tofu.sh ~/.local/opt/tofu && export PATH="$HOME/.local/opt/tofu:$PATH"
tofu version   # must match infra/.opentofu-version
```

**Credentials, the recommended way: 1Password's `op run`.** Each value is injected into one `tofu` process's environment and nothing else: not your shell, your history or argv, and `op run` masks any that reach the output. A file of references, never values, says which items to use. It lives **outside the repo**; the guard refuses any `.env` file under `infra/`, and `.gitignore` refuses them too.

1. In the 1Password app, open each item, use the field's menu → **Copy Secret Reference**, and paste it into `~/.config/hanker/tofu.env`, one line per variable:

   ```
   TF_VAR_state_passphrase=op://<vault>/<passphrase item>/password
   AWS_ACCESS_KEY_ID=op://<vault>/<R2 token item>/<Access Key ID field>
   AWS_SECRET_ACCESS_KEY=op://<vault>/<R2 token item>/<Secret Access Key field>
   CLOUDFLARE_API_TOKEN=op://<vault>/<Cloudflare apply token>/credential
   VERCEL_API_TOKEN=op://<vault>/<Vercel tofu-apply>/credential
   BETTERUPTIME_API_TOKEN=op://<vault>/<Better Stack token>/credential
   ```

   The R2 values are the token's **Access Key ID** and **Secret Access Key**, not its Token value.

2. Check every reference resolves, printing lengths only (the single quotes matter: the lengths are worked out inside `op run`'s process). Expect `pass` ≥ 32, `id=32`, `secret=64`, and the rest non-zero:

   ```bash
   op run --env-file="$HOME/.config/hanker/tofu.env" -- sh -c \
     'echo "pass=${#TF_VAR_state_passphrase} id=${#AWS_ACCESS_KEY_ID} secret=${#AWS_SECRET_ACCESS_KEY} cf=${#CLOUDFLARE_API_TOKEN} vercel=${#VERCEL_API_TOKEN} bs=${#BETTERUPTIME_API_TOKEN}"'
   ```

3. Add a shell function (for example to `~/.zshrc`) and run it from the repo root, as `tofu-hanker plan`:

   ```bash
   # OpenTofu for Hanker: secrets come from 1Password for this one command only.
   tofu-hanker() {
     GITHUB_TOKEN="$(gh auth token)" TF_CLI_CONFIG_FILE=/dev/null \
       op run --env-file="$HOME/.config/hanker/tofu.env" -- tofu -chdir=infra "$@"
   }
   ```

   `TF_CLI_CONFIG_FILE=/dev/null` keeps a CLI config's `dev_overrides` from bypassing the lockfile. `op run` passes `apply`'s `yes` prompt through.

**Without 1Password:** type or paste each value at a silent prompt in a real terminal, then run `tofu` in that same terminal. (A Claude Code `!` command gets a new, non-interactive shell each time, so `read` has nothing to read and nothing exported survives to the next command.) Close the shell when you're done.

```bash
export TF_CLI_CONFIG_FILE=/dev/null
read -rs TF_VAR_state_passphrase && export TF_VAR_state_passphrase
read -rs AWS_ACCESS_KEY_ID && export AWS_ACCESS_KEY_ID           # the R2 token's Access Key ID
read -rs AWS_SECRET_ACCESS_KEY && export AWS_SECRET_ACCESS_KEY   # …and its Secret Access Key
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
read -rs VERCEL_API_TOKEN && export VERCEL_API_TOKEN
read -rs BETTERUPTIME_API_TOKEN && export BETTERUPTIME_API_TOKEN
export GITHUB_TOKEN="$(gh auth token)"
```

The same length check works here without the `op run` wrapper. Below, `tofu-hanker <command>` means `tofu -chdir=infra <command>` with this fallback.

### One-off setup

State can't describe the bucket that holds it, so the bucket and its first token are made by hand.

1. **Bucket.** Cloudflare → R2 → create `hanker-tofu-state`: automatic location, Standard storage, private, no custom domain, **no lock rule and no lifecycle rule**. State is overwritten on every apply, so a lock would block it.
2. **Apply token.** R2 → Manage API tokens → **Object Read & Write**, applied to `hanker-tofu-state` only. Cloudflare shows three values: the S3 backend uses the **Access Key ID** (`AWS_ACCESS_KEY_ID`) and the **Secret Access Key** (`AWS_SECRET_ACCESS_KEY`), not the Token value. The secret is shown once. It lives only in your password manager.
3. **Passphrase.** Generate 32 characters or more in your password manager (OpenTofu's minimum is 16). Lose it and the state is unreadable: see Recovery.
4. **Initialise,** on `main`, in a terminal where you've done [Local setup](#local-setup): `tofu-hanker init`. Expected: `Successfully configured the backend "s3"`. Then `tofu-hanker plan` answers "No changes" until the first provider is imported.

### Changing infrastructure

1. On a branch, edit `infra/` and run `tofu-hanker plan`.
2. Open the PR. Once `infra-plan.yml` exists, approve its `infra-plan` deployment after reading the diff; it posts the plan as a comment.
3. Merge through the normal stack flow.
4. On `main`'s tip, run `tofu-hanker apply`. It plans again; check it matches the PR's plan before typing `yes`.

`terraform.tfstate` exists only in R2, encrypted. Never commit state, a `.tfplan` or a `.tfvars` (`.gitignore` refuses them), and never paste a plan that `tofu show` hasn't redacted.

### Recovery

R2 has no object versioning, so there's no older state to roll back to. Nothing in production depends on the state, though:

- **State lost, corrupted, or its passphrase lost:** delete `infra/terraform.tfstate` from the bucket (with the passphrase lost it's unreadable anyway), set a new passphrase if needed, and re-import every resource with `import` blocks, as when they were first imported (the import layers' history in git has the IDs). The gate is the same: a plan with nothing to add, change or destroy.
- **A stuck lock** (`use_lockfile` writes `infra/terraform.tfstate.tflock` next to the state): only after confirming no other run is going, `tofu-hanker force-unlock <lock ID>`.

### Upgrading

Renovate opens provider bumps; they wait for review because they run next to secrets. Plan a bump locally before merging it, since Renovate's PRs get no CI plan. OpenTofu itself moves by hand: the Quarterly row in [operations.md](operations.md#recurring).

**The Vercel provider isn't signed on OpenTofu's registry** (`tofu init` says signature validation was skipped). Before merging a bump, check its hash by hand: take the signing key from `https://registry.terraform.io/v1/providers/vercel/vercel/<version>/download/linux/amd64` (`signing_keys`), verify the release's `SHA256SUMS.sig` on GitHub with it, and confirm the `linux_amd64` hash is among the lockfile's `zh:` entries. 5.24.1 was checked this way (key `1ADC 8CB0 1C6E 6C19 532E 6EEC 6545 E9CB 7A48 C1FA`).
