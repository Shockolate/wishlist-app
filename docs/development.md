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

## Pinned dependencies

`apps/api` pins `undici-types` as a devDependency, at the version `@types/node` locks. Vercel's post-build type check doesn't follow pnpm's symlinks, so without the pin `@types/node` can't find `undici-types`, the global `Response` type collapses, and `build-api` fails with `TS2339`. When you bump `@types/node`, bump `undici-types` to the version the lockfile resolves for it: `pnpm --filter @wishlist/api why undici-types --depth 1`.

## Workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md) for stacked PRs and merge rules.
