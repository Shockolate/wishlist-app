# Plan 2b — Auth Web & Go-Live (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hanker its account web pages in the Warm Editorial theme:
- landing;
- sign-up;
- email verification;
- login;
- password reset;
- a signed-in home;
- settings.

Alongside the pages, finish the auth API's go-live hardening and stand up `hanker.dev` with Resend and Turnstile configured. Production sign-up stays dark until Plan 3.

**Architecture:**
- **Proxy:** the Next.js 16 web app gains a `proxy.ts`. It issues a fresh CSP nonce on every page request and redirects on the session cookie's *presence* only (spec §6.1).
- **Account forms:** they use react-hook-form with the shared `contracts` Zod schemas and call the API through the same-origin `/api` rewrite, so the API's `Set-Cookie` reaches the browser (spec §7: no Server Actions for auth).
- **Signed-in pages:** they ask the API who is signed in, server to server, and send a stale session to `/login`.
- **API changes:** all hardening. The changes:
  - a long-lived cookie, with the database as the only authority on expiry (D27);
  - email-token hygiene;
  - display-name rules;
  - Turnstile secret errors;
  - a production email guard;
  - IPv6 /64 rate-limit keys;
  - race-safe password writes.

**Tech Stack:**
- Next.js 16.4, React 19.3, Tailwind 4.3.
- Components in shadcn/ui style, hand-copied with no CLI.
- react-hook-form 7.89.0 with @hookform/resolvers 5.9.1.
- class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0.
- `next/font/google`: Instrument Serif and Geist.
- Cloudflare Turnstile, rendered explicitly with no wrapper library.
- Playwright, axe and Mailpit for E2E.
- On the API: NestJS 12, Drizzle and Vitest, as before.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §3, §5, §6.1, §6.2, §6.5–§6.7, §6.9, §7, §8, §9 and §10 Domain and DNS. The API it builds on is [Plan 2a](2026-10-09-plan-2a-auth-api.md). The 2a final review's go-live checklist is folded in as Tasks 2–7.

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1, 1b and 2a still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`.
- Exact version pins, and Vitest.
- Explicit `@Inject` on every constructor dependency.
- Every error is problem+json with a stable `code`.
- An error's `detail` never echoes what the caller sent.
- No personal data in logs.

**Trust model.** No new GitHub secrets. The Turnstile **site key** is public:
- It's the repo *variable* `TURNSTILE_SITE_KEY` and a value inlined at build time, never a secret.
- The Turnstile **secret** is not set in production during 2b. That's how sign-up stays dark.
- `node scripts/workflow-policy.test.mjs` and `node scripts/workflow-policy.mutations.test.mjs` keep passing.

**New dependencies, exact, in `apps/web` only:**
- `react-hook-form@7.89.0`
- `@hookform/resolvers@5.9.1`
- `class-variance-authority@0.7.1`
- `clsx@2.1.1`
- `tailwind-merge@3.7.0`

Nothing else: no Turnstile wrapper, no Radix (it arrives with Plan 3's dialogs) and no TanStack Query (Plan 3's editor).

**Naming.**
- People see **Hanker** everywhere.
- Code, packages, tables and Vercel projects keep `wishlist`.
- Copy never uses a pronoun for a list owner ("Ada won't see who's getting what"), because the app can't know it.

**The theme: Warm Editorial Minimalism (Ted, 2026-10-10).** The canvas is https://claude.ai/artifact/ETBdkEdoM9PuetGUKMahys, on the page "Hanker theme".

| Token | Value | Use |
|---|---|---|
| `--background` | `#FAF7F2` (sand) | Page ground |
| `--foreground`, `--border`, `--ring` | `#1E1B18` (espresso) | Text, card borders, focus ring |
| `--card` | `#FFFFFF` | Cards and fields |
| `--primary` | `#FF5A4D` (terracotta) | Primary actions only, **never text**: 2.9:1 on sand |
| `--primary-foreground` | `#1E1B18` | Text on terracotta: 5.5:1. White on terracotta is 3.1:1, which fails AA |
| `--muted-foreground` | `#5C554E` | Secondary text: 6.8:1 on sand |
| `--input` | `#8C847B` | Field borders: 3.6:1 on white |
| `--success` | `#6B8E78` (sage) | Fills and icons only: 3.4:1 |
| `--success-foreground` | `#3F5A49` | Sage text |
| `--success-wash` | `#E6EEE8` | Sage pill background |
| `--destructive` | `#B42318` | Error text: 6.1:1 on sand. Terracotta can't carry text |
| `--radius-card` | `16px` | Cards |
| `--radius-control` | `12px` | Buttons and fields |
| `--font-display` | Instrument Serif 400, normal and italic | Wordmark and headings |
| `--font-sans` | Geist | Everything else |

**Accessibility.** WCAG 2.2 AA (spec §7):
- Every field has a visible label.
- Errors are text linked with `aria-describedby`, never colour alone.
- The focus ring is 2px espresso, offset 3px.
- Touch targets are at least 44px.
- `prefers-reduced-motion` turns off every transition and transform.

**Values fixed by this plan:**

| Thing | Value |
|---|---|
| Session cookie | `__Host-session`, `Max-Age` 400 days (34,560,000 s), set at login only and never reissued (D27) |
| Session expiry | Database `expires_at`, 30 days idle, slid at most once an hour. The only authority |
| Turnstile test keys | Site key `1x00000000000000000000AA`; secret `1x0000000000000000000000000000000AA`. Both always pass. Used locally, in CI, in E2E and in previews |
| CSP (every page) | `default-src 'self'; script-src 'self' 'nonce-<N>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| CSP on Turnstile pages | `/signup`, `/verify-email` and `/reset-password` (and the paths below it) add `https://challenges.cloudflare.com` to `script-src`, and add `frame-src https://challenges.cloudflare.com` |
| CSP in development | `script-src` adds `'unsafe-eval'`, which React needs for dev error overlays |
| Token pages | `/verify-email` and `/reset-password/confirm` send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` |
| Mailpit | Inbox http://localhost:8025, API `http://localhost:8025/api/v1` |
| E2E ports | Web 3100, API 3101 (unchanged) |

**Tests.**
- Web unit tests are pure TypeScript: Vitest in the `node` environment.
- Pages and components are covered by Playwright E2E against production builds, with axe on every page (spec §8).
- API tests follow Plan 2a: every state-changing request goes through `test/support/client.ts`.

## Rulings this plan makes on gaps in the spec

The spec says what must happen but not every how. These are the plan's decisions. The executor records each one in the ledger as it lands.

1. **D27: a long-lived cookie, with the database deciding (Ted).** The cookie gets `Max-Age` 400 days at login and is never reissued. The database's sliding `expires_at` is the only expiry.
   - **Why:** a Server Component's call to the API can be the first request after the hourly refresh window. That call slides the database expiry, but its `Set-Cookie` lands on the web server, not the browser. With the cookie's age tied to the session, a daily user would be signed out after 30 days anyway (2a final review, Important #2).
   - It also removes the double `Set-Cookie` on `DELETE /me`.
2. **The API clears a dead session cookie.** A request that presents `__Host-session` but has no live session gets its `401` *and* a cleared cookie. So the next browser call stops sending the stale cookie.
3. **Dark until Plan 3 (Ted).**
   - The domain, DNS, Resend and the Turnstile *widget* are set up now.
   - `TURNSTILE_SECRET_KEY` stays unset in production, so sign-up, resend and reset-request answer `503 CAPTCHA_UNAVAILABLE`.
   - The web app shows that as "Sign-ups and account emails are paused right now."
4. **The CSP as built:**
   - `style-src` is `'self' 'unsafe-inline'`. React and `next/font` set style attributes, and a nonce can't cover an attribute. Inline styles are a far smaller risk than inline scripts.
   - `script-src` gets `'strict-dynamic'`, as Next's guide recommends.
   - `object-src`, `base-uri` and `form-action` are added.
   - `upgrade-insecure-requests` is left out. It would break `http://localhost` E2E, and the HSTS-preloaded `.dev` domain covers production anyway.
5. **Every page renders dynamically.** Nonces only reach pages rendered per request, so the root layout calls `await connection()`.
6. **Turnstile pages:** `/signup`, `/verify-email` (resend) and `/reset-password` (request). `/login` has no challenge, because the API doesn't ask for one.
7. **Token pages (spec §6.7):**
   - The page reads the token from `location`, keeps it in memory, and removes it from the address bar with `history.replaceState` *before* doing anything else.
   - Nothing is posted until the person presses the button. So a mail scanner or link preview that renders the page can't use up a single-use link (Review Focus 1).
   - Both token pages send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. `robots.txt` disallows the auth and signed-in paths.
8. **Proxy redirects (spec §6.1: cookie presence only):**
   - `/list` and `/settings` without the cookie go to `/login?next=<path>`.
   - `/` with the cookie goes to `/list`.
   - `/login` is **never** redirected, because a stale cookie would loop `/login` → `/list` → `/login`.
9. **`next` is accepted only as a same-site path:**
   - It must start with `/`.
   - It must not start with `//` or `/\`.
   - It must contain no whitespace or control characters, which browsers strip and so turn `/\t/evil` into `//evil`.

   Anything else becomes `/list`.
10. **`/list` in 2b is a placeholder signed-in home.** It shows the "confirm your email" notice for unverified users. Plan 3 replaces it with the editor.
11. **The Turnstile site key is inlined at build time as `TURNSTILE_SITE_KEY`.** It's required the way `API_ORIGIN` is: the build refuses to run without it.
    - Local, CI, E2E and previews use Cloudflare's always-pass test key.
    - Production uses the repo variable `TURNSTILE_SITE_KEY` (Task 1).
12. **The email gate splits in two:**
    - `screen` runs the per-IP limit, then Turnstile.
    - `chargeAddress` runs the per-address limit.

    Sign-up checks for a breached password between the two, so a breached password no longer uses up the address's three emails an hour (2a T7).
13. **IPv6 rate-limit keys use the /64,** since one IPv6 host usually holds a whole /64. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is keyed as its IPv4 address (2a final review, Minor 1).
14. **Display names and the verification email:**
    - Display names reject control and format characters (`\p{Cc}`, `\p{Cf}`) except the zero-width joiner inside emoji. That rules out newlines and bidirectional overrides.
    - The verification email no longer greets anyone by a name nobody has verified (2a T7).
15. **Production boot guard.** The API refuses to start when all three hold:
    - `VERCEL_ENV=production`;
    - `TURNSTILE_SECRET_KEY` is set;
    - `EMAIL_TRANSPORT=log`.

    Without the guard, the day sign-up opens, every account email would only be logged (2a T3).
16. **Turnstile operator errors read as "unavailable".** `missing-input-secret`, `invalid-input-secret` and `bad-request` mean our request is wrong, not the visitor's. So they become `unavailable` plus a warning, as `internal-error` already did (2a T4).
17. **Race-safe password writes:**
    - Creating a session at login re-checks, under a share lock on the user row, that the password is still the one just verified.
    - A password change re-checks the hash and that its own session still exists, under an update lock.
    - Either way, a concurrent reset can't be undone (2a final review, Minor 2).
18. **Reset links retire.** Once a password is reset or changed, every unused reset link for that user is deleted. And `issue()` locks the user row, so two concurrent requests can't leave two live links (2a T7, T9, T10).
19. **No UI library in 2b.** Button, input, label, field, card and notice are hand-copied in shadcn/ui's style, onto shadcn's semantic token names. Plan 3 adds Radix-based components the same way.
20. **The landing page drops the API-status line.** Health stays covered by the smoke and E2E API tests. The web home becomes a real landing page.
21. **E2E uses the real thing:**
    - Cloudflare's test keys, over the network.
    - Mailpit's search API.
    - `scripts/e2e.sh` empties `rate_limits` in `wishlist_e2e` before each run. Otherwise the per-IP mail budget (20 an hour) carries across local runs.
    - A run stays under 20 mail-sending calls.
22. **The old production origin.** Once `APP_ORIGIN` is `https://hanker.dev`, the `*.vercel.app` production alias still serves pages, but its state-changing calls get `403 FORBIDDEN_ORIGIN`. Accepted: nobody uses it. A host redirect can come later.
23. **Error copy lives in one table** (`apps/web/src/lib/messages.ts`; spec §7) and never shows raw server text (spec §9). Zod's own messages are replaced by `formErrorMap` with plain-language ones.
24. **The web keeps its own `SESSION_COOKIE` constant** (`__Host-session`), with a comment pointing at the API's. The E2E account tests fail if the two drift apart.

## Review Focus

Five failure modes the spec implies but no task's tests would otherwise exercise, most likely first. Each has its test in the task named.

1. **A link opened by a mail scanner, a preview, or twice by the person must not be used up before they act.** Expected: rendering `/verify-email?token=…` never posts. The token is used only when the person presses "Confirm my email". Opening the link, leaving, and opening it again still confirms (Task 13).
2. **A stale session cookie** (30 days idle, or revoked elsewhere) must not loop or strand anyone. Expected: `/` → `/list` → `/login?next=%2Flist` and stop there; logging in works; the API clears the dead cookie (Tasks 2 and 14).
3. **Tokens must not linger in the address bar, history or `Referer`.** Expected: after a token page loads, its URL has no `token=`, and the response carries `Referrer-Policy: no-referrer` (Task 13).
4. **`/login?next=` must not become an open redirect.** Expected: `https://evil.example`, `//evil.example`, `/\evil.example` and `/%09/evil.example` all land on `/list` after login (Tasks 11 and 12).
5. **Pressing "Create account" twice must send one request.** A second request with the same address would send an "already have an account" email and burn the single-use Turnstile token. Expected: exactly one email arrives (Task 12).

## Stacks and order

| Stack | Branches (bottom to top) | Tasks | Merges |
|---|---|---|---|
| `auth-hardening` | `api/session-cookie` → `api/email-tokens` → `api/display-names` → `api/config-guards` → `api/ip-keys` → `api/password-races` | 2–7 | Task 8, before stack 2 starts |
| `auth-web` | `web/theme` → `web/proxy` → `web/plumbing` → `web/signup-login` → `web/email-links` → `web/account` → `e2e/auth` → `docs/auth-web` | 9–16 | Task 17 |

Task 1 is an operations checkpoint with Ted. It runs first and in parallel with Tasks 2–7, because DNS and Resend verification take time. Its `TURNSTILE_SITE_KEY` repo variable must exist before stack `auth-web` deploys (Task 11 makes the production build require it).

## File map

**API** (`apps/api`):
- `src/auth/session-cookie.ts`, `sessions.service.ts`, `session.guard.ts`, `session.controller.ts`, `login.service.ts`: D27, the stale-cookie clear, and race-safe login.
- `src/auth/email-tokens.service.ts`, `password-reset.service.ts`, `account.service.ts`: retiring reset links, the `issue()` lock, and a race-safe change.
- `src/auth/auth-emails.ts`, `signup.service.ts`, `email-gate.ts`: no name in the verification email, the gate split, and the breach-check order.
- `src/security/captcha.ts`, `src/core/env.ts`: operator errors, and the production email guard.
- `src/rate-limit/keys.ts`: `ipRateLimitKey`, keyed on the /64.
- `packages/contracts/src/auth.ts`: `DisplayNameSchema` rejects hidden characters.

**Web** (`apps/web`):
- `src/app/globals.css`, `src/app/fonts.ts`, `src/app/layout.tsx`: theme, type, and dynamic rendering.
- `src/components/ui/*`: button, input, label, field, card, notice.
- `src/components/*`: site header, account header, collage, Turnstile, and the auth and account forms.
- `src/proxy.ts`, `src/lib/csp.ts`, `src/lib/auth-routing.ts`: nonces, CSP and redirects.
- `src/lib/browser-api.ts`, `messages.ts`, `form-errors.ts`, `safe-next.ts`, `nonce.ts`, `require-me.ts`, `session.ts`: client plumbing.
- `src/app/(auth)/signup`, `login`, `verify-email`, `reset-password`, `reset-password/confirm`: signed-out pages.
- `src/app/(account)/list`, `settings`: signed-in pages.
- `src/app/robots.ts`, `not-found.tsx`, `error.tsx`, `page.tsx`.

**E2E** (`e2e`):
- `support/mailpit.ts`, `support/accounts.ts`.
- `tests/local/*.spec.ts` (security, signup, login, email-links, account, golden-path, a11y, phone).
- `tests/smoke/smoke.spec.ts`.

**CI and docs:**
- `.github/workflows/ci.yml`, `preview.yml` and `deploy.yml`: `TURNSTILE_SITE_KEY` for web builds.
- `scripts/e2e.sh`, `e2e/playwright.config.ts`.
- `docs/deployment.md`, `docs/development.md`, `AGENTS.md`.
- The spec (D27–D29, §6.1, §6.9, §7) and the roadmap.

---
### Task 1: ⏸ CHECKPOINT: hanker.dev, Turnstile and Resend (Ted, with the controller)

**Files:** none. This task is operations only. Every secret goes in through a hidden prompt or a pipe, is never echoed, and never lands in the repo.

**Produces:**
- `https://hanker.dev` serving the `wishlist-web` production deployment.
- Repo variable `TURNSTILE_SITE_KEY`.
- Resend verified on `mail.hanker.dev`.
- In `wishlist-api` production: `RESEND_API_KEY`, `EMAIL_TRANSPORT=resend` and `EMAIL_FROM`.
- `APP_ORIGIN=https://hanker.dev` and repo variable `APP_PRODUCTION_ORIGIN=https://hanker.dev`.
- The Turnstile **secret** stays offline (Ted's password manager) until Plan 3.

Steps 1–4 can run in any order, and in parallel with Tasks 2–7. Step 5 waits for step 1.

- [ ] **Step 1: Attach the domain to the web project**

  - In Vercel, go to `wishlist-web` → Settings → Domains → Add `hanker.dev` (Production). Then add `www.hanker.dev` and set it to redirect (308) to `hanker.dev`.
  - In Cloudflare, in the `hanker.dev` zone → DNS, add exactly the records Vercel shows (today, an `A` record for the apex and a `CNAME` for `www`). Set **Proxy status: DNS only (grey cloud)** on both (spec §10).
  - Wait until Vercel shows "Valid Configuration" with a certificate.

  Verify:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' https://hanker.dev/
  curl -fsS https://hanker.dev/api/health; echo
  ```
  Expected: `200`, then the health JSON with the current `main` SHA.

- [ ] **Step 2: Create the Turnstile widget**

  - In the Cloudflare dashboard, go to Turnstile → Add widget. Name: `Hanker`. Hostname: `hanker.dev`. Mode: **Managed**.
  - Copy the **site key** (public) into a repo variable:
    ```bash
    gh variable set TURNSTILE_SITE_KEY --body '<site key>'
    ```
  - Put the **secret key** in your password manager. Do **not** add it to Vercel: production stays dark until Plan 3 (rule 3).

  Verify: `gh variable list` shows `TURNSTILE_SITE_KEY`.

- [ ] **Step 3: Set up Resend on `mail.hanker.dev`**

  - At resend.com, go to Domains → Add domain → `mail.hanker.dev`.
  - In the Cloudflare zone, add every record Resend lists (the MX and SPF `TXT` on the `send` subdomain, and the DKIM `TXT`), all as **DNS only**.
  - Add the DMARC record: `TXT` `_dmarc.hanker.dev` = `v=DMARC1; p=none;`. It starts in monitor mode; tighten it after a month of clean reports.
  - Press **Verify** and wait for "Verified".
  - Go to Resend → API Keys → Create `hanker-production`: **Sending access**, domain `mail.hanker.dev`.

- [ ] **Step 4: Give the API its email settings (nothing sends while dark)**

  ```bash
  read -rs RESEND_KEY && printf %s "$RESEND_KEY" \
    | npx --yes vercel@62.5.0 env add RESEND_API_KEY production --sensitive --project wishlist-api --scope shockolate
  unset RESEND_KEY
  printf %s 'resend' \
    | npx --yes vercel@62.5.0 env add EMAIL_TRANSPORT production --project wishlist-api --scope shockolate
  printf %s 'Hanker <no-reply@mail.hanker.dev>' \
    | npx --yes vercel@62.5.0 env add EMAIL_FROM production --project wishlist-api --scope shockolate
  ```
  These apply to the next production deployment (Task 8).

- [ ] **Step 5: Move the canonical origin to `hanker.dev` (after step 1 verifies)**

  ```bash
  npx --yes vercel@62.5.0 env rm APP_ORIGIN production --yes --project wishlist-api --scope shockolate
  printf %s 'https://hanker.dev' \
    | npx --yes vercel@62.5.0 env add APP_ORIGIN production --project wishlist-api --scope shockolate
  gh variable set APP_PRODUCTION_ORIGIN --body 'https://hanker.dev'
  ```
  - The CSRF guard compares `Origin` with `APP_ORIGIN` exactly, and email links use it.
  - It takes effect on the next deploy (Task 8). From then on, state-changing calls from the old `*.vercel.app` alias get `403` (rule 22).
  - If DNS is still settling when Task 8 is ready, merge anyway, and do this step before Task 17.

- [ ] **Step 6: Record**

  The controller checks:
  ```bash
  gh variable list
  npx --yes vercel@62.5.0 env ls production --project wishlist-api --scope shockolate
  ```
  The second command shows names only; sensitive values stay hidden.

  Expected names:
  - `APP_ORIGIN`, `CRON_SECRET`, `DATABASE_URL`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`.
  - **No** `TURNSTILE_SECRET_KEY`.

  Write the outcome in the ledger.

---

### Task 2: Session cookie: long-lived, the database decides (D27)

**Files:**
- Modify: `apps/api/src/auth/session-cookie.ts`, `apps/api/src/auth/sessions.service.ts`, `apps/api/src/auth/session.guard.ts`, `apps/api/src/auth/session.controller.ts`, `apps/api/src/auth/login.service.ts`
- Test: `apps/api/src/auth/session-cookie.spec.ts`, `apps/api/test/sessions.int-spec.ts`, `apps/api/test/login.int-spec.ts`

**Interfaces:**
- Consumes: the Plan 2a session code.
- Produces:
  - `SESSION_COOKIE_MAX_AGE_MS` (400 days).
  - `hasSessionCookie(cookieHeader: string | undefined): boolean`.
  - `setSessionCookie(res: Response, token: string): void` (two parameters now).
  - `SessionsService.create(userId: string): Promise<{ token: string }>`. Task 7 adds a parameter.
  - `SessionsService.resolve(token): Promise<ActiveSession | null>`, where `ActiveSession = { sessionId: string; user: SessionUser }`.
  - `LoginService.login(...): Promise<{ token: string }>`.

- [ ] **Step 1: Start the stack**

```bash
git switch main && git pull --ff-only
gh stack init api/session-cookie
```

- [ ] **Step 2: Write the failing tests**

In `apps/api/src/auth/session-cookie.spec.ts`:
- Import `hasSessionCookie` and drop the `SESSION_TTL_MS` import.
- The probe's `set` handler becomes `setSessionCookie(res, TOKEN);`.
- Replace the "sets __Host-session … for 30 days" test with the first test below, and add the second inside the `readSessionToken` describe:

```ts
  it('sets __Host-session HttpOnly, Secure, SameSite=Lax, Path=/ for 400 days (D27)', async () => {
    const res = await http(app).get('/api/probe/set');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=${TOKEN}; Max-Age=34560000; Path=/; `));
    expect(cookie).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie).not.toMatch(/Domain=/i);
  });
```

```ts
  it('tells whether a session cookie was sent at all, well-formed or not', () => {
    expect(hasSessionCookie(`theme=dark; ${SESSION_COOKIE}=not-a-token`)).toBe(true);
    expect(hasSessionCookie(`${SESSION_COOKIE}=${TOKEN}`)).toBe(true);
    expect(hasSessionCookie('theme=dark')).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
  });
```

In `apps/api/test/sessions.int-spec.ts`, replace the test "slides the expiry at most once an hour, reissuing the cookie when it does" with these two:

```ts
  it('slides the database expiry at most once an hour and never reissues the cookie (D27)', async () => {
    const { cookie } = await signedIn();
    const row = async () =>
      (
        await db.pool.query<{ last_seen_at: Date; expires_at: Date }>(
          'select last_seen_at, expires_at from sessions',
        )
      ).rows[0];

    t.clock.advance(59 * 60 * 1000);
    const early = await client(t.app, cookie).get('/me');
    expect(early.status).toBe(200);
    expect(setCookies(early)).toEqual([]);
    expect((await row())?.expires_at).toEqual(new Date(TEST_START.getTime() + 30 * DAY));

    t.clock.advance(2 * 60 * 1000);
    const refreshedAt = t.clock.now();
    const refreshed = await client(t.app, cookie).get('/me');
    expect(refreshed.status).toBe(200);
    expect(setCookies(refreshed)).toEqual([]);
    expect(await row()).toEqual({
      last_seen_at: refreshedAt,
      expires_at: new Date(refreshedAt.getTime() + 30 * DAY),
    });

    // Past the original 30-day expiry but within the slid one: only the slide keeps it alive.
    t.clock.set(new Date(TEST_START.getTime() + 30 * DAY + 30 * 60 * 1000));
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });

  it('clears a dead session cookie with the 401, so the browser stops sending it (rule 2)', async () => {
    const { cookie } = await signedIn();
    t.clock.advance(30 * DAY + 1);
    const expired = await client(t.app, cookie).get('/me');
    expect(expired.status).toBe(401);
    expect(setCookies(expired)[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`),
    );

    const malformed = await client(t.app, `${SESSION_COOKIE}=not-a-token`).get('/me');
    expect(malformed.status).toBe(401);
    expect(setCookies(malformed)).toHaveLength(1);

    const none = await client(t.app).get('/me');
    expect(none.status).toBe(401);
    expect(setCookies(none)).toEqual([]);
  });
```

`sessionCookie` is no longer used in this file: remove it from the import.

In `apps/api/test/login.int-spec.ts`, in the test "logs in with the right password and sets the __Host- session cookie", change `Max-Age=2592000` to `Max-Age=34560000`.

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null
pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/api exec vitest run --project unit src/auth/session-cookie.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/sessions.int-spec.ts test/login.int-spec.ts
```
Expected failures:
- `hasSessionCookie` is not exported (unit).
- `Max-Age=2592000` where `34560000` is expected.
- The refreshed `/me` reissues a cookie.
- The expired-cookie `401` sets no cookie.

- [ ] **Step 4: Implement**

`apps/api/src/auth/session-cookie.ts`, in full:

```ts
import type { Response } from 'express';

/**
 * The `__Host-` prefix makes browsers insist on Secure, Path=/ and no Domain (spec §6.1). Browsers
 * treat http://localhost as secure, so the cookie works in local development and E2E too.
 */
export const SESSION_COOKIE = '__Host-session';
/** How long a session lives without use. The database's expires_at is the only authority (D27). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry moves forward at most this often, so reads don't write on every request. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/**
 * The cookie outlives any session: 400 days, the longest browsers keep one. It's set at login and
 * never reissued, because a refresh can happen on a server-to-server call whose Set-Cookie never
 * reaches the browser (D27).
 */
export const SESSION_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The session token from a Cookie header, if it's there and well-formed. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const [name, value] = pair.trim().split('=', 2);
    if (name === SESSION_COOKIE) {
      return value !== undefined && TOKEN_PATTERN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Whether a Cookie header carries the session cookie at all, well-formed or not. */
export function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return (cookieHeader ?? '').split(';').some((pair) => pair.trim().startsWith(`${SESSION_COOKIE}=`));
}

const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...ATTRIBUTES, maxAge: SESSION_COOKIE_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, ATTRIBUTES);
}
```

In `apps/api/src/auth/sessions.service.ts`:
- `ActiveSession` loses `maxAgeMs` and `refreshed`.
- `create` returns `{ token }`.
- `resolve` slides the row and returns `{ sessionId, user }`.

Replace from `export interface ActiveSession` to the end of `resolve` with:

```ts
export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
}

/** Database sessions (spec §6.1, D16): revocable at once, at the cost of one indexed lookup. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(userId: string): Promise<{ token: string }> {
    const now = this.clock.now();
    const token = newToken(32);
    await this.db.insert(sessions).values({
      id: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    return { token };
  }

  /**
   * The live session for a token. Its database expiry slides forward at most once an hour; the
   * cookie is never touched, because the database alone decides (D27).
   */
  async resolve(token: string): Promise<ActiveSession | null> {
    const now = this.clock.now();
    const sessionId = hashToken(token);
    const [row] = await this.db
      .select({
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)));
    if (!row) return null;

    if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_REFRESH_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
        .where(eq(sessions.id, sessionId));
    }
    return {
      sessionId,
      user: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        emailVerified: row.emailVerifiedAt !== null,
      },
    };
  }
```
`revoke` stays as it is.

In `apps/api/src/auth/session.guard.ts`:
- The import becomes `import { clearSessionCookie, hasSessionCookie, readSessionToken } from './session-cookie.js';`.
- The class comment and `canActivate` become:

```ts
/**
 * Requires a live session and attaches it to the request. Every authorization decision is made
 * here, in the API (spec §6.1). A dead cookie is cleared along with the 401 (rule 2).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      if (hasSessionCookie(req.headers.cookie)) clearSessionCookie(http.getResponse<Response>());
      throw unauthenticated();
    }
    req.auth = { sessionId: session.sessionId, user: session.user };
    return true;
  }
}
```

In `apps/api/src/auth/session.controller.ts`, the login handler sets `setSessionCookie(res, session.token);`.

In `apps/api/src/auth/login.service.ts`, `login` now returns `Promise<{ token: string }>`. The body is unchanged.

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/auth/session-cookie.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/sessions.int-spec.ts test/login.int-spec.ts test/account.int-spec.ts
pnpm turbo run lint typecheck test --filter=@wishlist/api
```
Expected: all pass.
- `account.int-spec.ts` is included because `DELETE /me` now sends exactly one `Set-Cookie`.
- If `typecheck` names a caller of the old `create`, `resolve` or `setSessionCookie`, fix that call. Change no behaviour.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/api/src/auth apps/api/test
git commit -F - <<'EOF'
feat(api): keep the session cookie for 400 days and let the database decide

A Server Component's API call can slide the session but can't pass the
reissued cookie to the browser, so a cookie tied to the 30-day session
signed daily users out anyway. The cookie now lives 400 days, is set only
at login, and the database's sliding expires_at is the only authority
(D27). A request with a dead session cookie gets it cleared with the 401.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Use a `Co-Authored-By` line that names the model that actually wrote the commit (Plan 2a ruling). Submit the stack only after Task 7 (step 7 there).

---

### Task 3: Email tokens: one live token per purpose, really

**Files:**
- Modify: `apps/api/src/auth/email-tokens.service.ts`, `apps/api/src/auth/password-reset.service.ts`, `apps/api/src/auth/account.service.ts`
- Create: `apps/api/test/email-tokens.int-spec.ts`
- Test: `apps/api/test/password-reset.int-spec.ts`, `apps/api/test/account.int-spec.ts`

**Interfaces:**
- Consumes: `EmailTokensService.issue(tx, userId, purpose)`, `consume`, `peek` (Plan 2a).
- Produces: `EmailTokensService.retireUnused(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<void>`. `AccountService` now injects `EmailTokensService`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/email-tokens
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/email-tokens.int-spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailTokensService } from '../src/auth/email-tokens.service.js';
import { hashToken } from '../src/security/tokens.js';
import { signUp } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

describe('EmailTokensService.issue (spec §6.5: one live token per purpose)', () => {
  it('leaves exactly one live token when two are issued for the same user at once', async () => {
    await signUp(t);
    const [user] = (await db.pool.query<{ id: string }>('select id from users')).rows;
    if (!user) throw new Error('signup created no user');
    const tokens = t.app.get(EmailTokensService);

    let markIssued: () => void = () => undefined;
    let release: () => void = () => undefined;
    const issued = new Promise<void>((resolve) => {
      markIssued = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The first transaction issues a token, then stays open until released.
    const first = db.db.transaction(async (tx) => {
      const token = await tokens.issue(tx, user.id, 'reset_password');
      markIssued();
      await released;
      return token;
    });
    await issued;
    // The second starts while the first is open. Without a lock, its delete can't see the first's
    // uncommitted token, and both survive.
    const second = db.db.transaction((tx) => tokens.issue(tx, user.id, 'reset_password'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const [, secondToken] = await Promise.all([first, second]);

    const { rows } = await db.pool.query<{ token_hash: string }>(
      "select token_hash from email_tokens where purpose = 'reset_password' and consumed_at is null",
    );
    expect(rows.map((r) => r.token_hash)).toEqual([hashToken(secondToken)]);
  });
});
```

Add to `apps/api/test/password-reset.int-spec.ts`, inside `describe('password reset (spec §5)')`:
- New imports: `newId` from `'../src/core/ids.js'` and `hashToken` from `'../src/security/tokens.js'`.
- `signUp` is already imported.

```ts
  it('retires every other unused reset link once the password is reset (rule 18)', async () => {
    await signUpVerified(t);
    await requestReset(ADA.email);
    const used = resetToken();
    // A second live link, as the old issue() race could leave behind.
    const spare = 'S'.repeat(43);
    await db.pool.query(
      `insert into email_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
       select $1, id, 'reset_password', $2, $3, $4 from users`,
      [newId(), hashToken(spare), new Date(t.clock.now().getTime() + 60 * 60 * 1000), t.clock.now()],
    );

    expect((await confirm(used)).status).toBe(204);
    const res = await confirm(spare, 'yet another passphrase 3');
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });

  it('never accepts a verification link as a reset link, or the other way round', async () => {
    await signUp(t);
    const verify = linkToken(lastEmail(t, ADA.email, SUBJECTS.verification).text);
    const asReset = await confirm(verify);
    expect([asReset.status, codeOf(asReset)]).toEqual([400, ErrorCode.INVALID_TOKEN]);

    await requestReset(ADA.email);
    const asVerify = await client(t.app).post('/auth/verify-email', { token: resetToken() });
    expect([asVerify.status, codeOf(asVerify)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });
```

Add to `apps/api/test/account.int-spec.ts`, inside `describe('POST /me/password (spec §5)')`:
- New imports: `SUBJECTS` from `'../src/auth/auth-emails.js'`; `lastEmail` and `TURNSTILE_OK` from `'./support/accounts.js'`; `linkToken` from `'./support/client.js'`.

```ts
  it('retires outstanding reset links, so one sent before the change cannot undo it (rule 18)', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    await client(t.app).post('/auth/password-reset/request', {
      email: ADA.email,
      turnstileToken: TURNSTILE_OK,
    });
    const link = linkToken(lastEmail(t, ADA.email, SUBJECTS.passwordReset).text);

    expect((await change(cookie, ADA.password)).status).toBe(204);

    const res = await client(t.app).post('/auth/password-reset/confirm', {
      token: link,
      newPassword: 'yet another passphrase 3',
    });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project integration test/email-tokens.int-spec.ts test/password-reset.int-spec.ts test/account.int-spec.ts
```
Expected:
- The concurrency test finds **two** hashes.
- The spare link confirms (`204`, not `400`).
- The link sent before the change still confirms.
- The cross-purpose test already passes. It pins behaviour that already exists.

- [ ] **Step 4: Implement**

In `apps/api/src/auth/email-tokens.service.ts`:
- Import `users` alongside `emailTokens` from `'../db/schema.js'`.
- Replace `issue` with the version below, and add `retireUnused` after it.

```ts
  /**
   * A fresh token; the user's earlier unused tokens for this purpose stop working. Locking the
   * user's row first serializes concurrent calls for one user: the second waits, and its delete
   * then sees the first's committed token (rule 18).
   */
  async issue(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<string> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await this.retireUnused(tx, userId, purpose);
    const now = this.clock.now();
    const token = newToken(32);
    await tx.insert(emailTokens).values({
      id: newId(),
      userId,
      purpose,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  /** Deletes the user's unused tokens for a purpose, e.g. spare reset links once the password changed. */
  async retireUnused(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<void> {
    await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.consumedAt),
        ),
      );
  }
```

In `apps/api/src/auth/password-reset.service.ts`, inside `confirm`'s transaction, after `if (!userId) return false;`, add:

```ts
      // Any other live reset link would undo this reset for the next hour (rule 18).
      await this.tokens.retireUnused(tx, userId, 'reset_password');
```

In `apps/api/src/auth/account.service.ts`:
- Inject the token service: add `@Inject(EmailTokensService) private readonly tokens: EmailTokensService,` to the constructor, and import it from `'./email-tokens.service.js'`.
- Inside `changePassword`'s transaction, after the sessions delete, add:

```ts
      // A reset link sent before the change must not be able to undo it (rule 18).
      await this.tokens.retireUnused(tx, auth.user.id, 'reset_password');
```

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project integration test/email-tokens.int-spec.ts test/password-reset.int-spec.ts test/account.int-spec.ts test/signup.int-spec.ts
pnpm turbo run lint typecheck test --filter=@wishlist/api
```
Expected: all pass. The concurrency test sees one hash, the second token's.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/api/src/auth apps/api/test
git commit -F - <<'EOF'
fix(api): keep one live email token per purpose, and retire reset links

issue() now locks the user's row, so two concurrent requests can't each
keep a token. A completed reset and a password change both delete the
user's unused reset links, so a link sent earlier can't undo them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 4: Display names that can't hide text, and no name in the verification email

**Files:**
- Modify: `packages/contracts/src/auth.ts`, `apps/api/src/auth/auth-emails.ts`, `apps/api/src/auth/signup.service.ts`
- Test: `packages/contracts/src/auth.spec.ts`, `apps/api/src/auth/auth-emails.spec.ts`, `apps/api/test/signup.int-spec.ts`

**Interfaces:**
- Produces:
  - `DisplayNameSchema` rejects control and format characters, with the message `'Use visible characters only'`.
  - `verificationEmail(appOrigin: string, token: string)`.
  - `AuthEmails.verification(to: string, token: string)`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/display-names
```

- [ ] **Step 2: Write the failing tests**

In `packages/contracts/src/auth.spec.ts`, add `DisplayNameSchema` to the import from `'./auth.js'`, and add:

```ts
describe('DisplayNameSchema (rule 14)', () => {
  it.each(['Ada', 'Zoë', "O'Brien", 'Ada & Bob', '\u{1F469}‍\u{1F373} Ada'])('accepts %s', (name) => {
    expect(DisplayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ['a newline', 'Ada\nEvil'],
    ['a tab', 'Ada\tEvil'],
    ['a right-to-left override', 'Ada‮live'],
    ['a zero-width space', 'A​da'],
    ['a soft hyphen', 'A­da'],
  ])('rejects %s', (_label, name) => {
    const result = DisplayNameSchema.safeParse(name);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Use visible characters only');
  });
});
```

In `apps/api/src/auth/auth-emails.spec.ts`, replace the first two tests:

```ts
  it('links verification to /verify-email with the token, in text and in HTML', () => {
    const email = verificationEmail(ORIGIN, TOKEN);
    expect(email.subject).toBe(SUBJECTS.verification);
    expect(email.text).toContain(`${ORIGIN}/verify-email?token=${TOKEN}`);
    expect(email.html).toContain(`href="${ORIGIN}/verify-email?token=${TOKEN}"`);
    expect(email.text).not.toMatch(/^Hi\b/m);
  });

  it('escapes every value it puts into HTML', () => {
    const { html } = passwordResetEmail('https://x.example/?a=1&b=<2>', TOKEN);
    expect(html).toContain('https://x.example/?a=1&amp;b=&lt;2&gt;');
    expect(html).not.toContain('<2>');
  });
```

In `apps/api/test/signup.int-spec.ts`, add inside `describe('POST /auth/signup (spec §5)')`:

```ts
  it('leaves the unverified display name out of the verification email (rule 14)', async () => {
    await signUp(t, { ...ADA, displayName: 'evil.example/login' });
    const mail = lastEmail(t, ADA.email, SUBJECTS.verification);
    expect(mail.text).not.toContain('evil.example');
    expect(mail.html).not.toContain('evil.example');
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/contracts exec vitest run src/auth.spec.ts
pnpm --filter @wishlist/api exec vitest run --project unit src/auth/auth-emails.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts
```
Expected:
- The five hidden-character names are accepted.
- The link test fails: with the old signature, `verificationEmail(ORIGIN, TOKEN)` puts the token in the display-name slot, so the link reads `?token=undefined`. Vitest doesn't type-check, so this shows up as a wrong value.
- The email contains `evil.example`.

- [ ] **Step 4: Implement**

In `packages/contracts/src/auth.ts`, replace the `DisplayNameSchema` line:

```ts
/**
 * Control and format characters: newlines, tabs, bidirectional overrides, zero-width spaces. They
 * can make a name lie about what it says (rule 14). The zero-width joiner is allowed: emoji
 * sequences such as 👩‍🍳 need it.
 */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine(
    (name) => !HIDDEN_CHARACTERS.test(name.replaceAll('‍', '')),
    'Use visible characters only',
  );
```

In `apps/api/src/auth/auth-emails.ts`, replace `verificationEmail` and `AuthEmails.verification`:

```ts
/** No greeting: the display name is unverified, so it can't speak in Hanker's voice (rule 14). */
export function verificationEmail(appOrigin: string, token: string): Rendered {
  return compose(
    SUBJECTS.verification,
    ['Welcome to Hanker. Confirm your email address to start your wishlist.'],
    [{ label: 'Confirm your email', href: `${appOrigin}/verify-email?token=${token}` }],
    "This link expires in 24 hours. If you didn't sign up, ignore this email.",
  );
}
```

```ts
  verification(to: string, token: string): void {
    this.mailer.queue({ to, ...verificationEmail(this.env.APP_ORIGIN, token) });
  }
```

In `apps/api/src/auth/signup.service.ts`, the two calls become:
- `this.emails.verification(input.email, verifyToken);`
- `this.emails.verification(user.email, token);`

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/contracts build
pnpm turbo run lint typecheck test --filter=@wishlist/contracts --filter=@wishlist/api
pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts test/account.int-spec.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add packages/contracts/src apps/api/src apps/api/test
git commit -F - <<'EOF'
fix(api): reject hidden characters in display names, and stop greeting by them

A display name can no longer carry newlines, bidirectional overrides or
zero-width characters, which could make it lie about what it says. The
verification email no longer opens with the name, since nobody has
verified it yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 5: Turnstile operator errors, and the production email guard

**Files:**
- Modify: `apps/api/src/security/captcha.ts`, `apps/api/src/core/env.ts`
- Test: `apps/api/src/security/captcha.spec.ts`, `apps/api/src/core/env.spec.ts`

**Interfaces:**
- Produces:
  - `Env.VERCEL_ENV?: 'production' | 'preview' | 'development'`.
  - `parseEnv` refuses production with Turnstile and the log transport together.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/config-guards
```

- [ ] **Step 2: Write the failing tests**

In `apps/api/src/security/captcha.spec.ts`:
- Delete the `['an internal error', …]` row from the `it.each` on line 66. The table below covers it.
- Add:

```ts
  it.each(['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error'])(
    'is unavailable, and says why, when Cloudflare reports %s: the fault is ours, not the visitor’s',
    async (code) => {
      const { fn } = fakeFetch(() => json({ success: false, 'error-codes': [code] }));
      expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
        'unavailable',
      );
      expect(warn).toHaveBeenCalledWith(`captcha unavailable: Cloudflare reported ${code}`);
    },
  );

  it.each(['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response'])(
    'fails the visitor when Cloudflare reports %s',
    async (code) => {
      const { fn } = fakeFetch(() => json({ success: false, 'error-codes': [code] }));
      expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
        'failed',
      );
    },
  );
```

If the second `internal-error` row (line 87, a logging test) duplicates the new table, leave it alone: it asserts the log line.

In `apps/api/src/core/env.spec.ts`, add:

```ts
  it('refuses to only log account emails in production once sign-up can send them (rule 15)', () => {
    const live = { ...base, VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: 'x' };
    expect(() => parseEnv(live)).toThrow(/EMAIL_TRANSPORT/);
    expect(
      parseEnv({ ...live, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }).EMAIL_TRANSPORT,
    ).toBe('resend');
  });

  it('still boots dark production, and previews on the log transport', () => {
    expect(parseEnv({ ...base, VERCEL_ENV: 'production' }).EMAIL_TRANSPORT).toBe('log');
    expect(
      parseEnv({ ...base, VERCEL_ENV: 'preview', TURNSTILE_SECRET_KEY: 'x' }).EMAIL_TRANSPORT,
    ).toBe('log');
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/security/captcha.spec.ts src/core/env.spec.ts
```
Expected:
- `missing-input-secret`, `invalid-input-secret` and `bad-request` come back `failed`.
- The production guard doesn't throw.

- [ ] **Step 4: Implement**

In `apps/api/src/security/captcha.ts`:
- Add above the class:

```ts
/** Siteverify errors that mean our request is wrong, not the visitor's: an operator must act (rule 16). */
const OPERATOR_ERRORS = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);
```

- Replace the last three lines of `verify` (from `if (body.data.success)`):

```ts
    if (body.data.success) return 'passed';
    const operatorError = body.data['error-codes'].find((code) => OPERATOR_ERRORS.has(code));
    return operatorError ? this.unavailable(`Cloudflare reported ${operatorError}`) : 'failed';
```

In `apps/api/src/core/env.ts`:
- Add to the object schema, after `GIT_SHA`:

```ts
    /** Set by Vercel at runtime: production, preview or development. Unset everywhere else. */
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
```

- Add to `superRefine`, after the `RESEND_API_KEY` check:

```ts
    // The day sign-up opens, the log transport would swallow every account email (rule 15).
    if (env.VERCEL_ENV === 'production' && env.TURNSTILE_SECRET_KEY && env.EMAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message:
          'must be resend in production once TURNSTILE_SECRET_KEY is set: with log, account emails would only be written to the logs',
      });
    }
```

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/security/captcha.spec.ts src/core/env.spec.ts
pnpm turbo run lint typecheck test --filter=@wishlist/api
```
Expected: all pass, including the existing `applies defaults` test, which never sets `VERCEL_ENV`.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/api/src
git commit -F - <<'EOF'
fix(api): treat Turnstile secret errors as unavailable, and guard production email

A bad or missing Turnstile secret now reads as "unavailable" with a
warning, not as every visitor failing the challenge. The API also refuses
to boot in production when Turnstile is configured but email would only
be logged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 6: Per-IP keys on the /64, and the breach check before the address is charged

**Files:**
- Modify: `apps/api/src/rate-limit/keys.ts`, `apps/api/src/auth/email-gate.ts`, `apps/api/src/auth/signup.service.ts`, `apps/api/src/auth/login.service.ts`
- Test: `apps/api/src/rate-limit/keys.spec.ts`, `apps/api/test/signup.int-spec.ts`

**Interfaces:**
- Produces:
  - `ipIdentity(ip: string): string`.
  - `ipRateLimitKey(scope: string, ip: string): string`.
  - `EmailGate.screen(turnstileToken, ip)` and `EmailGate.chargeAddress(email)`.
  - `EmailGate.admit` is now those two in order.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/ip-keys
```

- [ ] **Step 2: Write the failing tests**

In `apps/api/src/rate-limit/keys.spec.ts`, change the import to `import { ipIdentity, ipRateLimitKey, rateLimitKey } from './keys.js';` and add:

```ts
describe('ipIdentity (rule 13)', () => {
  it('keeps an IPv4 address whole', () => {
    expect(ipIdentity('203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(ipIdentity('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipIdentity('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys IPv6 by its /64, however the address is written', () => {
    expect(ipIdentity('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('2001:DB8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('::1')).toBe('0:0:0:0::/64');
    expect(ipIdentity('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipIdentity('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
  });

  it('passes through a value the API could not resolve', () => {
    expect(ipIdentity('unknown')).toBe('unknown');
  });
});

describe('ipRateLimitKey', () => {
  it('gives one /64 one key, and a neighbouring /64 another', () => {
    expect(ipRateLimitKey('mail:ip', '2001:db8:1:2::1')).toBe(
      ipRateLimitKey('mail:ip', '2001:db8:1:2:ffff::9'),
    );
    expect(ipRateLimitKey('mail:ip', '2001:db8:1:2::1')).not.toBe(
      ipRateLimitKey('mail:ip', '2001:db8:1:3::1'),
    );
  });
});
```

In `apps/api/test/signup.int-spec.ts`, add inside `describe('POST /auth/signup (spec §5)')`:

```ts
  it("doesn't charge an address's hourly budget for a breached password (rule 12)", async () => {
    t.breaches.breached.add('password12345');
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await client(t.app).post('/auth/signup', { ...SIGNUP, password: 'password12345' });
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.PASSWORD_BREACHED]);
    }
    expect((await client(t.app).post('/auth/signup', SIGNUP)).status).toBe(202);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/rate-limit/keys.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts
```
Expected:
- `ipIdentity` is not exported.
- The fourth breached attempt answers `429`, not `400`.

- [ ] **Step 4: Implement**

In `apps/api/src/rate-limit/keys.ts`, add `import { isIP } from 'node:net';` at the top and append:

```ts
/**
 * The part of an IP address that identifies one client for a per-IP limit (rule 13). An IPv6 host
 * usually holds a whole /64, so IPv6 is keyed by its first 64 bits. An IPv4-mapped IPv6 address is
 * keyed as the IPv4 address it carries.
 */
export function ipIdentity(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const bare = ip.split('%')[0] ?? ip;
  if (isIP(bare) !== 6) return ip;
  return `${expandIpv6(bare).slice(0, 4).join(':')}::/64`;
}

/** A rate-limit key for a per-IP limit: the scope plus the hashed ipIdentity. */
export function ipRateLimitKey(scope: string, ip: string): string {
  return rateLimitKey(scope, ipIdentity(ip));
}

/** The eight groups of a valid IPv6 address, lowercase, without leading zeros. */
function expandIpv6(ip: string): string[] {
  const [head = '', tail] = ip.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':').flatMap(dottedToGroups));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => '0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16).toString(16));
}

/** A dotted IPv4 tail (`64:ff9b::203.0.113.7`) is two groups. */
function dottedToGroups(group: string): string[] {
  if (!group.includes('.')) return [group];
  const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}
```

In `apps/api/src/auth/email-gate.ts`:
- Import `ipRateLimitKey` beside `rateLimitKey`.
- Replace `admit` with:

```ts
  /** Resend and reset-request: screen, then charge the address. */
  async admit(email: string, turnstileToken: string, ip: string): Promise<void> {
    await this.screen(turnstileToken, ip);
    await this.chargeAddress(email);
  }

  /** The per-IP limit, then Turnstile. Nothing here touches the address's budget. */
  async screen(turnstileToken: string, ip: string): Promise<void> {
    await this.limiter.enforce(ipRateLimitKey('mail:ip', ip), MAIL_PER_IP);
    const verdict = await this.captcha.verify(turnstileToken, ip);
    if (verdict === 'unavailable') throw captchaUnavailable();
    if (verdict === 'failed') throw captchaFailed();
  }

  /** One email against the address's hourly budget (spec §6.6). */
  async chargeAddress(email: string): Promise<void> {
    await this.limiter.enforce(rateLimitKey('mail:email', email), MAIL_PER_EMAIL);
  }
```

In `apps/api/src/auth/signup.service.ts`, the first two lines of `signup` become:

```ts
    await this.gate.screen(input.turnstileToken, ip);
    // Before the address is charged, so a breached password doesn't use up its emails (rule 12).
    await this.passwordPolicy.assertNotBreached(input.password);
    await this.gate.chargeAddress(input.email);
```

In `apps/api/src/auth/login.service.ts`:
- Import `ipRateLimitKey` beside `rateLimitKey`.
- The per-IP line becomes `await this.limiter.enforce(ipRateLimitKey('login:ip', ip), LOGIN_PER_IP);`.

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/rate-limit/keys.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts test/login.int-spec.ts test/password-reset.int-spec.ts
pnpm turbo run lint typecheck test --filter=@wishlist/api
```
Expected: all pass, including the existing per-IP and per-address limit tests.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/api/src apps/api/test
git commit -F - <<'EOF'
fix(api): key per-IP limits on the IPv6 /64, and check breaches before the mail budget

One IPv6 host usually holds a /64, so per-IP limits now key on it, and
IPv4-mapped addresses key as IPv4. Sign-up checks for a breached password
before charging the address's hourly email budget.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 7: Password writes that a concurrent reset can't undo

**Files:**
- Modify: `apps/api/src/auth/sessions.service.ts`, `apps/api/src/auth/login.service.ts`, `apps/api/src/auth/account.service.ts`
- Test: `apps/api/test/sessions.int-spec.ts`, `apps/api/test/account.int-spec.ts`

**Interfaces:**
- Consumes: `EmailTokensService.retireUnused` (Task 3).
- Produces:
  - `SessionsService.create(userId: string, verifiedPasswordHash: string): Promise<{ token: string } | null>`.
  - `AccountService.changePassword` re-checks under lock.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/password-races
```

- [ ] **Step 2: Write the failing tests**

In `apps/api/test/sessions.int-spec.ts`:
- The `signedIn` helper's create call becomes `await t.app.get(SessionsService).create(userId, 'x')`. Its user's `password_hash` is `'x'`.
- Add:

```ts
  it('refuses to create a session when the password changed after it was verified (rule 17)', async () => {
    const userId = newId();
    await db.pool.query(
      `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'current', 'Ada')`,
      [userId],
    );
    await expect(t.app.get(SessionsService).create(userId, 'stale')).resolves.toBeNull();
    const { rows } = await db.pool.query<{ n: string }>('select count(*) as n from sessions');
    expect(Number(rows[0]?.n)).toBe(0);
  });
```

In `apps/api/test/account.int-spec.ts`:
- Add `afterEach` and `vi` to the vitest import, and `afterEach(() => { vi.restoreAllMocks(); });` beside the other hooks.
- Add inside `describe('POST /me/password (spec §5)')`:

```ts
  // The breach check runs after the current password is confirmed and before the new one is
  // written: the test changes the world there, as a concurrent reset would.
  it('refuses the change if the password changed meanwhile, and keeps the newer one (rule 17)', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    vi.spyOn(t.breaches, 'isBreached').mockImplementationOnce(async () => {
      await db.pool.query(`update users set password_hash = 'changed elsewhere'`);
      return false;
    });

    const res = await change(cookie, ADA.password);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.INVALID_CREDENTIALS]);
    const { rows } = await db.pool.query<{ password_hash: string }>('select password_hash from users');
    expect(rows[0]?.password_hash).toBe('changed elsewhere');
  });

  it('refuses the change if this session was revoked meanwhile (rule 17)', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    vi.spyOn(t.breaches, 'isBreached').mockImplementationOnce(async () => {
      await db.pool.query('delete from sessions');
      return false;
    });

    const res = await change(cookie, ADA.password);
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
    expect((await login(ADA.password)).status).toBe(204);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project integration test/sessions.int-spec.ts test/account.int-spec.ts
```
Expected:
- `create(userId, 'stale')` resolves to a token, not `null`. JavaScript ignores the extra argument, and Vitest doesn't type-check.
- Both password-change tests answer `204`.

- [ ] **Step 4: Implement**

In `apps/api/src/auth/sessions.service.ts`, replace `create`:

```ts
  /**
   * A new session, but only if the password is still the one just verified (rule 17). The share
   * lock holds a concurrent reset or change back until this session exists, and that change then
   * revokes it; a change that committed first makes this return null.
   */
  async create(userId: string, verifiedPasswordHash: string): Promise<{ token: string } | null> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .for('share');
      if (user?.passwordHash !== verifiedPasswordHash) return null;
      const now = this.clock.now();
      const token = newToken(32);
      await tx.insert(sessions).values({
        id: hashToken(token),
        userId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      });
      return { token };
    });
  }
```

In `apps/api/src/auth/login.service.ts`, the last line of `login` becomes:

```ts
    // Null when a reset or change replaced the password since it was read (rule 17).
    const session = await this.sessions.create(user.id, user.passwordHash);
    if (!session) throw invalidCredentials();
    return session;
```

In `apps/api/src/auth/account.service.ts`:
- Import `unauthenticated` from `'../http/errors.js'`.
- `confirmPassword` returns the hash it verified: its signature becomes `private async confirmPassword(auth: AuthContext, password: string): Promise<string>`, and it ends with `return row.passwordHash;`.
- Replace `changePassword`:

```ts
  /** Revokes every other session and keeps this one (spec §6.1), in the same transaction. */
  async changePassword(auth: AuthContext, input: ChangePasswordRequest): Promise<void> {
    const verifiedHash = await this.confirmPassword(auth, input.currentPassword);
    await this.passwordPolicy.assertNotBreached(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      // Re-check under the row lock: a reset or another change may have landed while this one
      // hashed, and this request's own session may have been revoked meanwhile (rule 17).
      const [user] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, auth.user.id))
        .for('update');
      if (user?.passwordHash !== verifiedHash) throw wrongPassword();
      const [own] = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, auth.sessionId));
      if (!own) throw unauthenticated();

      await tx
        .update(users)
        .set({ passwordHash, updatedAt: this.clock.now() })
        .where(eq(users.id, auth.user.id));
      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)));
      // A reset link sent before the change must not be able to undo it (rule 18).
      await this.tokens.retireUnused(tx, auth.user.id, 'reset_password');
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project integration
pnpm turbo run lint typecheck test --filter=@wishlist/api
```
Expected: the whole integration suite passes, with no warnings or errors printed by the new tests.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/api/src apps/api/test
git commit -F - <<'EOF'
fix(api): re-check the password under lock before creating a session or changing it

Login creates its session only if the password is still the one it
verified, and a password change re-checks the hash and its own session
under the row lock. A concurrent reset can no longer be undone by a login
or a change that started before it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

- [ ] **Step 7: Submit the stack and check it**

Run:
```bash
pnpm turbo run lint typecheck test build
pnpm test:integration
gh stack submit --open
```
Give each PR its commit's title with `gh pr edit <n> --title "…"`. A layer with several commits otherwise gets its branch name.

Expected: every PR's checks and preview pass. `build-api` is the Vercel type check.

---

### Task 8: ⏸ CHECKPOINT: merge `auth-hardening` and verify production (still dark)

**Files:** none. Run by the controller with Ted (Plan 2a ruling P1).

- [ ] **Step 1: Ted merges the stack**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 2: Verify production**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
APP=$(gh variable get APP_PRODUCTION_ORIGIN)
API=$(gh variable get API_PRODUCTION_ORIGIN)
curl -fsS "$APP/api/health"; echo
curl -s -o /dev/null -w 'me: %{http_code}\n' "$APP/api/me"
curl -s -X POST "$APP/api/auth/signup" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase","displayName":"Probe","turnstileToken":"x"}' | jq -r .code
curl -s -X POST "$APP/api/auth/login" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase"}' | jq -r .code
curl -s -o /dev/null -w 'cron without the secret: %{http_code}\n' "$API/api/internal/cron/daily"
```

Expected:
- **Deploy:** 7/7 jobs pass.
- **Health:** reports the merge SHA.
- **`me: 401`.**
- **Sign-up:** `CAPTCHA_UNAVAILABLE`, so it's still dark.
- **Login:** `INVALID_CREDENTIALS`, not `FORBIDDEN_ORIGIN`. That proves `APP_ORIGIN` matches `$APP`, which is `https://hanker.dev` once Task 1 step 5 is done.
- **Cron without the secret:** `401`.

---
### Task 9: The Warm Editorial theme, its UI kit, and the Hanker landing page

**Files:**
- Modify: `apps/web/package.json` (dependencies), `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Create:
  - `apps/web/src/app/fonts.ts`, `apps/web/src/app/not-found.tsx`, `apps/web/src/app/error.tsx`
  - `apps/web/src/lib/utils.ts` and `apps/web/src/lib/utils.spec.ts`
  - `apps/web/src/components/ui/button.tsx`, `input.tsx`, `label.tsx`, `field.tsx`, `card.tsx`, `notice.tsx`
  - `apps/web/src/components/site-header.tsx`, `apps/web/src/components/collage.tsx`
- Test: `e2e/tests/local/landing.spec.ts`, `e2e/tests/smoke/smoke.spec.ts`

**Interfaces:**
- Produces:
  - `cn(...inputs: ClassValue[]): string`.
  - `Button` (`variant: 'primary' | 'secondary' | 'strong' | 'link'`, `size: 'default' | 'compact'`) and `buttonVariants`.
  - `Input`, `Label` and `Card`.
  - `Field({ id, label, hint?, error?, children: (control: FieldControlProps) => ReactNode })`.
  - `Notice({ tone: 'success' | 'error' | 'info', children, className? })`.
  - `SiteHeader({ action?: 'login' | 'signup' | 'none' })` and `Collage()`.
  - Tailwind utilities from the theme: `bg-background`, `text-foreground`, `bg-card`, `bg-primary`, `text-primary-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `bg-success-wash`, `text-success-foreground`, `text-destructive`, `font-display`, `font-sans`, `rounded-card`, `rounded-control`.

- [ ] **Step 1: Start the web stack**

```bash
git switch main && git pull --ff-only
gh stack init web/theme
pnpm --filter @wishlist/web add -E class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.7.0
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/utils.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('drops falsy values, and a later Tailwind class wins over an earlier one', () => {
    expect(cn('px-4 text-sm', false, undefined, 'px-6')).toBe('text-sm px-6');
  });
});
```

In `e2e/tests/local/landing.spec.ts`, replace the first test ("landing page reports a healthy API and database") with the test below. Keep the two `/api/*` rewrite tests.

```ts
test('the landing page introduces Hanker and links to sign-up and login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Hanker');
  await expect(
    page.getByRole('heading', { level: 1, name: 'One list. One link. No doubled-up gifts.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your list' })).toHaveAttribute('href', '/signup');
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
});
```

In `e2e/tests/smoke/smoke.spec.ts`, the last test becomes:

```ts
test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'One list. One link. No doubled-up gifts.' }),
  ).toBeVisible();
});
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null
pnpm --filter @wishlist/web exec vitest run src/lib/utils.spec.ts
pnpm test:e2e landing.spec.ts
```
Expected:
- `./utils` doesn't exist.
- The landing test can't find the heading. The title is `Wishlist`.

- [ ] **Step 4: Implement the theme and type**

`apps/web/src/app/globals.css`, in full:

```css
@import 'tailwindcss';

/*
 * Hanker's Warm Editorial palette (Ted, 2026-10-10; Plan 2b's theme table). The names follow
 * shadcn/ui's semantic tokens, so components copied from it work unchanged. Terracotta (--primary)
 * is for actions only: at 2.9:1 on sand it can't carry text, so text on it is espresso.
 */
:root {
  --background: #faf7f2;
  --foreground: #1e1b18;
  --card: #ffffff;
  --card-foreground: #1e1b18;
  --primary: #ff5a4d;
  --primary-foreground: #1e1b18;
  --muted-foreground: #5c554e;
  --border: #1e1b18;
  --input: #8c847b;
  --ring: #1e1b18;
  --success: #6b8e78;
  --success-foreground: #3f5a49;
  --success-wash: #e6eee8;
  --destructive: #b42318;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-success-wash: var(--success-wash);
  --color-destructive: var(--destructive);
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-instrument-serif), ui-serif, Georgia, serif;
  --radius-card: 16px;
  --radius-control: 12px;
}

@layer base {
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }

  a {
    text-underline-offset: 4px;
  }
}

/* Motion is decoration here: people who ask for less get none (spec §7, WCAG 2.2 AA). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
```

`apps/web/src/app/fonts.ts`:

```ts
import { Geist, Instrument_Serif } from 'next/font/google';

/** Geist for everything people read and use; Instrument Serif for the wordmark and headings. */
export const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});
```

`apps/web/src/app/layout.tsx`, in full:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { geist, instrumentSerif } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Hanker', template: '%s | Hanker' },
  description: 'One list. One link. No doubled-up gifts.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

`apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; a later Tailwind class overrides an earlier one (shadcn/ui's helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Implement the UI kit**

These are hand-copied in shadcn/ui's style, onto the theme's tokens (rule 19).

`apps/web/src/components/ui/button.tsx`:

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Terracotta for the main action, with espresso text (5.5:1); white on terracotta fails AA. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control px-5 text-[15px] font-semibold no-underline transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[0_8px_18px_rgba(30,27,24,0.16)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground',
        secondary: 'border border-border bg-card text-foreground',
        strong: 'bg-foreground text-background',
        link: 'px-0 font-medium underline hover:translate-y-0 hover:shadow-none',
      },
      size: {
        default: 'min-h-12',
        compact: 'min-h-11 px-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
```

`apps/web/src/components/ui/input.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-control border-[1.5px] border-input bg-card px-3.5 text-[17px] text-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/src/components/ui/label.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-[15px] font-semibold', className)} {...props} />;
}
```

`apps/web/src/components/ui/field.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Label } from './label';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * A label, its control, and the control's hint and error, linked for screen readers. The error
 * comes first in aria-describedby, so it's read before the hint.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/ui/card.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-card border border-border bg-card p-5 sm:p-7', className)}
      {...props}
    />
  );
}
```

`apps/web/src/components/ui/notice.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A short message about what just happened. Success is sage with a check. An error is announced
 * at once (role="alert"); anything else politely (role="status").
 */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-control px-3.5 py-2.5 text-[15px] leading-snug',
        tone === 'success' && 'bg-success-wash font-medium text-success-foreground',
        tone === 'error' && 'border border-destructive bg-card font-medium text-destructive',
        tone === 'info' && 'border border-border bg-card',
        className,
      )}
    >
      {tone === 'success' ? (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            fill="none"
            stroke="var(--success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <div>{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Implement the header, the collage and the pages**

`apps/web/src/components/site-header.tsx`:

```tsx
import Link from 'next/link';

const LINK = 'inline-flex min-h-11 items-center text-[15px] underline';

/** The signed-out header: the wordmark, and the one account link the page needs. */
export function SiteHeader({ action = 'login' }: { action?: 'login' | 'signup' | 'none' }) {
  return (
    <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 pt-6 sm:px-7">
      <Link href="/" className="font-display text-[34px] leading-none no-underline">
        Hanker
      </Link>
      {action === 'login' ? (
        <Link href="/login" className={LINK}>
          Log in
        </Link>
      ) : null}
      {action === 'signup' ? (
        <Link href="/signup" className={LINK}>
          Create an account
        </Link>
      ) : null}
    </header>
  );
}
```

`apps/web/src/components/collage.tsx`:

```tsx
/** A small board of example gifts. Decoration only: hidden from assistive tech, and on phones. */
const TILES = [
  { place: 'col-[1/4] row-[1/5]', tone: 'bg-[#d8ccbe]', label: 'Linen apron' },
  { place: 'col-[4/7] row-[1/4]', tone: 'bg-[#c3cdb5]', label: 'Fig tree' },
  { place: 'col-[4/7] row-[4/7]', tone: 'bg-[#e2d3c6]', label: 'Camp mug' },
  { place: 'col-[1/3] row-[5/8]', tone: 'bg-[#bfc6b6]', label: 'Wool socks' },
  { place: 'col-[3/4] row-[5/8]', tone: 'bg-[#c9c4b4]', label: null },
  { place: 'col-[1/4] row-[8/9]', tone: 'bg-[#ddd3c7]', label: null },
] as const;

export function Collage() {
  return (
    <div
      aria-hidden="true"
      className="hidden min-w-0 flex-[1_1_480px] auto-rows-[72px] grid-cols-6 gap-3.5 md:grid"
    >
      {TILES.map((tile, index) => (
        <div key={index} className={`relative rounded-card ${tile.place} ${tile.tone}`}>
          {tile.label ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-card px-2.5 py-1 text-[13px]">
              {tile.label}
            </span>
          ) : null}
        </div>
      ))}
      <div className="col-[4/7] row-[7/9] flex items-end rounded-card border border-border bg-card p-4">
        <span className="font-display text-[28px] italic leading-none">Pottery class for two</span>
      </div>
    </div>
  );
}
```

`apps/web/src/app/page.tsx`, in full:

```tsx
import Link from 'next/link';
import { Collage } from '@/components/collage';
import { SiteHeader } from '@/components/site-header';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-7">
        <div className="mt-14 flex flex-wrap items-start gap-x-16 gap-y-12">
          <Collage />
          <div className="min-w-0 max-w-[460px] flex-[1_1_340px]">
            <h1 className="font-display text-[clamp(2.75rem,6vw,4rem)] leading-[0.98] tracking-[-0.01em]">
              One list. One link. No doubled-up gifts.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Add the things you’d love, then share your link with family and friends. They claim
              gifts quietly, so nobody buys the same thing twice, and you never see who’s getting
              what.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={buttonVariants()}>
                Create your list
              </Link>
              <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
                Log in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
```

`apps/web/src/app/not-found.tsx`:

```tsx
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export default function NotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <h1 className="font-display text-5xl">This page isn’t here.</h1>
        <p className="mt-4 text-muted-foreground">The link may be mistyped, or the page has moved.</p>
        <p className="mt-8">
          <Link href="/" className="underline">
            Go to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
```

`apps/web/src/app/error.tsx` (Next 16 passes `retry`):

```tsx
'use client';

import { Button } from '@/components/ui/button';

/** Shown when a page throws. It never shows the error's own text (spec §9). */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
      <h1 className="font-display text-5xl">Something went wrong.</h1>
      <p className="mt-4 text-muted-foreground">
        Try again. If it keeps happening, come back in a few minutes.
      </p>
      <Button className="mt-8" onClick={() => retry()}>
        Try again
      </Button>
    </main>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build --filter=@wishlist/web
pnpm test:e2e landing.spec.ts a11y.spec.ts
```
Expected:
- All pass. `a11y.spec.ts` (axe on `/`) passes on the new landing page.
- If lint rejects a snippet, make the minimal lint-clean equivalent and say so in the report.

- [ ] **Step 8: Look at it**

Open the landing page in a production build (`pnpm test:e2e` leaves none running; use `pnpm dev` and http://localhost:3000). Compare it with the "Hanker theme" page on the canvas:
- sand background;
- Instrument Serif headline;
- terracotta button with espresso text;
- collage hidden below 768px.

Note any differences in the report. Don't redesign.

- [ ] **Step 9: Commit**

```bash
pnpm format:check
git add apps/web pnpm-lock.yaml e2e/tests
git commit -F - <<'EOF'
feat(web): apply the Warm Editorial theme and give Hanker its landing page

Sand, espresso, terracotta and sage tokens on shadcn/ui's semantic names,
Instrument Serif and Geist, and a small kit of hand-copied components
(button, input, label, field, card, notice). The landing page introduces
Hanker and links to sign-up and login; the API-status line goes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 10: The proxy: CSP nonces, session redirects, and robots.txt

**Files:**
- Create: `apps/web/src/proxy.ts`, `apps/web/src/lib/csp.ts`, `apps/web/src/lib/auth-routing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/robots.ts`, `e2e/tests/local/security.spec.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/lib/csp.spec.ts`, `apps/web/src/lib/auth-routing.spec.ts`

**Interfaces:**
- Produces:
  - `contentSecurityPolicy({ nonce: string; turnstile: boolean; dev: boolean }): string`.
  - `usesTurnstile(pathname: string): boolean`.
  - `authRedirect(url: URL, hasSessionCookie: boolean): string | null`.
  - `SESSION_COOKIE`.
  - The request header `x-nonce` on every page request.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add web/proxy
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/csp.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, usesTurnstile } from './csp';

describe('contentSecurityPolicy (spec §6.9, rule 4)', () => {
  it('locks a page to its own origin and this request’s nonce', () => {
    expect(contentSecurityPolicy({ nonce: 'abc', turnstile: false, dev: false })).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it('lets a Turnstile page load the challenge script and its frame', () => {
    const csp = contentSecurityPolicy({ nonce: 'abc', turnstile: true, dev: false });
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com;",
    );
    expect(csp).toContain('; frame-src https://challenges.cloudflare.com;');
  });

  it("adds 'unsafe-eval' in development only, for React's dev overlays", () => {
    expect(contentSecurityPolicy({ nonce: 'abc', turnstile: false, dev: true })).toContain(
      "'strict-dynamic' 'unsafe-eval';",
    );
  });
});

describe('usesTurnstile (rule 6)', () => {
  it.each([
    ['/signup', true],
    ['/verify-email', true],
    ['/reset-password', true],
    ['/reset-password/confirm', true],
    ['/login', false],
    ['/', false],
    ['/settings', false],
    ['/signups', false],
  ])('%s → %s', (path, expected) => {
    expect(usesTurnstile(path)).toBe(expected);
  });
});
```

`apps/web/src/lib/auth-routing.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { authRedirect } from './auth-routing';

const at = (path: string) => new URL(path, 'https://hanker.dev');

describe('authRedirect (spec §6.1, rule 8)', () => {
  it.each([
    ['/list', false, '/login?next=%2Flist'],
    ['/settings', false, '/login?next=%2Fsettings'],
    ['/settings?tab=password', false, '/login?next=%2Fsettings%3Ftab%3Dpassword'],
    ['/', true, '/list'],
    ['/list', true, null],
    ['/login', true, null],
    ['/', false, null],
    ['/listing', false, null],
    ['/signup', false, null],
  ])('%s with a cookie: %s → %s', (path, hasCookie, expected) => {
    expect(authRedirect(at(path), hasCookie)).toBe(expected);
  });
});
```

`e2e/tests/local/security.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const nonceIn = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

test('a page carries a nonce CSP that its own scripts satisfy (spec §6.9)', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  const res = await page.goto('/');
  const csp = res?.headers()['content-security-policy'];
  const nonce = nonceIn(csp);
  expect(nonce).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('challenges.cloudflare.com');

  const scriptNonces = await page
    .locator('script[nonce]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));
  await page.waitForLoadState('networkidle');
  expect(violations).toEqual([]);
});

test('every request gets a fresh nonce', async ({ request }) => {
  const first = nonceIn((await request.get('/')).headers()['content-security-policy']);
  const second = nonceIn((await request.get('/')).headers()['content-security-policy']);
  expect(first).not.toBe(second);
});

test('only the Turnstile pages allow Cloudflare’s challenge (rule 6)', async ({ request }) => {
  const cspOf = async (path: string) =>
    (await request.get(path)).headers()['content-security-policy'] ?? '';
  expect(await cspOf('/signup')).toContain('frame-src https://challenges.cloudflare.com');
  expect(await cspOf('/login')).not.toContain('challenges.cloudflare.com');
});

test('signed-out visitors to account pages go to login, keeping where they were going', async ({
  request,
}) => {
  for (const path of ['/list', '/settings']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
  }
});

test('a visitor with a session cookie skips the landing page', async ({ request }) => {
  const res = await request.get('/', {
    maxRedirects: 0,
    headers: { cookie: `__Host-session=${'A'.repeat(43)}` },
  });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toMatch(/\/list$/);
});

test('robots.txt keeps auth and account pages out of search (spec §6.7)', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  for (const path of ['/verify-email', '/reset-password', '/list', '/settings']) {
    expect(body).toContain(`Disallow: ${path}`);
  }
});
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run src/lib/csp.spec.ts src/lib/auth-routing.spec.ts
pnpm test:e2e security.spec.ts
```
Expected:
- The modules don't exist.
- No `content-security-policy` header, no redirects, and `robots.txt` is a 404.

- [ ] **Step 4: Implement**

`apps/web/src/lib/session.ts`:

```ts
/**
 * The API's session cookie (apps/api/src/auth/session-cookie.ts). The proxy only checks that it
 * exists (spec §6.1); the account E2E tests fail if the two names drift apart (rule 24).
 */
export const SESSION_COOKIE = '__Host-session';
```

`apps/web/src/lib/csp.ts`:

```ts
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const TURNSTILE_PATHS = ['/signup', '/verify-email', '/reset-password'];

/** Pages that render the Turnstile widget, and so may load Cloudflare's script and frame (rule 6). */
export function usesTurnstile(pathname: string): boolean {
  return TURNSTILE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The Content-Security-Policy for one page request (spec §6.9 as amended by rule 4). */
export function contentSecurityPolicy({
  nonce,
  turnstile,
  dev,
}: {
  nonce: string;
  turnstile: boolean;
  dev: boolean;
}): string {
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
    ...(dev ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // React and next/font set style attributes, which a nonce can't cover (rule 4).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
```

`apps/web/src/lib/auth-routing.ts`:

```ts
const SIGNED_IN_ONLY = ['/list', '/settings'];

/**
 * Where the proxy sends a request instead, judged only by whether the session cookie exists
 * (spec §6.1). The API makes every real decision, and the pages send a stale cookie to /login.
 * /login itself is never redirected: a stale cookie would loop (rule 8).
 */
export function authRedirect(url: URL, hasSessionCookie: boolean): string | null {
  const path = url.pathname;
  const signedInOnly = SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`));
  if (signedInOnly && !hasSessionCookie) {
    return `/login?next=${encodeURIComponent(path + url.search)}`;
  }
  if (path === '/' && hasSessionCookie) return '/list';
  return null;
}
```

`apps/web/src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { authRedirect } from '@/lib/auth-routing';
import { contentSecurityPolicy, usesTurnstile } from '@/lib/csp';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Runs before every page. It sends signed-out visitors away from account pages (spec §6.1), then
 * gives the page a fresh CSP nonce. Next.js reads the nonce from the request's CSP header and
 * applies it to its own scripts (spec §6.9).
 */
export function proxy(request: NextRequest) {
  const redirect = authRedirect(request.nextUrl, request.cookies.has(SESSION_COOKIE));
  if (redirect) return NextResponse.redirect(new URL(redirect, request.url));

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    nonce,
    turnstile: usesTurnstile(request.nextUrl.pathname),
    dev: process.env.NODE_ENV === 'development',
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the /api rewrite, static files, or robots.txt.
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
```

`apps/web/src/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';

/** Auth, token and account pages stay out of search (spec §6.7). Plan 3 adds /s/ and /c/. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/verify-email', '/reset-password', '/list', '/settings'] },
  };
}
```

In `apps/web/src/app/layout.tsx`:
- Add `import { connection } from 'next/server';`.
- Make the layout async:

```tsx
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, so each gets the proxy's nonce (rule 5).
  await connection();
  return (
```
The rest of the JSX is unchanged.

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build --filter=@wishlist/web
pnpm test:e2e security.spec.ts landing.spec.ts a11y.spec.ts
```
Expected: all pass. The first security test finds no CSP violation in the console, so Next's own scripts carry the nonce.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/web e2e/tests
git commit -F - <<'EOF'
feat(web): add the proxy: a nonce CSP on every page, and session redirects

Every page gets a fresh nonce and the CSP from spec §6.9 (style-src keeps
'unsafe-inline' for style attributes; Turnstile pages may load Cloudflare's
challenge). Account pages send signed-out visitors to login with a next
path, and / sends anyone with a session cookie to /list. robots.txt keeps
auth and account pages out of search.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 11: Web plumbing: the browser client, error copy, safe `next`, and Turnstile

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`, `apps/web/next.config.ts`, `apps/web/package.json` (`typecheck` script), `apps/web/turbo.json`, `apps/web/.env.development`
- Create: `apps/web/src/lib/browser-api.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/lib/form-errors.ts`, `apps/web/src/lib/safe-next.ts`, `apps/web/src/lib/nonce.ts`, `apps/web/src/lib/strip-token.ts`, `apps/web/src/components/turnstile.tsx`
- Modify (CI and E2E): `.github/workflows/ci.yml`, `.github/workflows/preview.yml`, `.github/workflows/deploy.yml`, `e2e/playwright.config.ts`, `scripts/e2e.sh`
- Test: `apps/web/src/lib/api-client.spec.ts`, `apps/web/src/lib/messages.spec.ts`, `apps/web/src/lib/form-errors.spec.ts`, `apps/web/src/lib/safe-next.spec.ts`, `apps/web/next.config.spec.ts`

**Interfaces:**
- Produces:
  - `NoContentSchema` and `delete(path, schema, body?)` on the API client.
  - `browserApi: ApiClient`.
  - `ERROR_MESSAGES`, `errorMessage(error: unknown): string`, `fieldErrors(error: unknown): Record<string, string>` and `hasCode(error: unknown, code: string): boolean`.
  - `formErrorMap`.
  - `safeNext(value: string | null | undefined, fallback?: string): string`.
  - `cspNonce(): Promise<string | undefined>` (server only).
  - `stripTokenFromUrl(): void`.
  - `Turnstile({ nonce, onToken, resetKey })`.
  - `process.env.TURNSTILE_SITE_KEY`, inlined at build.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add web/plumbing
pnpm --filter @wishlist/web add -E react-hook-form@7.89.0 @hookform/resolvers@5.9.1
```

- [ ] **Step 2: Write the failing tests**

In `apps/web/src/lib/api-client.spec.ts`, add:

```ts
  it('sends a JSON body with DELETE, which DELETE /me needs for the password', async () => {
    const { client, calls } = clientReturning(new Response(null, { status: 204 }));
    await expect(client.delete('/me', NoContentSchema, { password: 'x' })).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.body).toBe('{"password":"x"}');
  });
```
Add `NoContentSchema` to the import from `'./api-client'`.

`apps/web/src/lib/messages.spec.ts`:

```ts
import { ErrorCode, type Problem } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, ContractMismatchError } from './api-client';
import { ERROR_MESSAGES, errorMessage, fieldErrors, hasCode } from './messages';

const apiError = (code: string, extra: Partial<Problem> = {}) =>
  new ApiError({ type: 'about:blank', title: 'x', status: 400, code, requestId: 'r', ...extra });

describe('errorMessage (spec §7, §9)', () => {
  it.each(Object.entries(ERROR_MESSAGES))('says %s in plain words', (code, message) => {
    expect(errorMessage(apiError(code))).toBe(message);
  });

  it('never shows the server’s own text', () => {
    const message = errorMessage(
      apiError(ErrorCode.INTERNAL_ERROR, { status: 500, detail: 'pg: connection terminated' }),
    );
    expect(message).toBe('Something went wrong on our side. Try again in a moment.');
  });

  it('explains a lost connection and a version mismatch', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      "We couldn't reach Hanker. Check your connection and try again.",
    );
    expect(errorMessage(new ContractMismatchError('GET /me', []))).toBe(
      'Hanker was just updated. Reload the page and try again.',
    );
  });

  it('says sign-ups are paused while Turnstile is unavailable (rule 3)', () => {
    expect(errorMessage(apiError(ErrorCode.CAPTCHA_UNAVAILABLE, { status: 503 }))).toBe(
      'Sign-ups and account emails are paused right now. Try again later.',
    );
  });
});

describe('fieldErrors', () => {
  it('turns a VALIDATION_FAILED problem into messages by field', () => {
    const error = apiError(ErrorCode.VALIDATION_FAILED, {
      errors: [{ path: 'displayName', message: 'Use visible characters only' }],
    });
    expect(fieldErrors(error)).toEqual({ displayName: 'Use visible characters only' });
  });

  it('is empty for anything else', () => {
    expect(fieldErrors(apiError(ErrorCode.RATE_LIMITED))).toEqual({});
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});

describe('hasCode', () => {
  it('matches an API error by its code', () => {
    expect(hasCode(apiError(ErrorCode.INVALID_TOKEN), ErrorCode.INVALID_TOKEN)).toBe(true);
    expect(hasCode(apiError(ErrorCode.INVALID_TOKEN), ErrorCode.RATE_LIMITED)).toBe(false);
    expect(hasCode(new Error('x'), ErrorCode.INVALID_TOKEN)).toBe(false);
  });
});
```

`apps/web/src/lib/form-errors.spec.ts`:

```ts
import { LoginRequestSchema, SignupRequestSchema } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { formErrorMap } from './form-errors';

const messages = (schema: z.ZodType, input: unknown) =>
  Object.fromEntries(
    (schema.safeParse(input, { error: formErrorMap }).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('formErrorMap (rule 23)', () => {
  it('speaks plainly about the sign-up fields', () => {
    const SignupForm = SignupRequestSchema.omit({ turnstileToken: true });
    expect(messages(SignupForm, { displayName: '  ', email: 'ada', password: 'short' })).toEqual({
      displayName: 'Enter a name.',
      email: 'Enter an email address, like ada@example.com.',
      password: 'Use at least 10 characters.',
    });
  });

  it('asks for the password at login without revealing the policy', () => {
    expect(messages(LoginRequestSchema, { email: 'ada@example.com', password: '' })).toEqual({
      password: 'Enter your password.',
    });
  });

  it('states the upper limit', () => {
    expect(
      messages(LoginRequestSchema, { email: 'ada@example.com', password: 'x'.repeat(129) }),
    ).toEqual({ password: 'Use 128 characters or fewer.' });
  });

  it('keeps a refinement’s own message', () => {
    const NameOnly = SignupRequestSchema.pick({ displayName: true });
    expect(messages(NameOnly, { displayName: 'Ada‮' })).toEqual({
      displayName: 'Use visible characters only',
    });
  });
});
```

`apps/web/src/lib/safe-next.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext (rule 9, Review Focus 4)', () => {
  it.each([
    ['/settings', '/settings'],
    ['/list?x=1', '/list?x=1'],
  ])('keeps the same-site path %s', (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    [' /settings'],
    ['settings'],
  ])('sends %j to /list instead', (value) => {
    expect(safeNext(value)).toBe('/list');
  });
});
```

In `apps/web/next.config.spec.ts`, `loadConfig` also stubs the site key:

```ts
async function loadConfig(apiOrigin: string, siteKey = '1x00000000000000000000AA') {
  vi.stubEnv('API_ORIGIN', apiOrigin);
  vi.stubEnv('TURNSTILE_SITE_KEY', siteKey);
  vi.resetModules();
  return (await import('./next.config')).default;
}
```

The "inlines API_ORIGIN" test becomes the first test below, and the second is new:

```ts
  it('inlines API_ORIGIN and the Turnstile site key at build', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.env).toEqual({
      API_ORIGIN: 'https://api.example.test',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    });
  });

  it('refuses to load without TURNSTILE_SITE_KEY (rule 11)', async () => {
    await expect(loadConfig('https://api.example.test', '')).rejects.toThrow(
      /TURNSTILE_SITE_KEY must be set/,
    );
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
```
Expected:
- The new modules don't exist.
- `NoContentSchema` isn't exported.
- `config.env` lacks `TURNSTILE_SITE_KEY`.

- [ ] **Step 4: Implement the client plumbing**

In `apps/web/src/lib/api-client.ts`:
- Change `import type { z } from 'zod';` to `import { z } from 'zod';`.
- Export, after the error classes:

```ts
/** The schema for an empty 204 response. */
export const NoContentSchema = z.undefined();
```

- `delete` takes an optional body:

```ts
    delete: <S extends z.ZodType>(path: string, schema: S, body?: unknown) =>
      request('DELETE', path, schema, body),
```

`apps/web/src/lib/browser-api.ts`:

```ts
import { createApiClient } from './api-client';

/**
 * The API from the browser: same origin, through the /api rewrite, so the API's Set-Cookie lands
 * in the browser (spec §7: auth forms don't use Server Actions).
 */
export const browserApi = createApiClient({ baseUrl: '' });
```

`apps/web/src/lib/messages.ts`:

```ts
import { ErrorCode } from '@wishlist/contracts';
import { ApiError, ContractMismatchError } from './api-client';

/** What a person sees for each error code: the one table (spec §7, rule 23). */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  [ErrorCode.INVALID_CREDENTIALS]: "That email and password don't match.",
  [ErrorCode.PASSWORD_BREACHED]:
    'That password has appeared in a data breach. Choose a different one.',
  [ErrorCode.CAPTCHA_FAILED]: "The human check didn't go through. Try it again.",
  [ErrorCode.CAPTCHA_UNAVAILABLE]:
    'Sign-ups and account emails are paused right now. Try again later.',
  [ErrorCode.INVALID_TOKEN]: 'This link has expired or has already been used.',
  [ErrorCode.RATE_LIMITED]: 'Too many attempts. Wait a few minutes and try again.',
  [ErrorCode.UNAUTHENTICATED]: "You're signed out. Log in to continue.",
  [ErrorCode.VALIDATION_FAILED]: 'Some details need fixing.',
  [ErrorCode.FORBIDDEN_ORIGIN]: 'This page is out of date. Reload it and try again.',
};

const FALLBACK = 'Something went wrong on our side. Try again in a moment.';

/** Plain words for any failure; never the server's own text (spec §9). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return ERROR_MESSAGES[error.problem.code] ?? FALLBACK;
  if (error instanceof ContractMismatchError) {
    return 'Hanker was just updated. Reload the page and try again.';
  }
  // fetch rejects with a TypeError when the network is down.
  if (error instanceof TypeError) return "We couldn't reach Hanker. Check your connection and try again.";
  return FALLBACK;
}

/** Messages by field from a 400 VALIDATION_FAILED; empty for anything else. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.problem.code !== ErrorCode.VALIDATION_FAILED) return {};
  return Object.fromEntries((error.problem.errors ?? []).map((e) => [e.path, e.message]));
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.problem.code === code;
}
```

`apps/web/src/lib/form-errors.ts`:

```ts
import type { z } from 'zod';

/**
 * Plain-language messages for the contracts' rules, in place of Zod's (rule 23). Pass it to
 * zodResolver as `{ error: formErrorMap }`. A refinement's own message, such as the display
 * name's, wins.
 */
export const formErrorMap: z.core.$ZodErrorMap = (issue) => {
  const field = String(issue.path?.[0] ?? '');
  switch (issue.code) {
    case 'invalid_format':
      return field === 'email' ? 'Enter an email address, like ada@example.com.' : undefined;
    case 'too_small':
      if (Number(issue.minimum) > 1) return `Use at least ${String(issue.minimum)} characters.`;
      if (field === 'displayName') return 'Enter a name.';
      return /password/i.test(field) ? 'Enter your password.' : 'Fill this in.';
    case 'too_big':
      return `Use ${String(issue.maximum)} characters or fewer.`;
    default:
      return undefined;
  }
};
```

`apps/web/src/lib/safe-next.ts`:

```ts
/**
 * Where to go after logging in. Only a same-site path survives (rule 9, Review Focus 4).
 * Whitespace and control characters are refused because browsers strip them, which turns
 * "/\t/evil" into "//evil".
 */
export function safeNext(value: string | null | undefined, fallback = '/list'): string {
  if (!value || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we refuse
  if (/[\u0000-\u001F\u007F\s]/.test(value)) return fallback;
  return value;
}
```

If `no-control-regex` isn't enabled in the web lint config, the disable comment is unused: delete it.

`apps/web/src/lib/nonce.ts`:

```ts
import 'server-only';
import { headers } from 'next/headers';

/** This request's CSP nonce, set by the proxy, for scripts a page adds itself (Turnstile). */
export async function cspNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
```

`apps/web/src/lib/strip-token.ts`:

```ts
/**
 * Takes ?token= out of the address bar and this history entry, keeping the path (spec §6.7). Call
 * it once on mount, before anything else happens on a token page (rule 7).
 */
export function stripTokenFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
```

`apps/web/src/components/turnstile.tsx`:

```tsx
'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'light';
      size: 'normal' | 'compact';
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Cloudflare Turnstile, rendered explicitly (spec §6.5, §6.9). `onToken` gets a fresh token, or
 * null when one expires or fails. A token works once, so change `resetKey` after any submit that
 * used one, and the widget renders again for a new token.
 */
export function Turnstile({
  nonce,
  onToken,
  resetKey,
}: {
  nonce: string | undefined;
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const api = window.turnstile;
    const element = container.current;
    if (!ready || !api || !element) return;
    latest.current(null);
    const widget = api.render(element, {
      sitekey: process.env.TURNSTILE_SITE_KEY ?? '',
      theme: 'light',
      // The normal widget is 300px wide; narrow phones get the compact one.
      size: element.clientWidth < 300 ? 'compact' : 'normal',
      callback: (token) => latest.current(token),
      'expired-callback': () => latest.current(null),
      'error-callback': () => latest.current(null),
    });
    return () => api.remove(widget);
  }, [ready, resetKey]);

  return (
    <>
      <Script src={SCRIPT} strategy="afterInteractive" nonce={nonce} onReady={() => setReady(true)} />
      {/* data-turnstile: E2E excludes Cloudflare's iframe from axe; we can't fix its markup. */}
      <div ref={container} data-turnstile="" className="min-h-[65px] w-full" />
    </>
  );
}
```

- [ ] **Step 5: Require and inline the site key, everywhere the web builds**

In `apps/web/next.config.ts`, add after `readApiOrigin()`:

```ts
/**
 * Cloudflare Turnstile's public site key (rule 11). Required, so a build can't ship a widget that
 * never renders. Outside production, use Cloudflare's always-pass test key.
 */
function readTurnstileSiteKey(): string {
  const value = process.env.TURNSTILE_SITE_KEY;
  if (!value) {
    throw new Error(
      'TURNSTILE_SITE_KEY must be set to build or start the web app (outside production, use the test key 1x00000000000000000000AA)',
    );
  }
  return value;
}
```

Below `const API_ORIGIN = readApiOrigin();`, add `const TURNSTILE_SITE_KEY = readTurnstileSiteKey();`. Then `env: { API_ORIGIN },` becomes:

```ts
  // Inlined at build: server code calls exactly the API the rewrite points at, and the browser
  // gets the Turnstile site key.
  env: { API_ORIGIN, TURNSTILE_SITE_KEY },
```

In `apps/web/package.json`, the `typecheck` script becomes:

```json
"typecheck": "API_ORIGIN=${API_ORIGIN:-http://localhost:3001} TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-1x00000000000000000000AA} next typegen && tsc --noEmit",
```

In `apps/web/turbo.json`, the build task's `env` becomes `["API_ORIGIN", "TURNSTILE_SITE_KEY"]`.

Append to `apps/web/.env.development`:

```
# Cloudflare's published always-pass test key (public, not a credential). Production's comes from
# the TURNSTILE_SITE_KEY repo variable.
TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

In `.github/workflows/ci.yml`, job `checks` → `env`, below `API_ORIGIN`:

```yaml
      # Cloudflare's always-pass test key: the web build refuses to run without a site key.
      TURNSTILE_SITE_KEY: 1x00000000000000000000AA
```

In `.github/workflows/preview.yml`, job `build-web` → `env`, below `API_ORIGIN`:

```yaml
      # Previews pair Cloudflare's always-pass test key with the API's test secret (Plan 2a).
      TURNSTILE_SITE_KEY: 1x00000000000000000000AA
```

In `.github/workflows/deploy.yml`, job `build` → `env`, below `API_ORIGIN`:

```yaml
      # The production widget's public site key (Plan 2b Task 1). The build fails without it.
      TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}
```

In `e2e/playwright.config.ts`:
- Below the port constants, add:

```ts
// Cloudflare's published always-pass Turnstile test keys (public, not credentials).
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
```

- The API server's `env` gains:

```ts
        EMAIL_TRANSPORT: 'mailpit',
        MAILPIT_URL: 'http://localhost:8025',
        TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
```

- The web server's `env` becomes `{ API_ORIGIN: \`http://localhost:${API_PORT}\`, TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY }`.

In `scripts/e2e.sh`:
- Below `export API_ORIGIN=…`, add:

```bash
export TURNSTILE_SITE_KEY="1x00000000000000000000AA" # Cloudflare's always-pass test key
```

- After the migrate line, add:

```bash
# Per-IP limits would otherwise carry over from a run earlier in the hour (Plan 2b rule 21).
docker compose exec -T postgres psql -U wishlist -d wishlist_e2e -c 'TRUNCATE rate_limits' >/dev/null
```

- [ ] **Step 6: Run the tests to verify they pass, then the gates**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
TURNSTILE_SITE_KEY=1x00000000000000000000AA API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 -color
pnpm test:e2e
```
Expected:
- Unit tests pass.
- `workflow-policy: ok` and `workflow-policy mutations: ok (15 caught)`.
- actionlint prints nothing.
- The whole E2E suite passes.

If `formErrorMap`'s issues lack `path` in this Zod version, so that `form-errors.spec.ts` fails on field names, stop and report it (NEEDS_CONTEXT). Don't change the contracts.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add apps/web pnpm-lock.yaml .github/workflows e2e/playwright.config.ts scripts/e2e.sh
git commit -F - <<'EOF'
feat(web): add the browser client, error copy, safe next paths and Turnstile

Client forms call the API through the /api rewrite; one table turns error
codes into plain words, and form validation speaks plainly too. Login's
next parameter only accepts same-site paths. The Turnstile widget renders
explicitly with the page's nonce. The site key is inlined at build and
required: previews, CI and E2E use Cloudflare's test key, production the
TURNSTILE_SITE_KEY repo variable. E2E's API sends mail to Mailpit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 12: Sign-up and login pages

**Files:**
- Create:
  - `apps/web/src/components/auth-page.tsx`
  - `apps/web/src/components/auth/signup-form.tsx`, `apps/web/src/components/auth/login-form.tsx`
  - `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/(auth)/login/page.tsx`
  - `e2e/support/accounts.ts`, `e2e/support/mailpit.ts`, `e2e/support/turnstile.ts`
  - `e2e/tests/local/signup.spec.ts`, `e2e/tests/local/login.spec.ts`

**Interfaces:**
- Consumes: Tasks 9–11.
- Produces:
  - `AuthPage({ action, children })`.
  - E2E helpers: `PASSWORD`, `uniqueEmail(label)`, `signUpViaApi(request, baseURL, email, displayName?)`, `emailsTo(address)`, `waitForEmail(address, subject)`, `linkPath(text, path)` and `passTurnstile(page)`.

**Mail budget (rule 21):** these tests make 3 mail-sending calls. The whole suite must stay under 20; Task 15 counts it.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add web/signup-login
```

- [ ] **Step 2: Write the E2E helpers**

`e2e/support/accounts.ts`:

```ts
import type { APIRequestContext } from '@playwright/test';

export const PASSWORD = 'correct horse battery 1';

/** A fresh address per test: Mailpit keeps everything, and accounts must not collide. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Cloudflare's test secret accepts this token (Plan 2a Task 13). */
const TEST_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Signs up through the API, as the browser would, without driving the form. */
export async function signUpViaApi(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  displayName = 'Ada',
): Promise<void> {
  const res = await request.post('/api/auth/signup', {
    headers: { origin: baseURL },
    data: { email, password: PASSWORD, displayName, turnstileToken: TEST_TURNSTILE_TOKEN },
  });
  if (res.status() !== 202) throw new Error(`signup answered ${res.status()}`);
}

/** Logs in through the API. The cookie lands in the page's browser context. */
export async function logInViaApi(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password = PASSWORD,
): Promise<number> {
  const res = await request.post('/api/auth/login', {
    headers: { origin: baseURL },
    data: { email, password },
  });
  return res.status();
}
```

`e2e/support/mailpit.ts`:

```ts
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface MailSummary {
  ID: string;
  Subject: string;
}

/** Every email Mailpit holds for an address, newest first. */
export async function emailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search answered ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}

/** The newest email with this subject, once it arrives. Mail goes out in the background. */
export async function waitForEmail(
  address: string,
  subject: string,
  timeoutMs = 15_000,
): Promise<{ text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = (await emailsTo(address)).find((m) => m.Subject === subject);
    if (match) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      return { text: ((await res.json()) as { Text: string }).Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no "${subject}" email to ${address} within ${timeoutMs} ms`);
}

/** The path and query of the emailed link to `path`, ready for page.goto. */
export function linkPath(text: string, path: string): string {
  const match = new RegExp(`https?://\\S+?(${path}\\?token=[A-Za-z0-9_-]{43})`).exec(text);
  if (!match?.[1]) throw new Error(`no ${path} link in this email`);
  return match[1];
}
```

`e2e/support/turnstile.ts`:

```ts
import { expect, type Page } from '@playwright/test';

/** Waits until Cloudflare's test widget has handed the page a token. */
export async function passTurnstile(page: Page): Promise<void> {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 15_000,
  });
}
```

- [ ] **Step 3: Write the failing tests**

`e2e/tests/local/signup.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts';
import { emailsTo, waitForEmail } from '../../support/mailpit';
import { passTurnstile } from '../../support/turnstile';

const VERIFY = 'Confirm your email for Hanker';

async function fillSignup(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await passTurnstile(page);
}

test('signs up, and the verification email arrives', async ({ page }) => {
  const email = uniqueEmail('signup');
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  expect((await waitForEmail(email, VERIFY)).text).toContain('/verify-email?token=');
});

test('says what to fix before sending anything', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expect(page.getByText('Enter an email address, like ada@example.com.')).toBeVisible();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
});

test('pressing Create account twice sends one request (Review Focus 5)', async ({ page }) => {
  const email = uniqueEmail('double');
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await waitForEmail(email, VERIFY);
  // A second request would have sent an "already have an account" email by now.
  await page.waitForTimeout(2_000);
  expect(await emailsTo(email)).toHaveLength(1);
});
```

`e2e/tests/local/login.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts';

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('login: plain words for a wrong password, then home; next never leaves the site (Review Focus 4)', async ({
  page,
  baseURL,
}) => {
  const email = uniqueEmail('login');
  await signUpViaApi(page.request, baseURL ?? '', email);

  await page.goto(`/login?next=${encodeURIComponent('//evil.example')}`);
  await logIn(page, email, 'not my password');
  // By text: Next's route announcer also has role="alert".
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await logIn(page, email);
  await expect(page).toHaveURL('/list');
  expect((await page.request.get('/api/me')).status()).toBe(200);

  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent('/settings')}`);
  await logIn(page, email);
  await expect(page).toHaveURL('/settings');
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm test:e2e signup.spec.ts login.spec.ts`

Expected: `/signup` and `/login` are 404s, so no field is found.

- [ ] **Step 5: Implement**

`apps/web/src/components/auth-page.tsx`:

```tsx
import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

/** The frame for a signed-out page: the header with one account link, and the content. */
export function AuthPage({
  action,
  children,
}: {
  action: 'login' | 'signup' | 'none';
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader action={action} />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-7">{children}</main>
    </>
  );
}
```

`apps/web/src/components/auth/signup-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, SignupRequestSchema } from '@wishlist/contracts';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, hasCode } from '@/lib/messages';

const FormSchema = SignupRequestSchema.omit({ turnstileToken: true });
const FIELDS = ['displayName', 'email', 'password'] as const;

export function SignupForm({ nonce }: { nonce: string | undefined }) {
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(FormSchema, { error: formErrorMap }),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    // One request per press, however fast the clicks (Review Focus 5).
    if (inFlight.current) return;
    if (!token) {
      setFormError('Finish the check above, then try again.');
      return;
    }
    inFlight.current = true;
    setFormError(null);
    try {
      await browserApi.post('/auth/signup', { ...values, turnstileToken: token }, NoContentSchema);
      setSentTo(values.email);
    } catch (error) {
      const fields = fieldErrors(error);
      for (const name of FIELDS) {
        const message = fields[name];
        if (message) setError(name, { message });
      }
      if (hasCode(error, ErrorCode.PASSWORD_BREACHED)) {
        setError('password', { message: errorMessage(error) });
      } else if (Object.keys(fields).length === 0) {
        setFormError(errorMessage(error));
      }
    } finally {
      inFlight.current = false;
      // A Turnstile token works once: get a fresh one for the next attempt.
      setToken(null);
      setChallenge((n) => n + 1);
    }
  });

  if (sentTo) return <CheckYourEmail email={sentTo} />;

  return (
    <Card className="mt-8">
      <h2 className="font-display text-3xl">Create your account</h2>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <Field
          id="displayName"
          label="Your name"
          hint="Shown on your list, like “Ada’s wishlist”."
          error={errors.displayName?.message}
        >
          {(control) => <Input {...control} {...register('displayName')} autoComplete="nickname" />}
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} {...register('email')} type="email" autoComplete="email" />
          )}
        </Field>
        <Field
          id="password"
          label="Password"
          hint="10 characters or more. A short phrase is easiest to remember."
          error={errors.password?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Turnstile nonce={nonce} onToken={setToken} resetKey={challenge} />
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-[15px]">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </Card>
  );
}

/** The same answer for a new address and an existing one (spec §8): the email says which. */
function CheckYourEmail({ email }: { email: string }) {
  return (
    <Card className="mt-8">
      <h2 className="font-display text-3xl">Check your email</h2>
      <p className="mt-3 leading-relaxed">
        We sent a link to <strong>{email}</strong>. Open it within 24 hours to confirm your address.
      </p>
      <p className="mt-3 text-[15px] text-muted-foreground">
        Nothing there? Check your spam folder, or{' '}
        <Link href="/verify-email" className="text-foreground underline">
          send a new link
        </Link>
        .
      </p>
    </Card>
  );
}
```

`apps/web/src/components/auth/login-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema } from '@wishlist/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage } from '@/lib/messages';

/** `next` has already been through safeNext (rule 9). */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(LoginRequestSchema, { error: formErrorMap }),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.post('/auth/login', values, NoContentSchema);
      router.replace(next);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <Card>
      <h1 className="font-display text-5xl leading-none">Log in</h1>
      <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-5">
        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} {...register('email')} type="email" autoComplete="email" />
          )}
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              {...register('password')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Log in
        </Button>
      </form>
      <p className="mt-5 text-[15px]">
        <Link href="/reset-password" className="underline">
          Forgot your password?
        </Link>
      </p>
    </Card>
  );
}
```

`apps/web/src/app/(auth)/signup/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { SignupForm } from '@/components/auth/signup-form';
import { Collage } from '@/components/collage';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage() {
  const nonce = await cspNonce();
  return (
    <AuthPage action="login">
      <div className="mt-14 flex flex-wrap items-start gap-x-16 gap-y-12">
        <Collage />
        <div className="min-w-0 max-w-[460px] flex-[1_1_340px]">
          <h1 className="font-display text-[clamp(2.75rem,6vw,4rem)] leading-[0.98] tracking-[-0.01em]">
            One list. One link. No doubled-up gifts.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Add the things you’d love, then share your link with family and friends. They claim
            gifts quietly, so nobody buys the same thing twice, and you never see who’s getting
            what.
          </p>
          <SignupForm nonce={nonce} />
        </div>
      </div>
    </AuthPage>
  );
}
```

`apps/web/src/app/(auth)/login/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { LoginForm } from '@/components/auth/login-form';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <AuthPage action="signup">
      <div className="mx-auto mt-16 max-w-[460px]">
        <LoginForm next={safeNext(typeof next === 'string' ? next : null)} />
      </div>
    </AuthPage>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass, then the gate**

Run:
```bash
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build --filter=@wishlist/web
pnpm test:e2e signup.spec.ts login.spec.ts security.spec.ts
```
Expected: all pass. `/list` and `/settings` are still 404 pages, but the URL assertions hold.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): add the sign-up and login pages

Sign-up checks the fields with the shared contracts, passes Turnstile, and
answers new and existing addresses alike with "Check your email". A
second press can't send a second request. Login sends you back to a
same-site next path, or to /list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 13: The email-link pages: verify, resend, and reset

**Files:**
- Create:
  - `apps/web/src/components/auth/email-link-form.tsx`, `apps/web/src/components/auth/verify-email.tsx`, `apps/web/src/components/auth/choose-new-password.tsx`
  - `apps/web/src/app/(auth)/verify-email/page.tsx`, `apps/web/src/app/(auth)/reset-password/page.tsx`, `apps/web/src/app/(auth)/reset-password/confirm/page.tsx`
  - `e2e/tests/local/email-links.spec.ts`
- Modify: `apps/web/next.config.ts` (token-page headers)
- Test: `apps/web/next.config.spec.ts`

**Interfaces:**
- Consumes: Tasks 9–12.
- Produces: `EmailLinkForm({ endpoint, submitLabel, sentMessage, nonce })`.

**Mail budget:** these tests make 5 mail-sending calls.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add web/email-links
```

- [ ] **Step 2: Write the failing tests**

In `apps/web/next.config.spec.ts`, add:

```ts
  it('keeps tokens out of Referer and search on the token pages (spec §6.7, rule 7)', async () => {
    const rules = (await (await loadConfig('https://api.example.test')).headers?.()) ?? [];
    for (const source of ['/verify-email', '/reset-password/confirm']) {
      expect(rules.find((rule) => rule.source === source)?.headers).toEqual([
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ]);
    }
  });
```

`e2e/tests/local/email-links.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts';
import { emailsTo, linkPath, waitForEmail } from '../../support/mailpit';
import { passTurnstile } from '../../support/turnstile';

const VERIFY = 'Confirm your email for Hanker';
const RESET = 'Reset your Hanker password';
const NEW_PASSWORD = 'a brand new passphrase 2';

test('a verification link is used only when the person presses Confirm, and never shows or leaks its token (Review Focus 1, 3)', async ({
  page,
  baseURL,
}) => {
  const email = uniqueEmail('verify');
  await signUpViaApi(page.request, baseURL ?? '', email);
  const link = linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email');

  // A mail scanner or a preview renders the page: nothing is used up.
  const res = await page.goto(link);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(page.getByRole('button', { name: 'Confirm my email' })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('token=');
  await page.goto('/');

  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page.getByRole('heading', { name: 'Your email is confirmed.' })).toBeVisible();

  // The same link again is spent, and the page offers a new one.
  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(
    page.getByRole('heading', { name: 'This link has expired or has already been used.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();
});

test('sends a new verification link from /verify-email', async ({ page, baseURL }) => {
  const email = uniqueEmail('resend');
  await signUpViaApi(page.request, baseURL ?? '', email);
  await waitForEmail(email, VERIFY);
  await page.goto('/verify-email');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send a new link' }).click();
  await expect(page.getByRole('status')).toContainText('a new link is on its way');
  await expect
    .poll(async () => (await emailsTo(email)).filter((m) => m.Subject === VERIFY).length)
    .toBe(2);
});

test('resets a forgotten password, and the new one logs in', async ({ page, baseURL }) => {
  const email = uniqueEmail('reset');
  await signUpViaApi(page.request, baseURL ?? '', email);
  await page.goto('/reset-password');
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  const res = await page.goto(
    linkPath((await waitForEmail(email, RESET)).text, '/reset-password/confirm'),
  );
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect.poll(() => page.url()).not.toContain('token=');
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page.getByRole('heading', { name: 'Your password is changed.' })).toBeVisible();
  expect(await logInViaApi(page.request, baseURL ?? '', email, NEW_PASSWORD)).toBe(204);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run next.config.spec.ts
pnpm test:e2e email-links.spec.ts
```
Expected:
- No token-page rule.
- The pages are 404s.

- [ ] **Step 4: Implement**

In `apps/web/next.config.ts`, `headers()` returns the existing rule followed by the token pages. Later rules override earlier ones for the same key.

```ts
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // Token pages (spec §6.7): no Referer can carry the token, and search engines skip them.
      ...['/verify-email', '/reset-password/confirm'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      })),
    ];
  },
```

`apps/web/src/components/auth/email-link-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PasswordResetRequestSchema } from '@wishlist/contracts';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage } from '@/lib/messages';

/** Resend-verification and reset-request take the same body: an email and a Turnstile token. */
const EmailOnlySchema = PasswordResetRequestSchema.omit({ turnstileToken: true });

/**
 * Asks the API to email a link. The answer never says whether the address has an account
 * (spec §8), so the confirmation is worded "if".
 */
export function EmailLinkForm({
  endpoint,
  submitLabel,
  sentMessage,
  nonce,
}: {
  endpoint: '/auth/resend-verification' | '/auth/password-reset/request';
  submitLabel: string;
  sentMessage: string;
  nonce: string | undefined;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(EmailOnlySchema, { error: formErrorMap }),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (inFlight.current) return;
    if (!token) {
      setFormError('Finish the check above, then try again.');
      return;
    }
    inFlight.current = true;
    setFormError(null);
    try {
      await browserApi.post(endpoint, { ...values, turnstileToken: token }, NoContentSchema);
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setToken(null);
      setChallenge((n) => n + 1);
    }
  });

  if (sent) return <Notice tone="success" className="mt-6">{sentMessage}</Notice>;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
      <Field id="email" label="Email" error={errors.email?.message}>
        {(control) => <Input {...control} {...register('email')} type="email" autoComplete="email" />}
      </Field>
      <Turnstile nonce={nonce} onToken={setToken} resetKey={challenge} />
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
```

`apps/web/src/components/auth/verify-email.tsx`:

```tsx
'use client';

import { ErrorCode } from '@wishlist/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { stripTokenFromUrl } from '@/lib/strip-token';
import { cn } from '@/lib/utils';
import { EmailLinkForm } from './email-link-form';

type State = 'confirm' | 'confirmed' | 'invalid' | 'check';

/**
 * Confirms an address only when the person presses the button. Rendering the page never uses
 * the token, so a mail scanner or a second look can't spend it (rule 7, Review Focus 1).
 */
export function VerifyEmail({
  token,
  hadToken,
  nonce,
}: {
  token: string | null;
  hadToken: boolean;
  nonce: string | undefined;
}) {
  const [state, setState] = useState<State>(token ? 'confirm' : hadToken ? 'invalid' : 'check');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await browserApi.post('/auth/verify-email', { token }, NoContentSchema);
      setState('confirmed');
    } catch (failure) {
      if (hasCode(failure, ErrorCode.INVALID_TOKEN)) setState('invalid');
      else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'confirmed') {
    return (
      <Card>
        <h1 className="font-display text-5xl leading-none">Your email is confirmed.</h1>
        <p className="mt-4 leading-relaxed">You’re all set.</p>
        <Link href="/list" className={cn(buttonVariants(), 'mt-7')}>
          Go to your list
        </Link>
      </Card>
    );
  }

  if (state === 'confirm') {
    return (
      <Card>
        <h1 className="font-display text-5xl leading-none">Confirm your email</h1>
        <p className="mt-4 leading-relaxed">Press the button to finish setting up your account.</p>
        {error ? <Notice tone="error" className="mt-5">{error}</Notice> : null}
        <Button className="mt-7" onClick={confirm} disabled={busy}>
          Confirm my email
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-display text-5xl leading-none">
        {state === 'invalid' ? 'This link has expired or has already been used.' : 'Check your email'}
      </h1>
      <p className="mt-4 leading-relaxed text-muted-foreground">
        {state === 'invalid'
          ? 'Confirmation links work once, within 24 hours. Send yourself a new one.'
          : 'We sent a confirmation link when you signed up. It works for 24 hours. Need a new one?'}
      </p>
      <EmailLinkForm
        endpoint="/auth/resend-verification"
        submitLabel="Send a new link"
        sentMessage="If that address has an account waiting to be confirmed, a new link is on its way."
        nonce={nonce}
      />
    </Card>
  );
}
```

`apps/web/src/components/auth/choose-new-password.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, PasswordResetConfirmRequestSchema } from '@wishlist/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode } from '@/lib/messages';
import { stripTokenFromUrl } from '@/lib/strip-token';
import { cn } from '@/lib/utils';

const NewPasswordSchema = PasswordResetConfirmRequestSchema.pick({ newPassword: true });

export function ChooseNewPassword({ token }: { token: string | null }) {
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(NewPasswordSchema, { error: formErrorMap }),
    defaultValues: { newPassword: '' },
  });

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await browserApi.post('/auth/password-reset/confirm', { token, ...values }, NoContentSchema);
      setState('done');
    } catch (error) {
      if (hasCode(error, ErrorCode.INVALID_TOKEN)) setState('invalid');
      else if (hasCode(error, ErrorCode.PASSWORD_BREACHED)) {
        setError('newPassword', { message: errorMessage(error) });
      } else setFormError(errorMessage(error));
    }
  });

  if (state === 'done') {
    return (
      <Card>
        <h1 className="font-display text-5xl leading-none">Your password is changed.</h1>
        <p className="mt-4 leading-relaxed">You’re signed out everywhere. Log in with the new one.</p>
        <Link href="/login" className={cn(buttonVariants(), 'mt-7')}>
          Go to login
        </Link>
      </Card>
    );
  }

  if (state === 'invalid') {
    return (
      <Card>
        <h1 className="font-display text-5xl leading-none">
          This link has expired or has already been used.
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          Reset links work once, within an hour.
        </p>
        <Link href="/reset-password" className={cn(buttonVariants(), 'mt-7')}>
          Send a new link
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-display text-5xl leading-none">Choose a new password</h1>
      <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-5">
        <Field
          id="newPassword"
          label="New password"
          hint="10 characters or more."
          error={errors.newPassword?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('newPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Save the new password
        </Button>
      </form>
    </Card>
  );
}
```

`apps/web/src/app/(auth)/verify-email/page.tsx`:

```tsx
import { EmailTokenSchema } from '@wishlist/contracts';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { VerifyEmail } from '@/components/auth/verify-email';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  const valid = typeof token === 'string' && EmailTokenSchema.safeParse(token).success ? token : null;
  return (
    <AuthPage action="login">
      <div className="mx-auto mt-16 max-w-[520px]">
        <VerifyEmail token={valid} hadToken={token !== undefined} nonce={await cspNonce()} />
      </div>
    </AuthPage>
  );
}
```

`apps/web/src/app/(auth)/reset-password/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { EmailLinkForm } from '@/components/auth/email-link-form';
import { Card } from '@/components/ui/card';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Reset your password' };

export default async function ResetPasswordPage() {
  return (
    <AuthPage action="login">
      <div className="mx-auto mt-16 max-w-[520px]">
        <Card>
          <h1 className="font-display text-5xl leading-none">Reset your password</h1>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Enter your email and we’ll send a link to choose a new password. It works once, within
            an hour.
          </p>
          <EmailLinkForm
            endpoint="/auth/password-reset/request"
            submitLabel="Send the link"
            sentMessage="If an account uses that address, a link is on its way. It works once, within an hour."
            nonce={await cspNonce()}
          />
        </Card>
      </div>
    </AuthPage>
  );
}
```

`apps/web/src/app/(auth)/reset-password/confirm/page.tsx`:

```tsx
import { EmailTokenSchema } from '@wishlist/contracts';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { ChooseNewPassword } from '@/components/auth/choose-new-password';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ConfirmResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  const valid = typeof token === 'string' && EmailTokenSchema.safeParse(token).success ? token : null;
  return (
    <AuthPage action="login">
      <div className="mx-auto mt-16 max-w-[520px]">
        <ChooseNewPassword token={valid} />
      </div>
    </AuthPage>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build --filter=@wishlist/web
pnpm test:e2e email-links.spec.ts signup.spec.ts security.spec.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): add the verify, resend and password-reset pages

A verification link is used only when the person presses Confirm, so a
mail scanner can't spend it; a spent or expired link offers a new one.
Token pages take the token out of the address bar and send no Referer.
Reset request and resend never say whether an address has an account.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 14: The signed-in pages: home, settings and logout

**Files:**
- Create:
  - `apps/web/src/lib/require-me.ts`
  - `apps/web/src/components/account-header.tsx`
  - `apps/web/src/components/account/name-form.tsx`, `apps/web/src/components/account/password-form.tsx`, `apps/web/src/components/account/delete-account-form.tsx`
  - `apps/web/src/app/(account)/list/page.tsx`, `apps/web/src/app/(account)/settings/page.tsx`
  - `e2e/tests/local/account.spec.ts`

**Interfaces:**
- Consumes: Tasks 9–13, and `serverApi()` (Plan 1).
- Produces:
  - `requireMe(returnTo: string): Promise<MeResponse>`.
  - `AccountHeader({ current: 'list' | 'settings' })`.

**Mail budget:** these tests make 3 mail-sending calls.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add web/account
```

- [ ] **Step 2: Write the failing tests**

`e2e/tests/local/account.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts';

const NEW_PASSWORD = 'a brand new passphrase 2';

/** A new account, logged in. The session cookie lands in the page's browser context. */
async function signedIn(page: Page, baseURL: string, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await signUpViaApi(page.request, baseURL, email);
  expect(await logInViaApi(page.request, baseURL, email)).toBe(204);
  return email;
}

test('the home greets the user, asks an unverified one to confirm, and settings renames them', async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL ?? '', 'home');
  await page.goto('/');
  await expect(page).toHaveURL('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Confirm your email to start your list');

  await page.goto('/settings');
  await page.getByLabel('Display name').fill('Ada L.');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status')).toHaveText('Name saved');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada L.');
});

test('changes the password, keeps this device, and the old password stops working', async ({
  page,
  baseURL,
}) => {
  const email = await signedIn(page, baseURL ?? '', 'password');
  await page.goto('/settings');
  await page.getByLabel('Current password').fill('not my password');
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('That password isn’t right.')).toBeVisible();

  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toContainText('Password changed');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/');
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(401);
  expect(await logInViaApi(page.request, baseURL ?? '', email, NEW_PASSWORD)).toBe(204);
});

test('deletes the account after the password, and signs out', async ({ page, baseURL }) => {
  const email = await signedIn(page, baseURL ?? '', 'delete');
  await page.goto('/settings');
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/settings');
  await expect(page).toHaveURL('/login?next=%2Fsettings');
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(401);
});

test('a stale session cookie leads to login, not a loop (Review Focus 2)', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: '__Host-session',
      value: 'A'.repeat(43),
      url: baseURL ?? '',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2Flist');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:e2e account.spec.ts`

Expected: `/list` and `/settings` are 404s.

- [ ] **Step 4: Implement**

`apps/web/src/lib/require-me.ts`:

```ts
import 'server-only';
import { MeResponseSchema, type MeResponse } from '@wishlist/contracts';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * The signed-in user, or a redirect to login that comes back here. The API decides; the proxy
 * only saw a cookie, which may be stale (spec §6.1, rule 8).
 */
export async function requireMe(returnTo: string): Promise<MeResponse> {
  try {
    return await (await serverApi()).get('/me', MeResponseSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}
```

`apps/web/src/components/account-header.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { cn } from '@/lib/utils';

/** The signed-in header: the wordmark, the two account pages, and Log out. */
export function AccountHeader({ current }: { current: 'list' | 'settings' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    try {
      await browserApi.post('/auth/logout', {}, NoContentSchema);
    } finally {
      router.replace('/');
    }
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-7">
        <Link href="/list" className="font-display text-[30px] leading-none no-underline">
          Hanker
        </Link>
        <nav aria-label="Main" className="flex flex-1 gap-1.5 text-[15px] font-medium">
          <NavLink href="/list" current={current === 'list'}>
            Your list
          </NavLink>
          <NavLink href="/settings" current={current === 'settings'}>
            Settings
          </NavLink>
        </nav>
        <Button variant="secondary" size="compact" onClick={logOut} disabled={busy}>
          Log out
        </Button>
      </div>
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full px-4 no-underline',
        current ? 'bg-foreground text-background' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
```

`apps/web/src/components/account/name-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, MeResponseSchema, UpdateMeRequestSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, hasCode } from '@/lib/messages';

export const LOGIN_AGAIN = '/login?next=%2Fsettings';

export function NameForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(UpdateMeRequestSchema, { error: formErrorMap }),
    defaultValues: { displayName },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    try {
      await browserApi.patch('/me', values, MeResponseSchema);
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        router.replace(LOGIN_AGAIN);
        return;
      }
      const message = fieldErrors(error).displayName;
      if (message) setError('displayName', { message });
      else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="name-heading">
      <h2 id="name-heading" className="font-display text-3xl">
        Your name
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Shown on your list and to the people who open your link.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="displayName" label="Display name" error={errors.displayName?.message}>
            {(control) => (
              <Input {...control} {...register('displayName')} autoComplete="nickname" />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Save name
        </Button>
      </form>
      {saved ? <Notice tone="success" className="mt-4">Name saved</Notice> : null}
      {formError ? <Notice tone="error" className="mt-4">{formError}</Notice> : null}
    </Card>
  );
}
```

`apps/web/src/components/account/password-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordRequestSchema, ErrorCode } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

export function PasswordForm() {
  const router = useRouter();
  const [changed, setChanged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(ChangePasswordRequestSchema, { error: formErrorMap }),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setChanged(false);
    setFormError(null);
    try {
      await browserApi.post('/me/password', values, NoContentSchema);
      reset();
      setChanged(true);
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        router.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('currentPassword', { message: 'That password isn’t right.' });
      } else if (hasCode(error, ErrorCode.PASSWORD_BREACHED)) {
        setError('newPassword', { message: errorMessage(error) });
      } else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="password-heading">
      <h2 id="password-heading" className="font-display text-3xl">
        Password
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Changing it signs you out on every other device.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex max-w-[400px] flex-col gap-4">
        <Field id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
          {(control) => (
            <Input
              {...control}
              {...register('currentPassword')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>
        <Field
          id="newPassword"
          label="New password"
          hint="10 characters or more."
          error={errors.newPassword?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('newPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Button type="submit" className="self-start" disabled={isSubmitting}>
          Change password
        </Button>
      </form>
      {changed ? (
        <Notice tone="success" className="mt-4">
          Password changed. Other devices are signed out.
        </Notice>
      ) : null}
      {formError ? <Notice tone="error" className="mt-4">{formError}</Notice> : null}
    </Card>
  );
}
```

`apps/web/src/components/account/delete-account-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DeleteMeRequestSchema, ErrorCode } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/** The password is the confirmation: no extra dialog. The API clears the cookie on success. */
export function DeleteAccountForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(DeleteMeRequestSchema, { error: formErrorMap }),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.delete('/me', NoContentSchema, values);
      router.replace('/');
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        router.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('password', { message: 'That password isn’t right.' });
      } else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="font-display text-3xl">
        Delete account
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Deletes your account, your list and every claim on it. This can’t be undone.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="deletePassword" label="Your password" error={errors.password?.message}>
            {(control) => (
              <Input
                {...control}
                {...register('password')}
                type="password"
                autoComplete="current-password"
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="strong" disabled={isSubmitting}>
          Delete account
        </Button>
      </form>
      {formError ? <Notice tone="error" className="mt-4">{formError}</Notice> : null}
    </Card>
  );
}
```

`apps/web/src/app/(account)/list/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountHeader } from '@/components/account-header';
import { Notice } from '@/components/ui/notice';
import { requireMe } from '@/lib/require-me';

export const metadata: Metadata = { title: 'Your list' };

/** The signed-in home until Plan 3 brings the list editor (rule 10). */
export default async function ListPage() {
  const me = await requireMe('/list');
  return (
    <>
      <AccountHeader current="list" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">
          Hello, {me.displayName}.
        </h1>
        {me.emailVerified ? null : (
          <Notice tone="info" className="mt-6">
            Confirm your email to start your list. We sent a link to <strong>{me.email}</strong>.{' '}
            <Link href="/verify-email" className="underline">
              Send a new link
            </Link>
          </Notice>
        )}
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Your list comes next: soon you’ll add the things you’d love here and share one link with
          family and friends. Until then, you can manage your account in{' '}
          <Link href="/settings" className="text-foreground underline">
            Settings
          </Link>
          .
        </p>
      </main>
    </>
  );
}
```

`apps/web/src/app/(account)/settings/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { DeleteAccountForm } from '@/components/account/delete-account-form';
import { NameForm } from '@/components/account/name-form';
import { PasswordForm } from '@/components/account/password-form';
import { requireMe } from '@/lib/require-me';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const me = await requireMe('/settings');
  return (
    <>
      <AccountHeader current="settings" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Settings</h1>
        <p className="mt-2.5 text-muted-foreground">Signed in as {me.email}</p>
        <div className="mt-10 flex flex-col gap-5">
          <NameForm displayName={me.displayName} />
          <PasswordForm />
          <DeleteAccountForm />
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass, then the gate**

Run:
```bash
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build --filter=@wishlist/web
pnpm test:e2e
```
Expected: the whole E2E suite passes, including `login.spec.ts`, whose `/list` and `/settings` now render.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): add the signed-in home and settings, and log out

The home greets the user and asks an unverified one to confirm; the list
itself arrives in Plan 3. Settings renames, changes the password and
deletes the account. A stale cookie leads to login, never a loop.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---
### Task 15: The E2E sweep: a golden path, axe on every page, phone width, and smoke

**Files:**
- Create: `e2e/tests/local/pages.spec.ts`, `e2e/tests/local/golden-path.spec.ts`
- Delete: `e2e/tests/local/a11y.spec.ts` (`pages.spec.ts` replaces it)
- Modify: `e2e/tests/smoke/smoke.spec.ts`

**Interfaces:** consumes everything above.

**Mail budget:** 3 calls here. The full run totals 14, well under the per-IP 20 an hour (rule 21).

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add e2e/auth
```

- [ ] **Step 2: Write the tests**

These pin the finished pages. Run them right after writing: a failure is a defect in Tasks 9–14, so fix it there in this layer, and keep the test as written.

`e2e/tests/local/pages.spec.ts`:

```ts
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function expectAccessible(page: Page) {
  // Cloudflare's widget is a third-party iframe whose markup we can't change.
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA)
    .exclude('[data-turnstile]')
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectFitsPhone(page: Page) {
  await page.setViewportSize(PHONE);
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'no sideways scrolling at 390px').toBeLessThanOrEqual(0);
}

for (const path of [
  '/',
  '/signup',
  '/login',
  '/verify-email',
  '/reset-password',
  '/reset-password/confirm',
]) {
  test(`${path}: no detectable WCAG 2.2 AA violations, and it fits a phone`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page);
  });
}

test('sign-up with every field wrong is still accessible', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expectAccessible(page);
});

test('the signed-in pages are accessible and fit a phone', async ({ page, baseURL }) => {
  const email = uniqueEmail('pages');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  for (const path of ['/list', '/settings']) {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page);
  }
});
```

`e2e/tests/local/golden-path.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts';
import { linkPath, waitForEmail } from '../../support/mailpit';
import { passTurnstile } from '../../support/turnstile';

const VERIFY = 'Confirm your email for Hanker';
const RESET = 'Reset your Hanker password';
const NEW_PASSWORD = 'a brand new passphrase 2';

test('a new person signs up, confirms, logs in, renames, resets the password and leaves (spec §8)', async ({
  page,
}) => {
  const email = uniqueEmail('golden');
  const mainNav = page.getByRole('navigation', { name: 'Main' });

  await page.goto('/');
  await page.getByRole('link', { name: 'Create your list' }).click();
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email'));
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await page.getByRole('link', { name: 'Go to your list' }).click();

  // Signing up doesn't log you in: the list sends you to login, and back.
  await expect(page).toHaveURL('/login?next=%2Flist');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada.' })).toBeVisible();
  await expect(page.getByText('Confirm your email to start your list')).toHaveCount(0);

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status')).toHaveText('Name saved');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  await page.goto(linkPath((await waitForEmail(email, RESET)).text, '/reset-password/confirm'));
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await page.getByRole('link', { name: 'Go to login' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada Lovelace.' })).toBeVisible();

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Your password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
});
```

Append to `e2e/tests/smoke/smoke.spec.ts`:

```ts
test('the login page renders with its nonce CSP (spec §6.9)', async ({ page }) => {
  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
```

- [ ] **Step 3: Run the whole suite, then the gate**

Run:
```bash
git rm e2e/tests/local/a11y.spec.ts
pnpm test:e2e
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
```
Expected: every E2E test passes.
- An axe violation or sideways scrolling is a defect in the page that owns it. Fix it in this layer, and name the file and the fix in the report.
- Don't exclude more than `[data-turnstile]` from axe.

- [ ] **Step 4: Commit**

```bash
pnpm format:check
git add e2e apps/web
git commit -F - <<'EOF'
test(e2e): walk the account golden path, and check every page for a11y and phone width

One person signs up, confirms, logs in, renames, resets the password and
deletes the account, with mail through Mailpit. Every auth and account
page passes axe (WCAG 2.2 AA) and fits a 390px screen without sideways
scrolling. Smoke checks the login page and its CSP.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
The trailer names the model that actually wrote the commit.

---

### Task 16: Docs, the spec's amendments, and the roadmap

**Files:**
- Modify: `docs/deployment.md`, `docs/development.md`, `AGENTS.md`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`

**Produces:**
- The spec records D27–D29 and the CSP as built.
- The deployment guide covers the domain, DNS, Resend, Turnstile and how Plan 3 opens sign-up.
- The development guide covers the pages and E2E.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add docs/auth-web
```

- [ ] **Step 2: Amend the spec and the roadmap**

Every swap asserts that its anchor appears exactly once. If one fails, stop and report the anchor.

```bash
python3 - <<'PY'
from pathlib import Path

def amend(path, swaps):
    p = Path(path)
    s = p.read_text()
    for old, new in swaps:
        assert s.count(old) == 1, (path, old[:70])
        s = s.replace(old, new)
    p.write_text(s)

amend('docs/superpowers/specs/2026-10-07-wishlist-app-design.md', [
    ("  - `Max-Age` is 30 days.",
     "  - `Max-Age` is 400 days, the longest browsers keep a cookie. It's set at login and never reissued (D27)."),
    ("  - The cookie is reissued on refresh.",
     "  - The database's `expires_at` is the only authority: a session ends after 30 days without use. "
     "The cookie isn't reissued on refresh, because a refresh can happen on a server-to-server call "
     "whose `Set-Cookie` never reaches the browser (D27)."),
    ("""  - `default-src 'self'`
  - `script-src 'self' 'nonce-…'`
  - `img-src 'self' https: data:`
  - `connect-src 'self'` plus Sentry's ingest origin
  - `frame-ancestors 'none'`
  - On the auth pages only, `https://challenges.cloudflare.com` is added to both `script-src` and `frame-src` for Turnstile.""",
     """  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`. A fresh nonce per request, from the web app's proxy; so every page renders dynamically
  - `style-src 'self' 'unsafe-inline'`. React and `next/font` set style attributes, which a nonce can't cover (Plan 2b)
  - `img-src 'self' https: data:`
  - `font-src 'self'`
  - `connect-src 'self'` plus Sentry's ingest origin (Plan 5)
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
  - `frame-ancestors 'none'`
  - On the Turnstile pages only (`/signup`, `/verify-email`, `/reset-password`), `https://challenges.cloudflare.com` is added to `script-src`, and `frame-src` allows it.
  - Not `upgrade-insecure-requests`: it breaks `http://localhost` E2E, and `.dev` is HSTS-preloaded."""),
    ("- The visual direction is chosen during implementation using the `frontend-design` skill. The share page and the editor are mocked up for review before they're built.",
     "- The visual direction is **Warm Editorial Minimalism** (D28): a sand ground, espresso type and borders, terracotta for actions only, and sage for fulfilled states. Instrument Serif for headings, Geist for everything else, and 16px cards. The tokens live in `apps/web/src/app/globals.css`. The share page and the editor are mocked up for review before they're built (Plan 3)."),
    ("| D26 | Product name **Hanker** on `hanker.dev` (2026-10-09). The user-facing name changes; code, packages, projects and tables keep `wishlist` | `hanker.app` and `hanker.com` (both registered); keeping the generic \"Wishlist\" |",
     "| D26 | Product name **Hanker** on `hanker.dev` (2026-10-09). The user-facing name changes; code, packages, projects and tables keep `wishlist` | `hanker.app` and `hanker.com` (both registered); keeping the generic \"Wishlist\" |\n"
     "| D27 | A long-lived session cookie (400 days, set only at login); the database's sliding expiry is the only authority (2026-10-10) | A cookie tied to the 30-day session and reissued on refresh, which server-to-server calls lose; the web proxy reissuing it |\n"
     "| D28 | Warm Editorial Minimalism: sand, espresso, terracotta and sage, with Instrument Serif and Geist (2026-10-10) | Six mocked directions: Wish Book, Ribbon, Candlelight, Folio, Board, Letter |\n"
     "| D29 | Go-live in two steps: the domain, DNS, Resend and the Turnstile widget in Plan 2b; the Turnstile secret, which opens sign-up, in Plan 3 (2026-10-10) | Opening sign-up in Plan 2b, before there is a list to make |"),
])

r = Path('docs/superpowers/plans/2026-10-07-roadmap.md')
t = r.read_text()
row = t[t.index("| 2b | Auth web & go-live |"):]
row = row[:row.index("\n")]
assert t.count(row) == 1
t = t.replace(row,
    "| 2b | [Auth web & go-live](2026-10-10-plan-2b-auth-web.md) | §6.1, §6.7, §6.9, §7 auth routes, §10 Domain and DNS | "
    "`hanker.dev`, DNS, Resend and the Turnstile widget; the Warm Editorial theme; landing, sign-up, verify, login, reset, "
    "a signed-in home and the account parts of `/settings`; proxy with nonce CSP; Mailpit-backed E2E golden path; the "
    "auth API's go-live hardening. Sign-up stays dark (D29) | Done |")
plan3 = t[t.index("| 3 | Owner wishlist |"):]
plan3 = plan3[:plan3.index("\n")]
t = t.replace(plan3, plan3.replace(
    "visual direction via the `frontend-design` skill",
    "list and share pages in the Warm Editorial theme (D28); opens sign-up by setting `TURNSTILE_SECRET_KEY` (D29)"))
r.write_text(t)
PY
grep -nE "D2[789]|style-src" docs/superpowers/specs/2026-10-07-wishlist-app-design.md | cut -c1-90
grep -nE "^\| (2b|3) " docs/superpowers/plans/2026-10-07-roadmap.md | cut -c1-80
```

Expected:
- The spec shows the three decision rows and the `style-src` line.
- The roadmap shows rows 2b (Done) and 3.

- [ ] **Step 3: The deployment guide**

In `docs/deployment.md`:
- Replace the `TURNSTILE_SECRET_KEY` and `EMAIL_TRANSPORT=resend` rows of the environment table with the rows below.
- Add the `TURNSTILE_SITE_KEY` rows after `Set at build by CI`.

```markdown
| Vercel `wishlist-api` → Production | `TURNSTILE_SECRET_KEY` (sensitive) | **Unset until Plan 3 (D29).** While unset, sign-up, resend-verification and reset-request answer `503 CAPTCHA_UNAVAILABLE`, and the web app says sign-ups are paused. Setting it opens sign-up: see "Opening sign-up" |
| Vercel `wishlist-api` → Production | `EMAIL_TRANSPORT=resend`, `EMAIL_FROM=Hanker <no-reply@mail.hanker.dev>`, `RESEND_API_KEY` (sensitive) | Set in Plan 2b. The API refuses to boot in production with Turnstile set and `EMAIL_TRANSPORT=log` |
| GitHub repo variable | `TURNSTILE_SITE_KEY` | The production widget's public site key (Cloudflare → Turnstile → Hanker). The production web build fails without it |
| Set at build by CI | `TURNSTILE_SITE_KEY` (web) | The repo variable in `deploy.yml`; Cloudflare's always-pass test key in CI and previews |
```

Then add this section before `## Environment variables`:

````markdown
## Domain and DNS

`hanker.dev` is registered at Cloudflare, and DNS stays there (spec §10).

| Record | Points at | Proxy |
| --- | --- | --- |
| `hanker.dev` and `www.hanker.dev` | The records Vercel → `wishlist-web` → Settings → Domains shows. `www` redirects to the apex (308) | **DNS only (grey cloud).** Proxying breaks Vercel's certificates and caching |
| `mail.hanker.dev` (MX, SPF and DKIM `TXT`) | The records Resend → Domains shows | DNS only |
| `_dmarc.hanker.dev` (`TXT`) | `v=DMARC1; p=none;`. Monitor first, then tighten | DNS only |

- **Turnstile:** Cloudflare → Turnstile → widget "Hanker", hostname `hanker.dev`, mode Managed. The site key is the `TURNSTILE_SITE_KEY` repo variable. The secret key stays offline until sign-up opens.
- **The canonical origin:** `APP_ORIGIN` and the `APP_PRODUCTION_ORIGIN` repo variable are both `https://hanker.dev`. State-changing calls from any other origin, including the `*.vercel.app` production alias, get `403 FORBIDDEN_ORIGIN`.
````

And this section after `## Daily cron`:

````markdown
## Opening sign-up (Plan 3)

Sign-up is dark until the Turnstile secret is set (D29). To open it:

```bash
read -rs TURNSTILE_SECRET && printf %s "$TURNSTILE_SECRET" \
  | npx --yes vercel@62.5.0 env add TURNSTILE_SECRET_KEY production --sensitive --project wishlist-api --scope shockolate
unset TURNSTILE_SECRET
```

Then redeploy (or merge to `main`). Sign up with a real address on https://hanker.dev, and check that the verification email arrives from `no-reply@mail.hanker.dev`.
````

- [ ] **Step 4: The development guide, AGENTS.md and README**

In `docs/development.md`, add this section after `## Trying the auth API`:

````markdown
## Trying the pages

With `pnpm dev` running, open http://localhost:3000/signup.
- The Turnstile widget is Cloudflare's always-pass test key (`TURNSTILE_SITE_KEY` in `apps/web/.env.development`), so it ticks itself.
- Every email lands in Mailpit at http://localhost:8025.
- A web *build* (not `next dev`) needs `API_ORIGIN` and `TURNSTILE_SITE_KEY` in the environment. Outside production, use the test key `1x00000000000000000000AA`.
- `pnpm test:e2e` runs the account flows against production builds, with mail through Mailpit and Cloudflare's test widget. It needs Docker and network access to `challenges.cloudflare.com`.
````

In `AGENTS.md`:
- Replace the Environment bullet that begins "Building the web app needs `API_ORIGIN`" with:

```markdown
- Building the web app needs `API_ORIGIN` and `TURNSTILE_SITE_KEY`, for example `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's test key). Only `next dev` reads them from `apps/web/.env.development`.
```

- The verification gate's build line becomes:

```bash
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
```

- Add a Conventions bullet after "Naming":

```markdown
- **Web:**
  - `apps/web/src/proxy.ts` gives every page a nonce CSP and does cookie-presence redirects. The API decides who is signed in.
  - Account forms call the API through `browserApi` (the `/api` rewrite), never Server Actions.
  - Error copy lives only in `src/lib/messages.ts`.
  - UI pieces are hand-copied, shadcn/ui-style, in `src/components/ui`, on the theme tokens in `globals.css`. Terracotta (`primary`) never carries text.
```

In `README.md`:
- The heading becomes `# Hanker`.
- The first sentence becomes "Hanker is a wishlist app for family and friends, at https://hanker.dev." The rest of the paragraph is unchanged.

- [ ] **Step 5: Gate, commit, and submit the stack**

```bash
pnpm format:check || (pnpm exec prettier --write docs AGENTS.md README.md && pnpm format:check)
git add docs AGENTS.md README.md
git commit -F - <<'EOF'
docs: record the auth web, the theme and the two-step go-live

The spec takes D27 (a long-lived cookie, the database decides), D28 (Warm
Editorial Minimalism) and D29 (go-live in two steps), and its CSP as
built. The deployment guide covers hanker.dev, DNS, Resend, Turnstile and
how Plan 3 opens sign-up; the development guide covers the pages and E2E.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give each PR its commit's title with `gh pr edit <n> --title "…"`.

Expected: every PR in `auth-web` passes CI and its preview, including `e2e` and `smoke`.

---

### Task 17: ⏸ CHECKPOINT: review the preview, merge `auth-web`, and verify production (still dark)

**Files:** none. Run by the controller with Ted.

- [ ] **Step 1: Ted reviews the top preview against the canvas**

- Open the top PR's web alias (`https://<PREVIEW_ALIAS_PREFIX><n>.vercel.app`).
- Walk landing → sign-up → login, with the verification link from `pnpm exec vercel logs <api-preview-url>`, as in Plan 2a Task 13 → `/list` → `/settings`.
- Compare against the "Hanker theme" page of https://claude.ai/artifact/ETBdkEdoM9PuetGUKMahys. Note anything to change. Small fixes go into the top layer before merging.

- [ ] **Step 2: Check the production prerequisites**

Run: `gh variable list`

Expected:
- `TURNSTILE_SITE_KEY` exists (Task 1). Without it the production web build fails.
- `APP_PRODUCTION_ORIGIN` is `https://hanker.dev`.

- [ ] **Step 3: Ted merges the stack**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 4: Verify production**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
APP=$(gh variable get APP_PRODUCTION_ORIGIN)
curl -sSI "$APP/login" | grep -iE '^content-security-policy:' | grep -o "script-src[^;]*"
curl -sSI "$APP/signup" | grep -iE '^content-security-policy:' | grep -o "frame-src[^;]*"
curl -sS -o /dev/null -w 'settings without a session: %{http_code} → %{redirect_url}\n' "$APP/settings"
curl -s -X POST "$APP/api/auth/signup" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase","displayName":"Probe","turnstileToken":"x"}' | jq -r .code
```

Expected:
- **Deploy:** 7/7, with smoke passing on the new landing and login pages.
- **Login CSP:** `script-src 'self' 'nonce-…' 'strict-dynamic'`.
- **Sign-up CSP:** `frame-src https://challenges.cloudflare.com`.
- **Settings without a session:** `307 → …/login?next=%2Fsettings`.
- **The sign-up probe:** `CAPTCHA_UNAVAILABLE`, so it's still dark.

Then Ted opens https://hanker.dev/signup in a browser and checks:
1. The real Turnstile widget renders.
2. Submitting shows "Sign-ups and account emails are paused right now. Try again later."
3. https://hanker.dev/login with a made-up account says "That email and password don't match." That proves the CSRF origin is `hanker.dev`.
