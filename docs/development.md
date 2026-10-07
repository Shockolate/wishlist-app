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

## Daily loop

```bash
pnpm dev
```

This starts Postgres, rebuilds `packages/contracts` on change, and runs the API (`:3001`) and web app (`:3000`) in watch mode. Open http://localhost:3000; the web app proxies `/api/*` to the API.

| Service      | URL                                                     |
| ------------ | ------------------------------------------------------- |
| Web          | http://localhost:3000                                   |
| API (direct) | http://localhost:3001/api/health                        |
| Postgres     | `postgres://wishlist:wishlist@localhost:54329/wishlist` |

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

## Workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md) for stacked PRs and merge rules.
