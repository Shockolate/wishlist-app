# Operations

Running Hanker once it's live. Setup lives in [deployment.md](deployment.md); this is what to check, how often, and where to go when something breaks.

## Before inviting people widely

Do these once, and again after a big change to how the site runs.

- [ ] Better Stack's three monitors are green, and the backup heartbeat has reported ([Monitoring](deployment.md#monitoring)).
- [ ] A Better Stack test alert reaches your email (each monitor's menu → "Send test alert").
- [ ] A Sentry test event arrives with its token redacted ([Sentry → Check it works](deployment.md#check-it-works)). The API's wiring is proven by its tests and by its first real error; there's no safe way to force a production `500`.
- [ ] The restore drill has passed against a real nightly dump ([Restore drill and recovery](deployment.md#restore-drill-and-recovery)). It first passed on 2026-10-20.
- [ ] The runbooks in deployment.md match what you see in each dashboard.

## Recurring

| When                       | What                                                                                                                                                    | Where                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Weekly                     | Triage new Sentry issues: fix, ignore with a reason, or open an issue                                                                                   | Sentry → Issues                                                           |
| Weekly                     | Review and merge Renovate's PRs                                                                                                                         | GitHub → Pull requests                                                    |
| Monthly                    | Neon compute against the free quota (pause the Deep monitor past about 70%)                                                                             | Neon → Usage; [Monitoring](deployment.md#monitoring)                      |
| Monthly                    | R2 bucket size, and that a dump arrived every night                                                                                                     | Cloudflare → R2 → `hanker-backups`                                        |
| Monthly                    | The monitors' and heartbeat's incident history                                                                                                          | Better Stack                                                              |
| Monthly                    | `pnpm audit` with dev tooling included: have the Vercel CLI's advisories cleared? CI's gate covers production only                                      | Terminal, at the repo root                                                |
| Quarterly                  | The restore drill (D53). Put a recurring reminder in your calendar                                                                                      | [Restore drill and recovery](deployment.md#restore-drill-and-recovery)    |
| After a backup-path change | The restore drill: after a Postgres major upgrade, a new `age` key, a change to `backup.sh` or the backup role's grants, or a new pinned image          | Same                                                                      |
| Yearly                     | Rotate the R2 token and `hanker_backup`'s password                                                                                                      | [Backups → Rotation and upgrades](deployment.md#rotation-and-upgrades)    |
| Yearly                     | Check `hanker.dev` auto-renews, and how long Node's LTS has left                                                                                        | Cloudflare → Registrar; nodejs.org                                        |
| Yearly                     | Renew `Expires` in `apps/web/public/.well-known/security.txt` (CI fails once it lapses)                                                                 | The file; [Contact email](deployment.md#contact-email)                    |
| Yearly                     | Re-run the internet.nl website test and securityheaders.com on `hanker.dev`. Only new findings matter; the known ones are listed as not done on purpose | [DNSSEC and CAA](deployment.md#dnssec-and-caa)                            |
| Yearly                     | Rotate the `gmail-send-as` Resend key: create a new one, update Gmail's "Send mail as" password, revoke the old one                                     | [Contact email → B](deployment.md#b-reply-as-hello-resend-smtp-and-gmail) |

## When something breaks

| You see                                                 | Start here                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Stack: Live or Site down                         | Vercel's status, then the latest deploy; roll back if it caused it ([Rollback](deployment.md#rollback))                                                                                                                                                                                               |
| Better Stack: Deep down, Live up                        | Neon: its status page and the compute quota ([Monitoring](deployment.md#monitoring))                                                                                                                                                                                                                  |
| Better Stack: backup heartbeat failed or missed         | [Backups → When it fails](deployment.md#when-it-fails)                                                                                                                                                                                                                                                |
| A Sentry issue                                          | Its `requestId` tag matches the API's `x-request-id` and Vercel's logs, which keep only an hour                                                                                                                                                                                                       |
| Vercel: a certificate error on `hanker.dev`             | `dig +short CAA hanker.dev` still allows `letsencrypt.org`; https://letsdebug.net ([DNSSEC and CAA](deployment.md#dnssec-and-caa))                                                                                                                                                                    |
| `hanker.dev` doesn't resolve for some people (SERVFAIL) | DNSSEC: https://dnsviz.net/d/hanker.dev/dnssec/ ([DNSSEC and CAA](deployment.md#dnssec-and-caa))                                                                                                                                                                                                      |
| Bad data, newer than 6 hours                            | Neon point-in-time restore ([Rollback](deployment.md#rollback))                                                                                                                                                                                                                                       |
| Bad data, older than 6 hours                            | [Restore drill and recovery](deployment.md#restore-drill-and-recovery), the "Real recovery" paragraph                                                                                                                                                                                                 |
| A deploy run failed                                     | Its first red job's log; a stale-commit refusal from `assert-main-tip.sh` is by design ([Continuous deployment](deployment.md#continuous-deployment)); a red `sourcemaps` job alone means the browser maps are missing for that release, not that the release failed ([Sentry](deployment.md#sentry)) |
