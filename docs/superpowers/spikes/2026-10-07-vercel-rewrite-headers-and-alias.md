# Spikes B & C: client IP through the rewrite, and preview aliases

- **Date:** 2026-10-08
- **Setup:** throwaway API and web previews built from `delivery/vercel-setup` plus a temporary header-echo endpoint (`GET /api/_spike/headers`). The web preview was aliased to `shockolate-wishlist-pr-0.vercel.app`. The API preview had a dummy `DATABASE_URL`, because the endpoint never touches the database. Everything was deleted afterwards, and the spike branch was never pushed.
- **Client IP below:** written as `<client>` (the tester's public IP); `sig` values in `forwarded` are elided.

## Spike B: client IP

`req.ip` and `req.socket.remoteAddress` were always `127.0.0.1`: Vercel's function runtime fronts the app locally, so the client IP is only available from headers.

| Probe | `x-forwarded-for` | `x-real-ip` | `x-vercel-forwarded-for` | `x-vercel-proxied-for` | `forwarded` |
|---|---|---|---|---|---|
| (a) through the rewrite | `<client>` | `<client>` | `<client>` | `<client>` | `for=<client>;host=<alias>;proto=https;sig=…` |
| (b) rewrite, all three headers spoofed as `203.0.113.7` | `<client>` | `<client>` | `<client>` | `<client>` | `for=<client>;…` |
| (c) direct to the API deployment | `<client>` | `<client>` | `<client>` | `<client>` | `for=<client>;host=<api>;…` |
| (d) direct, spoofed | `<client>` | `<client>` | `<client>` | `<client>` | `for=<client>;…` |

Other observations:
- Through the rewrite, `host` is the **API** deployment's host and `x-forwarded-host` is the **web** alias.
- `x-vercel-id` gains a segment per edge hop (`cle1:cle1::…` through the rewrite vs `cle1::…` direct). It still matches the API's request-ID pattern.

**Decision:** use **`x-real-ip`** (a single value) as the client IP for per-IP rate limits, and trust it **only when running on Vercel** (`VERCEL` set). Off Vercel the header is client-controlled, so the API falls back to the socket address.
**Why:** through the rewrite, Vercel treats the hop as internal and preserves the browser's IP. Its edge overwrites client-supplied values on every path tested, so callers can't spoof the header on Vercel.

## Origin through the rewrite

(e) `Origin: https://<alias>` arrived at the API unchanged: `"https://shockolate-wishlist-pr-0.vercel.app"`.
**Decision:** the CSRF guard's `Origin` check (spec §6.2) works as designed. No escalation is needed.

## Spike C: preview alias

- `vercel alias set <web preview URL> shockolate-wishlist-pr-0.vercel.app` → `Success!` on the Hobby plan.
- Without the bypass header, the alias returned `302` (a redirect to Vercel login), so deployment protection covers aliases. With `x-vercel-protection-bypass: <secret>` it returned `200`.

**Decision:** the preview web alias pattern is `<PREVIEW_ALIAS_PREFIX><pr-number>.vercel.app`, with the repo variable `PREVIEW_ALIAS_PREFIX=shockolate-wishlist-pr-`. The bare `wishlist-web-pr-` prefix was avoided: `*.vercel.app` names are global, and Vercel had already assigned `wishlist-api-five`/`wishlist-web-gold` because the plain names were taken.

## Also learned

- **The CLI prints JSON under agent detection.** When it detects an AI agent, `vercel deploy` prints a JSON object (`.deployment.url`) on stdout instead of a bare URL. Scripts read the URL from either form.
