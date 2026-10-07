# Wishlist App — Design Spec

- **Date:** 2026-10-07
- **Status:** Draft, pending review
- **Author:** Ted Armstrong (with Claude)
- **Repo:** `github.com/Shockolate/wishlist-app` (public; not yet created)

## 1. Intent

A wishlist app for family and friends. A signed-in owner curates one list of
gifts they'd like and sends a secret link to the people who might buy for them.
Anyone holding the link can see the list and claim items so the same gift isn't
bought twice.

The project is also a deliberate exercise in Staff-level engineering. It should
be **durable** (it survives months of idle time and seasonal spikes with no
babysitting), **flexible** (decisions are cheap to revisit), and **free** to run,
apart from a domain at roughly $10–15 a year.

### Success criteria

1. An owner can sign up, verify their email, build and order a list, and share it in under five minutes from a phone.
2. A gifter who opens a share link from a text message can claim an item in three taps, and get back to their claim later from any device.
3. Two gifters claiming the last unit at the same moment never both succeed.
4. An owner who hasn't opted in never receives claim data from the server, not just in the UI.
5. A merge to `main` reaches production with no manual steps. A bad deploy is rolled back with Vercel Instant Rollback, and a bad data change is recoverable from a backup up to 30 days old.
6. The running cost is $0 per month beyond the domain.

### Non-goals (v1)

These are explicit so they don't creep in:

- More than one list per user, and co-owners or shared editing.
- An item "received" state or history. Owners delete items they received.
- Price tracking or scheduled re-fetching of metadata.
- Emails to gifters, including "email me my claim link".
- OAuth or social login, magic links, and 2FA.
- Notifications of any kind.
- An admin UI.
- Internationalization. The app is English only, and prices are display strings.

## 2. Product rules

### Actors

- **Owner:** a signed-in user with a verified email. They own exactly one wishlist.
- **Gifter:** anyone holding a share link. A gifter has no account and is identified only by the display name they type when claiming.

### Wishlist

- One per user. It's created in the same transaction as the user, with the default title `"<displayName>'s wishlist"`.
- Settings:
  - `title`, 1–100 characters.
  - `showClaimsToOwner`, default `false`.
  - The share token, which the owner can rotate.

### Items

- An item is either a **URL item**, where `url` is set, or an **idea**, where `url` is null. Nothing else distinguishes the two.
- Fields:

  | Field | Rules |
  |---|---|
  | `title` | Required, 1–200 characters |
  | `url` | Optional, http or https, at most 2048 characters |
  | `imageUrl` | Optional, https only |
  | `priceText` | Optional, at most 50 characters |
  | `note` | Optional, at most 1000 characters. This is the owner's comment to gifters |
  | `quantity` | 1–99 |
  | `position` | Set by the server |

- A list holds at most **200 items**.
- New items are appended at the end of the list.
- The owner can edit any field, delete an item, and reorder the list.
- Deleting an item **hard-deletes** it and cascades to its claims.

### Claims

- A claim has a `claimerName` (1–50 characters), a `quantity` of at least 1, and a private **manage link**.
- **Remaining** = `greatest(0, item.quantity − Σ claim.quantity)`.
  - Remaining is always computed, never stored.
  - A new claim, or an increase to an existing claim, may not exceed remaining at the moment it's written. This is enforced transactionally (§6.3).
- **Owners may lower an item's quantity below what's been claimed.** The API doesn't refuse it, because refusing would tell the owner something was claimed. Gifters then see the item as fully claimed.
- Through its manage link, a claimer can:
  - change their name,
  - change the quantity, as long as the new quantity is at least 1 and at most remaining plus their current quantity,
  - or delete the claim.
- If the item, the list, or the owner's account is deleted, the claim is deleted with it. The manage page then says: *"This claim no longer exists. The owner may have removed the item."*
- Gifters can see other gifters' names and quantities (e.g. "Aunt Sue ×1"), so they can coordinate.
- An owner can't claim items on their own list. The UI hides the claim controls, and the API rejects the request with `403 OWNER_CANNOT_CLAIM`.

### Spoilers

- By default, the owner never receives claim data from any endpoint, including when they view their own share link while signed in.
- If `showClaimsToOwner = true`, the owner sees remaining counts and claimer names in both the editor and the share view.
- The UI asks for confirmation before turning the setting on.

### Share link

- The link is `/s/<shareToken>`. The token is 128-bit random, encoded as base64url (22 characters).
- Rotating the token makes the old link return 404 immediately.
- Existing claims, and their manage links, are unaffected by a rotation.

## 3. Architecture

### Topology

The app runs as two Vercel projects behind one origin, joined by a Next.js rewrite.

```
Browser ──► https://<domain>  (Vercel project: wishlist-web, Next.js)
              ├── pages, RSC
              └── rewrite /api/:path* ──► API_ORIGIN/api/:path*
                                              (Vercel project: wishlist-api, NestJS, one Vercel Function)
                                                   └── pg (TCP, pooled) ──► Neon Postgres
```

**Why this topology:**

- The browser only ever talks to one origin. The session can therefore be a first-party `HttpOnly; SameSite=Lax` cookie, with no CORS.
- That holds in previews as well as production.
- **Rejected: subdomains with CORS.** `*.vercel.app` is on the Public Suffix List, so a web preview and an API preview count as different sites. Their cookies would be third-party, and browsers block third-party cookies.
- **Rejected: running Nest inside a Next.js route handler.** It means framework friction (decorator metadata versus Next's compiler), an artificial service boundary, and a hard exit if the app ever moves off Vercel.

**Costs we accept:**

- Browser API calls take an extra hop through Vercel's edge.
- Each PR deploys twice.
- After idle time a request can hit two cold starts.

### Repository layout

```
wishlist-app/
├── apps/
│   ├── web/                  Next.js (App Router)
│   └── api/                  NestJS
│       └── src/db/           Drizzle schema + generated SQL migrations (committed)
├── packages/
│   ├── contracts/            Zod schemas for every request/response + error codes
│   └── config/               Shared tsconfig, ESLint, Prettier
├── docs/
│   ├── superpowers/specs/    This document
│   ├── deployment.md         From-zero production setup
│   └── development.md        Local setup and workflows
├── .github/workflows/
├── docker-compose.yml        Postgres 17 + Mailpit
└── renovate.json
```

### Technology choices

| Concern | Choice | Why |
|---|---|---|
| Package manager | pnpm (pinned via the `packageManager` field) | Workspaces. Installed through npm rather than corepack, because Node 25+ doesn't bundle corepack |
| Monorepo | Turborepo | Affected-only builds and tests, plus Vercel's free remote cache |
| Runtime | Node 24 LTS (`.nvmrc`, `engines`, Vercel project setting) | The current LTS that Vercel supports |
| Web | Next.js, latest stable, App Router | Required by the brief |
| API | NestJS, latest stable, Express adapter | Required by the brief. Vercel deploys it with zero configuration as one Function on Fluid compute |
| Contract | Shared Zod schemas in `packages/contracts` | One source of truth: a breaking change fails typecheck in both apps in the same PR. OpenAPI is generated *from* the schemas. Rejected: class-validator DTOs plus OpenAPI codegen, which adds a codegen step and lets generated files drift, and only pays off for external consumers |
| Database | Neon Postgres 17, free plan | Scales to zero and wakes on the next query. Rejected: Supabase free, which pauses a project after 7 days of low activity and needs a manual restore |
| ORM | Drizzle with `pg` over TCP to Neon's pooled endpoint | SQL-shaped API, no engine binary, and plain SQL migrations. The TCP driver is required for interactive transactions (`SELECT … FOR UPDATE`). One small pool per Fluid instance, closed on suspend using Vercel's pool helper |
| IDs | UUIDv7, generated in the application | Time-ordered, so index-friendly, and not enumerable |
| Email | Resend (free tier) on the owned domain | Real verification and reset emails |
| CAPTCHA | Cloudflare Turnstile | Free and unobtrusive |
| Errors | Sentry (free tier), both apps | Vercel Hobby keeps runtime logs for only 1 hour |
| Tests | Jest, Testcontainers, supertest, Playwright, axe | §8 |
| UI | Tailwind, shadcn/ui (Radix primitives), react-hook-form, TanStack Query, dnd-kit | §7 |

Only `apps/api` has database credentials. The web app has no database connection.

## 4. Data model

All timestamps are `timestamptz`. All foreign keys are `ON DELETE CASCADE`.

```sql
users (
  id                 uuid PRIMARY KEY,               -- v7
  email              text NOT NULL,                  -- stored lowercased
  password_hash      text NOT NULL,                  -- argon2id PHC string
  display_name       text NOT NULL,                  -- 1–50 chars
  email_verified_at  timestamptz,
  created_at, updated_at
);
CREATE UNIQUE INDEX ON users (lower(email));

sessions (
  id            text PRIMARY KEY,                    -- sha256(token), hex
  user_id       uuid NOT NULL REFERENCES users,
  created_at, expires_at, last_seen_at
);

email_tokens (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users,
  purpose       text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at
);

wishlists (
  id                     uuid PRIMARY KEY,
  owner_id               uuid NOT NULL UNIQUE REFERENCES users,
  title                  text NOT NULL,
  share_token            text NOT NULL UNIQUE,         -- plaintext, by design
  show_claims_to_owner   boolean NOT NULL DEFAULT false,
  created_at, updated_at
);

items (
  id            uuid PRIMARY KEY,
  wishlist_id   uuid NOT NULL REFERENCES wishlists,
  title         text NOT NULL,
  url           text,
  image_url     text,
  price_text    text,
  note          text,
  quantity      int  NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  position      int  NOT NULL,
  created_at, updated_at
);
CREATE INDEX ON items (wishlist_id, position);

claims (
  id                  uuid PRIMARY KEY,
  item_id             uuid NOT NULL REFERENCES items,
  claimer_name        text NOT NULL,
  quantity            int  NOT NULL CHECK (quantity >= 1),
  manage_token_hash   text NOT NULL UNIQUE,
  created_at, updated_at
);
CREATE INDEX ON claims (item_id);

rate_limits (
  key            text NOT NULL,
  window_start   timestamptz NOT NULL,
  count          int NOT NULL,
  PRIMARY KEY (key, window_start)
);
```

### Notes on the model

- **One list per user is enforced by `UNIQUE(owner_id)`, not by putting items on `users`.** Supporting multiple lists later means dropping a constraint, not migrating every item.
- **How each token is stored:**

  | Token | Size | Stored as | Why |
  |---|---|---|---|
  | Session | 256-bit | SHA-256 hash | A database leak gives an attacker nothing usable. SHA-256 is enough for high-entropy random tokens; argon2 is only needed for passwords people choose |
  | Email (verify and reset) | 256-bit | SHA-256 hash | Same as above |
  | Claim manage | 128-bit | SHA-256 hash | Same as above. Kept to 128 bits so links that get texted stay short |
  | Share | 128-bit | **Plaintext** | The owner must be able to copy their link at any time. It's a public, low-privilege capability, and rotation is the fix if it leaks |

- **Reorder uses a plain integer `position`, rewritten in full by the reorder endpoint (§5).** Rejected: fractional indexing, which solves write amplification this app doesn't have (at most 200 items) and adds key growth and rebalancing.
- **Rate limits live in Postgres** as fixed-window counters, written with an upsert. Rejected: Redis or Upstash, which would be a second stateful free-tier service to keep alive.
- **There's no `kind` column on items.** "Idea versus link" is `url IS NULL`.

## 5. API

- Every route is under `/api`. Request bodies are `application/json`.
- Each request and response has a Zod schema in `packages/contracts`. A global Zod validation pipe validates requests.
- Errors are RFC 9457 `application/problem+json` with a stable `code` and the `requestId`. For validation failures they also include `errors[]`, the path of each bad field.

### Auth

| Method & path | Body | Result |
|---|---|---|
| `POST /auth/signup` | `{email, password, displayName, turnstileToken}` | `202` always. Creates the user and wishlist and sends a verification email. If the email already exists, sends an "you already have an account; reset your password?" email instead |
| `POST /auth/verify-email` | `{token}` | `204`; sets `email_verified_at` |
| `POST /auth/resend-verification` | `{email, turnstileToken}` | `202` always |
| `POST /auth/login` | `{email, password}` | `204` and sets the session cookie, or `401 INVALID_CREDENTIALS` |
| `POST /auth/logout` | none | `204`; deletes the session |
| `POST /auth/password-reset/request` | `{email, turnstileToken}` | `202` always |
| `POST /auth/password-reset/confirm` | `{token, newPassword}` | `204`. Revokes **all** sessions and sets `email_verified_at` if it was null, because receiving the reset proves the person controls the inbox |
| `GET /me` | none | `{id, email, displayName, emailVerified}` |
| `PATCH /me` | `{displayName}` | Updated user |
| `POST /me/password` | `{currentPassword, newPassword}` | `204`. Revokes all **other** sessions |
| `DELETE /me` | `{password}` | `204`. Cascades everything and clears the cookie |

Unverified users can log in. Every owner endpoint returns `403 EMAIL_NOT_VERIFIED` for them, and the web app shows a "check your email or resend" screen.

### Owner endpoints

These require a session and a verified email. The list is always derived from the session; no endpoint takes a list ID.

| Method & path | Body | Result |
|---|---|---|
| `GET /wishlist` | none | The wishlist, its items, and the share URL. Claim data appears only if `showClaimsToOwner` |
| `PATCH /wishlist` | `{title?, showClaimsToOwner?}` | Updated wishlist |
| `POST /wishlist/share-token/rotate` | none | `{shareUrl}` |
| `POST /wishlist/unfurl` | `{url}` | `{title?, imageUrl?, priceText?, failureReason?}`, always `200`. A prefill only; nothing is saved |
| `POST /wishlist/items` | item fields | `201` with the item, appended at the end. `422 LIST_FULL` at 200 items |
| `PATCH /wishlist/items/:id` | partial item fields | Updated item |
| `DELETE /wishlist/items/:id` | none | `204` |
| `PUT /wishlist/items/order` | `{itemIds: uuid[]}` | `204`, or `409 ORDER_CONFLICT` if the IDs aren't exactly the list's current item set |

An item ID that belongs to another user's list returns `404`, the same as one that doesn't exist.

### Public endpoints (capability tokens)

| Method & path | Body | Result |
|---|---|---|
| `GET /shared/:shareToken` | none | `{title, ownerDisplayName, items[], viewerIsOwner}`. `404` if the token is unknown |
| `POST /shared/:shareToken/items/:itemId/claims` | `{claimerName, quantity}` | `201 {claim, manageToken}`, `409 CLAIM_EXCEEDS_REMAINING {remaining}`, or `403 OWNER_CANNOT_CLAIM` |
| `GET /claims/:manageToken` | none | `{claim, item, wishlistTitle, ownerDisplayName, remaining, shareUrl}`, or `404` |
| `PATCH /claims/:manageToken` | `{claimerName?, quantity?}` | Updated claim, or `409 CLAIM_EXCEEDS_REMAINING` |
| `DELETE /claims/:manageToken` | none | `204` |

- `shareUrl` in the claim response is the wishlist's **current** share URL, so it stays correct after a rotation. The manage token itself is the authorization.
- Each item in the `GET /shared` response has: `id, title, url, imageUrl, priceText, note, quantity`, and `remaining` and `claims[] {id, claimerName, quantity}` when the viewer may see them (§5.1).
- Claims are only ever changed by **manage token**. A claim ID grants nothing.

### 5.1 Spoiler projection

All claim visibility goes through one pure function in the API:

```ts
type Viewer = { kind: 'guest' } | { kind: 'owner'; showClaims: boolean };
projectWishlist(wishlist, items, claims, viewer): WishlistView
```

| Viewer | `remaining` | `claims[]` |
|---|---|---|
| guest | included | included |
| owner, `showClaims = false` | **omitted** | **omitted** |
| owner, `showClaims = true` | included | included |

- `GET /wishlist` always uses an owner viewer.
- `GET /shared/:token` uses an owner viewer when the session's user owns the list, and a guest viewer otherwise.
- The function is unit-tested exhaustively, and the integration tests assert the fields are **absent** from the JSON, not just empty.

## 6. Auth and security

### 6.1 Sessions

- **The cookie:** `__Host-session`, holding a 256-bit random token (base64url).
  - Flags: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - `Max-Age` is 30 days.
- **Expiry:** sliding.
  - `expires_at` and `last_seen_at` are refreshed at most once an hour, so reads don't cause a write on every request.
  - The cookie is reissued on refresh.
- **Revocation:** logout deletes the session row.
  - Password reset deletes every session for the user.
  - Password change deletes every session except the current one.
  - Account deletion cascades to all sessions.
- **The web app's role is limited.** Its request proxy only checks whether the cookie *exists*, to redirect signed-out users away from `/list` and `/settings`. Every authorization decision is made in the API.
- **Rejected: JWTs.** They can't be revoked instantly, and they bring key rotation to manage. The cost of the database approach is one indexed lookup per request.

### 6.2 CSRF

There are two independent layers:

1. `SameSite=Lax` keeps the session cookie off cross-site POST, PATCH, PUT and DELETE requests.
2. A global guard rejects state-changing requests unless:
   - `Origin` equals the configured `APP_ORIGIN`, which is set per environment, and
   - `Content-Type` is `application/json`, which forces a CORS preflight for any cross-origin request.

There are no CSRF tokens.

### 6.3 Claim concurrency

**Creating a claim** runs in one transaction:

1. `SELECT … FROM items WHERE id = $1 AND wishlist_id = $2 FOR UPDATE`. This serializes all claim writes for that item.
2. `SELECT coalesce(sum(quantity), 0) FROM claims WHERE item_id = $1`.
3. If `requested > item.quantity − sum`, return `409 CLAIM_EXCEEDS_REMAINING` with the current remaining.
4. Otherwise, insert the claim.

**Updating a claim** uses the same transaction shape, excluding the claim's own quantity from the sum.

### 6.4 Passwords

- **Hashing:** argon2id via `@node-rs/argon2`. It ships prebuilt binaries, so there's no node-gyp build. Parameters follow OWASP: m=19 MiB, t=2, p=1.
- **Length:** 10–128 characters. The upper cap stops oversized inputs being used to burn CPU.
- **Breached-password check:** passwords are checked against Have I Been Pwned's Pwned Passwords range API (k-anonymity, so only a 5-character SHA-1 prefix leaves the server). The check runs on signup, reset and change. If HIBP is unavailable, the check is skipped.
- **Timing:** a login for an unknown email still verifies against a dummy hash, so the timing doesn't reveal which emails have accounts.

### 6.5 Email tokens and Turnstile

- **Token lifetimes:** verify links last 24 hours and reset links last 1 hour.
- **Single use:** both kinds are marked consumed in the same transaction that uses them.
- **One live token per purpose:** issuing a new token invalidates the user's earlier unconsumed tokens for the same purpose.
- **Turnstile** is required on every endpoint that sends email to a caller-supplied address: signup, resend-verification and reset-request. If Turnstile is unavailable, those endpoints refuse the request.
- **Cleanup:** a daily cron purges unverified accounts older than 7 days and expired email tokens. This keeps squatted, never-verified addresses from blocking a real signup indefinitely.

### 6.6 Rate limits

These are the initial values. They're configurable, and every limited endpoint returns `429` with a `Retry-After` header.

| Endpoint | Keys and limits |
|---|---|
| `POST /auth/login` | 10 per 15 minutes per email, and 50 per 15 minutes per IP |
| signup, resend-verification, reset-request | 3 per hour per email, and 20 per hour per IP |
| `POST …/claims`, `PATCH /claims/*` | 30 per hour per share token, and 20 per hour per IP |
| `POST /wishlist/unfurl` | 60 per hour per user |

**Open question (spike):** do requests forwarded by the Next.js rewrite carry the browser's real IP, and in which header? If there's no reliable answer, the per-IP limits are dropped and the endpoints are limited on their other keys only.

### 6.7 Tokens in URLs

- **Referrer policy:** `/s/*` and `/c/*` respond with `Referrer-Policy: no-referrer`. Outbound product links also carry `rel="noopener noreferrer"`. Without this, clicking through to a retailer would send the share or manage URL in the `Referer` header.
- **Indexing:** the same pages respond with `X-Robots-Tag: noindex`, and they're disallowed in `robots.txt`.
- **Sentry:** `beforeSend` scrubs token path segments.
- **Accepted:** Vercel's request logs contain the tokens. They're retained for 1 hour and only the account owner can read them.
- **Token query strings:** the verify and reset pages read the token from the query string, POST it, then remove it from the address bar with `history.replaceState`.

### 6.8 Unfurl (SSRF)

`MetadataFetcher` enforces the following:

- **Scheme and port:** `http` or `https` only, on port 80 or 443. Userinfo in the URL is rejected.
- **Resolution:** the hostname is resolved by the server, and the URL is rejected if **any** resolved address is:
  - loopback, private, link-local, CGNAT, unique-local, multicast or unspecified, or
  - an IPv4-mapped or IPv4-translated IPv6 form of any of those.

  Classification uses `ipaddr.js` range matching.
- **DNS rebinding:** the connection goes to the **vetted IP**, through a custom `lookup` on the undici agent, so the address can't change between the check and the connection. The original Host header and SNI are kept.
- **Redirects:** followed manually, at most 3 hops, with every hop checked the same way.
- **Limits:** 5-second total timeout. A 1 MB response cap, enforced while streaming. Only `text/html` is accepted.
- **Parsing:** done with a real HTML parser. Sources are tried in this order: Open Graph tags, then JSON-LD `Product` (name, image, offers price and currency), then `<title>`.
- **Images:** the extracted image URL must be https, and the server never fetches it.
- **Failure:** any failure returns `200` with empty fields and a `failureReason` code, e.g. `BLOCKED_BY_SITE`, `TIMEOUT`, `NOT_HTML` or `DISALLOWED_ADDRESS`.

### 6.9 Headers

- **CSP:**
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…'`
  - `img-src 'self' https: data:`
  - `connect-src 'self'` plus Sentry's ingest origin
  - `frame-ancestors 'none'`
  - On the auth pages only, `https://challenges.cloudflare.com` is added to both `script-src` and `frame-src` for Turnstile.
- **Other headers:** `X-Content-Type-Options: nosniff`, and HSTS (Vercel's default).
- **Retailer images:** rendered as plain `<img loading="lazy" referrerpolicy="no-referrer">`, **not** `next/image`. Configuring `next/image` to accept images from any host would turn the image-optimization quota into an open image proxy.

## 7. Web app

### Routes

| Route | Rendering | Notes |
|---|---|---|
| `/` | Server | Landing page. Redirects to `/list` when signed in |
| `/signup`, `/login`, `/verify-email`, `/reset-password`, `/reset-password/confirm` | Client forms | Call `/api/auth/*` directly, so the `Set-Cookie` lands from the API response |
| `/list` | Server shell + client editor (TanStack Query) | Optimistic updates for reorder, quantity and delete, rolled back on error |
| `/settings` | Client | Display name; spoiler toggle with confirmation; rotate the share link; change password; delete account |
| `/s/[shareToken]` | Server Component | Readable before JavaScript loads. Claim controls hydrate afterwards |
| `/c/[manageToken]` | Server Component + client form | Manage one claim |

**How the web app calls the API:**

- Server Components call the API **server-to-server**, at `API_ORIGIN`, forwarding the incoming `cookie` header. That's how the owner case on `/s/*` works.
- The browser calls go through the same-origin `/api/*` rewrite.
- **Auth forms deliberately don't use Server Actions.** A Server Action would have to read the API's `Set-Cookie` and re-issue it, defining the cookie's attributes in two places.

### Typed client

- `apiFetch` validates **every** response against its `contracts` schema.
- Web and api deploy independently, so for a short time during a deploy they can be out of step. Validation turns that version skew into a clear error instead of `undefined` reaching the UI.
- Error codes from problem+json map to user-facing messages in one table.

### Claim flow (mobile-first)

1. The gifter taps "I'll get this". A bottom sheet opens with:
   - a name field, prefilled from `localStorage`;
   - a quantity stepper, between 1 and remaining.
2. On `201`, the sheet shows the manage link with **Copy** and **Share** buttons. Share uses the Web Share API. The copy reads: "Save this link to change or cancel your claim."
3. `localStorage` stores `claims:<shareToken>` as `[{claimId, manageToken}]`. A returning gifter on the same browser sees "You're getting 1 · Change".
4. On a `409`, the stepper resets to the new remaining count and the sheet explains why.

`localStorage` is only a convenience. The manage link is the source of truth.

### Reordering

- dnd-kit, with its keyboard sensor enabled.
- Visible up and down buttons as well. They make reordering workable on phones and serve as the accessible fallback.
- Each move sends the full order to `PUT /wishlist/items/order`.
- On a `409`, the editor refetches the list and shows a toast.

### UI and accessibility

- Tailwind with shadcn/ui components, which are copied into the repo and built on Radix primitives.
- Forms use react-hook-form with the shared Zod schemas.
- The target is WCAG 2.2 AA.
- The visual direction is chosen during implementation using the `frontend-design` skill. The share page and the editor are mocked up for review before they're built.

## 8. Testing

**Ports and adapters.** External services are injected through interfaces:
`EmailSender`, `CaptchaVerifier`, `BreachedPasswordChecker`, `MetadataFetcher` and `Clock`. Tests swap in fakes through Nest's dependency injection.

| Layer | Scope | Tooling |
|---|---|---|
| Unit | `projectWishlist` (full table); the SSRF address classifier (every blocked range, mapped and odd encodings); unfurl parsers against saved retailer HTML fixtures; token, remaining and rate-window arithmetic | Jest |
| API integration | Every endpoint against real Postgres with real migrations. The database is never mocked | Jest, Nest testing module, supertest, Testcontainers (`postgres:17`) |
| E2E | Golden paths: signup → read verification mail → verify → build list → reorder → share → claim in a second browser context → manage claim → spoiler toggle. Axe on every page | Playwright against production builds, with Postgres and Mailpit in docker compose |
| Preview smoke | `/api/health` through the web origin, which proves the rewrite works; the landing page renders; an unknown share token returns 404. **Read-only**: nothing is written to the prod-cloned branch | Playwright against the PR's Vercel preview, using the automation-bypass token |

**Tests the plan must include:**

- **Claim race.** 20 concurrent claims against an item with quantity 1. Exactly one `201` and nineteen `409`s, and the claims sum to 1.
- **SSRF refusal through the real fetcher.** Unfurl against `127.0.0.1`, `[::1]`, `169.254.169.254` and `[::ffff:127.0.0.1]`, plus a redirect chain from a public fixture to a private address. All refused.
- **Spoilers.** Claim fields are absent from the JSON for an owner who hasn't opted in, on both `GET /wishlist` and `GET /shared/:token`.
- **Reorder conflict.** Sending a stale item set returns `409`.
- **Session revocation.** Revocation works on reset, password change and account deletion.
- **Enumeration resistance.** Signup and reset-request return identical responses for known and unknown emails.

Coverage is reported, not used as a gate. Critical modules (auth, claims, projection, SSRF) are written test-first.

## 9. Error handling

- **Domain errors:** typed exceptions (e.g. `ClaimExceedsRemainingError`). One global filter maps them to problem+json.
- **Unexpected errors:** a generic `500` with a `requestId`, captured to Sentry with the same `requestId`.
- **Web:** an `error.tsx` boundary per route. Messages are looked up by `code`; raw server text is never shown.

When a dependency fails, the behavior is fixed per service:

| Dependency down | Behavior |
|---|---|
| HIBP | Skip the breach check and log it |
| Turnstile | Refuse the email-sending endpoints and tell the user to try again later |
| Resend | The endpoint still returns `202`. The error goes to Sentry, and the user can resend |
| Unfurl target | `200` with empty fields; the owner fills them in by hand |
| Neon cold start | The `pg` connect timeout is 10 s. Non-idempotent writes aren't retried |

## 10. Environments, CI/CD and operations

### Environments

| Env | Web | API | Database | Email |
|---|---|---|---|---|
| Local | `next dev` on :3000, rewrites to :3001 | `nest start --watch` on :3001 | docker compose Postgres 17 | Mailpit |
| CI | Production build | Production build | Testcontainers or compose | Mailpit |
| Preview (per PR) | Vercel preview, **protected** | Vercel preview, unprotected | Neon branch `pr-<n>`, cloned from prod | **Log only, never sent** |
| Production | `https://<domain>` | `wishlist-api` production | Neon `main` | Resend |

- **Why the API preview is unprotected.** A Next.js rewrite can't attach Vercel's protection-bypass header. An unprotected API preview exposes the same surface as the production API: the same auth, and no secrets in responses.
- **Why preview email is log-only.** The preview database is cloned from production, so sending would mean real people get emails triggered by tests.

### Deployment model

- Vercel's Git integration is **disabled** on both projects, with `git.deploymentEnabled: false`. GitHub Actions is the only thing that deploys.
- The deploy sequence is `vercel pull`, then `vercel build`, then `vercel deploy --prebuilt`. Building in Actions reuses Turborepo's cache.

### Workflows

| File | Trigger | Steps |
|---|---|---|
| `ci.yml` | `pull_request` | install → `turbo lint typecheck test build` (affected) → API integration → E2E (compose) → `squawk` on new migrations. Its jobs are the ruleset's required checks |
| `preview.yml` | PR opened, synchronized or reopened | Create or reuse Neon branch `pr-<n>` → run migrations → deploy the API preview (`DATABASE_URL`, `APP_ORIGIN=https://<web alias>`, and `EMAIL_TRANSPORT=log` set for this deployment) → build the web app with `API_ORIGIN=<api preview URL>` → deploy the web preview → `vercel alias set` it to the PR's deterministic web alias → smoke test → upsert a PR comment with the URLs. Concurrency `preview-<n>`, cancel-in-progress |
| `cleanup.yml` | PR closed; nightly | Delete Neon branch `pr-<n>`. The nightly sweep deletes `pr-*` branches whose PR is closed, a safety net for Neon's free cap of 10 branches |
| `deploy.yml` | Push to `main` | Fast gates (cached) → `drizzle-kit migrate` on prod → deploy the API to production → poll `/api/health` → deploy the web app to production → smoke test prod → upload Sentry source maps. Concurrency `production`, `cancel-in-progress: false` |
| `backup.yml` | Nightly | `pg_dump` prod → encrypt with `age` → upload to Cloudflare R2. An R2 lifecycle rule keeps 30 days |

**Ordering that isn't obvious:**

- **The web build waits for the API preview URL.** Next.js compiles rewrite destinations into its build output, so the web app can't be built until `API_ORIGIN` is known.
- **The API needs the web URL before the web app exists.** The API's CSRF guard (§6.2) checks `Origin` against `APP_ORIGIN`, but the API preview is deployed *before* the web preview. The fix is a deterministic alias computed from the PR number, `wishlist-web-pr-<n>.vercel.app`:
  1. The alias is passed to the API as `APP_ORIGIN` when the API preview deploys.
  2. Once the web preview deploys, it's attached to that alias.

  Reviewers and smoke tests always use the alias.
  - **Rejected: a regex allowlist of preview URLs.** It's easy to get subtly wrong.
  - **Rejected: trusting `X-Forwarded-Host`.** It's unverified through rewrites.
- **Stack merges ship once.** With `cancel-in-progress: false`, a deploy that's already running is never interrupted (so a migration is never cut off), and GitHub keeps only the newest *pending* run. A stack that merges as N pushes to `main` therefore produces at most two deploys, and the last one ships the tip.
- **Expand/contract compatibility.** Each deploy step must work alongside the previous version of its neighbor:
  1. Migrations must be compatible with the currently deployed API.
  2. The API must be compatible with the currently deployed web app.

  Drops and renames happen in a later deploy than the change that stops using them. New response fields start out optional. `squawk` flags unsafe DDL, and review catches the rest.

### Recovery

| Failure | Recovery |
|---|---|
| Bad code | Vercel Instant Rollback, per project. Roll back the web app first, then the API |
| Bad data within 6 hours | Neon point-in-time restore (the free plan's window) |
| Bad data older than that | Restore the nightly encrypted dump from R2, kept for 30 days |

**Why backups can't go in Actions artifacts:** on a public repo, anyone can download them.

### Monitoring and maintenance

- Sentry in both apps.
- A free external uptime monitor on `/api/health`. The endpoint checks database connectivity and returns the applied migration version and the git SHA.
- A daily Vercel cron at `/api/internal/cron/daily`, authenticated with `CRON_SECRET`. It purges expired rate-limit windows, expired email tokens, expired sessions, and unverified accounts older than 7 days.

### Repository settings (all free on public repos)

- A ruleset on `main` requiring:
  - a pull request,
  - the `ci.yml` checks to pass,
  - no force pushes or deletion.
- CodeQL default setup, plus secret scanning with push protection.
- `actions/dependency-review-action` on PRs.
- Renovate with grouped weekly updates and automerge for devDependency patch updates.
- **Merge method: to be decided.** How a stack merges under squash isn't documented. The first plan task tests a two-PR stack on the real repo and sets the ruleset's allowed merge methods to match.

### Domain and DNS

- The domain is bought from Cloudflare Registrar.
- DNS stays on Cloudflare. The records pointing at Vercel are **DNS-only (grey cloud)**, because proxying in front of Vercel breaks certificate issuance and caching.
- Resend's SPF, DKIM and DMARC records are added on its sending subdomain.

### Secrets

| Where | Secrets |
|---|---|
| GitHub Environment `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_API`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `DATABASE_URL_DIRECT` (for migrations and dumps), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `AGE_RECIPIENT`, `SENTRY_AUTH_TOKEN` |
| GitHub Environment `preview` | The Vercel and Neon secrets above, plus `VERCEL_AUTOMATION_BYPASS_SECRET` |
| Vercel project env | `DATABASE_URL` (pooled), `APP_ORIGIN`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `SENTRY_DSN`, `CRON_SECRET`, `EMAIL_TRANSPORT` (`resend` or `log`) |

The private `age` key is never stored in GitHub. It's kept offline by the owner.

## 11. Developer environment prerequisites

As of 2026-10-07 on the development machine:

| Tool | Found | Action |
|---|---|---|
| node | 24.21.0 (nvm) | Keep. It's the current LTS |
| pnpm | missing | `npm i -g pnpm@latest` |
| vercel CLI | missing | `npm i -g vercel@latest` (≥ 48.4.0 is required for zero-config NestJS) |
| gh | 2.99.0 | `gh extension install github/gh-stack` |
| git | 2.43.0 | Works. Upgrading via `ppa:git-core/ppa` is optional |
| docker | 29.8.2 | Keep |

## 12. Delivery

- **Code arrives as GitHub stacked PRs, via `gh stack`.** The implementation plan groups tasks into stacks, each PR reviewable on its own.
- **Spikes come first in the plan.** The plan opens with three throwaway spikes, each reported as a finding before dependent work starts:
  1. How a stack merges, and therefore which merge methods the ruleset allows (§10).
  2. Which header, if any, carries the real client IP through the rewrite (§6.6).
  3. Whether `vercel alias set` to a `*.vercel.app` name works for CLI preview deployments on Hobby (§10). If it doesn't, the fallback is an anchored regex allowlist that matches only the web project's preview URLs in this Vercel scope.
- **Deliverables beyond code:**
  - `docs/deployment.md`: from-zero setup of the GitHub, Vercel, Neon, Cloudflare (Registrar, Turnstile, R2), Resend and Sentry accounts, with every secret and DNS record.
  - `docs/development.md`: local setup and workflows.
  - `README.md`.

## 13. Decision log

| # | Decision | Alternatives rejected |
|---|---|---|
| D1 | Claims hidden from the owner by default; the owner opts in per list | Always visible; never visible |
| D2 | Claims are rows with a quantity | A boolean claimed flag |
| D3 | Claimers give a name and get a private manage link | Anonymous browser token; honor system |
| D4 | One list per user, kept in its own table | Multiple lists; co-owners |
| D5 | Owner deletes received items; no received state | Mark received; claims expire on a date |
| D6 | Email and password login | Google OIDC; magic link; managed auth |
| D7 | Owned domain with Resend for email | Admin-issued resets; Gmail SMTP |
| D8 | Open signup with verified email, Turnstile and rate limits | Invite-only; admin approval |
| D9 | Best-effort unfurl with SSRF hardening | No unfurl; price refresh |
| D10 | Secret, rotatable share token | Friendly slug; multiple named links |
| D11 | Public repo with rulesets | Private repo (unprotected on GitHub Free) |
| D12 | Per-PR previews with Neon branches | Shared staging; prod only |
| D13 | Two Vercel projects, one origin via rewrites | Nest inside Next; subdomains with CORS |
| D14 | Zod contracts package | class-validator with OpenAPI codegen |
| D15 | Drizzle with `pg` over TCP | Prisma; Neon HTTP driver |
| D16 | Database sessions | JWT |
| D17 | Full-list reorder with integer positions | Fractional indexing |
| D18 | Postgres for rate limiting | Upstash Redis |
| D19 | Owners may lower quantity below claimed (refusing would leak spoilers) | Refuse the edit |
| D20 | No claim-link emails to gifters | Optional claimer email (spam-relay risk) |
| D21 | Plain `<img>` for retailer images | `next/image` with any remote host allowed |
| D22 | Nightly encrypted dump to R2 | Neon's 6-hour restore window only; Actions artifacts |
