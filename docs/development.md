# Local development

## Prerequisites

| Tool              | Version                            | Install                                 |
| ----------------- | ---------------------------------- | --------------------------------------- |
| Node              | 24 (see `.nvmrc`)                  | `nvm install`                           |
| pnpm              | 12.10.1 (pinned in `package.json`) | `npm i -g pnpm@12.10.1`                 |
| Docker            | with Compose v2                    | Docker Desktop or Engine                |
| gh + gh-stack     | latest                             | `gh extension install github/gh-stack`  |
| jq, python3, curl | any recent                         | OS package manager (used by `scripts/`) |

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose up -d --wait
pnpm --filter @wishlist/api db:migrate
pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium
```

Already have an `apps/api/.env`? Since Plan 2a the API needs `APP_ORIGIN`, and local development uses `EMAIL_TRANSPORT=mailpit` and Turnstile's test secret. Copy the new lines from `.env.example`. Without `APP_ORIGIN` the API stops at boot and names it. Without the other two it boots, but signup answers `503 CAPTCHA_UNAVAILABLE` and email goes to the API's console instead of Mailpit.

## Daily loop

```bash
pnpm dev
```

This starts Postgres, rebuilds `packages/contracts` on change, and runs the API (`:3001`) and web app (`:3000`) in watch mode. Open http://localhost:3000; the web app proxies `/api/*` to the API.

| Service               | URL                                                     |
| --------------------- | ------------------------------------------------------- |
| Web                   | http://localhost:3000                                   |
| API (direct)          | http://localhost:3001/api/health                        |
| Postgres              | `postgres://wishlist:wishlist@localhost:54329/wishlist` |
| Mailpit (email inbox) | http://localhost:8025                                   |

## Tests

| Command                         | What runs                                                                               | Needs Docker |
| ------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `pnpm test`                     | Unit tests in every package (Vitest)                                                    | No           |
| `pnpm test:integration`         | API tests against a throwaway Postgres (Testcontainers)                                 | Yes          |
| `pnpm test:e2e`                 | Playwright against production builds on ports 3100/3101 and the `wishlist_e2e` database | Yes          |
| `pnpm turbo run lint typecheck` | ESLint and TypeScript                                                                   | No           |

Testcontainers looks for Docker at `/var/run/docker.sock`. With Docker Desktop on Linux, point it at Desktop's socket: `DOCKER_HOST=unix://$HOME/.docker/desktop/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test:integration`.

## Database

- Change the schema in `apps/api/src/db/schema.ts`, then generate a migration: `pnpm --filter @wishlist/api db:generate --name <what_changed>`.
- Review the generated SQL. CI lints it with squawk (`.squawk.toml`).
- Apply it locally: `pnpm --filter @wishlist/api db:migrate`.
- Every migration must work alongside the currently deployed API (expand/contract; spec §10).
- To reset local data: `docker compose down -v && docker compose up -d --wait`, then migrate again.

## Trying the auth API

The API sends email to Mailpit, so every link lands in the inbox at http://localhost:8025. Turnstile's test secret accepts any token. State-changing requests must carry the web origin and a JSON body; the CSRF guard rejects anything else.

```bash
API=http://localhost:3001/api; ORIGIN=http://localhost:3000
curl -i -X POST "$API/auth/signup" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse battery 1","displayName":"Ada","turnstileToken":"x"}'
# Open the email in Mailpit, copy the token from the link, then:
curl -i -X POST "$API/auth/verify-email" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"token":"<token>"}'
curl -i -c /tmp/jar -X POST "$API/auth/login" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse battery 1"}'
curl -i -b /tmp/jar "$API/me"
```

curl keeps the `__Host-session` cookie over plain http because it's localhost.

## Trying the owner API

The owner endpoints need a confirmed email: sign up and verify as in "Trying the auth API", keeping the cookie jar.

```bash
curl -s -b /tmp/jar "$API/wishlist"
curl -s -b /tmp/jar -X POST "$API/wishlist/items" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
  -d '{"title":"Stovetop kettle","url":"https://shop.example/kettle","priceText":"$40"}'
curl -s -b /tmp/jar -X POST "$API/wishlist/unfurl" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
  -d '{"url":"https://example.com/"}'
```

- Every state change needs the `Origin` header and a JSON body, so a `DELETE` sends `-d '{}'`.
- Unfurl makes real requests from your machine. A private or loopback address answers `{"failureReason":"DISALLOWED_ADDRESS"}`, as it should.
- Reordering sends every item ID: `PUT /wishlist/items/order` with `{"itemIds":[…]}`. Anything but the list's exact item set is `409 ORDER_CONFLICT`.

## Trying the claims API

Anyone holding a list's share link can read it and claim from it, with no session. The token is the 22 characters after `/s/` in `shareUrl` from `GET /wishlist`, and an item's `id` comes from its `items`.

```bash
SHARE=<share token>; ITEM=<item id>
curl -s "$API/shared/$SHARE"
curl -s -X POST "$API/shared/$SHARE/items/$ITEM/claims" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
  -d '{"claimerName":"Aunt Sue","quantity":1}'
# The answer carries the manage token, this once.
MANAGE=<manage token>
curl -s "$API/claims/$MANAGE"
curl -s -X PATCH "$API/claims/$MANAGE" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"quantity":2}'
curl -i -X DELETE "$API/claims/$MANAGE" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{}'
```

- With the owner's cookie (`-b /tmp/jar`), `GET /shared/…` answers as the owner: `viewerIsOwner` is true, and there's no `remaining` or `claims` until `PATCH /wishlist` with `{"showClaimsToOwner":true}` (spec §5.1).
- The owner can't claim from their own list (`403 OWNER_CANNOT_CLAIM`).
- Claims and claim edits count against 20 an hour per IP and 30 an hour per list (spec §6.6). The counters are rows in `rate_limits`.

## Trying the editor

With `pnpm dev` running, sign up at http://localhost:3000/signup, confirm the email from Mailpit, log in, and open `/list`.

- Pasting a shop link unfurls it from your machine. A link to a `.invalid` host, such as `https://hanker-e2e.invalid/kettle`, fails fast with "We couldn’t find that site", which is how the E2E tests reach the add form without depending on a real shop.
- The editor keeps the list in one TanStack Query cache (`apps/web/src/lib/list-cache.ts`), and every change goes through one mutation queue (`apps/web/src/lib/list-mutations.ts`). A failure marks the list stale, and it is refetched once the queue drains, rather than a snapshot being restored. Components get the queue from `useListMutations()`, which shares one instance per QueryClient, and there is one QueryClient per browser document (`components/query-provider.tsx`). A remount from Next's router cache, as on Back, therefore reuses the live cache instead of reseeding from a stale server render, and `/list` also refetches on mount when no change is queued. The unit tests run the queue against a real `QueryClient`.

## Trying the pages

With `pnpm dev` running, open http://localhost:3000/signup.

- The Turnstile widget is Cloudflare's always-pass test key (`TURNSTILE_SITE_KEY` in `apps/web/.env.development`), so it ticks itself.
- Every email lands in Mailpit at http://localhost:8025.
- A web _build or start_ (not `next dev`) needs `API_ORIGIN` and `TURNSTILE_SITE_KEY` in the environment. Outside production, use the test key `1x00000000000000000000AA`.
- `pnpm test:e2e` runs the account flows against production builds, with mail through Mailpit and Cloudflare's test widget. It needs Docker and network access to `challenges.cloudflare.com`.

## Pinned dependencies

`apps/api` pins `undici-types` as a devDependency, at the version `@types/node` locks. Vercel's post-build type check doesn't follow pnpm's symlinks, so without the pin `@types/node` can't find `undici-types`, the global `Response` type collapses, and `build-api` fails with `TS2339`. When you bump `@types/node`, bump `undici-types` to the version the lockfile resolves for it: `pnpm --filter @wishlist/api why undici-types --depth 1`.

## Workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md) for stacked PRs and merge rules.
