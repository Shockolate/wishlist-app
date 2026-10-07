# Plan 1: Walking Skeleton & Delivery Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the whole delivery pipeline as a deployed skeleton:

- a Next.js web app and a NestJS API on Vercel, behind one origin, backed by Neon Postgres;
- CI on every PR, a preview environment for every PR, and a production deploy on every merge to `main`;
- the three spikes the later plans depend on, resolved.

**Architecture:**

- **Repo:** a pnpm + Turborepo monorepo. Every package is ESM.
- **Shared types:** `packages/contracts` holds Zod schemas and is the only code shared between `apps/api` (NestJS 12, Drizzle, `pg`) and `apps/web` (Next.js 16).
- **One origin:** the web app rewrites `/api/*` to the API.
- **Deploys:** GitHub Actions is the only deployer. It uses Vercel CLI prebuilt deploys.
- **Preview databases:** each PR gets its own Neon branch.

**Tech Stack:** Node 24 · pnpm 12.10.1 · Turborepo 2.11.7 · TypeScript 6.0.3 · NestJS 12.1.2 · Next.js 16.4.0 / React 19.3.0 · Zod 4.6.5 · Drizzle ORM 0.45.3 / drizzle-kit 0.31.11 · pg 8.23.1 · Vitest 5.0.3 (+ unplugin-swc 2.0.0) · Testcontainers 12.2.0 · Playwright 1.63.0 · Tailwind 4.3.3 · ESLint 9.39.5 · Vercel CLI 62.7.0 · Neon (Postgres 17) · GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-10-07-wishlist-app-design.md`](../specs/2026-10-07-wishlist-app-design.md). This plan covers §3 (architecture), §10 (environments and CI/CD), §11 (prerequisites) and §12 (delivery and spikes). It also builds the foundations later plans use: problem+json (§5), request IDs (§9), and rate-limit storage (§4, §6.6).

**Roadmap:** [`2026-10-07-roadmap.md`](2026-10-07-roadmap.md)

## Global Constraints

**Toolchain and versions**
- Node `>=24.15`. `.nvmrc` contains `24`.
- pnpm `12.10.1`, set through the root `packageManager` field.
- ESM everywhere: every `package.json` has `"type": "module"`. In Node packages (`contracts`, `api`, `e2e`), relative imports use `.js` extensions. The web app uses bundler resolution, so it doesn't.
- TypeScript is exactly `6.0.3`, never 7.x. TS 7 drops the compiler API that Nest CLI, typescript-eslint and Next's typecheck use.
- ESLint is exactly `9.39.5`, never 10.x. eslint-config-next's plugins don't support ESLint 10.
- Dependencies are pinned to exact versions in `package.json` (no `^` or `~`), as listed in each task.
- Postgres 17 everywhere: `postgres:17-alpine` locally and in Testcontainers, and the Neon project is created on 17.

**Testing**
- Vitest for unit and integration tests. Playwright for E2E and smoke tests.
- Unit tests are `*.spec.ts` and never touch Docker. Integration tests are `*.int-spec.ts`.

**API conventions**
- Every API route is under `/api`.
- Every API error is `application/problem+json` and includes `code` and `requestId` (spec §5).
- **Nest DI:** every constructor parameter gets an explicit `@Inject(TOKEN_OR_CLASS)`. Never rely on emitted `design:paramtypes` metadata. That keeps the API working whichever compiler Vercel's NestJS builder uses.

**Code boundaries**
- `packages/contracts` is the only code shared between web and api.
- Only `apps/api` has database credentials.

**CI workflows**
- Workflows triggered by `pull_request` must **not** use a `branches:` filter, because stacked PRs target non-`main` bases.
- They must also **not** use a workflow-level `paths:` filter, because required checks would then wait forever.

**Commits and PRs**
- Commits follow Conventional Commits. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- After each `gh stack submit`, give every new PR a Conventional Commit title and a body that summarizes the task, using `gh pr edit <n> --title "…" --body-file <file>`. The body ends with:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

**Approvals and secrets**
- **⏸ CHECKPOINT** marks an outward-facing or irreversible action: creating the GitHub repo, the first push or submit of a stack, merging, creating cloud resources, setting secrets. Stop and get Ted's explicit go-ahead before running it.
- No secrets go in the repo. `.env` files are gitignored; only `.env.example` and the non-secret `apps/web/.env.development` are committed. Secrets are never echoed to a terminal or a log. Use `read -rs` or an interactive prompt instead.

## Review Focus

These are the five inputs or failure modes the spec implies but nobody would think to test, ranked by how likely they are to bite. Each one has a test in the task that owns the code:

1. **Error responses that don't come from our API.** Vercel's edge 404, 502 and 504 HTML pages and its deployment-protection 401 page can all reach the web app's API client. The client must raise `ApiError` with code `UNEXPECTED_RESPONSE`, not crash parsing JSON. Task 7 test: *non-JSON error bodies become UNEXPECTED_RESPONSE*.
2. **Malformed or oversized JSON request bodies.** They must return problem+json `400 BAD_REQUEST` or `413 PAYLOAD_TOO_LARGE`, not Express's default HTML error page. Task 4 tests: *malformed JSON* and *oversized body*.
3. **A database that's unreachable, or slow while Neon wakes up.** `/api/health` must answer `503 degraded` within 5 seconds, not hang until the function times out. Task 6 tests: *times out after 5 seconds* (unit) and *unreachable database answers 503 quickly* (integration).
4. **A web build with no `API_ORIGIN`.** The build must fail loudly. The alternative is shipping a site where every `/api` call 404s. Task 7 test: *refuses to load without API_ORIGIN*.
5. **Request IDs sent by the client.** An incoming `x-request-id` must be ignored, and a malformed or oversized `x-vercel-id` must be replaced, so clients can't forge or bloat the IDs in our logs. Task 4 tests in `request-id.spec.ts`.

## Stacks

| Stack | Tasks | Branches (bottom → top) |
|---|---|---|
| `bootstrap-docs` (spike A) | 2 | `docs/readme` → `docs/contributing` |
| `foundation` | 3–8 | `foundation/monorepo` → `foundation/api-skeleton` → `foundation/database` → `foundation/health-db` → `foundation/web` → `foundation/e2e` |
| `delivery` | 9–13 | `delivery/vercel-setup` → `delivery/spike-findings` → `delivery/deploy-workflow` → `delivery/preview-workflow` → `delivery/repo-hygiene` |

`delivery` starts from `main` after `foundation` has merged. Task 10's spike branch is throwaway and is never pushed as a PR.

## File Structure (end state of Plan 1)

```
wishlist-app/
├── .github/
│   ├── rulesets/main.json                 Ruleset for main, applied via gh api (Task 13)
│   └── workflows/
│       ├── ci.yml                         checks · actionlint · integration · migrations-lint · e2e
│       ├── deploy.yml                     push to main → migrate → api → health → web → smoke
│       ├── preview.yml                    per-PR Neon branch + api/web previews + smoke + PR comment
│       ├── cleanup.yml                    delete PR database branch; nightly sweep
│       └── dependency-review.yml
├── apps/
│   ├── api/
│   │   ├── drizzle/                       generated SQL migrations + meta (committed)
│   │   ├── src/
│   │   │   ├── main.ts                    bootstrap (Vercel entrypoint)
│   │   │   ├── load-env.ts                local .env loading (dev only)
│   │   │   ├── app.module.ts
│   │   │   ├── configure-app.ts           APP_OPTIONS + configureApp(): prefix, middleware, filter
│   │   │   ├── core/                      env.ts, clock.ts, core.module.ts
│   │   │   ├── http/                      app-error.ts, problem.ts, problem-details.filter.ts,
│   │   │   │                              request-id.ts, body-parsing.ts
│   │   │   ├── db/                        schema.ts, pool.ts, database.module.ts, migrate.ts
│   │   │   ├── rate-limit/                window.ts, rate-limiter.ts, rate-limit.module.ts
│   │   │   ├── health/                    health.controller.ts, db-health.ts, health.module.ts
│   │   │   └── testing/                   test-env.ts, app.ts (unit-test helpers; excluded from build)
│   │   ├── test/                          integration tests + support (Testcontainers)
│   │   ├── drizzle.config.ts · nest-cli.json · vercel.json · vitest.config.ts
│   │   └── tsconfig.json · tsconfig.build.json · eslint.config.js · .env.example
│   └── web/
│       ├── src/app/                       layout.tsx, page.tsx, globals.css
│       ├── src/lib/                       api-client.ts (+spec), api.server.ts
│       ├── next.config.ts (+spec) · vercel.json · turbo.json · vitest.config.ts
│       └── tsconfig.json · eslint.config.js · postcss.config.mjs · .env.development
├── packages/
│   ├── config/                            tsconfig.base.json, eslint.base.js
│   └── contracts/src/                     error-codes.ts, problem.ts, health.ts (+specs)
├── e2e/                                   Playwright: tests/local, tests/smoke, two configs
├── scripts/                               e2e.sh, wait-for-health.sh, neon-sweep.sh (+tests)
├── docker/postgres/init/                  creates the wishlist_e2e database
├── docs/                                  development.md, deployment.md, spikes/, specs/, plans/
├── docker-compose.yml · turbo.json · pnpm-workspace.yaml · package.json · renovate.json
└── README.md · CONTRIBUTING.md · .squawk.toml · .nvmrc · .editorconfig · .prettierrc.json
```

---

### Task 1: Toolchain and GitHub repository

**Files:** none. The spec, roadmap and this plan are already committed on local `main`.

**Interfaces:**
- Produces: the public repo `github.com/Shockolate/wishlist-app` with `main` pushed, plus a local toolchain that has `pnpm@12.10.1` and the `gh stack` extension.

- [ ] **Step 1: Install and verify the toolchain**

```bash
npm i -g pnpm@12.10.1
gh extension install github/gh-stack
pnpm --version                 # expect 12.10.1
gh stack --help | head -3      # expect the gh-stack usage banner
git --version                  # expect >= 2.36
node --version                 # expect v24.x (>= 24.15)
docker info --format '{{.ServerVersion}}'   # expect a version, not an error
jq --version && python3 --version          # used by scripts/ and their tests
```

The Vercel CLI doesn't need a global install. Task 9 adds it as a root devDependency and runs it with `pnpm exec vercel`.

- [ ] **Step 2: ⏸ CHECKPOINT — create the public repo and push `main`**

Confirm with Ted, then run:

```bash
gh repo create Shockolate/wishlist-app --public \
  --description "Wishlists for family and friends" \
  --source . --remote origin --push
gh repo edit Shockolate/wishlist-app --delete-branch-on-merge
gh repo view Shockolate/wishlist-app --json visibility,defaultBranchRef \
  --jq '.visibility + " " + .defaultBranchRef.name'
```

Expected: `PUBLIC main`.

---

### Task 2: Spike A — how a stacked PR merges

The answer decides which merge methods the ruleset allows (spec §10). The PRs it uses carry real content (README and CONTRIBUTING), so nothing gets thrown away.

**Files:**
- Create: `README.md` (branch `docs/readme`)
- Create: `CONTRIBUTING.md` (branch `docs/contributing`)
- Create (locally, untracked until Task 3): `docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md`

**Interfaces:**
- Produces: the chosen merge method (`squash` or `merge`). Task 3 adds it to `CONTRIBUTING.md`, and Task 13 sets it in `.github/rulesets/main.json`.

- [ ] **Step 1: Create the README layer**

```bash
git switch main && git pull --ff-only
gh stack init docs/readme
```

Create `README.md`:

```markdown
# Wishlist

A wishlist app for family and friends. Owners keep one list of gifts they'd like and share a secret link; anyone with the link can claim items so nobody buys the same gift twice.

- **Design spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](docs/superpowers/specs/2026-10-07-wishlist-app-design.md)
- **Roadmap:** [docs/superpowers/plans/2026-10-07-roadmap.md](docs/superpowers/plans/2026-10-07-roadmap.md)
- **Contributing (stacked PRs):** [CONTRIBUTING.md](CONTRIBUTING.md)

## Stack

Next.js (web) · NestJS (API) · Postgres on Neon · Vercel · GitHub Actions. TypeScript and ESM throughout, in a pnpm + Turborepo monorepo.
```

```bash
git add README.md
git commit -F - <<'EOF'
docs: add README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 2: Create the CONTRIBUTING layer**

```bash
gh stack add docs/contributing
```

Create `CONTRIBUTING.md`:

````markdown
# Contributing

## Workflow: stacked pull requests

Changes land as small PRs arranged in stacks with [`gh stack`](https://github.github.com/gh-stack/). Each layer is one reviewable concern and must pass CI on its own.

### One-time setup

```bash
gh extension install github/gh-stack
```

### Build a stack

```bash
git switch main && git pull --ff-only
gh stack init <first-branch>      # first layer, on top of main
# …commit…
gh stack add <next-branch>        # next layer, on top of the current one
# …commit…
gh stack submit                   # push every layer and open/update one PR per layer
```

### Address review feedback on a lower layer

```bash
gh stack checkout <pr-number>
# …commit the fix…
gh stack rebase --upstack         # replay the layers above onto the fix
gh stack push
```

### Stay current with main

```bash
gh stack sync
```

### Merge

Merging goes bottom-up. `gh stack merge <pr-number>` merges every layer up to and including that PR as a single all-or-nothing operation.

## Rules for every PR

- One reviewable concern per PR.
- Conventional Commit titles: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`.
- Behavior changes are written test-first.
- Never commit secrets. Only `.env.example` files, and the non-secret `apps/web/.env.development`, are tracked.
````

```bash
git add CONTRIBUTING.md
git commit -F - <<'EOF'
docs: add contributing guide for stacked PRs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 3: ⏸ CHECKPOINT — submit the stack**

```bash
gh stack submit
gh stack view
```

Expected: two open PRs. Record both numbers as `BOTTOM` (`docs/readme`) and `TOP` (`docs/contributing`).

```bash
gh pr view "$BOTTOM" --json baseRefName --jq .baseRefName   # expect: main
gh pr view "$TOP"    --json baseRefName --jq .baseRefName   # expect: docs/readme
```

Set the PR titles and bodies as described in Global Constraints.

- [ ] **Step 4: ⏸ CHECKPOINT — merge the whole stack with squash**

```bash
gh stack merge "$TOP" --squash --yes
```

- [ ] **Step 5: Observe the result**

```bash
git fetch origin --prune
git log --oneline origin/main -3
git show --stat --format='%s' origin/main
git show --stat --format='%s' origin/main~1
gh pr view "$BOTTOM" --json state --jq .state
gh pr view "$TOP" --json state,baseRefName --jq '.state + " " + .baseRefName'
```

**Squash is the method if all of the following hold:**
- both PRs are `MERGED`;
- `origin/main` has exactly two new commits;
- the newest touches only `CONTRIBUTING.md`;
- the one before it touches only `README.md`.

**Fallback if squash fails** (e.g. the top PR is left open or conflicted, or both files land in one commit): merge what's left with merge commits, which GitHub documents as native stack behavior.

```bash
gh stack merge "$TOP" --merge --yes
```

Re-run the observation commands above. Record **merge** as the method.

- [ ] **Step 6: Record the findings (left untracked until Task 3 commits it)**

Create `docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md`. Fill in every `Observed` line with real output.

```markdown
# Spike A: stacked-PR merge method

- **Date:** 2026-10-07
- **Question:** Does `gh stack merge --squash` land a stack cleanly on `main` (spec §10, merge method)?
- **Setup:** two-layer stack (`docs/readme` → `docs/contributing`), PRs #<BOTTOM> and #<TOP>, merged with `gh stack merge <TOP> --squash --yes`.

## Observed

- PR states: <output>
- `git log --oneline origin/main -3`: <output>
- Files per commit: <output>

## Decision

- **Merge method:** <squash | merge>
- **Why:** <one sentence tied to the observations>
- **Consequences:** the ruleset's `allowed_merge_methods` is `["<method>"]` (Task 13), and CONTRIBUTING documents it (Task 3).
```

- [ ] **Step 7: Clean up the local stack**

```bash
gh stack sync --prune
git switch main && git pull --ff-only
```

---

### Task 3: Monorepo foundation, contracts package, CI checks

**Files:**
- Create: `.gitignore`, `.nvmrc`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.base.js`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/tsconfig.build.json`, `packages/contracts/eslint.config.js`
- Create: `packages/contracts/src/index.ts`, `src/error-codes.ts`, `src/problem.ts`, `src/health.ts`
- Test: `packages/contracts/src/problem.spec.ts`, `packages/contracts/src/health.spec.ts`
- Create: `.github/workflows/ci.yml`
- Commit: `docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md` (from Task 2)
- Modify: `CONTRIBUTING.md` (add "Merge method")

**Interfaces:**
- Produces, from `@wishlist/config`:
  - `@wishlist/config/tsconfig.base.json`
  - `baseEslintConfig(options: { tsconfigRootDir: string; decorators?: boolean })`, exported from `@wishlist/config/eslint`
- Produces, from `@wishlist/contracts`:
  - `ErrorCode`, a const object plus a type of the same name
  - `ProblemSchema` and `type Problem`
  - `HealthResponseSchema` and `type HealthResponse`. At this task it's `{ status: 'ok' | 'degraded'; sha: string }`; Task 6 adds `db`.

- [ ] **Step 1: Start the foundation stack**

```bash
git switch main && git pull --ff-only
gh stack init foundation/monorepo
```

- [ ] **Step 2: Write the root workspace files**

`.nvmrc`:
```
24
```

`.gitignore`:
```gitignore
node_modules/
dist/
.next/
next-env.d.ts
.turbo/
coverage/
.vercel/
*.tsbuildinfo
playwright-report/
test-results/
.DS_Store

# Secrets stay local. Only .env.example and apps/web/.env.development are committed.
.env
.env.local
.env.*.local
```

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.prettierrc.json`:
```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

`.prettierignore`:
```
pnpm-lock.yaml
# Design record: reformatting would churn reviewed docs without changing their meaning.
docs/superpowers/
apps/api/drizzle/
**/dist/
**/.next/
**/playwright-report/
**/test-results/
```

`package.json`:
```json
{
  "name": "wishlist-app",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.10.1",
  "engines": {
    "node": ">=24.15"
  },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "prettier": "3.9.9",
    "turbo": "2.11.7",
    "typescript": "6.0.3"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "stream",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "test:integration": {
      "dependsOn": ["^build"],
      "cache": false,
      "passThroughEnv": ["DOCKER_HOST", "TESTCONTAINERS_*"]
    },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true }
  }
}
```

**Why `^build` everywhere:** workspace packages are consumed through their built `dist`. Typecheck, lint and tests therefore need their dependencies built first.

- [ ] **Step 3: Write the shared config package**

`packages/config/package.json`:
```json
{
  "name": "@wishlist/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tsconfig.base.json": "./tsconfig.base.json",
    "./eslint": "./eslint.base.js"
  },
  "dependencies": {
    "@eslint/js": "9.39.5",
    "globals": "17.13.0",
    "typescript-eslint": "8.71.1"
  },
  "peerDependencies": {
    "eslint": "9.39.5"
  }
}
```

`packages/config/tsconfig.base.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  }
}
```

**Why `"types": []`:** TypeScript 6 doesn't auto-include `@types/*` any more, so each package states the global types it needs (e.g. `["node"]`). Writing it here makes that explicit.

`packages/config/eslint.base.js`:
```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config for the Node packages (contracts, api, e2e). The web app uses
 * eslint-config-next instead.
 *
 * `decorators: true` tells the type-import rule that decorator metadata is emitted, so it won't
 * autofix a Nest-injected class into `import type` (which would erase it at runtime).
 */
export function baseEslintConfig({ tsconfigRootDir, decorators = false }) {
  return defineConfig([
    globalIgnores(['dist/**', 'coverage/**', '.turbo/**', '*.config.*', 'eslint.config.js']),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
          ...(decorators ? { emitDecoratorMetadata: true, experimentalDecorators: true } : {}),
        },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      // Test bodies are untyped by nature (supertest bodies, mocks); parse them with contract
      // schemas where it matters instead of fighting the no-unsafe-* family.
      files: ['**/*.spec.ts', '**/*.int-spec.ts', 'test/**/*.ts', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ]);
}
```

- [ ] **Step 4: Write the contracts package scaffolding**

`packages/contracts/package.json`:
```json
{
  "name": "@wishlist/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@wishlist/config": "workspace:*",
    "eslint": "9.39.5",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "@wishlist/config/tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/contracts/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

`packages/contracts/eslint.config.js`:
```js
import { baseEslintConfig } from '@wishlist/config/eslint';

export default baseEslintConfig({ tsconfigRootDir: import.meta.dirname });
```

- [ ] **Step 5: Install, and resolve build-script approvals**

```bash
pnpm install
```

pnpm 12 refuses to run dependency build scripts until they're approved in `pnpm-workspace.yaml` under `allowBuilds`. If install reports ignored build scripts, run `pnpm ignored-builds`. Then for each package listed:
- **Allow it** (`<name>: true`) **only** if it's one of `esbuild`, `@swc/core`, `unrs-resolver`, `sharp` or `@parcel/watcher`. These all install native binaries.
- **Deny anything else** (`<name>: false`), and mention it in the PR description.

Example result:
```yaml
packages:
  - apps/*
  - packages/*
allowBuilds:
  esbuild: true
```

Re-run `pnpm install`. Expected: it finishes with no ignored-build warnings, and `pnpm-lock.yaml` exists.

- [ ] **Step 6: Write the failing contract tests**

`packages/contracts/src/problem.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ProblemSchema } from './problem.js';

const base = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  code: 'NOT_FOUND',
  requestId: 'req-1',
};

describe('ProblemSchema', () => {
  it('accepts a minimal problem', () => {
    expect(ProblemSchema.parse(base)).toEqual(base);
  });

  it('keeps extension members so domain errors can carry extra fields', () => {
    const parsed = ProblemSchema.parse({
      ...base,
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      remaining: 1,
    });
    expect(parsed).toMatchObject({ remaining: 1 });
  });

  it('rejects a problem without a code', () => {
    const { code: _code, ...withoutCode } = base;
    expect(ProblemSchema.safeParse(withoutCode).success).toBe(false);
  });

  it('rejects non-error statuses', () => {
    expect(ProblemSchema.safeParse({ ...base, status: 200 }).success).toBe(false);
  });
});
```

`packages/contracts/src/health.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts an ok response', () => {
    const body = { status: 'ok', sha: 'abc123' };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown statuses', () => {
    expect(HealthResponseSchema.safeParse({ status: 'meh', sha: 'abc123' }).success).toBe(false);
  });
});
```

- [ ] **Step 7: Run the tests and watch them fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, because `./problem.js` and `./health.js` can't be resolved.

- [ ] **Step 8: Implement the contracts**

`packages/contracts/src/error-codes.ts`:
```ts
/**
 * Stable, machine-readable error codes carried in every problem response's `code`. The web app
 * switches on these, never on human-readable text. Later plans add domain codes here.
 */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  HTTP_ERROR: 'HTTP_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Synthesized by the web client when an error response isn't problem+json (e.g. a Vercel edge page). */
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

`packages/contracts/src/problem.ts`:
```ts
import { z } from 'zod';

/**
 * RFC 9457 problem details, extended with a stable `code` and the `requestId` (spec §5).
 * A loose object, because domain errors add extension members such as `remaining` on a claim
 * conflict, and those must survive parsing.
 */
export const ProblemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
  requestId: z.string().min(1),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
```

`packages/contracts/src/health.ts`:
```ts
import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Git commit the API was deployed from; deploy pipelines poll for it. */
  sha: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```

`packages/contracts/src/index.ts`:
```ts
export * from './error-codes.js';
export * from './health.js';
export * from './problem.js';
```

- [ ] **Step 9: Run the tests and the full gate**

```bash
pnpm --filter @wishlist/contracts test
pnpm turbo run lint typecheck test build
pnpm format:check
```

Expected: 6 tests pass, every turbo task succeeds, and Prettier reports no issues. If Prettier lists files, run `pnpm format` and re-check.

- [ ] **Step 10: Add the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

# No `branches:` filter: in a stack, upper PRs target the branch below them, not main.
on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  checks:
    name: checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm turbo run lint typecheck test build
```

- [ ] **Step 11: Commit the Spike A findings and document the merge method**

Append to `CONTRIBUTING.md`. Use the method recorded in Task 2. The text below assumes **squash**; if the spike chose **merge**, replace the paragraph to describe merge commits.

```markdown

## Merge method

PRs are **squash-merged**: one commit on `main` per PR, titled with the PR's Conventional Commit title. The ruleset on `main` allows only this method. See [Spike A](docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md) for how it was chosen.
```

- [ ] **Step 12: Commit**

```bash
git add .gitignore .nvmrc .editorconfig .prettierrc.json .prettierignore package.json \
  pnpm-workspace.yaml pnpm-lock.yaml turbo.json packages .github/workflows/ci.yml
git commit -F - <<'EOF'
build: scaffold pnpm/turbo monorepo with contracts package and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git add docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md CONTRIBUTING.md
git commit -F - <<'EOF'
docs: record stacked-PR merge spike and merge method

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 13: ⏸ CHECKPOINT — submit the stack (first push of `foundation`)**

```bash
gh stack submit
```

Set the PR title and body. Expected: the `checks` job passes on the PR.

---

### Task 4: API skeleton — env, request IDs, problem+json, health

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.js`, `vitest.config.ts`, `.env.example`
- Create: `apps/api/src/main.ts`, `src/load-env.ts`, `src/app.module.ts`, `src/configure-app.ts`
- Create: `apps/api/src/core/env.ts`, `src/core/core.module.ts`
- Create: `apps/api/src/http/app-error.ts`, `src/http/problem.ts`, `src/http/problem-details.filter.ts`, `src/http/request-id.ts`, `src/http/body-parsing.ts`
- Create: `apps/api/src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `apps/api/src/testing/test-env.ts`, `src/testing/app.ts`
- Test: `apps/api/src/core/env.spec.ts`, `src/http/problem.spec.ts`, `src/http/request-id.spec.ts`, `src/http/http-pipeline.spec.ts`, `src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `Problem`, `HealthResponse`, `HealthResponseSchema`, `ProblemSchema` from `@wishlist/contracts`.
- Produces:
  - **`src/core/env.ts`:** `ENV: unique symbol`, `type Env = { NODE_ENV: 'development' | 'test' | 'production'; PORT: number; GIT_SHA: string }`, and `parseEnv(source: NodeJS.ProcessEnv): Env`. Task 5 adds `DATABASE_URL: string`.
  - **`src/core/core.module.ts`:** `CoreModule`, a global module providing `ENV`.
  - **`src/http/app-error.ts`:** `class AppError extends Error { constructor(status: number, code: string, detail?: string, extras?: Readonly<Record<string, unknown>>) }`.
  - **`src/http/problem.ts`:** `toProblem(exception: unknown, requestId: string): Problem` and `sendProblem(res: Response, problem: Problem): void`.
  - **`src/http/request-id.ts`:** the `requestId` Express middleware, `REQUEST_ID_HEADER = 'x-request-id'`, and `requestIdOf(res: Response): string`.
  - **`src/configure-app.ts`:** `APP_OPTIONS` and `configureApp(app: NestExpressApplication): NestExpressApplication`.
  - **`src/testing/test-env.ts`:** `testEnv(overrides?: Partial<Env>): Env`.
  - **`src/testing/app.ts`:** `createUnitApp(metadata: ModuleMetadata): Promise<NestExpressApplication>` and `http(app: INestApplication): TestAgent`. `TestAgent` is supertest's agent type.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add foundation/api-skeleton
```

- [ ] **Step 2: Write the package scaffolding**

`apps/api/package.json`:
```json
{
  "name": "@wishlist/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch --preserveWatchOutput",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run --project unit"
  },
  "dependencies": {
    "@nestjs/common": "12.1.2",
    "@nestjs/core": "12.1.2",
    "@nestjs/platform-express": "12.1.2",
    "@wishlist/contracts": "workspace:*",
    "express": "5.2.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@nestjs/cli": "12.0.8",
    "@nestjs/testing": "12.1.2",
    "@swc/core": "1.16.13",
    "@types/express": "5.0.6",
    "@types/node": "24.19.1",
    "@types/supertest": "7.2.1",
    "@wishlist/config": "workspace:*",
    "eslint": "9.39.5",
    "supertest": "7.3.1",
    "typescript": "6.0.3",
    "unplugin-swc": "2.0.0",
    "vitest": "5.0.3"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "@wishlist/config/tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts", "src/testing/**"]
}
```

`apps/api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "sourceRoot": "src",
  "compilerOptions": {
    "builder": "tsc",
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

`apps/api/eslint.config.js`:
```js
import { baseEslintConfig } from '@wishlist/config/eslint';

export default baseEslintConfig({ tsconfigRootDir: import.meta.dirname, decorators: true });
```

`apps/api/vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest's default transform can't emit decorator metadata. Our DI uses explicit @Inject tokens
  // and doesn't depend on it, but compiling tests the way Nest's own Vitest template does keeps
  // test behavior identical to `nest build`.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    projects: [{ extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } }],
  },
});
```

`apps/api/.env.example`:
```dotenv
# Copy to .env for local development (`cp .env.example .env`). Never commit .env.
PORT=3001
GIT_SHA=dev
```

```bash
pnpm install
```

Resolve any new ignored builds using the Task 3 Step 5 rule. `@swc/core` is on the allow list.

- [ ] **Step 3: Write the failing env tests**

`apps/api/src/core/env.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3001, GIT_SHA: 'dev' });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });
});
```

- [ ] **Step 4: Write the failing problem-mapping tests**

`apps/api/src/http/problem.spec.ts`:
```ts
import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { toProblem } from './problem.js';

describe('toProblem', () => {
  it('maps an AppError to its status, code, detail and extension members', () => {
    const problem = toProblem(new AppError(409, 'CLAIM_EXCEEDS_REMAINING', 'Only 1 left', { remaining: 1 }), 'req-1');
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      detail: 'Only 1 left',
      requestId: 'req-1',
      remaining: 1,
    });
  });

  it('never lets extension members overwrite the core fields', () => {
    const problem = toProblem(new AppError(409, 'REAL_CODE', undefined, { status: 200, code: 'FAKE', requestId: 'x' }), 'req-1');
    expect(problem).toMatchObject({ status: 409, code: 'REAL_CODE', requestId: 'req-1' });
  });

  it('maps Nest HTTP exceptions to a code by status', () => {
    expect(toProblem(new NotFoundException('Cannot GET /api/nope'), 'req-1')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /api/nope',
    });
  });

  it('hides the message of server-side HTTP exceptions', () => {
    const problem = toProblem(new HttpException('pool exhausted at db-7', 503), 'req-1');
    expect(problem).toMatchObject({ status: 503, code: 'INTERNAL_ERROR' });
    expect(problem).not.toHaveProperty('detail');
  });

  it('maps exposed client errors from Express middleware (e.g. body-parser)', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      status: 400,
      expose: true,
    });
    expect(toProblem(parseError, 'req-1')).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      detail: 'Unexpected end of JSON input',
    });
  });

  it('turns anything else into an opaque 500', () => {
    for (const thrown of [new Error('secret internals'), 'a string', { status: 400, expose: false, message: 'x' }]) {
      const problem = toProblem(thrown, 'req-1');
      expect(problem).toEqual({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: 'req-1',
      });
    }
  });
});
```

- [ ] **Step 5: Write the failing request-ID tests**

`apps/api/src/http/request-id.spec.ts`:
```ts
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requestId, requestIdOf } from './request-id.js';

function run(headers: Record<string, string>) {
  const req = { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const setHeader = vi.fn();
  const res = { locals: {}, setHeader } as unknown as Response;
  const next = vi.fn();
  requestId(req, res, next);
  return { id: requestIdOf(res), setHeader, next };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestId middleware', () => {
  it('generates a UUID when Vercel provides no ID, echoes it, and continues', () => {
    const { id, setHeader, next } = run({});
    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
    expect(next).toHaveBeenCalledOnce();
  });

  it("reuses Vercel's x-vercel-id so logs and errors line up", () => {
    expect(run({ 'x-vercel-id': 'iad1::iad1::abcde-1712345678901-0123456789ab' }).id).toBe(
      'iad1::iad1::abcde-1712345678901-0123456789ab',
    );
  });

  it('ignores a client-supplied x-request-id', () => {
    expect(run({ 'x-request-id': 'forged-id' }).id).toMatch(UUID);
  });

  it('replaces an oversized x-vercel-id', () => {
    expect(run({ 'x-vercel-id': 'a'.repeat(500) }).id).toMatch(UUID);
  });

  it('replaces an x-vercel-id containing unexpected characters', () => {
    expect(run({ 'x-vercel-id': 'iad1::<script>' }).id).toMatch(UUID);
  });
});
```

- [ ] **Step 6: Write the failing HTTP pipeline and health tests**

`apps/api/src/testing/test-env.ts`:
```ts
import type { Env } from '../core/env.js';

/** A complete, valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { NODE_ENV: 'test', PORT: 0, GIT_SHA: 'test-sha', ...overrides };
}
```

`apps/api/src/testing/app.ts`:
```ts
import type { Server } from 'node:http';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_OPTIONS, configureApp } from '../configure-app.js';

/** Boots a Nest app from the given module metadata with the production HTTP pipeline. */
export async function createUnitApp(metadata: ModuleMetadata): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false }),
  );
  await app.init();
  return app;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer() as Server);
}
```

`apps/api/src/http/http-pipeline.spec.ts`:
```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import { AppError } from './app-error.js';

@Controller('probe')
class ProbeController {
  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Get('conflict')
  conflict(): never {
    throw new AppError(409, 'PROBE_CONFLICT', 'probe conflicted', { remaining: 2 });
  }

  @Get('crash')
  crash(): never {
    throw new Error('database password is hunter2');
  }
}

describe('HTTP pipeline', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('answers unknown routes with problem+json 404 carrying the request id', async () => {
    const res = await http(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = ProblemSchema.parse(res.body);
    expect(problem.code).toBe(ErrorCode.NOT_FOUND);
    expect(problem.requestId).toBe(res.headers['x-request-id']);
  });

  it('renders AppErrors with their code, detail and extension members', async () => {
    const res = await http(app).get('/api/probe/conflict');
    expect(res.status).toBe(409);
    expect(ProblemSchema.parse(res.body)).toMatchObject({
      code: 'PROBE_CONFLICT',
      detail: 'probe conflicted',
      remaining: 2,
    });
  });

  it('hides unexpected errors behind an opaque 500', async () => {
    const res = await http(app).get('/api/probe/crash');
    expect(res.status).toBe(500);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('parses valid JSON bodies', async () => {
    const res = await http(app).post('/api/probe/echo').send({ hello: 'world' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ hello: 'world' });
  });

  it('answers malformed JSON with problem+json 400', async () => {
    const res = await http(app)
      .post('/api/probe/echo')
      .set('content-type', 'application/json')
      .send('{"broken": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.BAD_REQUEST);
  });

  it('answers oversized bodies with problem+json 413', async () => {
    const res = await http(app)
      .post('/api/probe/echo')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
  });

  it('does not advertise Express', async () => {
    const res = await http(app).get('/api/definitely-not-a-route');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
```

`apps/api/src/health/health.controller.spec.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { testEnv } from '../testing/test-env.js';
import { HealthController } from './health.controller.js';

describe('GET /api/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: testEnv({ GIT_SHA: 'abc123' }) }],
    });
  });

  afterAll(() => app.close());

  it('reports ok with the deployed commit and is never cached', async () => {
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: 'ok', sha: 'abc123' });
  });
});
```

- [ ] **Step 7: Run the tests and watch them fail**

Run: `pnpm --filter @wishlist/api test`
Expected: FAIL. Imports such as `./env.js`, `./problem.js`, `./request-id.js`, `../configure-app.js` and `./health.controller.js` don't resolve yet.

- [ ] **Step 8: Implement env and core module**

`apps/api/src/core/env.ts`:
```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  /** Commit the deployment was built from; set by the deploy pipelines. */
  GIT_SHA: z.string().min(1).default('dev'),
});

export type Env = z.infer<typeof EnvSchema>;

/** DI token for the validated environment. */
export const ENV = Symbol('ENV');

/** Validates the environment once at boot so a misconfigured deploy fails fast and says why. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

`apps/api/src/core/core.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv(process.env) }],
  exports: [ENV],
})
export class CoreModule {}
```

- [ ] **Step 9: Implement errors, problem mapping, request IDs and body parsing**

`apps/api/src/http/app-error.ts`:
```ts
/**
 * Base class for expected, client-facing failures. The problem-details filter renders these as
 * RFC 9457 responses; `extras` become extension members (e.g. `remaining` on a claim conflict).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly extras: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail ?? code);
    this.name = new.target.name;
  }
}
```

`apps/api/src/http/problem.ts`:
```ts
import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
import { ErrorCode, type Problem } from '@wishlist/contracts';
import type { Response } from 'express';
import { AppError } from './app-error.js';

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  404: ErrorCode.NOT_FOUND,
  405: ErrorCode.METHOD_NOT_ALLOWED,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  429: ErrorCode.RATE_LIMITED,
};

/** Maps anything thrown while handling a request to the problem we send. Never leaks 5xx detail. */
export function toProblem(exception: unknown, requestId: string): Problem {
  if (exception instanceof AppError) {
    return build(exception.status, exception.code, requestId, exception.detail, exception.extras);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return build(status, codeFor(status), requestId, status < 500 ? exception.message : undefined);
  }
  // Errors raised by Express middleware (body-parser) carry a status and an `expose` flag saying
  // whether their message is safe to show to the client.
  if (isExposedClientError(exception)) {
    return build(exception.status, codeFor(exception.status), requestId, exception.message);
  }
  return build(500, ErrorCode.INTERNAL_ERROR, requestId);
}

export function sendProblem(res: Response, problem: Problem): void {
  res.status(problem.status).type('application/problem+json').json(problem);
}

function build(
  status: number,
  code: string,
  requestId: string,
  detail?: string,
  extras: Readonly<Record<string, unknown>> = {},
): Problem {
  return {
    ...extras,
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    requestId,
    ...(detail === undefined ? {} : { detail }),
  };
}

function codeFor(status: number): string {
  if (status >= 500) return ErrorCode.INTERNAL_ERROR;
  return CODE_BY_STATUS[status] ?? ErrorCode.HTTP_ERROR;
}

function isExposedClientError(error: unknown): error is { status: number; message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose, message } = error as Record<string, unknown>;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    expose === true &&
    typeof message === 'string'
  );
}
```

`apps/api/src/http/request-id.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_VERCEL_ID_LENGTH = 128;
const VERCEL_ID_PATTERN = /^[a-z0-9:-]+$/i;

/**
 * Gives each request an ID, echoed in `x-request-id` and in every problem response. Vercel's edge
 * sets `x-vercel-id` (clients can't override it there), so we reuse it to line our errors up with
 * Vercel's logs. A client-sent `x-request-id` is ignored: trusting it would let callers forge or
 * collide IDs in our logs.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const vercelId = req.header('x-vercel-id');
  const id =
    vercelId && vercelId.length <= MAX_VERCEL_ID_LENGTH && VERCEL_ID_PATTERN.test(vercelId)
      ? vercelId
      : randomUUID();
  res.locals.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

export function requestIdOf(res: Response): string {
  const value: unknown = res.locals.requestId;
  return typeof value === 'string' ? value : 'unknown';
}
```

`apps/api/src/http/body-parsing.ts`:
```ts
import express, { type ErrorRequestHandler } from 'express';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

/** Our own JSON parser (Nest's is disabled in APP_OPTIONS) so its errors go through the handler below. */
export const jsonBodyParser = express.json({ limit: '100kb' });

/**
 * Body-parser failures happen before routing, so Nest's exception filters never see them. This
 * Express error handler renders them as problem+json instead of Express's default HTML page.
 */
export const bodyParseErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  sendProblem(res, toProblem(err, requestIdOf(res)));
};
```

`apps/api/src/http/problem-details.filter.ts`:
```ts
import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception, requestIdOf(res));
    if (problem.status >= 500) {
      this.logger.error(
        `[${problem.requestId}] unhandled error`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    sendProblem(res, problem);
  }
}
```

- [ ] **Step 10: Implement app wiring, health and the entrypoint**

`apps/api/src/configure-app.ts`:
```ts
import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { bodyParseErrorHandler, jsonBodyParser } from './http/body-parsing.js';
import { ProblemDetailsFilter } from './http/problem-details.filter.js';
import { requestId } from './http/request-id.js';

/**
 * Nest's built-in body parser is disabled so ours, and its error handler, run in a known order.
 * Tests must create apps with these same options.
 */
export const APP_OPTIONS = { bodyParser: false } satisfies NestApplicationOptions;

/** The production HTTP pipeline. main.ts and every test app go through this one function. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(requestId);
  app.use(jsonBodyParser);
  app.use(bodyParseErrorHandler);
  app.useGlobalFilters(new ProblemDetailsFilter());
  return app;
}
```

`apps/api/src/health/health.controller.ts`:
```ts
import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { HealthResponse } from '@wishlist/contracts';
import { ENV, type Env } from '../core/env.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(): HealthResponse {
    return { status: 'ok', sha: this.env.GIT_SHA };
  }
}
```

`apps/api/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [CoreModule, HealthModule] })
export class AppModule {}
```

`apps/api/src/load-env.ts`:
```ts
import { existsSync } from 'node:fs';

// Local development only: Vercel injects environment variables directly. loadEnvFile never
// overrides a variable that is already set.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}
```

`apps/api/src/main.ts`:
```ts
import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './configure-app.js';
import { ENV, type Env } from './core/env.js';

async function bootstrap(): Promise<void> {
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS),
  );
  app.enableShutdownHooks();
  await app.listen(app.get<Env>(ENV).PORT);
}

void bootstrap();
```

- [ ] **Step 11: Run the tests and watch them pass**

Run: `pnpm --filter @wishlist/api test`
Expected: PASS, with 22 tests across 5 files.

If the malformed-JSON or oversized-body tests return `text/html`, the body parser isn't ours. Check that `createUnitApp` passes `APP_OPTIONS` (`bodyParser: false`).

- [ ] **Step 12: Run the full gate and a real boot**

```bash
pnpm turbo run lint typecheck test build --filter=@wishlist/api...
cp apps/api/.env.example apps/api/.env
(cd apps/api && node dist/main.js) &
curl -sS -i --retry 15 --retry-connrefused --retry-delay 1 http://localhost:3001/api/health
kill %1
```

Expected:
- `HTTP/1.1 200`, `cache-control: no-store`, an `x-request-id` header, and the body `{"status":"ok","sha":"dev"}`.
- No `x-powered-by` header.

- [ ] **Step 13: Commit and submit**

```bash
git add apps/api pnpm-lock.yaml pnpm-workspace.yaml
git commit -F - <<'EOF'
feat(api): add NestJS skeleton with problem+json errors, request ids and health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

Set the new PR's title and body.

---

### Task 5: Database layer, migrations and rate limiter

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/init/01-create-e2e-db.sql`, `.squawk.toml`
- Create: `apps/api/drizzle.config.ts`, `apps/api/src/db/schema.ts`, `src/db/pool.ts`, `src/db/database.module.ts`, `src/db/migrate.ts`
- Create (generated): `apps/api/drizzle/0000_init_rate_limits.sql`, `apps/api/drizzle/meta/*`
- Create: `apps/api/src/core/clock.ts`, `src/rate-limit/window.ts`, `src/rate-limit/rate-limiter.ts`, `src/rate-limit/rate-limit.module.ts`
- Create: `apps/api/test/support/global-setup.ts`, `test/support/database.ts`
- Modify: `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/.env.example`, `apps/api/src/core/env.ts`, `src/core/env.spec.ts`, `src/core/core.module.ts`, `src/testing/test-env.ts`, `.github/workflows/ci.yml`
- Test: `apps/api/src/rate-limit/window.spec.ts`, `apps/api/test/rate-limiter.int-spec.ts`

**Interfaces:**
- Consumes: `ENV` and `Env` from Task 4.
- Produces:
  - **`src/core/env.ts`:** `Env` gains `DATABASE_URL: string`.
  - **`src/core/clock.ts`:** `interface Clock { now(): Date }`, `CLOCK: unique symbol`, `systemClock: Clock`. `CoreModule` now also provides `CLOCK`.
  - **`src/db/database.module.ts`:** `PG_POOL: unique symbol`, `DB: unique symbol`, `type Database = NodePgDatabase<typeof schema>`, and the global `DatabaseModule`, which exports `PG_POOL` and `DB`.
  - **`src/db/pool.ts`:** `createPool(connectionString: string): Pool`.
  - **`src/db/schema.ts`:** the `rateLimits` table.
  - **`src/db/migrate.ts`:** `MIGRATIONS_DIR: string` and `runMigrations(connectionString: string): Promise<void>`.
  - **`src/rate-limit/window.ts`:** `interface RateLimitRule { limit: number; windowSeconds: number }` and `fixedWindow(nowMs: number, windowSeconds: number): { start: Date; retryAfterSeconds: number }`.
  - **`src/rate-limit/rate-limiter.ts`:** `class RateLimiter { consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> }` and `interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }`.
  - **`src/rate-limit/rate-limit.module.ts`:** `RateLimitModule`, which exports `RateLimiter`.
  - **`test/support/database.ts`:** `openTestDatabase(): TestDatabase`, where `TestDatabase = { url: string; pool: Pool; db: Database; truncateAll(): Promise<void>; close(): Promise<void> }`.
  - **Vitest provided context:** `databaseUrl: string`, available through `inject('databaseUrl')` in integration tests.

- [ ] **Step 1: Add the stack layer and local Postgres**

```bash
gh stack add foundation/database
```

`docker-compose.yml`:
```yaml
# Local development services. Postgres matches production's major version (Neon, Postgres 17).
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: wishlist
      POSTGRES_PASSWORD: wishlist
      POSTGRES_DB: wishlist
    ports:
      - '54329:5432' # not 5432, so it never collides with a Postgres already on this machine
    volumes:
      - pgdata:/var/lib/postgresql/data
      # Init scripts only run against an empty data volume. Reset with `docker compose down -v`.
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U wishlist -d wishlist']
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  pgdata:
```

`docker/postgres/init/01-create-e2e-db.sql`:
```sql
-- Separate database for Playwright runs so E2E data never mixes with local development data.
CREATE DATABASE wishlist_e2e;
```

```bash
docker compose up -d --wait
docker compose exec postgres psql -U wishlist -d wishlist -c 'select 1' -tA
```

Expected: `1`.

- [ ] **Step 2: Add the database dependencies and scripts**

Edit `apps/api/package.json`:
- Add to `"dependencies"`: `"@vercel/functions": "3.9.11"`, `"drizzle-orm": "0.45.3"`, `"pg": "8.23.1"`.
- Add to `"devDependencies"`: `"@testcontainers/postgresql": "12.2.0"`, `"@types/pg": "8.23.1"`, `"drizzle-kit": "0.31.11"`, `"testcontainers": "12.2.0"`.
- Add to `"scripts"`:
  ```json
  "test:integration": "vitest run --project integration",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate"
  ```

```bash
pnpm install
```

Resolve any ignored builds using the Task 3 Step 5 rule.

- [ ] **Step 3: Add `DATABASE_URL` to the environment (test first)**

Replace `apps/api/src/core/env.spec.ts` with:
```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://wishlist:wishlist@localhost:54329/wishlist';

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      GIT_SHA: 'dev',
      DATABASE_URL,
    });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ DATABASE_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ DATABASE_URL, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });
});
```

Run: `pnpm --filter @wishlist/api test -- src/core/env.spec.ts`
Expected: FAIL. The defaults test receives no `DATABASE_URL`, and the "requires" test doesn't throw.

In `apps/api/src/core/env.ts`, add this field to `EnvSchema`, after `GIT_SHA`:
```ts
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
```

In `apps/api/src/testing/test-env.ts`, replace the return statement with:
```ts
  return {
    NODE_ENV: 'test',
    PORT: 0,
    GIT_SHA: 'test-sha',
    // Unit tests never connect; integration tests override this with the Testcontainers URL.
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    ...overrides,
  };
```

Append to `apps/api/.env.example`:
```dotenv
DATABASE_URL=postgres://wishlist:wishlist@localhost:54329/wishlist
```

Run: `pnpm --filter @wishlist/api test`
Expected: PASS.

- [ ] **Step 4: Write the failing window tests**

`apps/api/src/rate-limit/window.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fixedWindow } from './window.js';

describe('fixedWindow', () => {
  it('aligns the window start to a multiple of the window length', () => {
    expect(fixedWindow(125_000, 60)).toEqual({ start: new Date(120_000), retryAfterSeconds: 55 });
  });

  it('starts a fresh window exactly on the boundary', () => {
    expect(fixedWindow(120_000, 60)).toEqual({ start: new Date(120_000), retryAfterSeconds: 60 });
  });

  it('rounds the remaining time up to whole seconds', () => {
    expect(fixedWindow(179_500, 60).retryAfterSeconds).toBe(1);
  });
});
```

Run: `pnpm --filter @wishlist/api test -- src/rate-limit/window.spec.ts`
Expected: FAIL, because `./window.js` doesn't exist.

- [ ] **Step 5: Implement the window math and clock**

`apps/api/src/rate-limit/window.ts`:
```ts
export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** The fixed window containing `nowMs`, and the whole seconds until it resets. */
export function fixedWindow(
  nowMs: number,
  windowSeconds: number,
): { start: Date; retryAfterSeconds: number } {
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    start: new Date(startMs),
    retryAfterSeconds: Math.ceil((startMs + windowMs - nowMs) / 1000),
  };
}
```

`apps/api/src/core/clock.ts`:
```ts
/** Time source, injected so tests can control expiry and windowing. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };
```

Replace `apps/api/src/core/core.module.ts` with:
```ts
import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './clock.js';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [ENV, CLOCK],
})
export class CoreModule {}
```

Run: `pnpm --filter @wishlist/api test`
Expected: PASS.

- [ ] **Step 6: Write the schema, pool, module and migrator**

`apps/api/src/db/schema.ts`:
```ts
import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Fixed-window counters for rate limiting (spec §4, §6.6): one row per key per window. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
```

`apps/api/src/db/pool.ts`:
```ts
import { Logger } from '@nestjs/common';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';

const logger = new Logger('PgPool');

/**
 * One small pool per function instance. Fluid compute reuses instances across requests, so the
 * pool outlives a single invocation; attachDatabasePool closes idle clients before Vercel
 * suspends the instance.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  // Neon drops idle connections when its compute scales to zero. pg reports that as an 'error'
  // event on the pool, and an unhandled 'error' event would crash the process.
  pool.on('error', (err) => logger.warn(`idle client error: ${err.message}`));
  if (process.env.VERCEL) attachDatabasePool(pool);
  return pool;
}
```

`apps/api/src/db/database.module.ts`:
```ts
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { ENV, type Env } from '../core/env.js';
import { createPool } from './pool.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [ENV], useFactory: (env: Env): Pool => createPool(env.DATABASE_URL) },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool, schema }),
    },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
```

`apps/api/src/db/migrate.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** apps/api/drizzle, from both src/db (tests) and dist/db (built code). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies the committed migrations. The integration-test harness uses this; CI and deploys run
 * `drizzle-kit migrate` against the same folder and the same journal table.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
```

`apps/api/drizzle.config.ts`:
```ts
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// Migrations prefer the direct (non-pooled) connection: Neon recommends it for schema changes,
// since DDL through a transaction-mode pooler is a known source of surprises.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
```

Add `"drizzle.config.ts"` to the `include` array in `apps/api/tsconfig.json`:
```json
  "include": ["src", "test", "drizzle.config.ts"]
```

- [ ] **Step 7: Generate the first migration and lint it**

```bash
pnpm --filter @wishlist/api db:generate --name init_rate_limits
cat apps/api/drizzle/0000_init_rate_limits.sql
```

Expected: `apps/api/drizzle/0000_init_rate_limits.sql`, plus `meta/_journal.json` and `meta/0000_snapshot.json`. The SQL should be equivalent to:
```sql
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
```

`.squawk.toml`:
```toml
# Squawk lints migration SQL for operations that lock or break a live database (spec §10).
# Every excluded rule needs a reason here.
excluded_rules = [
  "prefer-bigint-over-int", # ints are deliberate: quantities, positions and counters are small and bounded
  "prefer-robust-stmts",    # drizzle runs each migration in a transaction; IF NOT EXISTS would hide drift
]
assume_in_transaction = true
```

```bash
npx --yes squawk-cli@2.67.0 apps/api/drizzle/0000_init_rate_limits.sql
```

Expected: no violations, exit code 0. **If squawk reports a rule that isn't excluded above, stop and ask Ted.** Don't exclude it, and don't hand-edit generated SQL, without a recorded reason.

```bash
pnpm --filter @wishlist/api db:migrate
docker compose exec postgres psql -U wishlist -d wishlist -c '\d rate_limits'
```

Expected: the table, with a primary key on `(key, window_start)`.

- [ ] **Step 8: Write the integration harness**

`apps/api/test/support/global-setup.ts`:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** One Postgres container per integration run, migrated with the committed migrations. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}
```

`apps/api/test/support/database.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import type { Database } from '../../src/db/database.module.js';
import * as schema from '../../src/db/schema.js';

export interface TestDatabase {
  url: string;
  pool: Pool;
  db: Database;
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

export function openTestDatabase(): TestDatabase {
  const url = inject('databaseUrl');
  const pool = new Pool({ connectionString: url, max: 20 });
  return {
    url,
    pool,
    db: drizzle({ client: pool, schema }),
    async truncateAll() {
      const { rows } = await pool.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'",
      );
      if (rows.length === 0) return;
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      await pool.query(`truncate ${tables} restart identity cascade`);
    },
    close: () => pool.end(),
  };
}
```

Replace the `projects` array in `apps/api/vitest.config.ts` with:
```ts
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int-spec.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // Files share one database and truncate between tests, so they must not run in parallel.
          fileParallelism: false,
        },
      },
    ],
```

- [ ] **Step 9: Write the failing rate limiter integration tests**

`apps/api/test/rate-limiter.int-spec.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../src/core/clock.js';
import { RateLimiter } from '../src/rate-limit/rate-limiter.js';
import { openTestDatabase } from './support/database.js';

class FakeClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
}

const database = openTestDatabase();
afterAll(() => database.close());
beforeEach(() => database.truncateAll());

const rule = { limit: 3, windowSeconds: 60 };

describe('RateLimiter', () => {
  it('allows hits up to the limit, then blocks until the window resets', async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 10));
    const limiter = new RateLimiter(database.db, clock);

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume('login:email:a@example.com', rule));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.retryAfterSeconds).toBe(50);

    clock.ms += 50_000;
    expect((await limiter.consume('login:email:a@example.com', rule)).allowed).toBe(true);
  });

  it('counts keys independently', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 0)));
    for (let i = 0; i < 3; i++) await limiter.consume('key-a', rule);
    expect((await limiter.consume('key-a', rule)).allowed).toBe(false);
    expect((await limiter.consume('key-b', rule)).allowed).toBe(true);
  });

  it('admits exactly `limit` hits when requests race', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 0)));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.consume('race', { limit: 5, windowSeconds: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
```

Run: `pnpm --filter @wishlist/api test:integration`
Expected: FAIL, because `../src/rate-limit/rate-limiter.js` doesn't exist. The container still starts and the migrations apply first, which proves the harness works.

- [ ] **Step 10: Implement the rate limiter**

`apps/api/src/rate-limit/rate-limiter.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { rateLimits } from '../db/schema.js';
import { fixedWindow, type RateLimitRule } from './window.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Counts one hit against `key` in the current window. The upsert row-locks the counter, so
   * concurrent hits on the same key are serialized and can never all slip under the limit.
   */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const { start, retryAfterSeconds } = fixedWindow(this.clock.now().getTime(), rule.windowSeconds);
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    if (!row) throw new Error('rate limit upsert returned no row');
    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfterSeconds,
    };
  }
}
```

`apps/api/src/rate-limit/rate-limit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter.js';

/** Storage for rate limits. Plan 2 wires it to endpoints (spec §6.6). */
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class RateLimitModule {}
```

Run: `pnpm --filter @wishlist/api test:integration`
Expected: PASS, 3 tests.

- [ ] **Step 11: Add the integration and migration-lint jobs to CI**

Replace `.github/workflows/ci.yml` with:
```yaml
name: CI

# No `branches:` filter: in a stack, upper PRs target the branch below them, not main.
on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  checks:
    name: checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm turbo run lint typecheck test build

  integration:
    name: integration
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test:integration

  migrations-lint:
    name: migrations-lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - name: Lint new or changed migrations
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
        run: |
          files=$(git diff --name-only --diff-filter=AM "$BASE_SHA"...HEAD -- 'apps/api/drizzle/*.sql')
          if [ -z "$files" ]; then
            echo "No migration changes."
            exit 0
          fi
          echo "$files"
          # shellcheck disable=SC2086 # one argument per file is intended
          npx --yes squawk-cli@2.67.0 $files
```

- [ ] **Step 12: Run the full gate, then commit and submit**

```bash
pnpm turbo run lint typecheck test build test:integration
pnpm format:check
```

Expected: everything passes.

```bash
git add docker-compose.yml docker .squawk.toml apps/api pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ci.yml
git commit -F - <<'EOF'
feat(api): add Postgres via Drizzle, migrations and fixed-window rate limiter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

Expected: `checks`, `integration` and `migrations-lint` pass on the PR. `migrations-lint` lints `0000_init_rate_limits.sql`.

---

### Task 6: Database-aware health check

**Files:**
- Modify: `packages/contracts/src/health.ts`, `packages/contracts/src/health.spec.ts`
- Create: `apps/api/src/health/db-health.ts`, `apps/api/test/support/app.ts`
- Modify: `apps/api/src/health/health.controller.ts`, `src/health/health.module.ts`, `src/health/health.controller.spec.ts`, `src/app.module.ts`
- Test: `apps/api/src/health/db-health.spec.ts`, `apps/api/test/health.int-spec.ts`

**Interfaces:**
- Consumes: `PG_POOL` and `DatabaseModule` (Task 5); `ENV`, `testEnv`, `createUnitApp`, `http`, `APP_OPTIONS` and `configureApp` (Task 4); `openTestDatabase` and `MIGRATIONS_DIR` (Task 5).
- Produces:
  - **`HealthResponse`** is now `{ status: 'ok' | 'degraded'; sha: string; db: { ok: boolean; migrationsApplied: number | null } }`.
  - **`src/health/db-health.ts`:** `DB_HEALTH: unique symbol`, `interface DbHealth { check(): Promise<DbHealthResult> }`, `type DbHealthResult = { ok: true; migrationsApplied: number } | { ok: false }`, and `class PostgresDbHealth implements DbHealth`.
  - **`test/support/app.ts`:** `createTestApp(options: { databaseUrl: string; env?: Partial<Env>; override?: (b: TestingModuleBuilder) => TestingModuleBuilder }): Promise<NestExpressApplication>`. It boots the full `AppModule`.
  - **`GET /api/health`** returns `503` with `status: 'degraded'` when the database check fails.

- [ ] **Step 1: Add the stack layer and extend the contract (test first)**

```bash
gh stack add foundation/health-db
```

Replace `packages/contracts/src/health.spec.ts` with:
```ts
import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts an ok response with database details', () => {
    const body = { status: 'ok', sha: 'abc123', db: { ok: true, migrationsApplied: 1 } };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a degraded response where the migration count is unknown', () => {
    const body = { status: 'degraded', sha: 'abc123', db: { ok: false, migrationsApplied: null } };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown statuses', () => {
    const body = { status: 'meh', sha: 'abc123', db: { ok: true, migrationsApplied: 1 } };
    expect(HealthResponseSchema.safeParse(body).success).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, because `db` is stripped and missing from the parsed output.

Replace `packages/contracts/src/health.ts` with:
```ts
import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Git commit the API was deployed from; deploy pipelines poll for it. */
  sha: z.string().min(1),
  db: z.object({
    ok: z.boolean(),
    /** Applied migrations; null when the database couldn't be reached. */
    migrationsApplied: z.number().int().nonnegative().nullable(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```

Run: `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`
Expected: PASS.

- [ ] **Step 2: Write the failing database-health unit tests**

`apps/api/src/health/db-health.spec.ts`:
```ts
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresDbHealth } from './db-health.js';

const poolWith = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

afterEach(() => {
  vi.useRealTimers();
});

describe('PostgresDbHealth', () => {
  it('reports the number of applied migrations', async () => {
    const health = new PostgresDbHealth(poolWith(async () => ({ rows: [{ n: 3 }] })));
    await expect(health.check()).resolves.toEqual({ ok: true, migrationsApplied: 3 });
  });

  it('treats a reachable but never-migrated database as zero migrations', async () => {
    const health = new PostgresDbHealth(poolWith(async () => Promise.reject(pgError('42P01'))));
    await expect(health.check()).resolves.toEqual({ ok: true, migrationsApplied: 0 });
  });

  it('reports down when the query fails for any other reason', async () => {
    const health = new PostgresDbHealth(poolWith(async () => Promise.reject(pgError('ECONNREFUSED'))));
    await expect(health.check()).resolves.toEqual({ ok: false });
  });

  it('reports down when the database does not answer within 5 seconds', async () => {
    vi.useFakeTimers();
    const health = new PostgresDbHealth(poolWith(() => new Promise(() => {})));
    const result = health.check();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ ok: false });
  });
});
```

Replace `apps/api/src/health/health.controller.spec.ts` with:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema } from '@wishlist/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { testEnv } from '../testing/test-env.js';
import { DB_HEALTH, type DbHealth, type DbHealthResult } from './db-health.js';
import { HealthController } from './health.controller.js';

let app: NestExpressApplication | undefined;
afterEach(() => app?.close());

async function appWithDb(result: DbHealthResult): Promise<NestExpressApplication> {
  const fake: DbHealth = { check: () => Promise.resolve(result) };
  app = await createUnitApp({
    controllers: [HealthController],
    providers: [
      { provide: ENV, useValue: testEnv({ GIT_SHA: 'abc123' }) },
      { provide: DB_HEALTH, useValue: fake },
    ],
  });
  return app;
}

describe('GET /api/health', () => {
  it('reports ok with the deployed commit and migration count, never cached', async () => {
    const res = await http(await appWithDb({ ok: true, migrationsApplied: 2 })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      sha: 'abc123',
      db: { ok: true, migrationsApplied: 2 },
    });
  });

  it('answers 503 degraded when the database is down', async () => {
    const res = await http(await appWithDb({ ok: false })).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'degraded',
      sha: 'abc123',
      db: { ok: false, migrationsApplied: null },
    });
  });
});
```

Run: `pnpm --filter @wishlist/api test`
Expected: FAIL, because `./db-health.js` doesn't exist.

- [ ] **Step 3: Implement database health and the controller**

`apps/api/src/health/db-health.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/database.module.js';

export type DbHealthResult = { ok: true; migrationsApplied: number } | { ok: false };

export interface DbHealth {
  check(): Promise<DbHealthResult>;
}

export const DB_HEALTH = Symbol('DB_HEALTH');

/**
 * Bounded so a sleeping or unreachable database answers "down" quickly. Without the bound,
 * health would hang until pg's 10s connect timeout or the function's own timeout.
 */
const CHECK_TIMEOUT_MS = 5_000;

/** undefined_table / invalid_schema_name: reachable, but drizzle's journal doesn't exist yet. */
const NOT_MIGRATED_CODES = new Set(['42P01', '3F000']);

@Injectable()
export class PostgresDbHealth implements DbHealth {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<DbHealthResult> {
    try {
      return await withTimeout(this.countMigrations(), CHECK_TIMEOUT_MS);
    } catch {
      return { ok: false };
    }
  }

  private async countMigrations(): Promise<DbHealthResult> {
    try {
      const { rows } = await this.pool.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      return { ok: true, migrationsApplied: rows[0]?.n ?? 0 };
    } catch (error) {
      if (hasPgCode(error, NOT_MIGRATED_CODES)) return { ok: true, migrationsApplied: 0 };
      throw error;
    }
  }
}

function hasPgCode(error: unknown, codes: ReadonlySet<string>): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return typeof error.code === 'string' && codes.has(error.code);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

Replace `apps/api/src/health/health.controller.ts` with:
```ts
import { Controller, Get, Header, HttpStatus, Inject, Res } from '@nestjs/common';
import type { HealthResponse } from '@wishlist/contracts';
import type { Response } from 'express';
import { ENV, type Env } from '../core/env.js';
import { DB_HEALTH, type DbHealth } from './db-health.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB_HEALTH) private readonly db: DbHealth,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const db = await this.db.check();
    if (!db.ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', sha: this.env.GIT_SHA, db: { ok: false, migrationsApplied: null } };
    }
    return { status: 'ok', sha: this.env.GIT_SHA, db };
  }
}
```

Replace `apps/api/src/health/health.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { DB_HEALTH, PostgresDbHealth } from './db-health.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [{ provide: DB_HEALTH, useClass: PostgresDbHealth }],
})
export class HealthModule {}
```

Replace `apps/api/src/app.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [CoreModule, DatabaseModule, HealthModule] })
export class AppModule {}
```

Run: `pnpm --filter @wishlist/api test`
Expected: PASS.

- [ ] **Step 4: Write the full-app integration tests**

`apps/api/test/support/app.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/configure-app.js';
import { ENV, type Env } from '../../src/core/env.js';
import { testEnv } from '../../src/testing/test-env.js';

export interface TestAppOptions {
  databaseUrl: string;
  env?: Partial<Env>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Boots the real AppModule against the given database, with the production HTTP pipeline. */
export async function createTestApp({
  databaseUrl,
  env = {},
  override = (builder) => builder,
}: TestAppOptions): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(testEnv({ DATABASE_URL: databaseUrl, ...env }));
  const moduleRef = await override(builder).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false }),
  );
  await app.init();
  return app;
}
```

`apps/api/test/health.int-spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema } from '@wishlist/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { http } from '../src/testing/app.js';
import { createTestApp } from './support/app.js';
import { openTestDatabase } from './support/database.js';

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
) as { entries: unknown[] };

let app: NestExpressApplication | undefined;
afterEach(() => app?.close());

describe('GET /api/health (real database)', () => {
  it('reports ok and counts every committed migration', async () => {
    app = await createTestApp({ databaseUrl: openTestDatabase().url, env: { GIT_SHA: 'int-sha' } });
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      sha: 'int-sha',
      db: { ok: true, migrationsApplied: journal.entries.length },
    });
  });

  it('answers 503 degraded quickly when the database is unreachable', async () => {
    app = await createTestApp({ databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' });
    const started = Date.now();
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(res.body).status).toBe('degraded');
    expect(Date.now() - started).toBeLessThan(6_000);
  });
});
```

In the first test, `openTestDatabase()` is only used to read `url`. Its pool never connects, so it holds no resources.

- [ ] **Step 5: Run the integration tests and watch them pass**

Run: `pnpm --filter @wishlist/api test:integration`
Expected: PASS, with 5 tests across 2 files.

- [ ] **Step 6: Run the full gate and a real boot against local Postgres**

```bash
pnpm turbo run lint typecheck test build test:integration
pnpm format:check
(cd apps/api && node dist/main.js) &
curl -sS --retry 15 --retry-connrefused --retry-delay 1 http://localhost:3001/api/health
kill %1
```

Expected: `{"status":"ok","sha":"dev","db":{"ok":true,"migrationsApplied":1}}`. Local `.env` points at docker Postgres, which was migrated in Task 5.

- [ ] **Step 7: Commit and submit**

```bash
git add packages/contracts apps/api
git commit -F - <<'EOF'
feat(api): report database health and applied migrations from /api/health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

---

### Task 7: Web skeleton, the `/api` rewrite, and the typed API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.js`, `vitest.config.ts`, `turbo.json`, `.env.development`
- Create: `apps/web/src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `apps/web/src/lib/api-client.ts`, `src/lib/api.server.ts`
- Test: `apps/web/next.config.spec.ts`, `apps/web/src/lib/api-client.spec.ts`
- Modify: `.github/workflows/ci.yml`, by adding `API_ORIGIN` to the `checks` job

**Interfaces:**
- Consumes: `ErrorCode`, `ProblemSchema`, `Problem` and `HealthResponseSchema` from `@wishlist/contracts`.
- Produces:
  - **`src/lib/api-client.ts`:**
    - `createApiClient(options: ApiClientOptions): ApiClient`
    - `ApiClientOptions = { baseUrl: string; headers?: Record<string, string>; fetch?: FetchFn }`
    - `ApiClient` has these methods:
      - `get(path, schema)`
      - `post(path, body, schema)`
      - `patch(path, body, schema)`
      - `put(path, body, schema)`
      - `delete(path, schema)`

      Each returns `Promise<z.output<S>>`. A `path` excludes the `/api` prefix, e.g. `'/health'`.
    - `class ApiError extends Error { problem: Problem; status: number }`
    - `class ContractMismatchError extends Error { endpoint: string; issues }`
  - **`src/lib/api.server.ts`:** `serverApi(): Promise<ApiClient>` (server only). It calls `API_ORIGIN` directly and forwards the browser's cookies.
  - **Build-time requirement:** `API_ORIGIN` must be a bare origin for `next build` and `next start`. It drives the rewrite and is inlined into server code.

- [ ] **Step 1: Add the stack layer and package scaffolding**

```bash
gh stack add foundation/web
```

`apps/web/package.json`:
```json
{
  "name": "@wishlist/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "API_ORIGIN=${API_ORIGIN:-http://localhost:3001} next typegen && tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@wishlist/contracts": "workspace:*",
    "next": "16.4.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "server-only": "0.0.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "24.19.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint": "9.39.5",
    "eslint-config-next": "16.4.0",
    "tailwindcss": "4.3.3",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

**Why `typecheck` runs `next typegen` with a default `API_ORIGIN`:** `next-env.d.ts` and the route types are generated and gitignored. Generating them loads `next.config.ts`, which refuses to run without `API_ORIGIN`.

`apps/web/tsconfig.json`:
```json
{
  "extends": "@wishlist/config/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "es2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "incremental": true,
    "declaration": false,
    "sourceMap": false,
    "allowJs": false,
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`apps/web/eslint.config.js`:
```js
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([...nextVitals, ...nextTs, globalIgnores(['.next/**', 'next-env.d.ts'])]);
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.spec.ts', '*.spec.ts'] },
});
```

`apps/web/turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "extends": ["//"],
  "tasks": {
    "build": {
      "outputs": [".next/**", "!.next/cache/**"],
      "env": ["API_ORIGIN"]
    }
  }
}
```

**Why `env: ["API_ORIGIN"]`:** Turborepo's strict env mode hides undeclared variables from tasks. It also has to key the build cache on this value, because the rewrite target is compiled into the output.

`apps/web/.env.development` (committed, not secret):
```dotenv
# Loaded by `next dev` only. Builds and `next start` must receive API_ORIGIN explicitly.
API_ORIGIN=http://localhost:3001
```

```bash
pnpm install
```

Resolve any ignored builds using the Task 3 Step 5 rule. `sharp` and `unrs-resolver` are on the allow list.

- [ ] **Step 2: Write the failing next.config tests**

`apps/web/next.config.spec.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(apiOrigin: string) {
  vi.stubEnv('API_ORIGIN', apiOrigin);
  vi.resetModules();
  return (await import('./next.config')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('next.config', () => {
  it('refuses to load without API_ORIGIN', async () => {
    await expect(loadConfig('')).rejects.toThrow(/API_ORIGIN must be set/);
  });

  it('refuses an API_ORIGIN with a path or trailing slash', async () => {
    await expect(loadConfig('https://api.example.test/')).rejects.toThrow(/bare origin/);
    await expect(loadConfig('https://api.example.test/api')).rejects.toThrow(/bare origin/);
  });

  it('rewrites /api/* to the same path on the API origin', async () => {
    const config = await loadConfig('https://api.example.test');
    await expect(config.rewrites?.()).resolves.toEqual([
      { source: '/api/:path*', destination: 'https://api.example.test/api/:path*' },
    ]);
  });

  it('inlines API_ORIGIN for server code', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.env).toEqual({ API_ORIGIN: 'https://api.example.test' });
  });
});
```

Run: `pnpm --filter @wishlist/web test`
Expected: FAIL, because `./next.config` doesn't exist.

- [ ] **Step 3: Implement next.config**

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next';

/**
 * Where /api/* is proxied (spec §3). Required whenever the config loads: Next compiles rewrite
 * destinations into the build output, so a missing value would ship a site whose every API call
 * 404s.
 */
function readApiOrigin(): string {
  const value = process.env.API_ORIGIN;
  if (!value) {
    throw new Error('API_ORIGIN must be set (e.g. http://localhost:3001) to build or start the web app');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`API_ORIGIN is not a valid URL: ${value}`);
  }
  if (url.origin !== value) {
    throw new Error(`API_ORIGIN must be a bare origin with no path or trailing slash, got: ${value}`);
  }
  return value;
}

const API_ORIGIN = readApiOrigin();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Inlined at build so server code calls exactly the API the rewrite points at.
  env: { API_ORIGIN },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

Run: `pnpm --filter @wishlist/web test`
Expected: PASS, 4 tests.

- [ ] **Step 4: Write the failing API client tests**

`apps/web/src/lib/api-client.spec.ts`:
```ts
import { ErrorCode } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, ContractMismatchError, createApiClient } from './api-client';

const Thing = z.object({ id: z.string() });

function clientReturning(response: Response, headers?: Record<string, string>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    ...(headers ? { headers } : {}),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  });
  return { client, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('createApiClient', () => {
  it('GETs under /api and returns the parsed body', async () => {
    const { client, calls } = clientReturning(json({ id: 't1' }));
    await expect(client.get('/things/t1', Thing)).resolves.toEqual({ id: 't1' });
    expect(calls[0]?.url).toBe('https://api.example.test/api/things/t1');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.cache).toBe('no-store');
    expect(calls[0]?.init.headers).toMatchObject({ accept: 'application/json, application/problem+json' });
  });

  it('forwards configured headers such as the incoming cookie', async () => {
    const { client, calls } = clientReturning(json({ id: 't1' }), { cookie: 'a=b' });
    await client.get('/things/t1', Thing);
    expect(calls[0]?.init.headers).toMatchObject({ cookie: 'a=b' });
  });

  it('sends JSON bodies with a JSON content type', async () => {
    const { client, calls } = clientReturning(json({ id: 't2' }, 201));
    await client.post('/things', { name: 'x' }, Thing);
    expect(calls[0]?.init.body).toBe('{"name":"x"}');
    expect(calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('raises ApiError carrying the problem, including extension members', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      requestId: 'req-1',
      remaining: 1,
    };
    const { client } = clientReturning(json(problem, 409));
    const error = await client.get('/x', Thing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).problem).toEqual(problem);
  });

  it('non-JSON error bodies become UNEXPECTED_RESPONSE', async () => {
    const edgePage = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html', 'x-request-id': 'edge-1' },
    });
    const { client } = clientReturning(edgePage);
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      code: ErrorCode.UNEXPECTED_RESPONSE,
      requestId: 'edge-1',
    });
  });

  it('JSON error bodies that are not problems also become UNEXPECTED_RESPONSE', async () => {
    const { client } = clientReturning(json({ error: 'unauthorized' }, 401));
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error.problem.code).toBe(ErrorCode.UNEXPECTED_RESPONSE);
    expect(error.problem.requestId).toBe('unknown');
  });

  it('raises ContractMismatchError when a success body breaks the contract', async () => {
    const { client } = clientReturning(json({ id: 42 }));
    const error = await client.get('/things/t1', Thing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractMismatchError);
    expect((error as ContractMismatchError).endpoint).toBe('GET /things/t1');
  });

  it('raises ContractMismatchError when a success body is not JSON', async () => {
    const { client } = clientReturning(new Response('not json', { status: 200 }));
    await expect(client.get('/things/t1', Thing)).rejects.toBeInstanceOf(ContractMismatchError);
  });

  it('resolves 204 responses as undefined', async () => {
    const { client } = clientReturning(new Response(null, { status: 204 }));
    await expect(client.delete('/things/t1', z.undefined())).resolves.toBeUndefined();
  });
});
```

Run: `pnpm --filter @wishlist/web test`
Expected: FAIL, because `./api-client` doesn't exist.

- [ ] **Step 5: Implement the API client and server wrapper**

`apps/web/src/lib/api-client.ts`:
```ts
import { ErrorCode, ProblemSchema, type Problem } from '@wishlist/contracts';
import type { z } from 'zod';

/** The API (or something in front of it) answered with an error status. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.status} ${problem.code}`);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }
}

/**
 * The API answered successfully but the body doesn't match its contract. Web and API deploy
 * independently, so this is how version skew shows up: loudly, instead of as undefined in the UI.
 */
export class ContractMismatchError extends Error {
  constructor(
    readonly endpoint: string,
    readonly issues: z.ZodError['issues'],
  ) {
    super(`Response from ${endpoint} does not match its contract`);
    this.name = 'ContractMismatchError';
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Origin to call; '' for same-origin browser calls through the /api rewrite. */
  baseUrl: string;
  /** Sent on every request, e.g. the incoming cookie when calling from the server. */
  headers?: Record<string, string>;
  fetch?: FetchFn;
}

export function createApiClient({ baseUrl, headers = {}, fetch: fetchFn = fetch }: ApiClientOptions) {
  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const endpoint = `${method} ${path}`;
    const res = await fetchFn(`${baseUrl}/api${path}`, {
      method,
      cache: 'no-store',
      headers: {
        ...headers,
        accept: 'application/json, application/problem+json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!res.ok) throw new ApiError(await readProblem(res));

    let payload: unknown;
    if (res.status !== 204) {
      try {
        payload = await res.json();
      } catch {
        throw new ContractMismatchError(endpoint, []);
      }
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ContractMismatchError(endpoint, parsed.error.issues);
    return parsed.data;
  }

  return {
    get: <S extends z.ZodType>(path: string, schema: S) => request('GET', path, schema),
    post: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('POST', path, schema, body),
    patch: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('PATCH', path, schema, body),
    put: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('PUT', path, schema, body),
    delete: <S extends z.ZodType>(path: string, schema: S) => request('DELETE', path, schema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Errors that didn't come from our API (Vercel edge pages, deployment-protection 401s) have no
 * problem body; synthesize one so callers handle every failure the same way.
 */
async function readProblem(res: Response): Promise<Problem> {
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = ProblemSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  return {
    type: 'about:blank',
    title: res.statusText || 'Unexpected response',
    status: res.status,
    code: ErrorCode.UNEXPECTED_RESPONSE,
    requestId: res.headers.get('x-request-id') ?? 'unknown',
  };
}
```

`apps/web/src/lib/api.server.ts`:
```ts
import 'server-only';
import { headers } from 'next/headers';
import { createApiClient, type ApiClient } from './api-client';

/**
 * API client for Server Components. Calls the API origin directly (server to server) and
 * forwards the browser's cookies so the API sees the same session.
 */
export async function serverApi(): Promise<ApiClient> {
  const origin = process.env.API_ORIGIN;
  if (!origin) throw new Error('API_ORIGIN is not configured');
  const cookie = (await headers()).get('cookie');
  return createApiClient({ baseUrl: origin, headers: cookie ? { cookie } : {} });
}
```

Run: `pnpm --filter @wishlist/web test`
Expected: PASS, 13 tests.

- [ ] **Step 6: Implement the layout and landing page**

`apps/web/src/app/globals.css`:
```css
@import 'tailwindcss';
```

`apps/web/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wishlist',
  description: 'Wishlists for family and friends',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
import { HealthResponseSchema } from '@wishlist/contracts';
import { ApiError } from '@/lib/api-client';
import { serverApi } from '@/lib/api.server';

// Rendered per request: the status must reflect the live API, and prerendering at build time
// would make CI call the API.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Wishlist</h1>
      <p className="mt-2 text-neutral-600">Wishlists for family and friends. Coming soon.</p>
      <p className="mt-8 font-mono text-sm" data-testid="api-status">
        {await apiStatus()}
      </p>
    </main>
  );
}

async function apiStatus(): Promise<string> {
  try {
    const api = await serverApi();
    const health = await api.get('/health', HealthResponseSchema);
    return `API: ${health.status} · db: ${health.db.ok ? 'ok' : 'down'}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return 'API: degraded · db: down';
    return 'API: unreachable';
  }
}
```

- [ ] **Step 7: Add `API_ORIGIN` to the CI `checks` job**

In `.github/workflows/ci.yml`, replace:
```yaml
  checks:
    name: checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
```
with:
```yaml
  checks:
    name: checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      # The web build refuses to run without it; any bare origin works for a build-only check.
      API_ORIGIN: http://localhost:3001
    steps:
```

- [ ] **Step 8: Run the full gate, including a production build**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm format:check
pnpm --filter @wishlist/web build 2>&1 | tail -5; echo "exit=$?"
```

Expected: the first command passes. The bare `build` without `API_ORIGIN` fails with `API_ORIGIN must be set` and a non-zero exit. That's the guard working.

On its first build, Next.js may rewrite `apps/web/tsconfig.json` (e.g. adding entries to `include`). Review the diff with `git diff apps/web/tsconfig.json` and commit it, as long as it doesn't loosen any compiler option set above.

- [ ] **Step 9: Commit and submit**

```bash
git add apps/web pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ci.yml
git commit -F - <<'EOF'
feat(web): add Next.js skeleton with /api rewrite and contract-validating API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

---

### Task 8: Local dev orchestration and E2E harness

**Files:**
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/eslint.config.js`, `e2e/playwright.config.ts`, `e2e/playwright.smoke.config.ts`
- Create: `e2e/tests/local/landing.spec.ts`, `e2e/tests/local/a11y.spec.ts`, `e2e/tests/smoke/smoke.spec.ts`
- Create: `scripts/e2e.sh`, `docs/development.md`
- Modify: `package.json` (root scripts), `pnpm-workspace.yaml` (add `e2e`), `README.md`, `.github/workflows/ci.yml` (add the `e2e` job)

**Interfaces:**
- Consumes: `HealthResponseSchema`, `ProblemSchema` and `ErrorCode` from contracts; the API's `dist/main.js` (Task 4); the web app's `next start` (Task 7).
- Produces:
  - `pnpm dev`, which starts Postgres and all dev servers.
  - `pnpm test:e2e`, which runs local E2E against production builds.
  - `pnpm --filter @wishlist/e2e test:smoke`, which needs `BASE_URL` and accepts `EXPECTED_SHA` and `VERCEL_AUTOMATION_BYPASS_SECRET`. Tasks 11 and 12 use it.
  - E2E ports: web on `3100`, API on `3101`. E2E database: `wishlist_e2e`.

- [ ] **Step 1: Add the stack layer and the e2e package**

```bash
gh stack add foundation/e2e
```

Replace `pnpm-workspace.yaml`'s `packages` list. Keep any `allowBuilds` entries.
```yaml
packages:
  - apps/*
  - packages/*
  - e2e
```

`e2e/package.json`:
```json
{
  "name": "@wishlist/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:e2e": "playwright test",
    "test:smoke": "playwright test --config playwright.smoke.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@axe-core/playwright": "4.13.0",
    "@playwright/test": "1.63.0",
    "@types/node": "24.19.1",
    "@wishlist/config": "workspace:*",
    "@wishlist/contracts": "workspace:*",
    "eslint": "9.39.5",
    "typescript": "6.0.3"
  }
}
```

`e2e/tsconfig.json`:
```json
{
  "extends": "@wishlist/config/tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["tests", "playwright.config.ts", "playwright.smoke.config.ts"]
}
```

`e2e/eslint.config.js`:
```js
import { baseEslintConfig } from '@wishlist/config/eslint';

export default baseEslintConfig({ tsconfigRootDir: import.meta.dirname });
```

```bash
pnpm install
pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium
```

- [ ] **Step 2: Write the Playwright configs**

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

// Not 3000/3001, so E2E can run while `pnpm dev` is up.
const WEB_PORT = 3100;
const API_PORT = 3101;
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://wishlist:wishlist@localhost:54329/wishlist_e2e';

export default defineConfig({
  testDir: './tests/local',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Production builds, not dev servers: E2E should exercise what ships. scripts/e2e.sh builds
  // them first (the web build must see API_ORIGIN=http://localhost:3101).
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'production',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        GIT_SHA: 'e2e',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start --port ${WEB_PORT}`,
      cwd: '../apps/web',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_ORIGIN: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
```

`e2e/playwright.smoke.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error('BASE_URL is required, e.g. BASE_URL=https://shockolate-wishlist-pr-12.vercel.app');
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests/smoke',
  // The first request after idle can hit a cold function and a sleeping Neon compute.
  retries: 2,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Previews sit behind Vercel deployment protection; this lets automation through.
    extraHTTPHeaders: bypass
      ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: Write the E2E and smoke tests**

`e2e/tests/local/landing.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ErrorCode, HealthResponseSchema, ProblemSchema } from '@wishlist/contracts';

test('landing page reports a healthy API and database', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
  await expect(page.getByTestId('api-status')).toHaveText('API: ok · db: ok');
});

test('/api/* reaches the API through the same-origin rewrite', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['x-request-id']).toBeTruthy();
  const body = HealthResponseSchema.parse(await res.json());
  expect(body).toMatchObject({ status: 'ok', sha: 'e2e', db: { ok: true } });
});

test('unknown API routes answer with problem+json through the rewrite', async ({ request }) => {
  const res = await request.get('/api/definitely-not-a-route');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/problem+json');
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.NOT_FOUND);
});
```

`e2e/tests/local/a11y.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('landing page has no detectable WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(results.violations).toEqual([]);
});
```

`e2e/tests/smoke/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { HealthResponseSchema } from '@wishlist/contracts';

// Read-only by design: previews run against a branch of production data (spec §8).
const expectedSha = process.env.EXPECTED_SHA;

test('API is healthy through the web origin', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = HealthResponseSchema.parse(await res.json());
  expect(body.status).toBe('ok');
  expect(body.db.ok).toBe(true);
  if (expectedSha) expect(body.sha).toBe(expectedSha);
});

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
});
```

- [ ] **Step 4: Write the orchestration script and root scripts**

`scripts/e2e.sh`:
```bash
#!/usr/bin/env bash
# Runs Playwright E2E against production builds of the API and web app, backed by the
# wishlist_e2e database in docker compose. Extra arguments are passed to `playwright test`.
set -euo pipefail

cd "$(dirname "$0")/.."

export API_ORIGIN="http://localhost:3101"
export E2E_DATABASE_URL="postgres://wishlist:wishlist@localhost:54329/wishlist_e2e"

docker compose up -d --wait
pnpm turbo run build --filter=@wishlist/api... --filter=@wishlist/web...
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter @wishlist/api db:migrate
pnpm --filter @wishlist/e2e test:e2e "$@"
```

```bash
chmod +x scripts/e2e.sh
```

In the root `package.json`, add these two entries to `"scripts"`:
```json
    "dev": "docker compose up -d --wait && turbo run dev",
    "test:e2e": "./scripts/e2e.sh",
```

- [ ] **Step 5: Run E2E locally and watch it pass**

Run: `pnpm test:e2e`
Expected: 4 tests pass (3 landing, 1 a11y).

If the a11y test reports violations, fix the markup in `apps/web/src/app/page.tsx` or `layout.tsx`. Don't relax the tags.

- [ ] **Step 6: Verify `pnpm dev` end to end**

```bash
pnpm dev > /tmp/claude-1000/wishlist-dev.log 2>&1 &
curl -sS --retry 60 --retry-connrefused --retry-delay 1 http://localhost:3000/api/health
curl -sS http://localhost:3000 | grep -o 'API: ok · db: ok'
kill %1
```

Expected: health JSON from the API **through the web origin on port 3000**, and the landing page containing `API: ok · db: ok`. This assumes `apps/api/.env` exists (Task 4 Step 12) and the dev database was migrated (Task 5 Step 7).

- [ ] **Step 7: Write the developer guide and link it**

`docs/development.md`:
````markdown
# Local development

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node | 24 (see `.nvmrc`) | `nvm install` |
| pnpm | 12.10.1 (pinned in `package.json`) | `npm i -g pnpm@12.10.1` |
| Docker | with Compose v2 | Docker Desktop or Engine |
| gh + gh-stack | latest | `gh extension install github/gh-stack` |
| jq, python3, curl | any recent | OS package manager (used by `scripts/`) |

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

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API (direct) | http://localhost:3001/api/health |
| Postgres | `postgres://wishlist:wishlist@localhost:54329/wishlist` |

## Tests

| Command | What runs | Needs Docker |
|---|---|---|
| `pnpm test` | Unit tests in every package (Vitest) | No |
| `pnpm test:integration` | API tests against a throwaway Postgres (Testcontainers) | Yes |
| `pnpm test:e2e` | Playwright against production builds on ports 3100/3101 and the `wishlist_e2e` database | Yes |
| `pnpm turbo run lint typecheck` | ESLint and TypeScript | No |

## Database

- Change the schema in `apps/api/src/db/schema.ts`, then generate a migration: `pnpm --filter @wishlist/api db:generate --name <what_changed>`.
- Review the generated SQL. CI lints it with squawk (`.squawk.toml`).
- Apply it locally: `pnpm --filter @wishlist/api db:migrate`.
- Every migration must work alongside the currently deployed API (expand/contract; spec §10).
- To reset local data: `docker compose down -v && docker compose up -d --wait`, then migrate again.

## Workflow

See [CONTRIBUTING.md](../CONTRIBUTING.md) for stacked PRs and merge rules.
````

Append to `README.md`:
```markdown

## Local development

See [docs/development.md](docs/development.md).
```

- [ ] **Step 8: Add the E2E job to CI**

Append this job to `.github/workflows/ci.yml`, under `jobs:` after `migrations-lint`:
```yaml
  e2e:
    name: e2e
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: e2e/playwright-report
          retention-days: 7
```

- [ ] **Step 9: Run the full gate, then commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm format:check
```

```bash
git add e2e scripts/e2e.sh package.json pnpm-workspace.yaml pnpm-lock.yaml docs/development.md README.md .github/workflows/ci.yml
git commit -F - <<'EOF'
test(e2e): add Playwright E2E and smoke suites with local dev orchestration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

Expected: all four CI jobs (`checks`, `integration`, `migrations-lint`, `e2e`) pass on every PR in the stack.

- [ ] **Step 10: ⏸ CHECKPOINT — Ted reviews and merges the foundation stack**

Ted reviews the six PRs. Once they're approved, Ted merges them, or tells you to run:
```bash
gh stack merge <top-pr-number> --squash --yes   # use the method from Spike A
gh stack sync --prune
git switch main && git pull --ff-only
```

---

### Task 9: Provision Neon and Vercel; first manual production deploy

Most of this task is account setup that only Ted can do. The agent prepares the commands and the docs, and verifies the result. **If the first deploy fails in a way that would change the deployment model, stop and escalate** (spec D13; CLAUDE.md "stop and ask" for structural changes). That covers, for example, Vercel's NestJS builder rejecting an ESM app or a workspace dependency.

**Files:**
- Create: `apps/api/vercel.json`, `apps/web/vercel.json`, `docs/deployment.md`
- Modify: `package.json` (root devDependency `vercel`)

**Interfaces:**
- Produces:
  - **Vercel projects:** `wishlist-api` (root `apps/api`, preview protection off) and `wishlist-web` (root `apps/web`, standard protection plus an automation-bypass secret).
  - **Neon project** `wishlist` on Postgres 17, region `aws-us-east-1`.
  - **GitHub environments:** `production` and `preview`, with the secrets listed in Step 9.
  - **Repo variables:** `API_PRODUCTION_ORIGIN` and `APP_PRODUCTION_ORIGIN`.
  - A live production deploy where `https://<web>/api/health` returns `status: ok`.

- [ ] **Step 1: Start the delivery stack and add the Vercel config**

```bash
git switch main && git pull --ff-only
gh stack init delivery/vercel-setup
pnpm add -D -w vercel@62.7.0
```

`apps/api/vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false },
  "installCommand": "pnpm install --frozen-lockfile && pnpm --filter @wishlist/contracts build"
}
```

`apps/web/vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false },
  "installCommand": "pnpm install --frozen-lockfile && pnpm --filter @wishlist/contracts build"
}
```

**Why the install command builds contracts:** workspace packages are consumed through their built `dist`. Install is the one Vercel step guaranteed to run before the framework's own build, so contracts must be built there.

**Why `git.deploymentEnabled: false`:** GitHub Actions is the only deployer (spec §10). This guarantees Vercel never deploys on its own, even if someone later connects the repository.

- [ ] **Step 2: ⏸ CHECKPOINT (Ted) — create the Neon project**

In the Neon console:
1. Create project `wishlist` on **Postgres 17**, region **AWS US East 1 (N. Virginia)**. That's the same region as Vercel's default function region, `iad1`.
2. Record the **project ID** (Settings).
3. From Connect, record the **pooled** connection string (pooling on) and the **direct** connection string (pooling off) for branch `main`.
4. Account settings → API keys: create `github-actions-wishlist` and record the key.

- [ ] **Step 3: ⏸ CHECKPOINT (Ted) — create and configure the Vercel projects**

```bash
pnpm exec vercel login
pnpm exec vercel project add wishlist-api
pnpm exec vercel project add wishlist-web
```

Then, in the Vercel dashboard:

| Setting | `wishlist-api` | `wishlist-web` |
|---|---|---|
| Build & Deployment → Root Directory | `apps/api` | `apps/web` |
| Build & Deployment → "Include files outside the root directory" | On | On |
| Build & Deployment → Node.js Version | 24.x | 24.x |
| Deployment Protection → Vercel Authentication | **Disabled** (see below) | **Standard Protection** |
| Deployment Protection → Protection Bypass for Automation | — | **Create a secret**, record it |

**Why the API is unprotected:** a Next.js rewrite can't attach the bypass header, so the web preview couldn't reach a protected API. The API carries its own auth, which makes an unprotected preview no more exposed than production.

- [ ] **Step 4: ⏸ CHECKPOINT (Ted) — set the API's production env vars**

```bash
pnpm exec vercel link --yes --project wishlist-api
pnpm exec vercel env add DATABASE_URL production   # paste the Neon *pooled* string at the prompt
```

`APP_ORIGIN` is set in Step 7, once the web's production domain is known.

- [ ] **Step 5: ⏸ CHECKPOINT (Ted) — migrate the production database**

```bash
read -rs DATABASE_URL_DIRECT && export DATABASE_URL_DIRECT   # paste the *direct* string; not echoed
pnpm --filter @wishlist/api db:migrate
unset DATABASE_URL_DIRECT
```

Expected: drizzle-kit reports `0000_init_rate_limits` applied.

- [ ] **Step 6: First production deploy of the API (prebuilt, exactly as CI will)**

```bash
pnpm exec vercel link --yes --project wishlist-api
pnpm exec vercel pull --yes --environment=production
pnpm exec vercel build --prod
pnpm exec vercel deploy --prebuilt --prod --env GIT_SHA="$(git rev-parse HEAD)"
```

Record the API production domain from the Vercel dashboard (Domains), e.g. `https://wishlist-api-<scope>.vercel.app`, as **`API_PRODUCTION_ORIGIN`**.

```bash
curl -fsS "$API_PRODUCTION_ORIGIN/api/health"
```

Expected: `{"status":"ok","sha":"<HEAD sha>","db":{"ok":true,"migrationsApplied":1}}`.

Decision rules:
- **`sha` is `"dev"`:** `--env` isn't reaching prebuilt deployments. Record it and stop. Tasks 11 and 12 depend on it.
- **The build or runtime fails** (module resolution, ESM, decorators): record the exact error in `docs/deployment.md` under "Known issues", then **⏸ stop and escalate to Ted**. Don't change the deployment model on your own.

- [ ] **Step 7: First production deploy of the web app**

```bash
pnpm exec vercel link --yes --project wishlist-web
pnpm exec vercel pull --yes --environment=production
API_ORIGIN="$API_PRODUCTION_ORIGIN" pnpm exec vercel build --prod
pnpm exec vercel deploy --prebuilt --prod
```

Record the web production domain as **`APP_PRODUCTION_ORIGIN`**. Then set the API's `APP_ORIGIN`. Plan 2's CSRF guard uses it.

```bash
pnpm exec vercel link --yes --project wishlist-api
printf '%s' "$APP_PRODUCTION_ORIGIN" | pnpm exec vercel env add APP_ORIGIN production
curl -fsS "$APP_PRODUCTION_ORIGIN/api/health"
curl -fsS "$APP_PRODUCTION_ORIGIN" | grep -o 'API: ok · db: ok'
```

Expected: the same health JSON, **through the web origin**, and the landing text.

- [ ] **Step 8: ⏸ CHECKPOINT (Ted) — create the Vercel token and gather IDs**

1. Vercel → Account Settings → Tokens → create `github-actions-wishlist`. Scope it to the Hobby team, expiry 1 year, and add a calendar reminder to rotate it.
2. IDs: `cat .vercel/project.json` gives `orgId` and the linked project's `projectId`. Relink to the other project to read its `projectId`.

- [ ] **Step 9: ⏸ CHECKPOINT (Ted) — GitHub environments, secrets and variables**

```bash
gh api -X PUT repos/Shockolate/wishlist-app/environments/production
gh api -X PUT repos/Shockolate/wishlist-app/environments/preview

# Each command prompts for the value; nothing is echoed or stored in shell history.
for s in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID_API VERCEL_PROJECT_ID_WEB DATABASE_URL_DIRECT; do
  gh secret set "$s" --env production
done
for s in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID_API VERCEL_PROJECT_ID_WEB NEON_API_KEY NEON_PROJECT_ID VERCEL_AUTOMATION_BYPASS_SECRET; do
  gh secret set "$s" --env preview
done

gh variable set API_PRODUCTION_ORIGIN --body "$API_PRODUCTION_ORIGIN"
gh variable set APP_PRODUCTION_ORIGIN --body "$APP_PRODUCTION_ORIGIN"
gh secret list --env production && gh secret list --env preview && gh variable list
```

Expected: 5 production secrets, 7 preview secrets and 2 variables.

- [ ] **Step 10: Write the deployment guide (part 1)**

`docs/deployment.md`:
````markdown
# Deployment

Production runs on free tiers: **Vercel Hobby** (two projects), **Neon Free** (Postgres 17) and **GitHub Actions**. GitHub Actions is the only thing that deploys; Vercel's Git integration is disabled (`apps/*/vercel.json`). See spec §3 and §10 for the reasoning.

```
Browser ──► wishlist-web (Next.js) ──rewrite /api/*──► wishlist-api (NestJS, one Vercel Function) ──► Neon
```

## Accounts

| Service | Plan | Used for |
|---|---|---|
| GitHub | Free (public repo) | Code, Actions, rulesets |
| Vercel | Hobby (non-commercial) | Hosting both apps |
| Neon | Free | Postgres 17, per-PR branches |

Later plans add: domain and DNS, Resend and Turnstile (Plan 2); Sentry, Cloudflare R2 backups and uptime monitoring (Plan 5).

## Neon

- Project `wishlist`, Postgres 17, region AWS us-east-1 (next to Vercel's `iad1`).
- **Pooled** connection string → the API's runtime `DATABASE_URL`.
- **Direct** connection string → migrations only (`DATABASE_URL_DIRECT`).
- The free plan scales compute to zero after 5 idle minutes. The first query afterwards takes a few hundred ms longer.
- Point-in-time restore covers **6 hours** on the free plan. Nightly backups arrive in Plan 5.

## Vercel projects

| Setting | wishlist-api | wishlist-web |
|---|---|---|
| Root Directory | `apps/api` | `apps/web` |
| Include files outside root | On | On |
| Node.js | 24.x | 24.x |
| Vercel Authentication | Disabled | Standard Protection |
| Protection Bypass for Automation | — | Enabled (secret in GitHub `preview` env) |

The API is deliberately unprotected: a Next.js rewrite can't attach the bypass header, and the API enforces its own auth.

## Environment variables

| Where | Name | Value |
|---|---|---|
| Vercel `wishlist-api` → Production | `DATABASE_URL` | Neon pooled string |
| Vercel `wishlist-api` → Production | `APP_ORIGIN` | Web production origin |
| Set per deploy by CI | `GIT_SHA` | The commit being deployed |
| Set at build by CI | `API_ORIGIN` (web) | API production origin, or the PR's API preview URL |

## GitHub configuration

| Kind | Scope | Names |
|---|---|---|
| Secrets | env `production` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `DATABASE_URL_DIRECT` |
| Secrets | env `preview` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_API`, `VERCEL_PROJECT_ID_WEB`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET` |
| Variables | repo | `API_PRODUCTION_ORIGIN`, `APP_PRODUCTION_ORIGIN` |

The Vercel token expires after one year; rotate it before then.

## Manual deploy (bootstrap or emergency only)

```bash
# API
pnpm exec vercel link --yes --project wishlist-api
pnpm exec vercel pull --yes --environment=production
pnpm exec vercel build --prod
pnpm exec vercel deploy --prebuilt --prod --env GIT_SHA="$(git rev-parse HEAD)"
# Web
pnpm exec vercel link --yes --project wishlist-web
pnpm exec vercel pull --yes --environment=production
API_ORIGIN="$API_PRODUCTION_ORIGIN" pnpm exec vercel build --prod
pnpm exec vercel deploy --prebuilt --prod
```

## Rollback

Code: Vercel Instant Rollback, **web first, then API**. Rolling the API back first could leave a newer web app calling an older API.

```bash
pnpm exec vercel link --yes --project wishlist-web && pnpm exec vercel rollback
pnpm exec vercel link --yes --project wishlist-api && pnpm exec vercel rollback
```

Data: Neon point-in-time restore (6-hour window) from the Neon console.

## Known issues

None yet.
````

- [ ] **Step 11: Commit and submit**

```bash
git add apps/api/vercel.json apps/web/vercel.json docs/deployment.md package.json pnpm-lock.yaml
git commit -F - <<'EOF'
chore(deploy): add Vercel project config and deployment guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit   # ⏸ first push of the delivery stack
```

---

### Task 10: Spikes B and C — client IP through the rewrite, and preview aliases

These spikes decide spec §6.6 (whether per-IP rate limits are possible) and §10 (how the API learns the web preview's origin). They also check whether the browser's `Origin` header survives the rewrite, which Plan 2's CSRF guard depends on. **Everything deployed here is throwaway.**

**Files:**
- Throwaway (never committed to a PR): branch `spike/vercel-headers` with `apps/api/src/spike/headers.controller.ts`
- Create: `docs/superpowers/spikes/2026-10-07-vercel-rewrite-headers-and-alias.md`
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§6.6, §10)

**Interfaces:**
- Produces:
  - **Repo variable `PREVIEW_ALIAS_PREFIX`**, e.g. `shockolate-wishlist-pr-`. Task 12 builds `<prefix><pr-number>.vercel.app` from it.
  - **Recorded decisions:** which header (if any) to use for per-IP rate limits, and whether `Origin` passes through the rewrite.

- [ ] **Step 1: Create the throwaway endpoint**

```bash
git switch main && git pull --ff-only
git switch -c spike/vercel-headers
```

`apps/api/src/spike/headers.controller.ts`:
```ts
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

const INTERESTING = [
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'x-vercel-proxied-for',
  'forwarded',
  'x-vercel-id',
  'x-forwarded-host',
  'host',
  'origin',
];

/** THROWAWAY (Plan 1, Task 10): shows which client-identifying headers survive the rewrite. */
@Controller('_spike/headers')
export class SpikeHeadersController {
  @Get()
  get(@Req() req: Request): Record<string, unknown> {
    return {
      ip: req.ip,
      remoteAddress: req.socket.remoteAddress,
      headers: Object.fromEntries(INTERESTING.map((h) => [h, req.headers[h] ?? null])),
    };
  }
}
```

In `apps/api/src/app.module.ts`, temporarily add `controllers: [SpikeHeadersController]` to the `@Module({...})` metadata, and add this import:
```ts
import { SpikeHeadersController } from './spike/headers.controller.js';
```

```bash
git add -A && git commit -m "spike: header echo endpoint (throwaway, never merged)"
```

- [ ] **Step 2: ⏸ CHECKPOINT — deploy throwaway previews and try the alias (spike C)**

Have Ted export the pooled `DATABASE_URL` (`read -rs DATABASE_URL && export DATABASE_URL`) and `BYPASS` (the automation-bypass secret).

```bash
pnpm install --frozen-lockfile
pnpm exec vercel link --yes --project wishlist-api
pnpm exec vercel pull --yes --environment=preview
pnpm exec vercel build
API_URL=$(pnpm exec vercel deploy --prebuilt --env DATABASE_URL="$DATABASE_URL" --env GIT_SHA=spike)

pnpm exec vercel link --yes --project wishlist-web
pnpm exec vercel pull --yes --environment=preview
API_ORIGIN="$API_URL" pnpm exec vercel build
WEB_URL=$(pnpm exec vercel deploy --prebuilt)

ALIAS=shockolate-wishlist-pr-0.vercel.app
pnpm exec vercel alias set "$WEB_URL" "$ALIAS"
curl -s -o /dev/null -w '%{http_code}\n' "https://$ALIAS/"
curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $BYPASS" "https://$ALIAS/"
```

**Spike C passes if all of these hold:**
- `vercel alias set` succeeds;
- the alias returns `401` without the bypass header, so preview protection applies to aliases;
- it returns `200` with the bypass header.

If the `.vercel.app` name is taken, try a different prefix. If aliasing to `*.vercel.app` is refused outright on Hobby, record that. The spec §12 fallback is then an anchored regex allowlist matching only `wishlist-web` preview URLs in this Vercel scope.

- [ ] **Step 3: Measure the client-IP headers (spike B)**

```bash
MY_IP=$(curl -fsS https://api.ipify.org); echo "my ip: $MY_IP"
H=(-H "x-vercel-protection-bypass: $BYPASS")
echo "== (a) through the rewrite";            curl -fsS "${H[@]}" "https://$ALIAS/api/_spike/headers" | jq
echo "== (b) through the rewrite, spoofed";   curl -fsS "${H[@]}" -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Real-IP: 203.0.113.7' "https://$ALIAS/api/_spike/headers" | jq
echo "== (c) direct to the API";              curl -fsS "$API_URL/api/_spike/headers" | jq
echo "== (d) direct, spoofed";                curl -fsS -H 'X-Forwarded-For: 203.0.113.7' "$API_URL/api/_spike/headers" | jq
echo "== (e) Origin through the rewrite";     curl -fsS "${H[@]}" -H "Origin: https://$ALIAS" "https://$ALIAS/api/_spike/headers" | jq '.headers.origin'
```

**Decision rules:**
- **Per-IP header H.** H is usable for per-IP rate limits only if all of these hold:
  - in (a), H's first value equals `$MY_IP`;
  - in (b), the value we'd read (the first entry) is still `$MY_IP`, not `203.0.113.7`;
  - in (c) and (d), the same header also names the real caller and can't be spoofed.

  If no header passes, per-IP limits are **dropped** and limits key on email, token and user only (spec §6.6 fallback).
- **Origin.** If (e) shows `https://$ALIAS`, `Origin` survives the rewrite and Plan 2's CSRF guard works as designed. If it's missing or changed, **⏸ stop and escalate to Ted**. The CSRF design (spec §6.2) needs revisiting before Plan 2.

- [ ] **Step 4: Tear everything down**

```bash
pnpm exec vercel alias rm "$ALIAS" --yes
pnpm exec vercel remove "$API_URL" "$WEB_URL" --yes
unset DATABASE_URL BYPASS
git switch main && git branch -D spike/vercel-headers
```

Expected: both deployments are gone (`pnpm exec vercel ls wishlist-api` and `pnpm exec vercel ls wishlist-web` no longer list them), and the local branch is deleted. It was never pushed.

- [ ] **Step 5: Record findings and update the spec**

```bash
git switch delivery/vercel-setup
gh stack add delivery/spike-findings
```

Create `docs/superpowers/spikes/2026-10-07-vercel-rewrite-headers-and-alias.md`. Paste the real outputs.

```markdown
# Spikes B & C: client IP through the rewrite, and preview aliases

- **Date:** 2026-10-07
- **Setup:** throwaway API and web previews; the web preview aliased to `<ALIAS>`; a header-echo endpoint on the API.

## Spike B: client IP

| Probe | x-forwarded-for | x-real-ip | x-vercel-forwarded-for | other |
|---|---|---|---|---|
| (a) rewrite | <value> | <value> | <value> | <value> |
| (b) rewrite + spoof | <value> | <value> | <value> | <value> |
| (c) direct | <value> | <value> | <value> | <value> |
| (d) direct + spoof | <value> | <value> | <value> | <value> |

**Decision:** <use header `X` (first entry) for per-IP limits | drop per-IP limits>. **Why:** <one sentence>.

## Origin through the rewrite

(e) `origin` = <value>. **Decision:** <CSRF Origin check works as designed | escalated: …>.

## Spike C: preview alias

- `vercel alias set` to `<ALIAS>`: <succeeded | refused: error>
- Without bypass: <status>. With bypass: <status>.

**Decision:** preview web alias pattern `<prefix><pr-number>.vercel.app`; repo variable `PREVIEW_ALIAS_PREFIX=<prefix>`.
```

Update the spec:
- **§6.6:** replace the "Open question (spike)" paragraph with the decision and a link to this file.
- **§10:** replace `wishlist-web-pr-<n>.vercel.app` with `<PREVIEW_ALIAS_PREFIX><n>.vercel.app` and link the findings.

```bash
gh variable set PREVIEW_ALIAS_PREFIX --body "shockolate-wishlist-pr-"   # ⏸ use the prefix that worked
git add docs/superpowers/spikes docs/superpowers/specs
git commit -F - <<'EOF'
docs: record rewrite header and preview alias spikes; resolve spec open questions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

---

### Task 11: Production deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`, `scripts/wait-for-health.sh`, `scripts/wait-for-health.test.sh`
- Modify: `.github/workflows/ci.yml` (add the `actionlint` job and a script-tests step), `docs/deployment.md` (add "Continuous deployment")

**Interfaces:**
- Consumes: the secrets and variables from Task 9; `pnpm --filter @wishlist/e2e test:smoke` (Task 8); `db:migrate` (Task 5).
- Produces:
  - **`scripts/wait-for-health.sh <health-url> <expected-sha> [timeout-seconds] [curl args…]`:** exits 0 once `status == ok` and `sha == expected-sha`, and exits 1 on timeout. The poll interval comes from env `POLL_SECONDS` (default 5).
  - **The `deploy` workflow** on push to `main`.

- [ ] **Step 1: Add the stack layer and write the failing script test**

```bash
gh stack add delivery/deploy-workflow
```

`scripts/wait-for-health.test.sh`:
```bash
#!/usr/bin/env bash
# Verifies wait-for-health.sh against a static health document served locally.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
server_pid=""
trap '[[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null; rm -rf "$root"' EXIT

mkdir -p "$root/api"
echo '{"status":"ok","sha":"abc123","db":{"ok":true,"migrationsApplied":1}}' > "$root/api/health"
python3 -m http.server 38999 --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
server_pid=$!
curl -fsS --retry 20 --retry-connrefused --retry-delay 0 -o /dev/null http://127.0.0.1:38999/api/health

export POLL_SECONDS=1
"$here/wait-for-health.sh" http://127.0.0.1:38999/api/health abc123 5

if "$here/wait-for-health.sh" http://127.0.0.1:38999/api/health other-sha 2; then
  echo "expected a timeout when the deployed sha never matches" >&2
  exit 1
fi

echo "wait-for-health: ok"
```

```bash
chmod +x scripts/wait-for-health.test.sh
scripts/wait-for-health.test.sh
```

Expected: FAIL, with `wait-for-health.sh: No such file or directory`.

- [ ] **Step 2: Implement the script**

`scripts/wait-for-health.sh`:
```bash
#!/usr/bin/env bash
# Polls an API health endpoint until it reports status "ok" for the expected commit.
# Usage: wait-for-health.sh <health-url> <expected-sha> [timeout-seconds] [extra curl args...]
# Env:   POLL_SECONDS (default 5)
set -euo pipefail

url="$1"
expected="$2"
timeout="${3:-120}"
shift $(( $# < 3 ? $# : 3 ))
poll="${POLL_SECONDS:-5}"
deadline=$(( $(date +%s) + timeout ))

while :; do
  body=$(curl -fsS --max-time 10 "$@" "$url" 2>/dev/null || true)
  status=$(jq -r '.status // empty' <<<"$body" 2>/dev/null || true)
  sha=$(jq -r '.sha // empty' <<<"$body" 2>/dev/null || true)
  if [[ "$status" == "ok" && "$sha" == "$expected" ]]; then
    echo "healthy: $body"
    exit 0
  fi
  if (( $(date +%s) >= deadline )); then
    echo "timed out after ${timeout}s waiting for $url to report sha $expected (last: ${body:-<no response>})" >&2
    exit 1
  fi
  sleep "$poll"
done
```

```bash
chmod +x scripts/wait-for-health.sh
scripts/wait-for-health.test.sh
```

Expected: `wait-for-health: ok`.

- [ ] **Step 3: Write the deploy workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy

# Production deploys run only from main, one at a time. A deploy already running is never
# cancelled (it may be mid-migration). GitHub keeps only the newest *queued* run, so merging a
# stack of N PRs ships the tip without deploying every intermediate commit.
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: production
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    name: deploy
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment:
      name: production
      url: ${{ vars.APP_PRODUCTION_ORIGIN }}
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      API_ORIGIN: ${{ vars.API_PRODUCTION_ORIGIN }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # Cheap with Turborepo's cache when the commit was already tested on its PR; a real check
      # when it wasn't (e.g. a squash that differs from the tested PR head).
      - name: Gates
        run: pnpm turbo run lint typecheck test

      # Before the new API ships. Migrations must be backward-compatible with the API that is
      # currently live (expand/contract, spec §10).
      - name: Migrate production database
        run: pnpm --filter @wishlist/api db:migrate
        env:
          DATABASE_URL_DIRECT: ${{ secrets.DATABASE_URL_DIRECT }}

      - name: Deploy API
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
        run: |
          pnpm exec vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
          pnpm exec vercel build --prod --token="$VERCEL_TOKEN"
          pnpm exec vercel deploy --prebuilt --prod --env GIT_SHA="$GITHUB_SHA" --token="$VERCEL_TOKEN"

      - name: Wait for the new API to serve traffic
        run: scripts/wait-for-health.sh "$API_ORIGIN/api/health" "$GITHUB_SHA" 180

      # After the API, so the new web app never talks to an older API.
      - name: Deploy web
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
        run: |
          pnpm exec vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
          pnpm exec vercel build --prod --token="$VERCEL_TOKEN"
          pnpm exec vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"

      - run: pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium

      - name: Smoke test production
        run: pnpm --filter @wishlist/e2e test:smoke
        env:
          BASE_URL: ${{ vars.APP_PRODUCTION_ORIGIN }}
          EXPECTED_SHA: ${{ github.sha }}
```

- [ ] **Step 4: Lint workflows in CI and run the script tests**

In `.github/workflows/ci.yml`, add this step to the `checks` job, after `pnpm format:check`:
```yaml
      - name: Script tests
        run: |
          scripts/wait-for-health.test.sh
```

Then add this job under `jobs:`:
```yaml
  actionlint:
    name: actionlint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
      - name: Lint GitHub workflows
        run: docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color
```

Run actionlint locally:
```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color
```

Expected: no output, exit 0. Fix anything it reports.

- [ ] **Step 5: Document continuous deployment**

In `docs/deployment.md`, insert this section **before** `## Manual deploy (bootstrap or emergency only)`:
````markdown
## Continuous deployment

`.github/workflows/deploy.yml` runs on every push to `main`, one at a time:

1. Gates: lint, typecheck, unit tests.
2. `drizzle-kit migrate` against production (direct connection).
3. Build and deploy the API (`--prod`, with `GIT_SHA` set to the commit).
4. Wait until `/api/health` reports that commit (`scripts/wait-for-health.sh`).
5. Build the web app with `API_ORIGIN` set to the API production origin, then deploy it.
6. Playwright smoke tests against the web production origin.

A deploy that's already running is never cancelled. Of the runs queued behind it, only the newest is kept, so merging a stack ships its tip once.

If a deploy fails after the migration step, production still runs the previous code against the new schema. That's safe by construction, because every migration is backward-compatible (expand/contract). Fix forward, or roll back the code (see Rollback).
````

- [ ] **Step 6: Commit and submit**

```bash
git add .github/workflows/deploy.yml .github/workflows/ci.yml scripts/wait-for-health.sh scripts/wait-for-health.test.sh docs/deployment.md
git commit -F - <<'EOF'
ci: deploy to production on merge to main with health-gated ordering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

Expected: `checks` (including script tests) and `actionlint` pass on the PR. The deploy workflow itself first runs when this layer merges.

---

### Task 12: Preview and cleanup workflows

**Files:**
- Create: `.github/workflows/preview.yml`, `.github/workflows/cleanup.yml`
- Create: `scripts/neon-sweep.sh`, `scripts/neon-sweep.test.sh`, `scripts/testdata/neon-branches.json`
- Modify: `.github/workflows/ci.yml` (script-tests step), `docs/deployment.md` (add "Previews")

**Interfaces:**
- Consumes: the `preview` environment secrets (Task 9); `PREVIEW_ALIAS_PREFIX` (Task 10); `scripts/wait-for-health.sh` (Task 11); `test:smoke` (Task 8).
- Produces:
  - **Per PR:** Neon branch `pr-<n>`, an API preview, and a web preview aliased to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app`, plus a sticky PR comment.
  - **`scripts/neon-sweep.sh [--dry-run]`**, with test seams `NEON_BRANCHES_FILE` and `OPEN_PRS`.

- [ ] **Step 1: Add the stack layer and write the failing sweep test**

```bash
gh stack add delivery/preview-workflow
mkdir -p scripts/testdata
```

`scripts/testdata/neon-branches.json`:
```json
{
  "branches": [
    { "id": "br-a", "name": "main" },
    { "id": "br-b", "name": "pr-12" },
    { "id": "br-c", "name": "pr-13" },
    { "id": "br-d", "name": "pr-14" },
    { "id": "br-e", "name": "pr-140" },
    { "id": "br-f", "name": "pr-12-old" }
  ]
}
```

`scripts/neon-sweep.test.sh`:
```bash
#!/usr/bin/env bash
# Verifies neon-sweep.sh's selection: only pr-<number> branches whose PR is closed are deleted.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(NEON_BRANCHES_FILE="$here/testdata/neon-branches.json" OPEN_PRS="12 14" "$here/neon-sweep.sh" --dry-run)
expected=$'keep         pr-12 (PR #12 is open)\nwould delete pr-13 (br-c)\nkeep         pr-14 (PR #14 is open)\nwould delete pr-140 (br-e)'

if [[ "$out" != "$expected" ]]; then
  echo "unexpected output:" >&2
  diff <(echo "$expected") <(echo "$out") >&2 || true
  exit 1
fi
echo "neon-sweep: ok"
```

```bash
chmod +x scripts/neon-sweep.test.sh
scripts/neon-sweep.test.sh
```

Expected: FAIL, with `neon-sweep.sh: No such file or directory`.

- [ ] **Step 2: Implement the sweep**

`scripts/neon-sweep.sh`:
```bash
#!/usr/bin/env bash
# Deletes Neon branches named pr-<number> whose pull request is no longer open. A safety net for
# the per-PR cleanup job: Neon's free plan caps a project at 10 branches.
#
# Usage: scripts/neon-sweep.sh [--dry-run]
# Env:   NEON_API_KEY, NEON_PROJECT_ID, GH_TOKEN (for `gh pr list`)
# Test seams: NEON_BRANCHES_FILE (branches JSON from a file) and OPEN_PRS (space-separated open
# PR numbers) replace the Neon and GitHub calls.
set -euo pipefail

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then dry_run=true; fi

api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID:-}/branches"
auth=(-H "Authorization: Bearer ${NEON_API_KEY:-}" -H "Accept: application/json")

if [[ -n "${NEON_BRANCHES_FILE:-}" ]]; then
  branches_json=$(cat "$NEON_BRANCHES_FILE")
else
  branches_json=$(curl -fsS "${auth[@]}" "$api")
fi

if [[ -n "${OPEN_PRS+x}" ]]; then
  open_prs=$(tr ' ' '\n' <<<"$OPEN_PRS")
else
  open_prs=$(gh pr list --state open --limit 500 --json number --jq '.[].number')
fi

jq -r '.branches[] | select(.name | test("^pr-[0-9]+$")) | "\(.id) \(.name)"' <<<"$branches_json" |
  while read -r id name; do
    number="${name#pr-}"
    if grep -qx "$number" <<<"$open_prs"; then
      echo "keep         $name (PR #$number is open)"
    elif $dry_run; then
      echo "would delete $name ($id)"
    else
      curl -fsS -X DELETE "${auth[@]}" "$api/$id" >/dev/null
      echo "deleted      $name ($id)"
    fi
  done
```

```bash
chmod +x scripts/neon-sweep.sh
scripts/neon-sweep.test.sh
```

Expected: `neon-sweep: ok`.

In `.github/workflows/ci.yml`, extend the `Script tests` step in `checks` to:
```yaml
      - name: Script tests
        run: |
          scripts/wait-for-health.test.sh
          scripts/neon-sweep.test.sh
```

- [ ] **Step 3: Write the preview workflow**

`.github/workflows/preview.yml`:
```yaml
name: Preview

# No `branches:` filter: every layer of a stack gets its own preview.
on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  preview:
    name: preview
    # Fork PRs receive no secrets; they get CI but no preview.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: preview
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      PR_NUMBER: ${{ github.event.pull_request.number }}
      HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      # Deterministic, so the API can be told the web origin before the web preview exists
      # (spec §10; spike C).
      WEB_ALIAS: ${{ vars.PREVIEW_ALIAS_PREFIX }}${{ github.event.pull_request.number }}.vercel.app
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: Create or reuse the PR's database branch
        id: db
        uses: neondatabase/create-branch-action@v6
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch_name: pr-${{ github.event.pull_request.number }}

      - name: Mask database credentials
        env:
          DB_URL: ${{ steps.db.outputs.db_url }}
          DB_URL_POOLED: ${{ steps.db.outputs.db_url_pooled }}
        run: |
          echo "::add-mask::$DB_URL"
          echo "::add-mask::$DB_URL_POOLED"

      - name: Migrate the PR's database branch
        run: pnpm --filter @wishlist/api db:migrate
        env:
          DATABASE_URL_DIRECT: ${{ steps.db.outputs.db_url }}

      - name: Deploy API preview
        id: api
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
          DATABASE_URL: ${{ steps.db.outputs.db_url_pooled }}
        run: |
          pnpm exec vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
          pnpm exec vercel build --token="$VERCEL_TOKEN"
          # EMAIL_TRANSPORT=log: preview data is cloned from production, so it must never email
          # real people (spec §10).
          url=$(pnpm exec vercel deploy --prebuilt --token="$VERCEL_TOKEN" \
            --env DATABASE_URL="$DATABASE_URL" \
            --env APP_ORIGIN="https://$WEB_ALIAS" \
            --env EMAIL_TRANSPORT=log \
            --env GIT_SHA="$HEAD_SHA")
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Wait for the API preview
        env:
          API_URL: ${{ steps.api.outputs.url }}
        run: scripts/wait-for-health.sh "$API_URL/api/health" "$HEAD_SHA" 180

      - name: Deploy web preview
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
          API_ORIGIN: ${{ steps.api.outputs.url }}
        run: |
          pnpm exec vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
          pnpm exec vercel build --token="$VERCEL_TOKEN"
          url=$(pnpm exec vercel deploy --prebuilt --token="$VERCEL_TOKEN")
          pnpm exec vercel alias set "$url" "$WEB_ALIAS" --token="$VERCEL_TOKEN"

      - run: pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium

      - name: Smoke test the preview
        run: pnpm --filter @wishlist/e2e test:smoke
        env:
          BASE_URL: https://${{ env.WEB_ALIAS }}
          EXPECTED_SHA: ${{ env.HEAD_SHA }}
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}

      - name: Comment preview links
        uses: marocchino/sticky-pull-request-comment@v3
        with:
          header: preview
          message: |
            **Preview** for ${{ env.HEAD_SHA }}

            - Web: https://${{ env.WEB_ALIAS }} (Vercel login required)
            - API health: ${{ steps.api.outputs.url }}/api/health
            - Database: Neon branch `pr-${{ env.PR_NUMBER }}`, cloned from production. Email is log-only.
```

- [ ] **Step 4: Write the cleanup workflow**

`.github/workflows/cleanup.yml`:
```yaml
name: Cleanup previews

on:
  pull_request:
    types: [closed]
  schedule:
    - cron: '23 6 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: List the branches that would be deleted without deleting them
        type: boolean
        default: true

permissions:
  contents: read
  pull-requests: read

jobs:
  delete-pr-branch:
    name: delete-pr-branch
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment: preview
    steps:
      - uses: neondatabase/delete-branch-action@v3
        # The branch may never have existed (e.g. the preview failed before creating it). Real
        # failures here are caught by the nightly sweep below.
        continue-on-error: true
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch: pr-${{ github.event.pull_request.number }}

  sweep:
    name: sweep
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment: preview
    steps:
      - uses: actions/checkout@v7
      - name: Delete database branches of closed PRs
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
          GH_TOKEN: ${{ github.token }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
        run: |
          if [[ "$DRY_RUN" == "true" ]]; then
            scripts/neon-sweep.sh --dry-run
          else
            scripts/neon-sweep.sh
          fi
```

- [ ] **Step 5: Lint, document, commit and submit**

```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color
```

Expected: no output.

In `docs/deployment.md`, insert this section **before** `## Manual deploy (bootstrap or emergency only)`:
````markdown
## Previews

Each PR, including each layer of a stack, gets (`.github/workflows/preview.yml`):

1. A Neon branch `pr-<n>`, a copy-on-write clone of production, with migrations applied.
2. An API preview using that branch. `EMAIL_TRANSPORT=log` means no real email is ever sent.
3. A web preview built against that API, aliased to `<PREVIEW_ALIAS_PREFIX><n>.vercel.app`.
4. Read-only smoke tests and a sticky PR comment with the links.

Web previews require a Vercel login (deployment protection). Automation uses the bypass secret.

Cleanup (`.github/workflows/cleanup.yml`): closing a PR deletes its Neon branch, and a nightly sweep deletes any `pr-*` branch whose PR is closed. Neon Free allows only 10 branches per project, so at most about 9 PRs can have previews at once.

To check the sweep by hand: Actions → "Cleanup previews" → Run workflow (dry run defaults to on).
````

```bash
git add .github/workflows scripts docs/deployment.md
git commit -F - <<'EOF'
ci: add per-PR previews on Neon branches and preview cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

Expected: on **this** PR (and every PR from now on), the `preview` workflow creates `pr-<n>`, deploys both previews, passes the smoke tests, and posts the sticky comment. Open the web alias in a browser while logged in to Vercel. It should show `API: ok · db: ok`.

---

### Task 13: Repository protection and hygiene

**Files:**
- Create: `.github/rulesets/main.json`, `.github/workflows/dependency-review.yml`, `renovate.json`
- Modify: `docs/deployment.md` (add "Repository settings")

**Interfaces:**
- Consumes: the merge method from Spike A (Task 2); CI job names `checks`, `actionlint`, `integration`, `migrations-lint` and `e2e`.
- Produces:
  - An active ruleset on `main`.
  - CodeQL default setup, secret scanning with push protection, and Dependabot alerts.
  - Renovate configuration.

- [ ] **Step 1: Add the stack layer and the config files**

```bash
gh stack add delivery/repo-hygiene
```

`.github/rulesets/main.json`. Set `allowed_merge_methods` to the method from Spike A. `squash` is shown.
```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "checks", "integration_id": 15368 },
          { "context": "actionlint", "integration_id": 15368 },
          { "context": "integration", "integration_id": 15368 },
          { "context": "migrations-lint", "integration_id": 15368 },
          { "context": "e2e", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

**Why these settings:**
- **0 required approvals:** it's a solo repo, and GitHub won't let you approve your own PR.
- **"Branch must be up to date" (strict) is off:** with stacks, it would force a rebase of every layer each time anything merges.
- **`integration_id: 15368`** pins each required check to GitHub Actions, so nothing else can report a passing status under the same name.
- **`preview` is deliberately not required.** A Vercel or Neon outage, or the Neon branch cap, shouldn't block merging code that has passed CI.

`.github/workflows/dependency-review.yml`:
```yaml
name: Dependency review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  dependency-review:
    name: dependency-review
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
      - uses: actions/dependency-review-action@v5
        with:
          fail-on-severity: high
          comment-summary-in-pr: on-failure
```

`renovate.json`:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits", "group:monorepos", "schedule:weekly"],
  "rangeStrategy": "pin",
  "packageRules": [
    {
      "description": "Low-risk: automerge devDependency patches once CI is green",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch"],
      "automerge": true
    },
    {
      "description": "TS 7 drops the JS compiler API that Nest CLI, typescript-eslint and Next's typecheck use (spec §3)",
      "matchPackageNames": ["typescript"],
      "allowedVersions": "<7.0.0"
    },
    {
      "description": "eslint-config-next's plugins don't support ESLint 10 yet (spec §3)",
      "matchPackageNames": ["eslint", "@eslint/js"],
      "allowedVersions": "<10.0.0"
    }
  ]
}
```

- [ ] **Step 2: Lint, document, commit and submit**

```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color
npx --yes --package renovate@latest -- renovate-config-validator renovate.json
```

Expected: actionlint prints nothing, and the validator reports `Config validated successfully`.

Append to `docs/deployment.md`:
````markdown

## Repository settings

Applied once, from the files in this repo:

| Setting | Source | How |
|---|---|---|
| Ruleset on `main` | `.github/rulesets/main.json` | `gh api -X POST repos/Shockolate/wishlist-app/rulesets --input .github/rulesets/main.json` (update: `-X PUT …/rulesets/<id>`) |
| CodeQL | default setup | `gh api -X PATCH repos/Shockolate/wishlist-app/code-scanning/default-setup -f state=configured` |
| Secret scanning + push protection | repo security settings | see Plan 1, Task 13, Step 4 |
| Dependabot alerts | repo security settings | `gh api -X PUT repos/Shockolate/wishlist-app/vulnerability-alerts` |
| Auto-merge (used by Renovate) | repo settings | `gh repo edit --enable-auto-merge` |
| Renovate | GitHub App | install from https://github.com/apps/renovate for this repo only |

Required checks: `checks`, `actionlint`, `integration`, `migrations-lint`, `e2e`. `preview` is advisory.
````

```bash
git add .github renovate.json docs/deployment.md
git commit -F - <<'EOF'
chore(repo): add main ruleset, dependency review and Renovate config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

- [ ] **Step 3: ⏸ CHECKPOINT — Ted reviews and merges the delivery stack, then verify the deploys**

After Ted's review, merge the delivery stack. Use the merge method from Spike A.

Then check how the deploys behaved:
```bash
gh run list --workflow deploy.yml --limit 10 --json databaseId,headSha,status,conclusion,createdAt
```

Expected:
- **At most two runs reached `in_progress`:** the first push that contained `deploy.yml`, and the newest one. Any run queued in between shows `conclusion: cancelled`, because GitHub replaced it in the queue.
- **The last run's `conclusion` is `success`.**
- **The live API reports the tip commit:**
  ```bash
  curl -fsS "$(gh variable get APP_PRODUCTION_ORIGIN)/api/health" | jq -r .sha
  ```
  This must equal `git rev-parse origin/main`.

If a run failed, read its log (`gh run view <id> --log-failed`), fix it in a new PR, and re-verify.

- [ ] **Step 4: ⏸ CHECKPOINT — apply the repository settings**

```bash
gh api -X POST repos/Shockolate/wishlist-app/rulesets --input .github/rulesets/main.json
gh api -X PATCH repos/Shockolate/wishlist-app/code-scanning/default-setup -f state=configured
gh api -X PUT repos/Shockolate/wishlist-app/vulnerability-alerts
gh api -X PATCH repos/Shockolate/wishlist-app --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh repo edit Shockolate/wishlist-app --enable-auto-merge
```

Ted installs Renovate: https://github.com/apps/renovate → Configure → only `wishlist-app`.

Verify:
```bash
gh api repos/Shockolate/wishlist-app/rulesets --jq '.[] | .name + " " + .enforcement'   # expect: main active
gh api repos/Shockolate/wishlist-app/rules/branches/main --jq '[.[].type] | sort | join(",")'
gh api repos/Shockolate/wishlist-app --jq '.security_and_analysis.secret_scanning_push_protection.status'  # expect: enabled
```

Expected:
- `main active`
- The effective rules on `main` are `deletion,non_fast_forward,pull_request,required_status_checks`.
- `enabled`

Don't test the ruleset by pushing to `main`. If the ruleset were misconfigured, that push would land and trigger a production deploy.

- [ ] **Step 5: Mark Plan 1 done in the roadmap**

```bash
git switch main && git pull --ff-only
gh stack init docs/roadmap-plan-1-done
```

In `docs/superpowers/plans/2026-10-07-roadmap.md`, change Plan 1's Status cell from `Written` to `Done`.

```bash
git add docs/superpowers/plans/2026-10-07-roadmap.md
git commit -F - <<'EOF'
docs: mark plan 1 complete in roadmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit
```

This PR is the first one to go through the full pipeline under the ruleset: CI, a preview, and a deploy on merge. Ted merges it, and then Plan 2 gets written.
