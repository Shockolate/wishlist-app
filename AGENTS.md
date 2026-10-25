# AGENTS.md

Instructions for AI coding agents working in this repository. Humans can read it as a short orientation, but [README.md](README.md) is the place to start.

Hanker is a wishlist app for family and friends: Next.js (web), NestJS (API), Postgres on Neon, deployed to Vercel, in a pnpm + Turborepo monorepo.

## Read first

- **The spec is the authority:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](docs/superpowers/specs/2026-10-07-wishlist-app-design.md). Where it is silent, follow the current plan's rulings in [docs/superpowers/plans/](docs/superpowers/plans/). If neither answers a question that is hard to undo, ask a maintainer.
- **What's built and what's next:** [the roadmap](docs/superpowers/plans/2026-10-07-roadmap.md).
- **How to work here:**
  - [docs/development.md](docs/development.md): setup, tests, the database and pinned dependencies.
  - [docs/deployment.md](docs/deployment.md): Vercel, Neon, environment variables and the cron.
  - [docs/operations.md](docs/operations.md): the readiness checklist, recurring chores and where to start when something breaks.
  - [CONTRIBUTING.md](CONTRIBUTING.md): stacked PRs and merge rules.

## Layout

| Path                 | What                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`           | NestJS 12 on Express 5. Drizzle + pg; schema in `src/db/schema.ts`, migrations in `drizzle/`. External services sit behind ports (email, Turnstile, breached passwords, link metadata, clock, error reporting), with fakes in `src/testing/fakes.ts` |
| `apps/web`           | Next.js. Proxies `/api/*` to the API                                                                                                                                                                                                                 |
| `packages/contracts` | Zod request/response schemas and error codes: the only code shared between web and API                                                                                                                                                               |
| `packages/config`    | Shared TypeScript and ESLint config                                                                                                                                                                                                                  |
| `e2e`                | Playwright E2E and post-deploy smoke tests                                                                                                                                                                                                           |
| `tools/vercel-cli`   | The Vercel CLI as `@wishlist/vercel-cli`, so its whole tree is pinned by the lockfile. Secret jobs install only it, with `--ignore-scripts` (D85); run it by hand as `pnpm vercel …`                                                                 |
| `scripts`            | CI helpers, each with a `*.test.sh` or `*.test.mjs`                                                                                                                                                                                                  |
| `.github/workflows`  | CI, previews, deploy. Guarded by `scripts/workflow-policy*.mjs`                                                                                                                                                                                      |

## Environment

- Node 24 (`.nvmrc`; run `nvm use`). Other versions fail in confusing ways, such as Turbo's `Exec format error`.
- pnpm 12.10.1, pinned by `packageManager`.
- Docker for `pnpm dev`, integration tests (Testcontainers) and E2E.
- Turbo builds `packages/contracts` before its dependents. If you run Vitest directly and `@wishlist/contracts` won't import, run `pnpm --filter @wishlist/contracts build`.
- Building or starting the web app needs `API_ORIGIN` and `TURNSTILE_SITE_KEY`, for example `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's test key). Only `next dev` reads them from `apps/web/.env.development`.

## Verify before you say it's done

Run what CI runs, and read the output:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
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
- **Claims (Plan 4a):** a claim or a claim edit locks only its item's row (`FOR UPDATE`), never the wishlist's, which keeps the users → wishlists → items lock order. A read that returns claims (`GET /shared`, `GET /claims`, `GET /wishlist`) runs in one `REPEATABLE READ, READ ONLY` transaction. Claim data reaches an item only through `projectWishlist` (`apps/api/src/claims/projection.ts`): an owner gets no `claims[]` ever; one who hasn't opted in gets no `remaining` or `claimed` either, absent, not empty (D75). The `/claims/:manageToken` routes refuse the list's signed-in owner with `403 OWN_LIST_CLAIM` (D82). A claim may carry the client's own `manageToken`; the same token for the same item returns that claim with `201`, and on another item it's `409 MANAGE_TOKEN_IN_USE` (D42).
- **Tags (Plan 7a):** a tag belongs to one list and is referenced by id. Its key is the lowercased cleaned name, unique per list: a name that came through `TagNameSchema` is keyed with `keyOfCleanName` (`apps/api/src/wishlist/tag-queries.ts`), and `tagKey()` from `packages/contracts` is only for raw input, so a parsed name is never cleaned twice. Every tag write, and every item write carrying `tags`, takes the wishlist row lock first. Item saves send `{ id }` for existing tags and `{ name }` for new ones, and an id that isn't on the list is dropped, never recreated.
- **Retailer lookups (Plan 8a):** `retailerOf()` in `packages/contracts` decides which links skip the page fetch. Amazon product links go to Bright Data through the `AmazonLookup` port, inside `RoutingMetadataFetcher` (`apps/api/src/unfurl/`), sending only `https://www.amazon.com/dp/<ASIN>`. Unset `BRIGHT_DATA_API_KEY` means today's page fetch. Etsy listing links (Plan 8b) go to Etsy's Open API through the `EtsyLookup` port, sending only the listing ID, and unset `ETSY_API_KEY` means today's page fetch. Never log or report the pasted URL, the ASIN, the listing ID or a key. Never store, cache or refresh Etsy data beyond the one prefill (D69).
- **Tag suggestions (Plan 9):** `POST /wishlist/tag-suggestions` asks the `TagSuggester` port (`apps/api/src/tag-suggest/`), Workers AI when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` are set, else nothing. It always answers `200`, and `[]` on any failure or when the list's `suggestTags` is off. Only the title, note, link host, unfurl description and tag names are sent; never a URL, and never anything from Etsy beyond the title. Never log or report item text, tag names or the token. Answers pass through `cleanSuggestions` before they reach the web. On the web, suggestions are offered by `SuggestedTags` and only ever added by a tap.
- **Your gifts (Plan 10b):** `claim_links` ties a claim to an account (`apps/api/src/claims/links.ts`, `claim-change.ts`; `apps/api/src/gifts/`). Only a session whose user has a verified email and isn't the list's owner gets a link: when it claims, or when it opens a manage link and the page's client island, once loaded, sends `POST /claims/:manageToken/link`. **Opening a page changes nothing**: no server render, `GET` or navigation ever links, unlinks or ticks. The first account to link a claim keeps it (`UNIQUE (claim_id)`); another gets `someone-else`; **Not mine** (`DELETE …/link`) removes only the session's own link. **The privacy rule:** no owner response (`GET /wishlist`, the owner's `GET /shared`, any `/claims/*`) carries a link, a Bought tick, a note or whether a claim is linked, and gifters never see each other's; `GET /shared` adds only the viewer's own `viewer.displayName`. Account deletion removes links, ticks and notes and never a claim or a quantity (`user_id` cascades). `claim_id … ON DELETE SET NULL` is the one foreign key that doesn't cascade: a link whose claim is gone is a note (`cancelled_at` set means it was cancelled through its link by anyone but the linked gifter's own session, a guest cancel by that gifter included; else it was removed), and the daily cron stamps `gone_at` on notes that have none, then deletes those older than **30 days** (`giftNotes`). Never log or report a claimer name, a manage token, a link ID or which account holds which claim. Your gifts writes (`PATCH`/`DELETE /me/gifts/:linkId`) take row locks in the order **item → claim → link**, the order the FK cascade from an item, list or account delete uses; `cancel` and Let it go delete the claim first and then touch the link by its id. Name and quantity changes share `applyClaimChange` with `PATCH /claims`; `bought` only sets the link's `bought_at`. On the web, `/gifts` follows `/s` and `/c`: a Server Component reading through `lib/gifts.server.ts`, client islands writing through `browserApi` and then `router.refresh()` (a `404` refreshes too), no TanStack Query, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Sentences live in `lib/gifts-copy.ts`. The claim sheet prefills `viewer.displayName` over `hanker:claimerName`. `/privacy` describes all of this (`If you’re signed in when you claim`); change either with the other.
- **Personal data:** a problem `detail` never echoes what the caller sent. Logs never contain passwords, tokens, raw email addresses or SQL parameters.
- **Error reporting (Plan 5b):** report only through the API's `ERROR_REPORTER` port, the web server's `onRequestError` (`instrumentation.ts`), or the browser's `instrumentation-client.ts` and `error.tsx`. Every Sentry `init` sets `beforeSend: scrubEvent` and `defaultIntegrations: false` and `dataCollection: DATA_COLLECTION_OFF`; never initialize a client without them. Never attach a request body, a user or a raw `DrizzleQueryError` (`reportable()` rebuilds it); a request URL is kept only in redacted form. `redactTokens` in `packages/contracts` is the one definition of what's redacted; a new token-bearing route must be covered by it, and its test.
- **Tests:** unit tests are `*.spec.ts` and never touch Docker. Integration tests are `apps/api/test/*.int-spec.ts`; their files run serially against one Testcontainers Postgres. State-changing requests in tests go through `test/support/client.ts`, which sends the `Origin` and JSON content type the CSRF guard requires. Behavior changes are written test-first.
- **Migrations:** edit `schema.ts`, then `pnpm --filter @wishlist/api db:generate --name <what_changed>`, and review the SQL. A migration must work alongside the API that is currently deployed (expand, then contract).
- **Naming:** people see **Hanker** (pages, emails, sender names). Code, packages, tables and Vercel projects say `wishlist`.
- **Web:**
  - `apps/web/src/proxy.ts` gives every page a nonce CSP and does cookie-presence redirects. The API decides who is signed in.
  - Account forms call the API through `browserApi` (the `/api` rewrite), never Server Actions.
  - The `/list` editor keeps the list in one TanStack Query cache (`lib/list-cache.ts`). Every list change is a mutation from `lib/list-mutations.ts`, in one scope, so changes reach the API in order. A failure marks the list stale, and it is refetched once the queue drains, rather than a snapshot being restored. Use `useListMutations()` from `components/list/use-list-mutations.ts`, which shares one instance per QueryClient, and there is one QueryClient per browser document (`components/query-provider.tsx`). A remount from Next's router cache, as on Back, therefore reuses the live cache instead of reseeding from a stale server render, and `/list` also refetches on mount when no change is queued.
  - **Share and claim pages (Plan 4b):** `/s/[shareToken]` and `/c/[manageToken]` are Server Components that read through `lib/shared-list.server.ts` (a dead link is `notFound()`). The claim sheet, the manage form and the "You're getting" strips are client islands that write through `browserApi` and then `router.refresh()`; TanStack Query isn't used there. The sheet mints the manage token and saves it under `localStorage` `hanker:claims`, by item ID, before it sends the claim, so a lost answer is replayed or found again on reload (D42, D45); storage that throws is treated as empty. Sentences built from claim numbers live in `lib/share-copy.ts`. Owner pages show claim data only from fields the API sent, and turning the setting off calls `hideCachedClaims()` (`components/query-provider.tsx`) first: it cancels in-flight list fetches, then strips the claims from the editor's cache, so a fetch that started before the opt-out can't write them back.
  - **Tags (Plan 7b):** the share page filters in one client island, `ShareFilterList`. Its logic is in `lib/share-filters.ts` and `parsePrice` in contracts. Filtered cards are `hidden`, never unmounted. The edit form sends `tags` only when the tag field changed, and the add form only when it has some. Tag changes are mutations in `lib/list-mutations.ts`.
  - **Add box (Plan 9):** a link and an idea both open the add form (`add-item.tsx`); an idea is never saved at once. Suggested tags come from `use-tag-suggestions.ts`: one request when a form mounts with a title and another when the title loses focus with a new one, and only the latest answer is shown.
  - Error copy lives in `src/lib/messages.ts`, and field-validation copy in `src/lib/form-errors.ts`.
  - UI pieces are hand-copied, shadcn/ui-style, in `src/components/ui`, on the theme tokens in `globals.css`. Terracotta (`primary`) never carries text.

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
- Put a database dump, decrypted or not, in an Actions artifact or a log. On a public repo anyone can download an artifact; backups go only to R2, encrypted (`scripts/backup.sh`).
- Add a `branches:` or workflow-level `paths:` filter to a `pull_request` workflow. Stacked PRs target non-`main` bases, and required checks would wait forever.
- Stop, remove or restart Docker containers or volumes that this repo's `docker-compose.yml` or its tests didn't create.
