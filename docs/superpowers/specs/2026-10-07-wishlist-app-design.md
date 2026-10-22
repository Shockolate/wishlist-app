# Wishlist App — Design Spec

- **Date:** 2026-10-07
- **Status:** Draft, pending review
- **Author:** Ted Armstrong (with Claude)
- **Repo:** `github.com/Shockolate/wishlist-app` (public; not yet created)
- **Product name:** **Hanker**, at `hanker.dev` (decided 2026-10-09, D26). Internal identifiers keep the domain noun `wishlist`.
- **Amended by:** [item tags and share-page filters](2026-10-21-item-tags-and-filters-design.md) (2026-10-21; D58 on). Plan 7a amends §2, §4 and §5 for the tags API, and Plan 7b §7 for the web.

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
  - `title`, 1–100 visible characters (D35).
  - `showClaimsToOwner`, default `false`.
  - The share token, which the owner can rotate.

### Items

- An item is either a **URL item**, where `url` is set, or an **idea**, where `url` is null. Nothing else distinguishes the two.
- Fields:

  | Field | Rules |
  |---|---|
  | `title` | Required, 1–200 visible characters (D35) |
  | `url` | Optional, http or https, at most 2048 characters |
  | `imageUrl` | Optional, https only |
  | `priceText` | Optional, at most 50 visible characters (D36) |
  | `note` | Optional, at most 1000 characters. This is the owner's comment to gifters |
  | `tags` | 0–10 per item, by the tag rule in the [tags design](2026-10-21-item-tags-and-filters-design.md) §3 |
  | `quantity` | 1–99 |
  | `position` | Set by the server |

- A list holds at most **200 items**.
- A tag belongs to one list. A list holds at most **50 tags**. A name is shown as typed after clean-up (trimmed, whitespace runs collapsed; a leading `#` is kept, so "#books" and "books" are two tags), is 1–30 visible characters, and is matched case-insensitively. A tag can exist with no items, and gifters are never sent one. Deleting a tag takes it off every item and never deletes items (D58, D59).
- New items are appended at the end of the list.
- The owner can edit any field, delete an item, and reorder the list.
- Deleting an item **hard-deletes** it and cascades to its claims.

### Claims

- A claim has a `claimerName` (1–50 visible characters, the display-name rule: D35, D41), a `quantity` of at least 1, and a private **manage link**.
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
- Gifters are told which way it's set (D40). The share page, the claim sheet and the manage page say whether the owner can see who's getting what, so nobody claims a surprise the owner is watching.
- The guarantee is about the owner's own session. An owner who opens their link signed out, or in a private window, is a guest like anyone else; that's a deliberate act, and the server can't tell it apart from a gifter.

### Share link

- The link is `/s/<shareToken>`. The token is 128-bit random, encoded as base64url (22 characters).
- Rotating the token makes the old link return 404 immediately.
- Existing claims, and their manage links, are unaffected by a rotation.

### Visible text

- Display names, list and item titles, prices and claimer names use visible characters only (D35, D36). Control and format characters are refused, except the two joiners that emoji and Persian need.
- Letters and marks that draw nothing count as blank (D41, widened by D44): every default-ignorable code point (`\p{Default_Ignorable_Code_Point}`: the Hangul fillers, U+034F, U+17B4, U+17B5, the variation selectors and the joiners among them) and the Braille blank (U+2800). A value made only of them and spaces is refused; one with something visible beside them is kept as typed.
- Lengths count UTF-16 code units everywhere, as JavaScript and the forms do. An emoji costs two or more, so a name made only of emoji fits about 25 (D41).

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
| Module system | ESM everywhere: `"type": "module"` in every package | NestJS 12 ships its packages as ESM only. Nest's own generator pairs ESM projects with Vitest |
| TypeScript | Pinned to 6.0.x. **Not 7** | TS 7, the native Go port, no longer exports the JavaScript compiler API. `@nestjs/cli` (which pins `~6.0.2`), typescript-eslint (`<6.1`) and Next's build-time typecheck all depend on that API. Renovate is capped at `<7` |
| Linting | ESLint 9.x. **Not 10** | eslint-config-next's plugins (`react`, `import`, `jsx-a11y`) declare peer support only up to ESLint 9. Renovate is capped at `<10` |
| Web | Next.js, latest stable, App Router | Required by the brief |
| API | NestJS, latest stable, Express adapter | Required by the brief. Vercel deploys it with zero configuration as one Function on Fluid compute |
| Contract | Shared Zod schemas in `packages/contracts` | One source of truth: a breaking change fails typecheck in both apps in the same PR. OpenAPI is generated *from* the schemas. Rejected: class-validator DTOs plus OpenAPI codegen, which adds a codegen step and lets generated files drift, and only pays off for external consumers |
| Database | Neon Postgres 17, free plan | Scales to zero and wakes on the next query. Rejected: Supabase free, which pauses a project after 7 days of low activity and needs a manual restore |
| ORM | Drizzle with `pg` over TCP to Neon's pooled endpoint | SQL-shaped API, no engine binary, and plain SQL migrations. The TCP driver is required for interactive transactions (`SELECT … FOR UPDATE`). One small pool per Fluid instance, closed on suspend using Vercel's pool helper |
| IDs | UUIDv7, generated in the application | Time-ordered, so index-friendly, and not enumerable |
| Email | Resend (free tier) on the owned domain | Real verification and reset emails |
| CAPTCHA | Cloudflare Turnstile | Free and unobtrusive |
| Errors | Sentry (free tier), both apps | Vercel Hobby keeps runtime logs for only 1 hour |
| Tests | Vitest (with `unplugin-swc` for Nest's decorator metadata), Testcontainers, supertest, Playwright, axe | §8. Vitest instead of Jest because Jest's native ESM mode is still experimental, while Vitest is native ESM and is what Nest 12 generates for ESM projects. Its API mirrors Jest's |
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

tags (
  id            uuid PRIMARY KEY,
  wishlist_id   uuid NOT NULL REFERENCES wishlists,
  name          text NOT NULL,                       -- as shown
  name_key      text NOT NULL,                       -- cleaned, lowercased
  created_at, updated_at,
  UNIQUE (wishlist_id, name_key)
);

item_tags (
  item_id   uuid NOT NULL REFERENCES items,
  tag_id    uuid NOT NULL REFERENCES tags,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX ON item_tags (tag_id);

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
  | Claim manage | 128-bit | SHA-256 hash | Same as above. Kept to 128 bits so links that get texted stay short. Minted by the server, or by the claim sheet when it sends one (D42) |
  | Share | 128-bit | **Plaintext** | The owner must be able to copy their link at any time. It's a public, low-privilege capability, and rotation is the fix if it leaks |

- **Reorder uses a plain integer `position`, rewritten in full by the reorder endpoint (§5).** Rejected: fractional indexing, which solves write amplification this app doesn't have (at most 200 items) and adds key growth and rebalancing.
- **Rate limits live in Postgres** as fixed-window counters, written with an upsert. Rejected: Redis or Upstash, which would be a second stateful free-tier service to keep alive.
- **There's no `kind` column on items.** "Idea versus link" is `url IS NULL`.
- **Tags are rows, not a `text[]` on `items` (D58).** A rename is one row, a tag can exist with no items, and `UNIQUE (wishlist_id, name_key)` makes case-insensitive identity the database's job. The API computes `name_key`: `keyOfCleanName` for a name that has been through `TagNameSchema`, and `tagKey()` from `packages/contracts` for raw input.
- **`item_tags` doesn't tie a tag's list to its item's.** The API guarantees both are on the session's list, because it looks both up through that list under the list lock. A composite foreign key isn't needed.

## 5. API

- Every route is under `/api`. Request bodies are `application/json`.
- Each request and response has a Zod schema in `packages/contracts`. A global Zod validation pipe validates requests.
- Errors are RFC 9457 `application/problem+json` with a stable `code` and the `requestId`. For validation failures they also include `errors[]`, the path of each bad field; those are `400 VALIDATION_FAILED` (Plan 2a).

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
| `POST /me/password` | `{currentPassword, newPassword}` | `204`. Revokes all **other** sessions. A wrong current password is `403 INVALID_CREDENTIALS`: a `401` would read as "signed out" |
| `DELETE /me` | `{password}` | `204`. Cascades everything and clears the cookie. A wrong password is `403 INVALID_CREDENTIALS` |

Unverified users can log in. Every owner endpoint returns `403 EMAIL_NOT_VERIFIED` for them, and the web app shows a "check your email or resend" screen.

### Owner endpoints

These require a session and a verified email. The list is always derived from the session; no endpoint takes a list ID.

| Method & path | Body | Result |
|---|---|---|
| `GET /wishlist` | none | The wishlist, its items, and the share URL. Claim data appears only if `showClaimsToOwner` |
| `PATCH /wishlist` | `{title?, showClaimsToOwner?}` | Updated wishlist |
| `POST /wishlist/share-token/rotate` | none | `{shareUrl}` |
| `POST /wishlist/unfurl` | `{url}` | `{title?, imageUrl?, priceText?, failureReason?}`, always `200`. A prefill only; nothing is saved |
| `POST /wishlist/items` | item fields, `tags?` | `201` with the item and its tags, appended at the end. `422 LIST_FULL` at 200 items, `422 TAG_LIMIT_REACHED` if its new tags would pass 50 (nothing is saved) |
| `PATCH /wishlist/items/:id` | partial item fields, `tags?` | Updated item and its tags. `422 TAG_LIMIT_REACHED` as above |
| `DELETE /wishlist/items/:id` | none | `204` |
| `PUT /wishlist/items/order` | `{itemIds: uuid[]}` | `204`, or `409 ORDER_CONFLICT` if the IDs aren't exactly the list's current item set |
| `POST /wishlist/tags` | `{name}` | `201 {id, name}`. If the list already has that name by key, `200` with the tag as stored. `422 TAG_LIMIT_REACHED` at 50 tags |
| `PATCH /wishlist/tags/:id` | `{name}` | `200 {id, name}`, or `409 TAG_NAME_TAKEN` if a different tag has that key. Changing only the case of its own name is allowed |
| `DELETE /wishlist/tags/:id` | none | `204`. Removes the tag from every item; the items stay |
| `PUT /wishlist/tags/:id/items/:itemId` | none | `204`, and a no-op if the tag is already on the item. `422 ITEM_TAG_LIMIT_REACHED` when the item already has 10 other tags |
| `DELETE /wishlist/tags/:id/items/:itemId` | none | `204`, also when the tag wasn't on the item |

An item or tag ID that belongs to another user's list, or isn't a UUID, returns `404`, the same as one that doesn't exist.

- **`showClaimsToOwner` arrives with claims, in Plan 4a (D33, D39).** `PATCH /wishlist` takes at least one of `title` and `showClaimsToOwner`, and answers `{title, shareUrl, showClaimsToOwner}`. `GET /wishlist` returns `showClaimsToOwner`, and each item carries `remaining` and `claims[]` only when it's on (§5.1). These are fields added to existing responses, so the contracts declare them optional (§10, expand/contract).
- **Tags arrive in Plan 7a (D58–D60).** `GET /wishlist` returns `tags: [{id, name}]`, every tag on the list including empty ones, and each item carries `tagIds`. `GET /shared` returns `tags` with only the tags at least one item carries, and each item carries `tagIds`. Both are read in the same `REPEATABLE READ, READ ONLY` transaction as the items. `POST` and `PATCH` of an item accept `tags?: Array<{id} | {name}>` (at most 10 entries) and answer with the item's `tagIds` and its `tags`. These are fields added to existing responses and requests, so the contracts declare them optional (§10, expand/contract). `GET /claims` omits `tagIds`: the manage page doesn't use them.
- **Item writes name tags by id or by name (D60).** An entry with an `id` is a tag the owner already has; an entry with a `name` joins the list's tag with the same key, or makes it. An entry with both is refused. Inside the list lock, an `id` that isn't one of this list's tags (deleted meanwhile, or from another list) is dropped, not an error, and entries that resolve to the same tag collapse to one. On `PATCH`, `tags` replaces the item's whole set, `[]` clears it, and leaving `tags` out changes nothing. A write that fails, such as a `TAG_LIMIT_REACHED`, saves nothing.
- **List changes are serialized per list (Plan 3a).** Every change to a list or its items first locks the owner's `wishlists` row `FOR UPDATE`. Inside that lock a create takes the next position and enforces the 200-item cap, and a reorder compares the submitted IDs with the current set before rewriting positions `0…n−1`. The lock order is users → wishlists → items, the order an account deletion's cascade takes. Every tag write, and every item write that carries `tags`, takes the same lock first. A tag write never takes an explicit lock on an `items` row; a tick's `item_tags` insert waits on a claim's row lock through the foreign key, which keeps the users → wishlists → items order.

### Public endpoints (capability tokens)

| Method & path | Body | Result |
|---|---|---|
| `GET /shared/:shareToken` | none | `{title, ownerDisplayName, viewerIsOwner, ownerSeesClaims, tags[], items[]}`, or `404 SHARE_LINK_NOT_FOUND` |
| `POST /shared/:shareToken/items/:itemId/claims` | `{claimerName, quantity, manageToken?}` (quantity 1–99, default 1) | `201 {claim, manageToken, manageUrl}`, `409 CLAIM_EXCEEDS_REMAINING {remaining}`, `409 MANAGE_TOKEN_IN_USE`, `403 OWNER_CANNOT_CLAIM`, `404 SHARE_LINK_NOT_FOUND` (the link), or `404 NOT_FOUND` (the item) |
| `GET /claims/:manageToken` | none | `{claim, item, wishlistTitle, ownerDisplayName, remaining, shareUrl, ownerSeesClaims}`, or `404 NOT_FOUND` |
| `PATCH /claims/:manageToken` | `{claimerName?, quantity?}`, at least one | Updated claim, `409 CLAIM_EXCEEDS_REMAINING {remaining}`, or `404 NOT_FOUND` |
| `DELETE /claims/:manageToken` | none | `204`, or `404 NOT_FOUND` |

- `shareUrl` in the claim response is the wishlist's **current** share URL, so it stays correct after a rotation. The manage token itself is the authorization.
- Each item in the `GET /shared` response has: `id, title, url, imageUrl, priceText, note, quantity, tagIds`, and `remaining` and `claims[] {id, claimerName, quantity}` when the viewer may see them (§5.1). The `item` in `GET /claims` has the same fields, without `claims[]` and `tagIds`.
- Claims are only ever changed by **manage token**. A claim ID grants nothing.
- `ownerSeesClaims` is the list's `showClaimsToOwner`, sent to every viewer so the pages can say which way it's set (D40). It's a setting, not claim data.
- `manageUrl` is `APP_ORIGIN/c/<manageToken>`, built by the API next to `shareUrl` so both links come from one place. The token is stored only as its SHA-256 (§4).
- **A claim that survives a lost response (D42, Plan 4b).** The claim sheet mints the manage token itself (16 random bytes, base64url) and saves it before it sends the claim, so a `201` lost on a bad connection costs nothing: the sheet replays the same token, and a reload finds the claim through `GET /claims`. A request without `manageToken` gets one minted by the API, as before. After the item's row is locked, the API looks the token's hash up: on **the same item** it returns that claim as it is now, with `201`, the same token and no remaining check (so retrying the last unit can't `409` against itself); on **another item** it answers `409 MANAGE_TOKEN_IN_USE`, which tells a caller only that a token they already hold exists; otherwise it claims as usual. A double tap is serialized by the row lock, and READ COMMITTED gives the second request a snapshot that sees the first one's row; the same token sent for two items at once is caught by the unique index and gets the same `409`. A replay counts against the rate limits like any claim. Accepted: the server no longer vouches for the randomness of a token a client chose, which weakens only that client's own claim.
- `CLAIM_EXCEEDS_REMAINING` carries `remaining` as a problem extension member, so the claim sheet can reset its stepper (§7).

**How the public endpoints work (Plan 4a):**

- **Who's looking.** `GET /shared` and `POST …/claims` resolve the session cookie if there is one, through a guard that never refuses. The viewer is the owner when the session's user owns the list, verified or not; the client never sends a flag. A dead cookie isn't cleared here, because the share page calls the API server to server, where a `Set-Cookie` never reaches the browser (D27).
- **Malformed is unknown.** A share or manage token that isn't 22 base64url characters gets the same `404` as an unknown one, and a malformed item ID gets `404 NOT_FOUND`, as on the owner endpoints.
- **Two 404s for a claim.** The link and the item get different codes because the claim sheet says different things: a rotated link means asking the owner for the new one, and a deleted item means the list is reloaded. Telling them apart reveals only that a link is dead, to someone who already holds it.
- **The order of a claim's checks.** A malformed token or item ID is refused before any rate limit or lookup (the session guard and body validation run earlier, as on every route). Then the per-IP limit, then the list by its token, then the owner check, then the list's limit, then the transaction (§6.3). The owner is refused **before** anything is summed, because a `409` carries `remaining`, and before the list's limit, because a `429` would tell them gifters have been claiming (D43). A change to a claim runs the same way: the per-IP limit, then the claim by its token's hash, then its list's limit, then the transaction.
- **Reads are one snapshot.** `GET /shared`, `GET /claims` and an opted-in `GET /wishlist` read the list, its items and its claims in one `REPEATABLE READ, READ ONLY` transaction, so `remaining` always agrees with the items beside it. For an owner who hasn't opted in, the claims aren't queried at all; the projection removes the fields anyway.
- Every public response is `Cache-Control: no-store`. The gifters' writes pass the CSRF guard like any other (§6.2), and need no session.

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
- `GET /claims/:manageToken` is the claimer's own view: the manage token is the capability, so it always includes `remaining`, and never other people's claims.

## 6. Auth and security

### 6.1 Sessions

- **The cookie:** `__Host-session`, holding a 256-bit random token (base64url).
  - Flags: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - `Max-Age` is 400 days, the longest browsers keep a cookie. It's set at login and never reissued (D27).
- **Expiry:** sliding.
  - `expires_at` and `last_seen_at` are refreshed at most once an hour, so reads don't cause a write on every request.
  - The database's `expires_at` is the only authority: a session ends after 30 days without use. The cookie isn't reissued on refresh, because a refresh can happen on a server-to-server call whose `Set-Cookie` never reaches the browser (D27).
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

**Updating a claim** uses the same transaction shape: lock the claim's item `FOR UPDATE`, then re-read the claim under that lock, since it may have been deleted meanwhile (`404`). The new quantity may be at most `remaining + current`, §2's rule (amended in Plan 4a).

- The original wording, "excluding the claim's own quantity from the sum", caps it at `item.quantity − others` instead. The two disagree once the owner has lowered the quantity below what's claimed (D19): with a quantity of 1 and two claims of 1, a claimer who only renames would get a `409`.
- So a `PATCH` that doesn't raise the quantity never answers `409`, and a claimer is never forced to give up what they already hold.

**Deleting a claim** is a plain `DELETE` by token hash with no item lock: removing a claim can't over-commit an item.

**Lock order.** Claim writes lock only the item row, never the `wishlists` row, so they keep the users → wishlists → items order that the owner's changes and an account deletion's cascade take (§5).

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
| `POST …/claims`, `PATCH /claims/*` | 30 per hour per list, and 20 per hour per IP (amended in Plan 4a: the list, not the share token) |
| `POST /wishlist/unfurl` | 60 per hour per user |

**Buckets and order (Plan 2a).** Signup, resend-verification and reset-request share one per-address and one per-IP bucket: together they cap the mail one inbox or one IP can trigger. Those endpoints check the per-IP limit, then Turnstile, then the per-address limit, so failed challenges can't use up a victim's budget. Password confirmations on `/me` count against login's per-address bucket. Keys store a SHA-256 of the email or IP, never the raw value.

**Claim limits (Plan 4a).** The two claim endpoints share one per-list and one per-IP bucket. The list's bucket is keyed by the wishlist ID rather than the share token: `PATCH /claims/:manageToken` has no share token in its path, and rotating the link shouldn't reset the count. The per-IP limit is checked first, before the list is looked up. Every attempt counts, including those answered `409`. Accepted: anyone holding the link can use up a list's 30 claims for the hour; rotating the link stops them.

**Plan 2b additions.** Per-IP limits key an IPv6 address by its /64, because one host usually holds a whole /64; an IPv4-mapped address is keyed as the IPv4 address it carries. In signup, the breached-password check runs before the address is charged against the mail budget, so a rejected password doesn't use up the address's emails.

**Client IP (resolved by [Spike B](../spikes/2026-10-07-vercel-rewrite-headers-and-alias.md)):** on Vercel, the API reads the client IP from **`x-real-ip`**. Requests forwarded by the Next.js rewrite carry the browser's real IP, and Vercel's edge overwrites client-supplied `x-real-ip`, `x-forwarded-for` and `x-vercel-forwarded-for`, both through the rewrite and on direct calls. The header is trusted **only when `VERCEL` is set**; elsewhere (local, CI) it is client-controlled, so the API falls back to the socket address. Per-IP limits stay in.

### 6.7 Tokens in URLs

- **Referrer policy:** `/s/*` and `/c/*` respond with `Referrer-Policy: no-referrer`. Outbound product links also carry `rel="noopener noreferrer"`. Without this, clicking through to a retailer would send the share or manage URL in the `Referer` header.
- **Indexing:** the same pages respond with `X-Robots-Tag: noindex`, and they're disallowed in `robots.txt`.
- **Sentry (Plan 5b, D50):** every event passes `scrubEvent` as `beforeSend`, which runs every string in it through `redactTokens` (`packages/contracts`): the 22-character segment after `/s/`, `/c/`, `/shared/` and `/claims/`, any `token=` query value, the 43-character email-token format, and email addresses. That covers paths, error messages, breadcrumbs and `ContractMismatchError.endpoint` alike. Cookies, request headers, request bodies and `user` are deleted. Events carry the route pattern (`/c/[manageToken]`, `/api/claims/:manageToken`) as their transaction, never the raw URL.
- **Accepted:** Vercel's request logs contain the tokens. They're retained for 1 hour and only the account owner can read them.
- **Token query strings:** the verify and reset pages read the token from the query string and remove it from the address bar with `history.replaceState` as soon as they load. They POST it only when the person presses the page's button, so a mail scanner or link preview can't use it up. Both pages send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.

### 6.8 Unfurl (SSRF)

`MetadataFetcher` enforces the following:

- **Scheme and port:** `http` or `https` only, on port 80 or 443. Userinfo in the URL is rejected.
- **Resolution:** the hostname is resolved by the server, and the URL is rejected if **any** resolved address is:
  - loopback, private, link-local, CGNAT, unique-local, multicast or unspecified, or
  - an IPv4-mapped or IPv4-translated IPv6 form of any of those.

  The resolver is c-ares, Node's `dns.promises.Resolver`, asking for A and AAAA records in parallel (Plan 4a). Never `dns.lookup`: its `getaddrinfo` runs on one of libuv's four threadpool threads and holds it until the OS gives up, long after our deadline, so a few slow lookups starved argon2 (9 ms became 317 ms in Plan 3a's probe). The two answers are joined; if one family fails and the other answers, that answer is used, and only when both fail is it `DNS_FAILED`. Each lookup has its own `Resolver`, cancelled at the deadline: `cancel()` stops every query on its resolver, so a shared one would cancel other people's lookups too. At most 4 lookups run at once per instance, and one that can't start before the deadline is `TIMEOUT`. c-ares doesn't read `/etc/hosts`, which no retailer needs.

  Classification uses `ipaddr.js` and is an **allowlist** (Plan 3a): after an IPv4-mapped address is converted to the IPv4 address it carries, an address passes only if `ipaddr.js` classes it as `unicast`. Every special-purpose range is refused by default, including NAT64, 6to4, Teredo and reserved space, so a range nobody thought to list can't slip through. An IPv6 address must also lie in `2000::/3`, the space allocated for global unicast: ipaddr.js calls some IPv6 space `unicast` that no public host uses, such as the deprecated IPv4-compatible `::a.b.c.d`, which a host with a `sit` tunnel treats as local (Plan 3a security review).
- **DNS rebinding:** the connection goes to the **vetted IP**, through a custom `lookup` on the undici agent, so the address can't change between the check and the connection. The original Host header and SNI are kept.
  - The fetcher uses the `undici` package's own `request()`, never Node's global `fetch`: Node's bundled undici can drift from the npm copy, and a global dispatcher would route the API's other outbound calls through this policy too (Plan 3a).
  - The `lookup` answers both the single-address call and the `all: true` list call that Node's default `autoSelectFamily` makes.
- **Redirects:** followed manually, at most 3 hops, with every hop checked the same way.
- **Limits:** 5-second total timeout. Reading stops at 1 MB, counted after decompression, and a longer page is parsed from what arrived: a product page's metadata is in its `<head>` (Plan 3a follow-up). The raw bytes are capped at 1 MB too, counted before decompression, so a compressed stream that decodes to almost nothing can't keep us reading until the deadline; whichever cap trips first ends the read (Plan 4a). Real pages reach the decoded cap first: HTML compresses roughly five- to tenfold, so a gzipped page reaches 1 MB decoded at 100–200 KB raw. Only a `200` with `text/html` is accepted.
- **Parsing:** done with a real HTML parser. Sources are tried in this order: Open Graph tags, then JSON-LD `Product` (name, image, offers price and currency), then `<title>`. A title that is only the site's name (`og:site_name`, or the host without `www.`) is skipped, as on a bot check's page (Plan 3a follow-up).
- **Output (Plan 3a):** a JSON-LD price and currency become a display string with `Intl.NumberFormat('en-US')`, e.g. `"$24.99"`. Titles are trimmed to 200 characters. Titles and prices keep only visible characters, so a prefill always passes the item contract (D35, D36).
- **Images:** the extracted image URL is resolved against the final page URL and must be https, and the server never fetches it.
- **Identification:** requests send `User-Agent: Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)` and `Accept: text/html`. No browser or crawler impersonation (D34).
- **Logs** carry the hostname and the failure reason, never the full URL: query strings can carry personal data.
- **Failure:** any failure returns `200` with empty fields and a `failureReason` code from a fixed list in `packages/contracts` (Plan 3a): `INVALID_URL`, `DISALLOWED_ADDRESS`, `DNS_FAILED`, `UNREACHABLE` (the connection or TLS handshake failed), `TIMEOUT`, `TOO_MANY_REDIRECTS`, `BLOCKED_BY_SITE` (after redirects, the site answered anything but `200`: a 4xx, a 5xx, or a bot check's `202`), `NOT_HTML`, `TOO_LARGE` (the first megabyte of a longer page had nothing usable) or `NO_METADATA`.

### 6.9 Headers

- **CSP:**
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`. A fresh nonce per request, from the web app's proxy, so every page renders dynamically
  - `style-src 'self' 'unsafe-inline'`. React and `next/font` set style attributes, which a nonce can't cover (Plan 2b)
  - `img-src 'self' https: data:`
  - `font-src 'self'`
  - `connect-src 'self'` plus Sentry's ingest origin, exactly the origin of the web DSN, and only in builds that have one (Plan 5b, D51)
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
  - `frame-ancestors 'none'`
  - On every page, `https://challenges.cloudflare.com` is added to `script-src`, and `frame-src` allows it, for Turnstile (amended 2026-10-10, Ted). A CSP belongs to the document, and client-side navigation keeps the first page's policy, so a per-page allowance broke the widget after in-app navigation onto an auth page. With `'strict-dynamic'`, CSP3 browsers ignore the `script-src` host, so the effective widening is `frame-src` to that one origin.
  - Not `upgrade-insecure-requests`: it breaks `http://localhost` E2E, and `.dev` is HSTS-preloaded.
- **Other headers:** `X-Content-Type-Options: nosniff`, and HSTS (Vercel's default). `Permissions-Policy` turns off camera, microphone, geolocation and the other features Hanker never uses, leaving clipboard and Web Share on (Plan 6).
- **Retailer images:** rendered as plain `<img loading="lazy" referrerpolicy="no-referrer">`, **not** `next/image`. Configuring `next/image` to accept images from any host would turn the image-optimization quota into an open image proxy.

## 7. Web app

### Routes

| Route | Rendering | Notes |
|---|---|---|
| `/` | Server | Landing page. Redirects to `/list` when signed in |
| `/privacy`, `/terms` | Server, static | Plain-language legal pages (Plan 6, D54). Indexable |
| `/signup`, `/login`, `/verify-email`, `/reset-password`, `/reset-password/confirm` | Client forms | Call `/api/auth/*` directly, so the `Set-Cookie` lands from the API response |
| `/list` | Server-rendered first load + client editor (TanStack Query) | Reorder, delete and tag ticks show at once; a failed change refetches the list (D37) |
| `/settings` | Client | Display name; list name; share link (copy, and rotate after a confirmation); change password; delete account (confirmation dialog). The spoiler toggle, with its confirmation, arrives in Plan 4b (D33, D39) |
| `/s/[shareToken]` | Server Component | Readable before JavaScript loads. Claim controls and the filter row hydrate afterwards |
| `/c/[manageToken]` | Server Component + client form | Manage one claim |

**How the web app calls the API:**

- Server Components call the API **server-to-server**, at `API_ORIGIN`, forwarding the incoming `cookie` header. That's how the owner case on `/s/*` works.
- The browser calls go through the same-origin `/api/*` rewrite.
- **Auth forms deliberately don't use Server Actions.** A Server Action would have to read the API's `Set-Cookie` and re-issue it, defining the cookie's attributes in two places.

### Typed client

- `apiFetch` validates **every** response against its `contracts` schema.
- Web and api deploy independently, so for a short time during a deploy they can be out of step. Validation turns that version skew into a clear error instead of `undefined` reaching the UI.
- Error codes from problem+json map to user-facing messages in one table.
- Every request other than a `GET` carries a JSON body, `{}` when it has nothing to send, so the CSRF guard's content-type check (§6.2) holds for bodiless writes like `DELETE /claims/:manageToken` (Plan 4b).

### Claim flow (mobile-first)

1. The gifter taps "I'll get this". A bottom sheet opens with:
   - a name field, prefilled from `localStorage`;
   - a quantity stepper, between 1 and remaining.
2. On `201`, the sheet shows the manage link with **Copy** and **Share** buttons. Share uses the Web Share API. The copy reads: "Save this link to change or cancel your claim."
3. `localStorage` keeps every claim this browser knows under one key, `hanker:claims`, as `[{itemId, manageToken, claimId?}]` (D45). Item IDs are unique on their own, so a rotated share link keeps them. The record is written **before** the claim is sent (D42) and gets its `claimId` from the `201`. A returning gifter on the same browser sees "You're getting 1 · Change": the share page matches records to `item.claims[].id`, drops records whose claim is gone, and resolves a record without a `claimId` (a lost response) through `GET /claims/:manageToken`. Opening a manage link saves its record too, so another device learns the claim.
4. On a `409`, the stepper resets to the new remaining count and the sheet explains why.
5. If no response arrives at all, the sheet says so and **Try again** resends the same token.

`localStorage` is only a convenience. The manage link is the source of truth.

The share page, the claim sheet and the manage page say whether the owner can see who's getting what, from `ownerSeesClaims` (D40).

### Share, claim and manage pages (Plan 4b)

These follow the Plan 4b mockups, on the same canvas as the editor's.

- **Server render, client islands.** `/s` and `/c` are Server Components. The claim sheet (a Radix Dialog shaped as a bottom sheet), the manage form and the `localStorage` strips are client components, and every write goes through the `/api` rewrite. After a write the page calls `router.refresh()`, so the server stays the only source of the list; TanStack Query isn't used on these pages.
- **The owner on their own link** (`viewerIsOwner`) sees the cards without claim controls, a note that says whether claims are hidden from them, and a link back to the editor.
- **A dead share link** gets its own page: the link may be mistyped or replaced, and a saved claim link still works. A dead manage link says *"This claim no longer exists."* (§2). Cancelling a claim shows its confirmation in the browser, since the link stops working.
- **The spoiler toggle** is a switch on `/settings`. Turning it on asks first; turning it off doesn't, and removes the claim fields from the editor's cache before the request returns, so the browser never keeps claim data the owner has turned off (§1, criterion 4).
- **The editor's claim lines,** when the owner has opted in: "No claims yet", "Aunt Sue is getting this", or "Sam ×1, Priya ×1 · 1 left". Item writes don't return claims, so the cache keeps an item's claims across an edit and recomputes `remaining` with the shared `remainingOf` from `contracts`.

### Owner editor (Plan 3b)

The editor is layout A from the Plan 3b mockups: compact rows, edited in place (D37).

- **Adding is link-first.** One box takes "a link or an idea":
  - An `http(s)` URL, or text shaped like a domain (`shop.com/x`, given `https://`), is unfurled, and a prefilled form opens for the owner to check and save.
  - Anything else becomes an item at once, titled with the text.
  - A failed or rate-limited unfurl opens the same form with the link kept, and one sentence per failure reason says why.
- **Rows:** a drag handle, the photo (or an idea tile), the title and price, and up and down buttons. Tapping a row opens its form in place, one row at a time. Quantity is a form field, saved with the rest. Delete asks for confirmation in a dialog.
- **Sharing from `/list`:** Copy share link, and Share where the Web Share API exists. Both appear once the list has an item.
- **Server state:** the server render seeds the TanStack Query cache. Every list change runs in one mutation queue, in order, and none is retried. Reorder, delete, and tag ticks, unticks and deletes update the cache at once; adding and saving, and creating and renaming a tag, wait for the API. Any failed change refetches the list, which is the rollback, since restoring a snapshot would also undo the changes queued after it.
- **Photos** render as `<img alt="">` with `referrerPolicy="no-referrer"`, and fall back to a placeholder if they don't load.

### Share filters and tags (Plan 7b)

These follow the tags design ([§3, §4](2026-10-21-item-tags-and-filters-design.md)) and the Plan 7b mockups. The share page and the editor were the only screens touched; cards and editor rows show no tags.

- **The filter row** is one client island, `ShareFilterList`, rendered in both the gifter's view (inside `ShareClaimsProvider`) and the owner's view of `/s`. Its filter state lives in the island, so it survives the `router.refresh()` after a claim (D62).
  - The row is in the server HTML, drawn exactly as the first client render draws it, so the cards don't move when the island hydrates. Without JavaScript, CSS hides it (`@media (scripting: none)`, a media query in the stylesheet, so no `<noscript>` markup or inline style is needed), so the page stays readable and every item shows. It scrolls sideways inside itself, and the page never does.
  - It is a `role="group"` labelled "Filter the list": the price pill first, then one chip per tag that at least one item carries, ordered by item count (descending), ties by name with one `Intl.Collator('en')`, so Node and the browser agree.
  - Chips are `aria-pressed` toggles named like "Kitchen gadgets, 4 items". Active pills are espresso (`--foreground`) with sand text; terracotta never marks a filter.
  - Tags combine with AND and price bands with OR. Each chip shows how many items would be shown with it on, given the other selections, so counts move as you filter. A chip that would show nothing is dimmed and disabled, not removed.
  - Below the row, "N of M items" (a polite live region) and **Clear filters** appear once anything is on. If nothing matches, the list area says so, with a Clear filters button.
  - **Filtered-out cards get `hidden` and stay mounted,** so a card's own state, such as an open claim strip, survives filtering. Claimed items still show and still count.
  - A refresh that takes a tag, or the list's currency, away drops the filter on it: with no chip left to undo it, it would hide cards for good.
- **The price filter** reads the number out of `priceText` in the browser, with `parsePrice` from `packages/contracts` (D61). A price is readable when it is a currency prefix, one number and nothing else (`$24.99`, `CA$20.00`, `¥1,200`; not `about £30`, `$20–30`, `30`). The list's currency is the prefix with the most readable prices, and the pill appears only for `$`, `US$`, `CA$`, `A$`, `NZ$`, `£` and `€`, since fixed bands mislead on a yen or rupee list. The bands are Under 25, 25–50, 50–100 and 100+, each including its lower bound.
  - While a band is on, an item without a readable price in the list's currency is hidden.
  - The pill reads "Any price" until a band is chosen, then the joined label: neighbouring bands merge ("$25–100", "Under $50"), the rest are joined with " · ". All four bands read "Any listed price".
  - The pill opens a hand-rolled disclosure, since no popover is installed: an "Any price" button and four native checkboxes, each with its count. Each band's count is that band on its own with the selected tags, not the union with the bands already on, so ticking it shows what ticking it would add.
  - It stays open while bands are ticked. Escape and the pill close it and return focus to the pill. An outside click or Tab closes it and leaves focus where it went.
  - Sentences built from these numbers live in `lib/share-copy.ts`, the logic in `lib/share-filters.ts`.
- **The tag field** is the item form's **Tags** field, after Note, shared by the add and edit forms: removable chips and a combobox with a listbox of suggestions.
  - Suggestions are every tag on the owner's own list, empty ones included and nobody else's, with prefix matches before contains matches, up to 6. Tags already on the item are left out.
  - Enter or a comma adds the highlighted suggestion or the typed text. Pasted or phone-typed commas split the text into several tags. Keys an input method is composing are ignored.
  - Text typed but not yet added is added on save, and invalid text blocks the save. An 11th tag is refused in the field and never sent.
  - Tags are tracked by id, and a name that matches an existing tag's key becomes that tag. A chip whose tag was deleted meanwhile disappears from the field and from the body.
  - The edit form sends `tags` only when the field changed, so saving without touching it never undoes a tick made in the Tags sheet. The add form sends `tags` only when it isn't empty.
- **The Tags sheet** is a bottom sheet on the claim sheet's primitive, opened by a **Tags** button beside the share actions, shown once the list has an item (D63).
  - Pane one lists every tag, alphabetical, empty tags included, with its item count, and **New tag**. Pane two is one tag: its name, **Rename** and **Delete** (after a confirmation that gives the count when the tag is on at least one item, and otherwise just asks "Delete “<name>”?"), and every item with a checkbox. Entering a name the list already has in **New tag** opens that tag; renaming to a taken name is refused with "You already have a tag called that."
  - Ticks and unticks save at once and are optimistic; create and rename wait for the API. Because each tick saves, the browser's Back leaving `/list` loses nothing.
  - The sheet is modal, so it has its own status line inside it for the editor's messages.
- **Editor state.** Every tag change is a mutation in `lib/list-mutations.ts`, in the one scope, so changes reach the API in order. A failed change marks the list stale and it is refetched when the queue drains. So does an item write that succeeds while other changes are queued, since its answer would otherwise undo a queued tick. `hideCachedClaims()` leaves tags alone: they aren't claim data.
- **Copy.** `TAG_NAME_TAKEN`, `TAG_LIMIT_REACHED` and `ITEM_TAG_LIMIT_REACHED` are in `lib/messages.ts`; the delete confirmation and item counts are in `lib/tag-copy.ts`.

### Reordering

- dnd-kit, with its keyboard sensor enabled.
- Visible up and down buttons as well. They make reordering workable on phones and serve as the accessible fallback.
- Each move sends the full order to `PUT /wishlist/items/order`: the order the list has when the request runs, not when the move was made, so a move queued behind an add includes the new item.
- On a `409`, the editor refetches the list and says why in its status line, which screen readers announce.

### UI and accessibility

- Tailwind with shadcn/ui components, which are copied into the repo and built on Radix primitives.
- Forms use react-hook-form with the shared Zod schemas.
- The target is WCAG 2.2 AA.
- The visual direction is **Warm Editorial Minimalism** (D28): a sand ground, espresso type and borders, terracotta for actions only, and sage for fulfilled states. Instrument Serif for headings, Geist for everything else, and 16px cards. The tokens live in `apps/web/src/app/globals.css`. The share page and the editor were mocked up for review before they were built (Plan 3b): the editor uses compact rows (D37), and the share page uses cards.

## 8. Testing

**Ports and adapters.** External services are injected through interfaces:
`EmailSender`, `CaptchaVerifier`, `BreachedPasswordChecker`, `MetadataFetcher` and `Clock`. Tests swap in fakes through Nest's dependency injection.

| Layer | Scope | Tooling |
|---|---|---|
| Unit | `projectWishlist` (full table); the SSRF address classifier (every blocked range, mapped and odd encodings); unfurl parsers against saved retailer HTML fixtures; token, remaining and rate-window arithmetic | Vitest |
| API integration | Every endpoint against real Postgres with real migrations. The database is never mocked | Vitest, Nest testing module, supertest, Testcontainers (`postgres:17`) |
| E2E | Golden paths: signup → read verification mail → verify → build list → reorder → share → claim in a second browser context → manage claim → spoiler toggle. Axe on every page | Playwright against production builds, with Postgres and Mailpit in docker compose |
| Preview smoke | `/api/health` through the web origin, which proves the rewrite works; the landing page renders; an unknown share token returns 404. **Read-only**: nothing is written to the prod-cloned branch | Playwright against the PR's Vercel preview, using the automation-bypass token |

**Tests the plan must include:**

- **Claim race.** 20 concurrent claims against an item with quantity 1. Exactly one `201` and nineteen `409`s, and the claims sum to 1.
- **Claim replay (D42).** The same `manageToken` sent again returns the same claim and writes no second row, including for the last unit; sent for another item, it's refused.
- **SSRF refusal through the real fetcher.** Unfurl against `127.0.0.1`, `[::1]`, `169.254.169.254` and `[::ffff:127.0.0.1]`, plus a redirect chain from a public fixture to a private address. All refused.
- **Spoilers.** Claim fields are absent from the JSON for an owner who hasn't opted in, on both `GET /wishlist` and `GET /shared/:token`.
- **Reorder conflict.** Sending a stale item set returns `409`.
- **Session revocation.** Revocation works on reset, password change and account deletion.
- **Enumeration resistance.** Signup and reset-request return identical responses for known and unknown emails.

Coverage is reported, not used as a gate. Critical modules (auth, claims, projection, SSRF) are written test-first.

## 9. Error handling

- **Domain errors:** typed exceptions (e.g. `ClaimExceedsRemainingError`). One global filter maps them to problem+json.
- **Unexpected errors:** a generic `500` with a `requestId`, captured to Sentry with the same `requestId` and the route pattern (Plan 5b). A `DrizzleQueryError` is reported as its parameterized SQL and the driver's error, never the original, whose message carries every bound parameter.
- **Web:** an `error.tsx` boundary per route. Messages are looked up by `code`; raw server text is never shown.

When a dependency fails, the behavior is fixed per service:

| Dependency down | Behavior |
|---|---|
| HIBP | Skip the breach check and log it |
| Turnstile | Refuse the email-sending endpoints and tell the user to try again later |
| Resend | The endpoint still returns `202`: email is delivered in the background, after the response (Plan 2a). The error is logged (Sentry from Plan 5b), and the user can resend |
| Unfurl target | `200` with empty fields; the owner fills them in by hand |
| Neon cold start | The `pg` connect timeout is 10 s. Non-idempotent writes aren't retried |

## 10. Environments, CI/CD and operations

### Environments

| Env | Web | API | Database | Email |
|---|---|---|---|---|
| Local | `next dev` on :3000, rewrites to :3001 | `nest start --watch` on :3001 | docker compose Postgres 17 | Mailpit |
| CI | Production build | Production build | Testcontainers or compose | Mailpit |
| Preview (per PR) | Vercel preview, **protected** | Vercel preview, unprotected | Neon branch `pr-<n>`, created from `preview-seed` (never holds production data) | **Log only, never sent** |
| Production | `https://<domain>` | `wishlist-api` production | Neon `main` | Resend |

- **Why the API preview is unprotected.** A Next.js rewrite can't attach Vercel's protection-bypass header. An unprotected API preview exposes the same surface as the production API: the same auth, and no secrets in responses.
- **Why preview email is log-only.** Preview databases hold only seed data, but log-only email means a preview can never send mail to anyone, whatever data it holds.
- **Why previews never clone production.** API previews are public and run unreviewed PR code, so preview databases branch from `preview-seed`, a schema-only root branch rebuilt from the migrations ([addendum 2026-10-08](2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)).

### Deployment model

- Vercel's Git integration is **disabled** on both projects, with `git.deploymentEnabled: false`. GitHub Actions is the only thing that deploys.
- The deploy sequence is `vercel pull`, then `vercel build`, then `vercel deploy --prebuilt`. Building in Actions reuses Turborepo's cache.

### Workflows

| File | Trigger | Steps |
|---|---|---|
| `ci.yml` | `pull_request` | install → `turbo lint typecheck test build` (affected) → API integration → E2E (compose) → `squawk` on new migrations. Its jobs are the ruleset's required checks |
| `preview.yml` | PR opened, synchronized or reopened | `settings` (pull project settings) → `build-api` (no secrets) → `provision` (check `preview-seed` → create or reuse `pr-<n>` from it → assert it descends from `preview-seed` → migrate with the migrator from source → deploy the API preview → wait for health) → `build-web` (no secrets) → `deploy-web` (deploy, alias) → `smoke` → `comment` (web alias only). Concurrency `preview-<n>`, cancel-in-progress |
| `cleanup.yml` | PR closed; nightly | Delete Neon branch `pr-<n>`. The nightly sweep deletes `pr-*` branches whose PR is closed, a safety net for Neon's free cap of 10 branches |
| `preview-seed.yml` | Manual (`reset`, `init_source`); push to `main` touching migrations | Ensure `preview-seed` exists (schema-only root branch, never `main`) → wipe and replay migrations from zero when created or reset → migrate incrementally otherwise |
| `deploy.yml` | Push to `main` | `guard` (stale-commit check) → `settings` → `build` (gates and `vercel build` for both apps, no secrets) → `migrate` (migrator from source) → `deploy-api` → health → `deploy-web` → `smoke`. Beside them, `sourcemaps` uploads the web app's browser source maps to Sentry (Plan 5b, D52); a Sentry outage never blocks a release. Every production job re-checks it is deploying `main`'s tip. Concurrency `production`, `cancel-in-progress: false` |
| `backup.yml` | Nightly; manual | `pg_dump` prod as the read-only `hanker_backup` role (D48) → encrypt with `age` in the pipe → upload to Cloudflare R2 → ping the backup heartbeat, or its `/fail` URL on any error (D47). An R2 lifecycle rule keeps 30 days (Plan 5a) |

**Ordering that isn't obvious:**

- **The web build waits for the API preview URL.** Next.js compiles rewrite destinations into its build output, so the web app can't be built until `API_ORIGIN` is known.
- **The API needs the web URL before the web app exists.** The API's CSRF guard (§6.2) checks `Origin` against `APP_ORIGIN`, but the API preview is deployed *before* the web preview. The fix is a deterministic alias computed from the PR number, `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` (repo variable; currently `shockolate-wishlist-pr-`, verified by [Spike C](../spikes/2026-10-07-vercel-rewrite-headers-and-alias.md)):
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

**Backups and the restore drill (Plan 5a).**
- **The dump.** `scripts/backup.sh` runs `pg_dump --format=custom --no-owner --no-privileges` from a `postgres:17` image pinned by digest, so its major version matches Neon's whatever the runner ships. It pipes the dump straight into `age -r "$AGE_RECIPIENT"`, so plaintext never touches the runner's disk, and it refuses to upload a file without the `age` header. `age` is a pinned release whose sha256 the script checks.
- **The upload.** It uses the runner's `curl --aws-sigv4` against R2's S3 API, so no new tool is installed. A `HEAD` afterwards checks the stored size. The key is `daily/<UTC timestamp>.dump.age`.
- **The job's least privilege.** The job connects as `hanker_backup`, a role that can only read (D48). Its R2 token can read and write objects in the one bucket. A bucket lock rule on `daily/` for 30 days stops a leaked token from deleting or overwriting the dumps already there.
- **The restore drill (D49).** A backup job that passes proves only that bytes reached R2. The drill proves they come back as the data. `scripts/restore-drill.sh <dump.age> <identity>` runs on the owner's machine, the only place the private key exists. It decrypts the dump, restores it with `pg_restore --exit-on-error --single-transaction` into a `postgres:17` container the script creates and removes (labeled `hanker.restore-drill`, with no published port), then checks the migration count against production's `/api/health`, checks every `public` table came back, and prints each table's row count. Plan 5a is done only when a drill passes against a real nightly dump (it passed 2026-10-20). Repeat it quarterly, and after any change to the backup path: a Postgres major upgrade, a new `age` key, a change to `backup.sh` or the role's grants, or a new pinned image (D53).
- **Real recovery from a dump.** Restoring a whole dump over `main` would lose everything written since, so recovery restores locally and copies the lost rows back with `psql` (runbook in `docs/deployment.md`).

### Monitoring and maintenance

- **Errors: Sentry's free Developer plan, in both apps (Plan 5b, D50).** Explicit capture on the lighter SDKs, never auto-instrumentation: `defaultIntegrations: false`, every `dataCollection` category off (v11's defaults collect cookies, headers, bodies and stack-frame variables), no tracing, no session replay.
  - **API:** `@sentry/node` behind an `ErrorReporter` port (no-op without `SENTRY_DSN`, a fake in tests). It reports the `5xx` path of `ProblemDetailsFilter`, background email failures, and as warnings the operator-actionable conditions already logged (Turnstile unavailable, HIBP down, the pool's idle-client errors). Each capture is flushed with `waitUntil`, because Vercel may freeze the function once the response is sent.
  - **Web:** `@sentry/node` in `instrumentation.ts` through `onRequestError`, labeled with `routePath`; `@sentry/browser` in `instrumentation-client.ts` with only the global handlers, linked errors and dedupe. `error.tsx` reports what it catches unless the error has a `digest`, which the server already reported.
  - **Production only.** The API's DSN is a Vercel production variable. The web's is the repository variable `SENTRY_DSN_WEB`, inlined at build by `deploy.yml` alone; `preview.yml` never reads it, and the policy test enforces that, so unreviewed PR code never reports.
  - **Readable traces (D52).** Vercel already deploys a source map beside each of the API's compiled files. The web build emits none by default, so it's configured to emit its server bundles' maps. Both servers then translate stack traces at runtime (`process.setSourceMapsEnabled(true)`), with nothing to upload. Browser JavaScript is minified: the build job writes debug IDs into the chunks and their maps (`sentry-cli sourcemaps inject`), then moves the maps out of the deploy output into the `web-sourcemaps` artifact, so `hanker.dev` never serves them, and the `sourcemaps` job uploads them with a checksum-pinned `sentry-cli`.
- **Operations checklist.** `docs/operations.md` holds the one-off readiness list, the recurring chores and a symptom-to-runbook table (Plan 5b).
- **Uptime: Better Stack's free plan (D47), alerting by email.**

  | Monitor | URL | Interval | Proves |
  |---|---|---|---|
  | Live | `https://hanker.dev/api/health/live` | 3 min | The web project, the `/api` rewrite and the API function are up |
  | Site | `https://hanker.dev/` | 3 min | The landing page renders. It's static, so it touches neither the API nor the database |
  | Deep | `https://hanker.dev/api/health` | 30 min, the longest Better Stack's free plan offers | Neon is reachable and migrated. A `503` alerts |
  | Backup heartbeat | `BACKUP_HEARTBEAT_URL` | A ping every 24 h, with 2 h of grace | The nightly backup ran and uploaded |

- **Why the frequent checks avoid the database.** `/api/health` queries Neon and so wakes it, and Neon Free stops compute only after 5 idle minutes and allows 100 CU-hours per project per month. A deep check every 3–5 minutes would keep a 0.25 CU compute awake all month, about 180 CU-hours, and Neon would suspend the database once the quota ran out. `/api/health/live` returns `{ status, sha }` and never touches the pool. The 30-minute deep check costs about 30 CU-hours a month, since Neon sleeps for 25 of every 30 minutes. If Neon's usage trends past about 70% of the quota, pause the deep monitor: the backup heartbeat still proves the database daily (Plan 5a go-live, 2026-10-20).
- **Why the backup needs a heartbeat.** GitHub disables scheduled workflows in a public repository after 60 days without activity, and a failed nightly run alerts nobody. The heartbeat alerts when the pings stop for any reason.
- `/api/health` checks database connectivity and returns the applied migration version and the git SHA.
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

- The domain, `hanker.dev`, is bought from Cloudflare Registrar. Like every `.dev` domain it's on the HSTS preload list, so it's served over HTTPS only, which Vercel does anyway.
- DNS stays on Cloudflare. The records pointing at Vercel are **DNS-only (grey cloud)**, because proxying in front of Vercel breaks certificate issuance and caching.
- Resend's SPF, DKIM and DMARC records are added on its sending subdomain, `mail.hanker.dev`. Email comes from `Hanker <no-reply@mail.hanker.dev>`.

### Secrets

| Where | Secrets |
|---|---|
| GitHub Environment `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_API`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `DATABASE_URL_DIRECT` (for migrations), `DATABASE_URL_BACKUP` (the read-only `hanker_backup` role, direct; D48), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `AGE_RECIPIENT`, `BACKUP_HEARTBEAT_URL` (Plan 5a), `SENTRY_AUTH_TOKEN` (Plan 5b: an organization token, used only by the `sourcemaps` job) |
| GitHub Environment `preview` | The Vercel and Neon secrets above, plus `VERCEL_AUTOMATION_BYPASS_SECRET` |
| GitHub repository variables (not secret) | `SENTRY_DSN_WEB` (read only by `deploy.yml`'s build job), `SENTRY_ORG`, `SENTRY_PROJECT_WEB` (Plan 5b) |
| Vercel project env | `DATABASE_URL` (pooled), `APP_ORIGIN`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `SENTRY_DSN` (the API project, production only; Plan 5b), `CRON_SECRET`, `EMAIL_TRANSPORT` (`resend`, `mailpit` for local development and E2E, or `log`), `EMAIL_FROM` |

The private `age` key is never stored in GitHub. It's kept offline by the owner, passphrase-protected, and used only for the restore drill and real recovery.

## 11. Developer environment prerequisites

As of 2026-10-07 on the development machine:

| Tool | Found | Action |
|---|---|---|
| node | 24.21.0 (nvm) | Keep. It's the current LTS |
| pnpm | missing | `npm i -g pnpm@latest` |
| vercel CLI | missing | `npm i -g vercel@latest` (≥ 48.4.0 is required for zero-config NestJS) |
| gh | 2.99.0 | `gh extension install github/gh-stack` |
| git | 2.43.0 | Works (`gh stack` needs ≥ 2.36). Upgrading via `ppa:git-core/ppa` is optional |
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
| D12 | Per-PR previews on Neon branches created from `preview-seed`, which never holds production data (amended 2026-10-08) | Clone production (the original D12, superseded by review finding I-4); shared staging; prod only |
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
| D23 | ESM with Vitest; TypeScript pinned to 6.0.x; ESLint pinned to 9.x (amended 2026-10-07 while planning) | CommonJS API with Jest; ESM with experimental Jest; TS 7; ESLint 10 |
| D24 | Secret-free build jobs; secrets only in jobs that run the pinned Vercel CLI, pinned actions, or a `--prod --ignore-scripts` install (2026-10-08) | One job with step-scoped secrets |
| D25 | `preview-seed` as a schema-only root branch, wiped and migrated from zero, refreshed in place (2026-10-08) | Clone of production then anonymized; a schema-only root branch per PR (exceeds Neon Free's 3 root branches) |
| D26 | Product name **Hanker** on `hanker.dev` (2026-10-09). The user-facing name changes; code, packages, projects and tables keep `wishlist` | `hanker.app` and `hanker.com` (both registered); keeping the generic "Wishlist" |
| D27 | A long-lived session cookie (400 days, set only at login); the database's sliding expiry is the only authority (2026-10-10) | A cookie tied to the 30-day session and reissued on refresh, which server-to-server calls lose; the web proxy reissuing it |
| D28 | Warm Editorial Minimalism: sand, espresso, terracotta and sage, with Instrument Serif and Geist (2026-10-10) | Six mocked directions: Wish Book, Ribbon, Candlelight, Folio, Board, Letter |
| D29 | Go-live in two steps: the domain, DNS, Resend and the Turnstile widget in Plan 2b; the Turnstile secret, which opens sign-up, in Plan 3 (2026-10-10; **amended by D31**) | Opening sign-up in Plan 2b, before there is a list to make |
| D30 | Plan 3 split into 3a, the owner API (shipped dark), and 3b, the editor and settings UI (2026-10-12) | One Plan 3, with a final review the size of Plan 2b's and stacks past Neon's preview cap |
| D31 | Sign-up opens at the end of Plan 4, once a list can be shared and claimed; amends D29 (2026-10-12) | The end of Plan 3 with the share link hidden; a read-only share page pulled forward from Plan 4 |
| D32 | No priority field on items: the owner's order is the priority, and terracotta stays for actions (2026-10-12) | A "most wanted" flag; priority levels |
| D33 | `showClaimsToOwner`, its API field and its settings toggle, ship in Plan 4 with the claims it controls (2026-10-12) | Shipping the toggle in Plan 3, with nothing for it to show |
| D34 | Unfurl identifies itself honestly, as `Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)` (2026-10-12) | A browser user agent; posing as a social network's crawler |
| D35 | List and item titles follow the display-name rule: visible characters only; control and format characters (newlines, bidirectional overrides, zero-width spaces) are refused, except the joiners emoji and Persian need (Ted, 2026-10-12) | Refusing only NUL, the one character Postgres rejects |
| D36 | Prices follow the title rule (D35): visible characters only. A price sits beside its title in front of gifters, and no currency Intl formats uses a control or format character (Ted, 2026-10-13) | Refusing only NUL; silently stripping the characters instead of refusing them |
| D37 | The owner editor is compact rows, edited in place; quantity is a form field saved with Save, so only reorder and delete update before the API answers; the share actions sit on `/list` once it has an item (Ted, 2026-10-13) | Image cards edited in a bottom sheet, with a quantity stepper on each card; rows edited in a sheet |
| D38 | Plan 2b's "before sign-up opens" fixes split by page: the four on Plan 3b's pages (the delete-account dialog, `/list`'s confirm-email copy, `requireMe`'s router cache, the screen-reader check) land in 3b; the two Turnstile fixes join Plan 4's go-live work, where sign-up opens (Ted, 2026-10-13) | All six in 3b; all six in Plan 4 |
| D39 | Plan 4 split into 4a, the claims API with unfurl's go-live hardening (shipped dark), and 4b, the share page, claim sheet, manage page and spoiler toggle, ending with sign-up opening (Ted, 2026-10-14) | One Plan 4 of about 14 PRs, past Neon's 8 previews; a split by feature, with neither half shippable dark |
| D40 | Gifters are told whether the owner can see claims: `GET /shared` and `GET /claims` carry `ownerSeesClaims`, and the pages say which way it's set (Ted, 2026-10-14) | Neutral copy that promises nothing, leaving a gifter no way to know their surprise is being watched |
| D41 | Letters and marks that draw nothing (the Hangul fillers, the Braille blank, U+034F, U+17B4, U+17B5) count as blank in `visibleOnly`, so a name made only of them is refused; lengths keep counting UTF-16 units, the same in every field (Plan 4a, 2026-10-14; **widened by D44**) | Refusing those characters anywhere in a name; counting names alone in code points or graphemes |
| D42 | The claim sheet mints the manage token and saves it before sending; the API returns the existing claim when the same token comes back for the same item, so a lost `201` costs nothing (Ted, 2026-10-14) | An `Idempotency-Key` column that rotates the manage token on replay; no key, with a lost response leaving a claim nobody can manage |
| D43 | A claim checks the owner before the list's rate limit, so a `429` can't tell an owner that gifters have been claiming (Plan 4b, 2026-10-14) | The Plan 4a order, list limit first |
| D44 | Blank in `visibleOnly` means every default-ignorable code point plus U+2800, not a hand-kept list; amends D41 (Plan 4b, 2026-10-14) | D41's seven code points, which let variation selectors through |
| D45 | The browser keeps its claims under one `localStorage` key, by item ID, so a rotated share link keeps them (Plan 4b, 2026-10-14) | `claims:<shareToken>`, which loses every claim's strip when the owner rotates the link |
| D46 | Plan 5 split into 5a (backups, the restore drill, uptime monitoring) and 5b (Sentry and the readiness checklist), so the backup ships first: losing data is the one failure the live site can't undo (Ted, 2026-10-19) | One Plan 5, with the backup behind the larger Sentry work |
| D47 | Better Stack's free plan for both the uptime checks and the backup heartbeat. The frequent checks hit `/api/health/live`, which never touches the database, and the deep `/api/health` check runs every 30 minutes, the free plan's longest interval (corrected from hourly at go-live), so the monitor can't keep Neon awake past its free compute quota (Ted, 2026-10-19) | UptimeRobot plus Healthchecks.io, two accounts because UptimeRobot's heartbeats are paid; a scheduled GitHub Actions job, which GitHub disables after 60 quiet days and which can't report GitHub's own outage |
| D48 | The backup job connects as a read-only `hanker_backup` role through its own `DATABASE_URL_BACKUP`, so a leaked backup credential can read but never change or destroy data (Ted, 2026-10-19) | Reusing the owner role's `DATABASE_URL_DIRECT` |
| D49 | The restore drill decrypts and restores on the owner's machine, into a throwaway local `postgres:17` container (Ted, 2026-10-19) | A Neon branch, which costs the last of Neon Free's three root branches and puts a second copy of production data in the cloud |
| D50 | Errors go to Sentry by explicit capture on the lighter SDKs (`@sentry/node` behind an `ErrorReporter` port in the API, `@sentry/node` and `@sentry/browser` in the web app), with auto-instrumentation off; `redactTokens` lives in `packages/contracts` beside the token patterns, so both apps redact against one definition (Ted, 2026-10-19) | `@sentry/nestjs` and `@sentry/nextjs`, whose breadcrumbs record every request URL and whose build plugin uploads when it sees a token; posting Sentry's envelope format by hand; a copy of the redaction in each app, or a new package for one function |
| D51 | Browser reports go straight to Sentry, with its ingest origin in `connect-src` (Ted, 2026-10-19) | A tunnel route on `hanker.dev`, which dodges blockers but adds a public endpoint that must refuse to relay anything else |
| D52 | The servers translate stack traces at runtime from the maps they already deploy; only the browser's maps are uploaded, by a `sourcemaps` job holding `SENTRY_AUTH_TOKEN`, from an artifact of map data the policy allows a secret job to download (Ted, 2026-10-19) | Serving the maps and letting Sentry fetch them, which Sentry calls unreliable and which fails for a tab still on the previous deploy |
| D53 | The restore drill repeats quarterly, and after any change to the backup path (Ted, 2026-10-19) | Monthly, which mostly re-proves what the heartbeat shows; twice a year, long enough to lose track of the key or passphrase |
| D54 | A footer on every page (source, privacy, terms, `hello@hanker.dev`), and short privacy and terms pages that name Ted Armstrong; Ted is US-based, so no postal address, imprint or cookie banner ([design](2026-10-21-site-trust-basics-design.md), Ted, 2026-10-21) | Ted's name in the footer; a sitemap |
| D55 | Hanker is for people 13 and older, gifters included (Ted, 2026-10-21) | Limiting the rule to account holders, which leaves gifters' names uncovered |
| D56 | Link previews use one static image in `public/`, with `metadataBase` fixed to `https://hanker.dev` and no `og:url` anywhere (Plan 6) | Build-time image generation; a per-page `og:url`, which on token pages would carry the token |
| D57 | `hello@hanker.dev` is received through Cloudflare Email Routing and answered through Resend SMTP from Gmail, with its own sending-only key (Ted, 2026-10-21) | Forward-only, which exposes Ted's personal address in replies; sending as `hello@mail.hanker.dev` |
| D58 | Tags are rows in `tags` and `item_tags`, referenced by id ([design](2026-10-21-item-tags-and-filters-design.md), Ted, 2026-10-21) | A `text[]` on `items` |
| D59 | Tag names are shown as typed, a leading `#` included, matched case-insensitively after whitespace is collapsed, and limited to 30 characters, 10 per item and 50 per list (Ted, 2026-10-21) | Hashtag-style slugs; dropping a leading `#` so "#books" joins "books" (the first design, changed before merge) |
| D60 | Item saves send existing tags by id and new ones by name, and a stale id is dropped (Ted, 2026-10-21) | Names only, which recreates deleted tags |
| D61 | The share page's price filter reads the number out of `priceText` in the browser, for dollar-scale currencies only (`$`, `US$`, `CA$`, `A$`, `NZ$`, `£`, `€`) (Ted, 2026-10-21) | A stored numeric price (the display string is unchanged, so the "prices are display strings" non-goal holds); bands for every currency, which would put nearly all of a yen list in "100+" |
| D62 | The filter row has charcoal active pills, tags that combine with AND, price bands with OR, and live counts (Ted, 2026-10-21) | Terracotta active pills, which would read as an action |
| D63 | The Tags view is a tag-first bottom sheet: pick a tag, then tick its items (Ted, 2026-10-21) | Per-item batch selection, picking items first and then their tags |
