# Neon quota check: design

**Date:** 2026-10-29 · **Decision:** D105 · **Builds on:** spec §10 Monitoring, D47, D86

## 1. Problem

Production runs on Neon's Free plan: 100 CU-hours of compute per project per billing period. When they run out, Neon suspends the database until the period ends, and every page that reads it fails. The only check today is a monthly look at Neon → Usage (`docs/operations.md`), and the Deep monitor turns red only once the database is already down.

On 2026-10-29 the project had used 29.7 CU-hours since 2026-10-08, awake about 5.4 hours a day at 0.25 CU. At that floor, 100 CU-hours is about 13 awake hours a day over a month, so a few busy days after a public post could use it up. Neon's spending notifications exist only on paid plans.

## 2. What it does

Once a day, after the cleanup, the daily cron (`GET /api/internal/cron/daily`) reads production's project record from Neon's API:

```
GET https://console.neon.tech/api/v2/projects/{NEON_PROJECT_ID}
Authorization: Bearer {NEON_USAGE_API_KEY}
```

It uses three fields of `project`: `compute_time_seconds` (CU-seconds this period), `consumption_period_start` and `consumption_period_end`. This is the endpoint Neon documents for tracking Free-plan usage. It's a control-plane read, so it doesn't wake the database.

- **Used** = `compute_time_seconds / 3600` CU-hours.
- **Projected** = used × (period length ÷ time elapsed), counted only once 3 days have passed, so the first days' noise can't alarm.
- **Over** when used ≥ 60, or projected ≥ 90. Even at the 0.5 CU ceiling, the most the database can use is about 12 CU-hours a day, so 60 leaves at least 3 days to act.

It then pings a second Better Stack heartbeat, **Neon quota**: the URL when under, and `<url>/fail` when over. When Neon's API can't be read (an error status, a timeout or an unexpected body), it pings nothing and sends a Sentry warning with the status only, so the heartbeat goes quiet and alerts after its grace period. Each run logs the used and projected numbers, which aren't personal data.

The check never throws and never changes the cron's answer or its own heartbeat (D86). A cron run whose cleanup fails still checks the quota.

## 3. Configuration

Three optional variables on `wishlist-api` → Production, set together or not at all (the env check refuses a partial set):

| Variable                   | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `NEON_PROJECT_ID`          | Production's project ID. Not a secret                              |
| `NEON_USAGE_API_KEY`       | A Neon API key scoped to production's project. Secret              |
| `NEON_QUOTA_HEARTBEAT_URL` | The Neon quota heartbeat's URL, which carries its token. Secret, https only |

Unset means no check and no outside call: previews, CI, tests and local development.

The heartbeat is made in Better Stack's dashboard, like the other two (`infra/betterstack.tf` says why): a 24-hour period with 2 hours of grace, on the same escalation policy.

## 4. The key

Neon has no read-only API key. A project-scoped key has Editor access to its project: it can change and delete what's inside it (branches, roles and their passwords, compute settings), but it can't delete the project, reach another one or mint keys.

It lives only in Vercel's Production environment for `wishlist-api`, which already holds `DATABASE_URL`, a connection that can already drop all the data. What the key adds: deleting branches, which loses the 6-hour restore history, and resetting role passwords, which locks the app out. The nightly R2 backups sit outside Neon behind a bucket lock, so recovery still holds. The key is never logged or reported: failures carry the HTTP status only, as `cron-heartbeat.ts` does.

## 5. What to do when it alerts

Pause the Deep monitor, which saves up to about 1 CU-hour a day, and look at Neon → Usage. Then ride out the period or move to Launch. Launch has no monthly minimum and bills compute at $0.106 per CU-hour, so the whole Free quota would cost about $10.60.

## 6. Rejected

- **A scheduled GitHub workflow.** It would put a second production credential in a second place, change the workflow policy tests, and GitHub disables schedules after 60 quiet days.
- **A Sentry warning instead of a heartbeat.** Whether a warning reaches anyone depends on Sentry's alert rules, which aren't managed in code, and a check that stops running would alert nobody.
- **Paying for Launch instead.** That's still open, and it's cheap. This check is what lets the Free plan stay safe.
