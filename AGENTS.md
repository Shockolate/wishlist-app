# AGENTS.md

Instructions for AI coding agents working in this repository. Humans can read it as a short orientation, but [README.md](README.md) is the place to start.

Hanker is a wishlist app for family and friends: Next.js (web), NestJS (API), Postgres on Neon, deployed to Vercel, in a pnpm + Turborepo monorepo.

## Read first

- **The spec is the authority:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](docs/superpowers/specs/2026-10-07-wishlist-app-design.md). Where it is silent, follow the current plan's rulings in [docs/superpowers/plans/](docs/superpowers/plans/). If neither answers a question that is hard to undo, ask a maintainer.
- **What's built and what's next:** [the roadmap](docs/superpowers/plans/2026-10-07-roadmap.md).
- **How to work here:**
  - [docs/development.md](docs/development.md): setup, tests, the database and pinned dependencies.
  - [docs/deployment.md](docs/deployment.md): Vercel, Neon, environment variables and the cron.
  - [CONTRIBUTING.md](CONTRIBUTING.md): stacked PRs and merge rules.

## Layout

| Path                 | What                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`           | NestJS 12 on Express 5. Drizzle + pg; schema in `src/db/schema.ts`, migrations in `drizzle/`. External services sit behind ports (email, Turnstile, breached passwords, clock), with fakes in `src/testing/fakes.ts` |
| `apps/web`           | Next.js. Proxies `/api/*` to the API                                                                                                                                                                                 |
| `packages/contracts` | Zod request/response schemas and error codes: the only code shared between web and API                                                                                                                               |
| `packages/config`    | Shared TypeScript and ESLint config                                                                                                                                                                                  |
| `e2e`                | Playwright E2E and post-deploy smoke tests                                                                                                                                                                           |
| `scripts`            | CI helpers, each with a `*.test.sh` or `*.test.mjs`                                                                                                                                                                  |
| `.github/workflows`  | CI, previews, deploy. Guarded by `scripts/workflow-policy*.mjs`                                                                                                                                                      |

## Environment

- Node 24 (`.nvmrc`; run `nvm use`). Other versions fail in confusing ways, such as Turbo's `Exec format error`.
- pnpm 12.10.1, pinned by `packageManager`.
- Docker for `pnpm dev`, integration tests (Testcontainers) and E2E.
- Turbo builds `packages/contracts` before its dependents. If you run Vitest directly and `@wishlist/contracts` won't import, run `pnpm --filter @wishlist/contracts build`.
- Building the web app needs `API_ORIGIN`, for example `API_ORIGIN=http://localhost:3001`. Only `next dev` reads it from `apps/web/.env.development`.

## Verify before you say it's done

Run what CI runs, and read the output:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm test:integration   # Docker
pnpm test:e2e           # Docker; when a user-facing flow changes
```

If you touch `.github/workflows/` or `scripts/`, also run `node scripts/workflow-policy.test.mjs`, `node scripts/workflow-policy.mutations.test.mjs`, the changed script's `*.test.sh`, and actionlint (the pinned command is in `.github/workflows/ci.yml`). CI lints new migrations with squawk (`.squawk.toml`).

Don't weaken or delete a test to get green. If a test is wrong, say why.

## Conventions

- **ESM everywhere.** In Node packages (`api`, `contracts`, `e2e`), relative imports end in `.js`; the web app uses bundler resolution. `verbatimModuleSyntax` is on, so type-only imports use `import type`.
- **Exact version pins** (no `^` or `~`). TypeScript stays on 6.x and ESLint on 9.x; `renovate.json` says why. Prefer platform APIs (`fetch`) over new dependencies.
- **Nest DI:** every constructor parameter gets an explicit `@Inject(TOKEN_OR_CLASS)`, classes included. Never rely on `design:paramtypes` metadata, so the API works whichever compiler Vercel's builder uses.
- **API shape:** every route is under `/api`. Every error is `application/problem+json` with a stable `code` from `packages/contracts` and a `requestId`. Request bodies are validated per parameter with `ZodValidationPipe` (`400 VALIDATION_FAILED`).
- **Personal data:** a problem `detail` never echoes what the caller sent. Logs never contain passwords, tokens, raw email addresses or SQL parameters.
- **Tests:** unit tests are `*.spec.ts` and never touch Docker. Integration tests are `apps/api/test/*.int-spec.ts`; their files run serially against one Testcontainers Postgres. State-changing requests in tests go through `test/support/client.ts`, which sends the `Origin` and JSON content type the CSRF guard requires. Behavior changes are written test-first.
- **Migrations:** edit `schema.ts`, then `pnpm --filter @wishlist/api db:generate --name <what_changed>`, and review the SQL. A migration must work alongside the API that is currently deployed (expand, then contract).
- **Naming:** people see **Hanker** (pages, emails, sender names). Code, packages, tables and Vercel projects say `wishlist`.

## Git and pull requests

- Changes land as stacked PRs with `gh stack`, one reviewable concern per layer ([CONTRIBUTING.md](CONTRIBUTING.md)). Always `gh stack submit --open`.
- Conventional Commits. PRs are squash-merged, so the **PR title** becomes the commit on `main`: give every new PR a Conventional Commit title and a summary body (`gh pr edit <n> --title … --body-file …`). A layer with several commits otherwise gets its branch name as its title.
- A commit written by an AI agent ends with a `Co-Authored-By:` trailer naming the model that actually wrote it.
- Never commit secrets. Only `.env.example` files and the non-secret `apps/web/.env.development` are tracked.

## Ask a maintainer first

Get explicit approval before anything outward-facing or hard to undo:

- merging, or pushing to `main`;
- the first `gh stack submit` of a new stack;
- creating or changing cloud resources or settings (Vercel, Neon, GitHub repository settings and rulesets);
- setting, rotating or reading secrets and production environment variables.

## Never

- Echo a secret to a terminal or a log. Use a hidden prompt (`read -rs`), or pipe the value straight into the tool that stores it.
- Give a CI build job a secret, or relax the workflow policy tests. Jobs that hold secrets run only pinned tools ([CI isolation spec](docs/superpowers/specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md)).
- Add a `branches:` or workflow-level `paths:` filter to a `pull_request` workflow. Stacked PRs target non-`main` bases, and required checks would wait forever.
- Stop, remove or restart Docker containers or volumes that this repo's `docker-compose.yml` or its tests didn't create.
