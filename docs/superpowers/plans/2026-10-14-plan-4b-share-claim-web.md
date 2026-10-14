# Plan 4b — Share & claim web, and go-live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pages gifters use and the switch that opens Hanker:
- the share page (`/s/[shareToken]`), with the owner's own view and a page for a dead link;
- the claim sheet, which survives a lost response because it mints its own manage token (D42);
- the manage page (`/c/[manageToken]`): change, cancel, and the pages after;
- the owner's spoiler toggle in `/settings`, and the editor's claim lines;
- the fixes that must land before sign-up opens (D38's two Turnstile fixes, Plan 3b's two carries);
- then sign-up opens, when Ted sets `TURNSTILE_SECRET_KEY` (D31).

**Architecture:**
- **API, small and additive (layer `api/claim-replay`).** `POST …/claims` takes an optional `manageToken` and replays a claim whose token it already holds (D42). The owner check moves before the list's limit (D43). Blank letters become every default-ignorable code point plus U+2800 (D44). Every problem response gets `Cache-Control: no-store`. `remainingOf` moves to `contracts` so the web can use it.
- **Server render, client islands.** `/s` and `/c` are Server Components that call the API server to server, forwarding the cookie. The claim sheet, the manage form and the "You're getting" strips are client components that write through `browserApi`, then call `router.refresh()`. TanStack Query isn't used on these pages.
- **The browser's claims** live under one `localStorage` key, `hanker:claims`, as `[{itemId, manageToken, claimId?}]` (D45), in a pure module with a thin storage wrapper.
- **Owner side.** A `ClaimsCard` in settings; claim lines on the editor's rows; the cache keeps an item's claims across item writes and drops them all when the owner opts out.

**Tech Stack:** Next.js (App Router), React 19, TanStack Query 5, Radix (`@radix-ui/react-dialog@1.2.0`, new as a direct dependency but already in the lockfile), NestJS 12, Drizzle, Zod 4, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §2 Claims, Spoilers, Visible text; §4 token table; §5 Public endpoints, "A claim that survives a lost response", "The order of a claim's checks"; §6.2; §6.5; §6.7; §7 Routes, Typed client, Claim flow, "Share, claim and manage pages (Plan 4b)"; §8. It was amended for this plan in `985cf4e` (D42–D45).

**Mockups:** the "Plan 4b" rows of https://claude.ai/artifact/6JbNzewTnt2fqvhPdn9vr8, and the approved "Share page (built in Plan 4)" board above them. Ted approved them on 2026-10-14. The copy in this plan is taken from them; where the plan's copy and a board differ, the plan wins (it fixes wording the boards left loose).

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1–4a still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`. Relative imports in `api`, `contracts` and `e2e` end in `.js`; the web app uses bundler resolution and the `@/` alias.
- Exact version pins. **One new direct dependency:** `@radix-ui/react-dialog` `1.2.0` in `apps/web` (Task 4). Nothing else.
- Explicit `@Inject(…)` on every Nest constructor parameter.
- Every error is problem+json with a stable `code`; a `detail` never echoes what the caller sent. No token ever appears in a log line, a problem body, or a page's `<title>`.
- State-changing API test requests go through `test/support/client.ts`.
- Behavior changes are written test-first. Web unit tests are `*.spec.ts` under `apps/web/src` and run in Node, with no DOM: logic that needs testing lives in pure modules under `apps/web/src/lib`, and components are proven by E2E.
- Error copy lives in `apps/web/src/lib/messages.ts`. Terracotta (`primary`) never carries text: buttons use `text-primary-foreground` (espresso).
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it: replace `<the model that wrote this commit>` in the commit steps below, e.g. `Claude Sonnet 5.5`.

**Dark until the checkpoint.** No environment variable, secret or Vercel setting changes in Tasks 1–9. `TURNSTILE_SECRET_KEY` stays unset in production until Ted sets it himself in Task 10 (D31).

**The spoiler guarantee (spec §1 criterion 4, §5.1).** No web code infers, stores or shows claim data for an owner who hasn't opted in. The owner's pages show claim data only from the fields the API sent; turning the setting off removes them from the browser's cache before the request returns.

**Values fixed by this plan:**

| Thing | Value |
|---|---|
| Manage token, minted by the sheet | 16 bytes from `crypto.getRandomValues`, base64url, no padding: 22 characters matching `CAPABILITY_TOKEN_PATTERN` |
| New error code | `MANAGE_TOKEN_IN_USE` (409) |
| Claim check order (D43) | malformed IDs → per-IP limit → list by token → **owner (403)** → list's limit → transaction |
| Blank letters (D44) | `/[\p{Default_Ignorable_Code_Point}⠀]/gu` |
| `localStorage` keys | `hanker:claims` (`[{itemId, manageToken, claimId?}]`, D45), `hanker:claimerName` (a string) |
| Problem responses | `Cache-Control: no-store`, all of them |
| Token pages | `/s/:shareToken` and `/c/:manageToken`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; `robots.ts` disallows `/s/` and `/c/` |
| Remaining | `remainingOf(quantity, claimed) = max(0, quantity − claimed)`, now exported from `@wishlist/contracts` |
| A claim change's maximum | `remaining + claim.quantity` (spec §2) |

## Rulings this plan makes on gaps in the spec

The executor records each one in the ledger as it lands.

1. **A replay answers `201`, as the first claim did.** The body is the claim as it is now (its name or quantity may have been changed since), with the same `manageToken` and `manageUrl`. The client never needs to tell a replay from a first claim.
2. **A replay looks the token up inside the transaction, after the item's row lock,** so a double tap's second request waits for the first and then sees its row (READ COMMITTED takes a fresh snapshot per statement). It skips the remaining check. It still counts against both rate limits, and still passes the owner check, because both run before the transaction.
3. **The same token on another item is `409 MANAGE_TOKEN_IN_USE`,** whether the lookup finds it or the unique index does (two items claimed at once with one token). Its detail is fixed: "This claim link is already in use."
4. **The sheet's token lifecycle.** The sheet mints a token at its first submit and keeps it for every retry until it gets a definitive answer. If this browser already holds a *pending* record for the item (one with no `claimId`, from a response that never arrived), the sheet reuses that record's token instead of minting a new one. A replay then finds the claim rather than making a second.
5. **A definitive refusal drops the pending record:** any `4xx`. A network failure (`TypeError`) or a `5xx` keeps it, so a reload or **Try again** can still find the claim.
6. **A gifter who already holds a claim on an item** sees "You're getting N · Change" and **no** second claim button. The approved 3b share board drew a "Get the last one too" button beside the strip. It's dropped: a second claim by the same person would make "Change" ambiguous, and the manage page already raises a claim (up to remaining + current). Ted is told this at the checkpoint.
7. **`localStorage` can fail** (private windows, blocked storage, quota). Every read and write is wrapped: a failed read is an empty list, a failed write is ignored. The claim still works, and the sheet still shows the manage link, which is the source of truth (spec §7).
8. **Reconciling the strips.** On mount, the share page drops records whose `claimId` matches no `item.claims[].id` on an item that's on the page, and resolves each pending record for an item on the page with `GET /claims/:token` (200 fills in `claimId`; 404 drops it; anything else leaves it for next time). Records for items not on this page are left alone: they may belong to another list.
9. **`/s` and `/c` render per request,** like every page (the root layout calls `connection()`). The share page's title is the list's title, fetched once per request through React's `cache()`, so `generateMetadata` and the page share one API call.
10. **A share token that isn't 22 base64url characters** never reaches the API: the page calls `notFound()` at once. The API's answers that mean "no such list" (`404` of any code, and the router's `400` for an undecodable escape) also call `notFound()`. Anything else is thrown to `error.tsx`.
11. **The owner's own link** gets `SiteHeader action="list"`, a new variant whose link is "Edit your list" (to `/list`). Gifters get `action="none"`.
12. **Turning the spoiler toggle on** sets `showClaimsToOwner: true` in the cached list and invalidates it, so `/list` fetches the claims when it next mounts. **Turning it off** strips `remaining` and `claims` from every cached item and sets the flag false, *before* the PATCH is sent; a failed PATCH invalidates the list (the server still has it on, so the refetch brings the claims back, which is correct).
13. **Item writes and claim fields (fix a).** With the owner opted in, `replaceItem` keeps the cached item's `claims` and recomputes `remaining` from the new quantity, and `appendItem` gives a new item `claims: []` and `remaining: quantity`. Opted out, both behave exactly as today.
14. **A list change that fails off-page** sets a flag in a small module store, but only while the editor isn't mounted. `AccountHeader` on `/settings` shows it; the editor clears it when it mounts.
15. **Turnstile's failures are shown in the widget's box:** a script that never loads ("We couldn't load the security check. If you use a content blocker, allow hanker.dev, or try another browser.") and a widget error ("The check didn't work. Reload the page to try again."). A token clears both. The widget-error path has no automated test: Cloudflare's always-failing test key would have to be built into the web app. The executor ledgers this.

## Review Focus

The input classes the spec implies but no requirement names, most likely to bite a person first. Each has a test in the task named.

1. **A gifter on a phone taps "Claim it" twice, or the answer is lost.** One claim results, never two, and the gifter ends up holding its manage link. Task 2 (replay and the double tap at the API), Task 4 (double tap, lost response then Try again, lost response then reload).
2. **Storage that throws or is empty:** a private window, or a second device. Claiming still works and shows the manage link; the share page renders without strips. Task 4 (the storage wrapper's unit test, and an E2E claim with `localStorage` disabled).
3. **The list changes under an open sheet:** the owner rotates the link, deletes the item, or someone else claims the last one. The sheet says which, and the page reloads to the truth; never a 500 page, never a stuck sheet. Task 4.
4. **Long names and titles on a 390 px phone:** a 200-character title, a 50-character claimer name, a long shop host. Nothing scrolls sideways, and every page passes axe. Tasks 3, 4 and 5.
5. **The owner opens their own link while signed in, with the toggle off.** Nothing on the page, in its HTML, or in the browser's storage says who claimed what. Task 3 (the page's HTML holds no claimer's name), Task 6 (toggle off strips the cache).

## Stacks and order

One stack, started on `docs/plan-4b` (initialized, not submitted). One layer per reviewable concern; seven layers stay under Neon's preview cap.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-4b` | the spec amendments (`985cf4e`) and this plan |
| `api/claim-replay` | 1, 2 |
| `web/share-page` | 3 |
| `web/claim-sheet` | 4 |
| `web/manage-claim` | 5 |
| `web/owner-claims` | 6 |
| `web/go-live-fixes` | 7, 8, 9 |

Then Task 10 is a ⏸ checkpoint: the final review, Ted's approval for the first submit, his pass on the preview, his merge, production verified, then Ted sets the Turnstile secret and sign-up opens.

The first task in each layer starts with `gh stack add <branch>`. Nothing is pushed until Task 10.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/claims.ts` | `manageToken?` on a claim request; `remainingOf` |
| `packages/contracts/src/error-codes.ts` | `MANAGE_TOKEN_IN_USE` |
| `packages/contracts/src/text.ts` | Blank letters (D44) |
| `apps/api/src/claims/claims.service.ts` | Replay (D42), check order (D43) |
| `apps/api/src/claims/claims-errors.ts` | `manageTokenInUse` |
| `apps/api/src/claims/remaining.ts` | Uses `remainingOf` from contracts |
| `apps/api/src/db/pg-errors.ts` (new) | `isUniqueViolation` |
| `apps/api/src/http/problem.ts` | `no-store` on every problem |
| `apps/web/src/lib/share-copy.ts` (new) | Every sentence the share page, sheet and manage page build from claim numbers, pure |
| `apps/web/src/lib/shared-list.server.ts` (new) | `loadSharedList`, `loadClaim`: server reads, `notFound()` on a dead link |
| `apps/web/src/app/s/[shareToken]/page.tsx`, `not-found.tsx` (new) | The share page and the dead-link page |
| `apps/web/src/components/share/*` (new) | Cards, the owner note, the sheet, the strips, the provider |
| `apps/web/src/components/ui/sheet.tsx` (new) | A Radix Dialog shaped as a bottom sheet |
| `apps/web/src/lib/manage-token.ts` (new) | `mintManageToken` |
| `apps/web/src/lib/claim-records.ts` (new) | The `hanker:claims` records: pure reconciliation plus a guarded storage wrapper |
| `apps/web/src/app/c/[manageToken]/page.tsx`, `not-found.tsx` (new) | The manage page and the gone page |
| `apps/web/src/components/manage/*` (new) | The manage form, cancel, the cancelled screen |
| `apps/web/src/components/account/claims-card.tsx` (new) | The spoiler toggle |
| `apps/web/src/lib/list-cache.ts` | `replaceItem`/`appendItem` keep claims; `stripClaims` |
| `apps/web/src/lib/editor-claims.ts` (new) | The editor's claim line, pure |
| `apps/web/src/components/list/item-row.tsx`, `list-editor.tsx` | The claim line; the "You can see" note |
| `apps/web/src/components/query-provider.tsx` | `invalidateCachedList`; the mutation cache's off-page failure |
| `apps/web/src/lib/off-page-failure.ts` (new) | The flag a failed off-page change sets |
| `apps/web/src/components/turnstile.tsx`, `auth/signup-form.tsx`, `auth/email-link-form.tsx` | D38's two fixes |
| `apps/web/src/lib/api-client.ts` | `{}` on bodiless writes |
| `apps/web/next.config.ts`, `src/app/robots.ts` | Token-page headers and robots |
| `e2e/support/share.ts` (new) | Share-link and claim helpers |
| `e2e/tests/local/share.spec.ts`, `claim.spec.ts`, `manage.spec.ts`, `owner-claims.spec.ts`, `go-live.spec.ts` (new) | E2E |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use                                            # Node 24
pnpm --filter @wishlist/contracts test                                     # contracts unit tests
pnpm --filter @wishlist/contracts build                                    # after a contracts change, before API or web tests
pnpm --filter @wishlist/api exec vitest run --project unit <file-or-name>  # one API unit test file
pnpm --filter @wishlist/api exec vitest run --project integration <name>   # one integration file (Docker)
pnpm --filter @wishlist/web exec vitest run <file>                         # one web unit test file
pnpm test:e2e -- tests/local/<file>.spec.ts                                # one E2E file (Docker; builds first)
```

Integration tests on this machine need `DOCKER_HOST=unix:///home/tarmstrong/.docker/desktop/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (see `docs/development.md`). If Docker Desktop isn't running, start it with `systemctl --user start docker-desktop`; never stop or restart a container this repo didn't create.

The full gate, run at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
pnpm test:e2e
```

---

### Task 1: The contracts: a client's manage token, `remainingOf`, and blank letters (D42, D44)

**Files:**
- Modify: `packages/contracts/src/claims.ts`
- Modify: `packages/contracts/src/error-codes.ts`
- Modify: `packages/contracts/src/text.ts:9-15`
- Modify: `packages/contracts/src/claims.spec.ts`, `packages/contracts/src/auth.spec.ts`
- Modify: `apps/api/src/claims/remaining.ts`

**Interfaces:**
- Produces (from `@wishlist/contracts`):
  - `CreateClaimRequestSchema` gains `manageToken?: string` (matches `CAPABILITY_TOKEN_PATTERN`)
  - `remainingOf(quantity: number, claimed: number): number`
  - `ErrorCode.MANAGE_TOKEN_IN_USE`
- `apps/api/src/claims/remaining.ts` keeps exporting `remainingOf` (re-exported from contracts), `fitsNewClaim`, `fitsChangedClaim`, so no API import changes.

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/claim-replay
```

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/src/claims.spec.ts`, add `remainingOf` to the import from `./claims.js`, then add inside `describe('CreateClaimRequestSchema (spec §5)', …)`:

```ts
  it('takes the manage token the claim sheet minted (D42)', () => {
    expect(
      CreateClaimRequestSchema.parse({ claimerName: 'Sue', manageToken: TOKEN }),
    ).toEqual({ claimerName: 'Sue', quantity: 1, manageToken: TOKEN });
    expect(CreateClaimRequestSchema.parse({ claimerName: 'Sue' })).not.toHaveProperty(
      'manageToken',
    );
  });

  it.each(['', 'short', `${TOKEN}x`, 'abcdefghijklmnopqrst+/'])(
    'refuses a manage token that is not 22 base64url characters: %j',
    (manageToken) => {
      expect(CreateClaimRequestSchema.safeParse({ claimerName: 'Sue', manageToken }).success).toBe(
        false,
      );
    },
  );
```

and a new block at the end of the file:

```ts
describe('remainingOf (spec §2)', () => {
  it('is what the owner wants less what is claimed, never below 0', () => {
    expect(remainingOf(3, 1)).toBe(2);
    expect(remainingOf(2, 2)).toBe(0);
    expect(remainingOf(1, 3)).toBe(0);
  });
});
```

`TOKEN` is already defined at the top of `claims.spec.ts`; if it isn't, define `const TOKEN = 'abcdefghijklmnopqrstuv';`.

In `packages/contracts/src/auth.spec.ts`, extend the `it.each` table of "refuses a name that draws nothing" with:

```ts
    ['variation selectors', '️︎'],
    ['a Mongolian free variation selector', '᠋'],
    ['a Hangul filler with a variation selector', 'ㅤ️'],
    ['a variation selector in spaces', ' ️ '],
```

and extend the "keeps %j as typed" list from `['Adaㅤ', '⠀Ada']` to:

```ts
  it.each(['Adaㅤ', '⠀Ada', '❤️', '❤️ Ada', 'Ada️'])(
```

(A red heart with its emoji selector draws a heart; the selector beside it is kept as typed.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL. `remainingOf` is not exported; the `manageToken` cases fail (the key is stripped, and bad tokens pass); the four variation-selector names are accepted.

- [ ] **Step 3: Implement**

In `packages/contracts/src/claims.ts`, replace `CreateClaimRequestSchema`:

```ts
export const CreateClaimRequestSchema = z.object({
  claimerName: ClaimerNameSchema,
  quantity: QuantitySchema.default(1),
  /**
   * The claim sheet's own manage token (D42). Sent again, it finds the claim it already made, so a
   * response lost on a bad connection costs nothing. Without it, the API mints one.
   */
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN).optional(),
});
```

Change the `CreateClaimResponseSchema` doc comment to:

```ts
/** `201` from `POST …/claims`: the claim's manage token, the sheet's own or one the API minted (D42). */
```

and add, after `ClaimConflictProblemSchema`:

```ts
/**
 * How many of an item are still wanted (spec §2): what the owner wants less what's claimed. Never
 * stored, and never below 0, because an owner may lower a quantity below what's claimed (D19).
 */
export function remainingOf(quantity: number, claimed: number): number {
  return Math.max(0, quantity - claimed);
}
```

In `packages/contracts/src/error-codes.ts`, after `SHARE_LINK_NOT_FOUND`:

```ts
  /** 409: a claim sent a manage token that belongs to a claim on another item (D42). */
  MANAGE_TOKEN_IN_USE: 'MANAGE_TOKEN_IN_USE',
```

In `packages/contracts/src/text.ts`, replace the `BLANK_LETTERS` comment and constant:

```ts
/**
 * Characters that draw nothing (D41, widened by D44): every default-ignorable code point (the
 * Hangul fillers, U+034F, the Khmer inherent vowels, the variation selectors, the joiners) and the
 * Braille blank, which isn't default-ignorable but shows as a space. HIDDEN_CHARACTERS lets the
 * letters and marks among them through, so a name made only of them would still show as blank.
 */
const BLANK_LETTERS = /[\p{Default_Ignorable_Code_Point}⠀]/gu;
```

In `apps/api/src/claims/remaining.ts`, delete the local `remainingOf` function and its comment, and put at the top of the file:

```ts
import { remainingOf } from '@wishlist/contracts';

// The formula lives in contracts, so the editor recomputes it the same way (Plan 4b rule 13).
export { remainingOf };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @wishlist/contracts test
pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/api exec vitest run --project unit remaining projection
```
Expected: all PASS. The API's `remaining.spec.ts` and `projection.spec.ts` pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src apps/api/src/claims/remaining.ts
git commit -m "feat(contracts): take the claim sheet's manage token, share remainingOf, widen blank letters

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 2: Replaying a claim (D42), the owner before the list's limit (D43), and `no-store` on every problem

**Files:**
- Create: `apps/api/src/db/pg-errors.ts`, `apps/api/src/db/pg-errors.spec.ts`
- Modify: `apps/api/src/claims/claims-errors.ts`
- Modify: `apps/api/src/claims/claims.service.ts:43-99` (`create`)
- Modify: `apps/api/src/http/problem.ts:53-55` (`sendProblem`)
- Modify: `apps/api/src/http/http-pipeline.spec.ts`
- Modify: `apps/api/test/claims.int-spec.ts`

**Interfaces:**
- Consumes: Task 1's `CreateClaimRequest.manageToken`, `ErrorCode.MANAGE_TOKEN_IN_USE`.
- Produces: `isUniqueViolation(error: unknown, constraint: string): boolean`; `manageTokenInUse(): AppError`. `POST …/claims` behaves as spec §5 now says.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/api/src/db/pg-errors.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './pg-errors.js';

const pg = (code: string, constraint?: string) =>
  Object.assign(new Error('duplicate key'), { code, constraint });

describe('isUniqueViolation', () => {
  it('recognizes Postgres’s unique_violation on the named constraint', () => {
    expect(isUniqueViolation(pg('23505', 'claims_manage_token_hash_unique'), 'claims_manage_token_hash_unique')).toBe(true);
  });

  it('looks through the error Drizzle wraps it in', () => {
    const wrapped = new Error('Failed query', {
      cause: pg('23505', 'claims_manage_token_hash_unique'),
    });
    expect(isUniqueViolation(wrapped, 'claims_manage_token_hash_unique')).toBe(true);
  });

  it('ignores another constraint, another code, and things that are not errors', () => {
    expect(isUniqueViolation(pg('23505', 'users_email_unique'), 'claims_manage_token_hash_unique')).toBe(false);
    expect(isUniqueViolation(pg('23503', 'claims_manage_token_hash_unique'), 'claims_manage_token_hash_unique')).toBe(false);
    expect(isUniqueViolation(undefined, 'x')).toBe(false);
    expect(isUniqueViolation('23505', 'x')).toBe(false);
  });
});
```

In `apps/api/src/http/http-pipeline.spec.ts`, add inside `describe('HTTP pipeline', …)`:

```ts
  it('marks every problem no-store, so no cache keeps an error (Plan 4b)', async () => {
    for (const path of ['/api/definitely-not-a-route', '/api/probe/conflict', '/api/probe/crash']) {
      const res = await http(app).get(path);
      expect(res.headers['cache-control'], path).toBe('no-store');
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit pg-errors http-pipeline`
Expected: FAIL. `./pg-errors.js` doesn't exist, and the problems carry no `cache-control`.

- [ ] **Step 3: Implement the helper and the header**

Create `apps/api/src/db/pg-errors.ts`:

```ts
/** Postgres's SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether `error` is a unique_violation on `constraint`. Drizzle wraps the driver's error, keeping
 * it as `cause`, so this looks a few levels down.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint: name, cause } = current as Record<string, unknown>;
    if (code === UNIQUE_VIOLATION && name === constraint) return true;
    current = cause;
  }
  return false;
}
```

In `apps/api/src/http/problem.ts`, replace `sendProblem`:

```ts
/** Every problem is `no-store`: an error, guard refusals and unknown routes included (Plan 4b). */
export function sendProblem(res: Response, problem: Problem): void {
  res
    .status(problem.status)
    .set('Cache-Control', 'no-store')
    .type('application/problem+json')
    .json(problem);
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit pg-errors http-pipeline problem`
Expected: PASS.

- [ ] **Step 4: Write the failing integration tests**

In `apps/api/test/claims.int-spec.ts`, add `CAPABILITY_TOKEN_PATTERN` to the `@wishlist/contracts` import and `newToken` to the `../src/security/tokens.js` import. Add these to `describe('POST /shared/:shareToken/items/:itemId/claims (spec §5)', …)`:

```ts
  it('refuses the owner with 403 even when the list’s claims are used up (D43)', async () => {
    const { token, kettle } = await adasKettle(3);
    const cookie = await logIn(t);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
  });

  it('marks a refused claim no-store, like every problem (Plan 4b)', async () => {
    const { token, kettle } = await adasKettle();
    const res = await http(t.app)
      .post(`/api/shared/${token}/items/${kettle}/claims`)
      .send({ claimerName: 'Sue' });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
  });
```

and a new block after that `describe`:

```ts
describe('replaying a claim with the sheet’s own manage token (D42)', () => {
  it('claims with the token the sheet sent, and keeps only its hash', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    const res = await claim(token, kettle, { claimerName: 'Sue', manageToken });
    expect(res.status).toBe(201);
    const body = CreateClaimResponseSchema.parse(res.body);
    expect(body.manageToken).toBe(manageToken);
    expect(body.manageUrl).toBe(`http://localhost:3000/c/${manageToken}`);
    const { rows } = await db.pool.query('select manage_token_hash from claims');
    expect(rows).toEqual([{ manage_token_hash: hashToken(manageToken) }]);
  });

  it('returns the same claim when the token comes back, and writes no second row', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    const first = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue', quantity: 2, manageToken })).body,
    );
    const again = await claim(token, kettle, { claimerName: 'Sue', quantity: 2, manageToken });
    expect(again.status).toBe(201);
    expect(CreateClaimResponseSchema.parse(again.body)).toEqual(first);
    expect(await count('claims')).toBe(1);
    expect(await claimedSum()).toBe(2);
  });

  it('replays the last unit with 201, never a 409 against itself', async () => {
    const { token, kettle } = await adasKettle(1);
    const manageToken = newToken(16);
    expect((await claim(token, kettle, { claimerName: 'Sue', manageToken })).status).toBe(201);
    const again = await claim(token, kettle, { claimerName: 'Sue', manageToken });
    expect(again.status).toBe(201);
    expect(await claimedSum()).toBe(1);
  });

  it('answers a replay with the claim as it is now, whatever the replay asked for', async () => {
    const { token, kettle } = await adasKettle(3);
    const manageToken = newToken(16);
    await claim(token, kettle, { claimerName: 'Sue', manageToken });
    await client(t.app).patch(`/claims/${manageToken}`, { claimerName: 'Aunt Sue', quantity: 2 });
    const again = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue', quantity: 1, manageToken })).body,
    );
    expect(again.claim).toMatchObject({ claimerName: 'Aunt Sue', quantity: 2 });
  });

  it('lets a double tap through once: both answers are the one claim', async () => {
    const { token, kettle } = await adasKettle(1);
    const manageToken = newToken(16);
    const [a, b] = await Promise.all([
      claim(token, kettle, { claimerName: 'Sue', manageToken }),
      claim(token, kettle, { claimerName: 'Sue', manageToken }),
    ]);
    expect([a?.status, b?.status]).toEqual([201, 201]);
    expect(CreateClaimResponseSchema.parse(a?.body).claim.id).toBe(
      CreateClaimResponseSchema.parse(b?.body).claim.id,
    );
    expect(await count('claims')).toBe(1);
  });

  it('refuses a token that belongs to a claim on another item', async () => {
    const { token, kettle } = await adasKettle(3);
    const socks = await seedItem(db, ADA.email, 'Socks', 3);
    const manageToken = newToken(16);
    await claim(token, kettle, { claimerName: 'Sue', manageToken });
    const res = await claim(token, socks, { claimerName: 'Sue', manageToken });
    expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.MANAGE_TOKEN_IN_USE]);
    expect(JSON.stringify(res.body)).not.toContain(manageToken);
    expect(await count('claims')).toBe(1);
  });

  // Two items claimed at once with one token take different row locks, so the lookup can't see
  // the other's uncommitted row. The unique index catches it, and the answer is the same 409.
  it('refuses the same token racing onto another item, through the unique index', async () => {
    const { token, kettle } = await adasKettle(3);
    const socks = await seedItem(db, ADA.email, 'Socks', 3);
    const manageToken = newToken(16);
    const holder = await db.pool.connect();
    try {
      await holder.query('begin');
      await holder.query(
        `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
         values ($1, $2, 'Holder', 1, $3)`,
        [newId(), socks, hashToken(manageToken)],
      );
      const pending = claim(token, kettle, { claimerName: 'Sue', manageToken });
      // Long enough for the claim to reach the unique index and wait on the holder's row.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await holder.query('commit');
      const res = await pending;
      expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.MANAGE_TOKEN_IN_USE]);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect(await count('claims')).toBe(1);
  });

  it('refuses a malformed token in the body with 400 VALIDATION_FAILED', async () => {
    const { token, kettle } = await adasKettle();
    const res = await claim(token, kettle, { claimerName: 'Sue', manageToken: 'short' });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('mints a token that fits the pattern when the sheet sends none', async () => {
    const { token, kettle } = await adasKettle();
    const body = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue' })).body,
    );
    expect(body.manageToken).toMatch(CAPABILITY_TOKEN_PATTERN);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims.int-spec`
Expected: FAIL. The owner gets `429` (the limit runs first); the API ignores `manageToken` (the first new test's token differs, replays make second rows or `409`s); `MANAGE_TOKEN_IN_USE` is never sent. The `no-store` test passes already, from Step 3.

- [ ] **Step 6: Implement the replay and the order**

In `apps/api/src/claims/claims-errors.ts`, add:

```ts
/** A manage token that belongs to a claim on another item (D42). Says nothing more. */
export const manageTokenInUse = (): AppError =>
  new AppError(409, ErrorCode.MANAGE_TOKEN_IN_USE, 'This claim link is already in use.');
```

In `apps/api/src/claims/claims.service.ts`, add `manageTokenInUse` to the `./claims-errors.js` import, add `import { isUniqueViolation } from '../db/pg-errors.js';`, and replace `create` from its doc comment to the end of the method:

```ts
  /**
   * Claims some of an item on the list behind `shareToken` (spec §5). The checks run in the
   * spec's order: malformed IDs, the IP's limit, the list, the owner (D43), the list's limit, and
   * only then the transaction, so the owner never sees a 409's `remaining` or a 429's hint.
   *
   * A request that sends the manage token of a claim already on this item gets that claim back
   * (D42): the claim sheet replays its token when an answer was lost.
   */
  async create(
    shareToken: string,
    itemId: string,
    input: CreateClaimRequest,
    viewerId: string | null,
    ip: string,
  ): Promise<CreateClaimResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    // Read outside the transaction: a link rotated just after this still gets this one claim,
    // as if it had arrived a moment earlier (Plan 4a rule 3).
    const [list] = await this.db
      .select({ id: wishlists.id, ownerId: wishlists.ownerId })
      .from(wishlists)
      .where(eq(wishlists.shareToken, shareToken));
    if (!list) throw shareLinkNotFound();
    // Before the list's limit (D43): a 429 there would tell the owner gifters have been claiming.
    if (viewerId === list.ownerId) throw ownerCannotClaim();
    await this.limiter.enforce(claimsListKey(list.id), CLAIMS_PER_LIST);

    const manageToken = input.manageToken ?? newToken(16);
    const tokenHash = hashToken(manageToken);
    let claim: Claim;
    try {
      claim = await this.db.transaction(async (tx) => {
        // Spec §6.3: the item's row lock serializes every claim write on it. Only the item is
        // locked, never the list, so the users → wishlists → items order holds.
        const [item] = await tx
          .select({ quantity: items.quantity })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.wishlistId, list.id)))
          .for('update');
        if (!item) throw itemNotFound();
        // After the lock, so a double tap's second request sees the first one's claim: each
        // statement at READ COMMITTED reads what had committed when it began (D42).
        const [existing] = await tx
          .select({ ...CLAIM_COLUMNS, itemId: claims.itemId })
          .from(claims)
          .where(eq(claims.manageTokenHash, tokenHash));
        if (existing) {
          if (existing.itemId !== itemId) throw manageTokenInUse();
          return { id: existing.id, claimerName: existing.claimerName, quantity: existing.quantity };
        }
        const claimed = await claimedTotal(tx, itemId);
        if (!fitsNewClaim(input.quantity, item.quantity, claimed)) {
          throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
        }
        const now = this.clock.now();
        const [row] = await tx
          .insert(claims)
          .values({
            id: newId(),
            itemId,
            claimerName: input.claimerName,
            quantity: input.quantity,
            manageTokenHash: tokenHash,
            createdAt: now,
            updatedAt: now,
          })
          .returning(CLAIM_COLUMNS);
        if (!row) throw new Error('claim insert returned no row');
        return row;
      });
    } catch (error) {
      // The same token claimed on another item at the same moment (Plan 4b rule 3).
      if (isUniqueViolation(error, 'claims_manage_token_hash_unique')) throw manageTokenInUse();
      throw error;
    }
    return { claim, manageToken, manageUrl: manageUrl(this.env.APP_ORIGIN, manageToken) };
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims.int-spec`
Expected: PASS, every test in the file, the 4a tests included.

- [ ] **Step 8: Update the docs this changes**

In `apps/api/test/claims.int-spec.ts`, rename the first test `'claims for a guest, and returns the manage link this once'` to `'claims for a guest, and returns the manage link'` (a replay returns it again now).

In `docs/development.md`, under "Trying the claims API", add a bullet after the one that begins `- Claims and claim edits count against`:

```markdown
- A claim may carry its own `manageToken` (22 base64url characters, D42). Sending it again for the same item returns the claim it made, with `201`, so the claim sheet can retry a claim whose answer was lost.
```

- [ ] **Step 9: Run the layer's gate, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
```
Expected: all green. (E2E is unaffected by this layer; it runs from Task 3 on.)

```bash
git add apps/api packages/contracts docs/development.md
git commit -m "feat(api): replay a claim by its manage token, and refuse the owner before the list's limit

D42: the claim sheet may send its own manage token, and the same token for the same item returns
that claim. D43: the owner check runs before the list's rate limit. Every problem is no-store.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 3: The share page, the owner's view, and the dead link

**Files:**
- Create: `apps/web/src/lib/share-copy.ts`, `apps/web/src/lib/share-copy.spec.ts`
- Create: `apps/web/src/lib/shared-list.server.ts`
- Create: `apps/web/src/app/s/[shareToken]/page.tsx`, `apps/web/src/app/s/[shareToken]/not-found.tsx`
- Create: `apps/web/src/components/share/share-page.tsx`, `share-card.tsx`, `card-photo.tsx`, `card-status.tsx`, `owner-note.tsx`
- Modify: `apps/web/src/components/list/icons.tsx` (add `CheckIcon`, `ExternalIcon`, `EyeOffIcon`)
- Modify: `apps/web/src/components/site-header.tsx` (an `action="list"` variant)
- Modify: `apps/web/next.config.ts:64-71`, `apps/web/next.config.spec.ts`, `apps/web/src/app/robots.ts`
- Create: `e2e/support/share.ts`, `e2e/tests/local/share.spec.ts`

**Interfaces:**
- Consumes: `SharedWishlistResponseSchema`, `ClaimDetailsResponseSchema`, `CAPABILITY_TOKEN_PATTERN`, `remainingOf` from contracts.
- Produces:
  - `share-copy.ts`: `joinNames(names: readonly string[]): string`; `ownerSeesLine(owner: string, ownerSeesClaims: boolean): string`; `interface ItemClaims { wants: string; quantity: number; claims?: readonly Claim[]; ownIds?: ReadonlySet<string> }`; `mineOf(item: ItemClaims): number`; `isTaken(item: ItemClaims): boolean`; `countLine(item: ItemClaims): string | null`; `takenLine(item: ItemClaims): string`.
  - `shared-list.server.ts`: `loadSharedList(shareToken: string): Promise<SharedWishlistResponse>`, `loadClaim(manageToken: string): Promise<ClaimDetailsResponse>`. Both call `notFound()` for a dead link; both are wrapped in React's `cache()`.
  - `ShareCard({ item, footer })` and `ItemCardBody({ item, footer })` (the card's inside, reused by `/c`); `CardStatus({ status }: { status: ItemClaims })`; `SharePage({ list, shareToken })`.
  - Icons `CheckIcon`, `ExternalIcon`, `EyeOffIcon`.
  - `SiteHeader action="list"`.
  - E2E: `shareTokenOf(request)`, `guest(browser, baseURL)`, `claimViaApi(request, baseURL, shareToken, itemId, body)`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add web/share-page
```

- [ ] **Step 1: Write the failing unit tests**

Create `apps/web/src/lib/share-copy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  countLine,
  isTaken,
  joinNames,
  mineOf,
  ownerSeesLine,
  takenLine,
  type ItemClaims,
} from './share-copy';

const claim = (id: string, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`,
  claimerName,
  quantity,
});
const SUE = claim('01', 'Aunt Sue');
const SAM = claim('02', 'Sam');
const PRIYA = claim('03', 'Priya');
const gifter = (extra: Partial<ItemClaims>): ItemClaims => ({ wants: 'Ada wants', quantity: 1, ...extra });

describe('share page copy', () => {
  it('joins names the way people say them', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Sue'])).toBe('Sue');
    expect(joinNames(['Sue', 'Sam'])).toBe('Sue and Sam');
    expect(joinNames(['Sue', 'Sam', 'Jo'])).toBe('Sue, Sam and Jo');
  });

  it('tells gifters which way the owner’s setting is (D40)', () => {
    expect(ownerSeesLine('Ada', false)).toBe(
      'Ada can’t see who’s getting what, so the surprise is safe.',
    );
    expect(ownerSeesLine('Ada', true)).toBe('Ada can see who’s getting what.');
  });

  it('says nothing about one unclaimed item, and how many are wanted when it’s more', () => {
    expect(countLine(gifter({ claims: [] }))).toBeNull();
    expect(countLine(gifter({ quantity: 3, claims: [] }))).toBe('Ada wants 3.');
    expect(countLine({ wants: 'You want', quantity: 3 })).toBe('You want 3.');
  });

  it('says who is getting some, and how many are left', () => {
    expect(countLine(gifter({ quantity: 3, claims: [SAM] }))).toBe(
      'Ada wants 3. Sam is getting 1, so 2 are left.',
    );
    expect(countLine(gifter({ quantity: 4, claims: [SAM, claim('04', 'Jo', 2)] }))).toBe(
      'Ada wants 4. Sam is getting 1 and Jo is getting 2, so 1 is left.',
    );
  });

  it('calls this browser’s own claim “you”', () => {
    const item = gifter({ quantity: 3, claims: [SAM, PRIYA], ownIds: new Set([PRIYA.id]) });
    expect(countLine(item)).toBe('Ada wants 3. Sam is getting 1 and you’re getting 1, so 1 is left.');
    expect(mineOf(item)).toBe(1);
    expect(countLine(gifter({ quantity: 3, claims: [PRIYA], ownIds: new Set([PRIYA.id]) }))).toBe(
      'Ada wants 3. You’re getting 1, so 2 are left.',
    );
  });

  it('has no count line once nothing is left, and says who is getting it', () => {
    const taken = gifter({ claims: [SUE] });
    expect(isTaken(taken)).toBe(true);
    expect(countLine(taken)).toBeNull();
    expect(takenLine(taken)).toBe('Taken care of: Aunt Sue is getting this');
    expect(takenLine(gifter({ quantity: 2, claims: [SUE, SAM] }))).toBe(
      'Taken care of: Aunt Sue and Sam are getting this',
    );
    // One person's two claims are one name.
    expect(takenLine(gifter({ quantity: 2, claims: [SAM, claim('05', 'Sam')] }))).toBe(
      'Taken care of: Sam is getting this',
    );
  });

  it('counts an owner who wanted fewer than were claimed as taken (D19)', () => {
    expect(isTaken(gifter({ quantity: 1, claims: [claim('06', 'Sam', 3)] }))).toBe(true);
  });

  it('never calls an item taken when the viewer may not see claims (spec §5.1)', () => {
    expect(isTaken({ wants: 'You want', quantity: 1 })).toBe(false);
    expect(mineOf({ wants: 'You want', quantity: 1 })).toBe(0);
  });
});
```

In `apps/web/next.config.spec.ts`, change the token-page test's loop to:

```ts
    for (const source of [
      '/verify-email',
      '/reset-password/confirm',
      '/s/:shareToken',
      '/c/:manageToken',
    ]) {
```

and rename the test to `'keeps tokens out of Referer and search on the token pages (spec §6.7)'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/share-copy.spec.ts next.config.spec.ts`
Expected: FAIL. `./share-copy` doesn't exist, and `/s/:shareToken` has no header rule.

- [ ] **Step 3: Implement the copy, the headers and robots**

Create `apps/web/src/lib/share-copy.ts`:

```ts
import { remainingOf, type Claim } from '@wishlist/contracts';

// The sentences the share page builds from claim numbers (spec §7, the Plan 4b mockups). Pure, so
// the server render and the browser say the same thing.

/** "Sue", "Sue and Sam", "Sue, Sam and Jo". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const isAre = (count: number) => (count === 1 ? 'is' : 'are');
const total = (claims: readonly Claim[]) => claims.reduce((sum, claim) => sum + claim.quantity, 0);

/** What gifters are told about the owner's spoiler setting (D40). */
export function ownerSeesLine(owner: string, ownerSeesClaims: boolean): string {
  return ownerSeesClaims
    ? `${owner} can see who’s getting what.`
    : `${owner} can’t see who’s getting what, so the surprise is safe.`;
}

/** An item's claims as one viewer sees them. */
export interface ItemClaims {
  /** "Ada wants" for gifters, "You want" for the owner. */
  wants: string;
  quantity: number;
  /** Absent when the viewer may not see claims (spec §5.1). */
  claims?: readonly Claim[];
  /** The claims this browser made (D45). */
  ownIds?: ReadonlySet<string>;
}

/** How many this browser is getting. */
export function mineOf({ claims = [], ownIds }: ItemClaims): number {
  return total(claims.filter((claim) => ownIds?.has(claim.id)));
}

/** Whether nothing is left to claim. Claims the viewer may not see never make an item taken. */
export function isTaken({ quantity, claims }: ItemClaims): boolean {
  return claims !== undefined && remainingOf(quantity, total(claims)) === 0;
}

/**
 * The line on an item that's still wanted: how many, who is getting some, and how many are left.
 * Null when there's nothing worth saying (one wanted and nobody has claimed it) or nothing is left.
 */
export function countLine(item: ItemClaims): string | null {
  const { wants, quantity, claims = [], ownIds } = item;
  const want = quantity > 1 ? `${wants} ${quantity}.` : null;
  if (claims.length === 0) return want;
  const remaining = remainingOf(quantity, total(claims));
  if (remaining === 0) return null;
  const parts = claims
    .filter((claim) => !ownIds?.has(claim.id))
    .map((claim) => `${claim.claimerName} is getting ${claim.quantity}`);
  const mine = mineOf(item);
  if (mine > 0) parts.push(`you’re getting ${mine}`);
  const who = `${capitalize(joinNames(parts))}, so ${remaining} ${isAre(remaining)} left.`;
  return want ? `${want} ${who}` : who;
}

/** The line on an item nobody can claim any more: who is getting it. */
export function takenLine({ claims = [] }: ItemClaims): string {
  const names = [...new Set(claims.map((claim) => claim.claimerName))];
  return `Taken care of: ${joinNames(names)} ${isAre(names.length)} getting this`;
}
```

In `apps/web/next.config.ts`, replace the token-page block:

```ts
      // Token pages (spec §6.7): no Referer can carry the token, and search engines skip them.
      ...['/verify-email', '/reset-password/confirm', '/s/:shareToken', '/c/:manageToken'].map(
        (source) => ({
          source,
          headers: [
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'X-Robots-Tag', value: 'noindex' },
          ],
        }),
      ),
```

Replace `apps/web/src/app/robots.ts`'s body:

```ts
import type { MetadataRoute } from 'next';

/** The token and account pages stay out of search (spec §6.7). /login and /signup are not listed. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: ['/verify-email', '/reset-password', '/list', '/settings', '/s/', '/c/'],
    },
  };
}
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/share-copy.spec.ts next.config.spec.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing E2E tests**

Create `e2e/support/share.ts`:

```ts
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import type {
  CreateClaimRequest,
  CreateClaimResponse,
  WishlistResponse,
} from '@wishlist/contracts';

/** The share token of the signed-in owner's list, from `GET /wishlist`. */
export async function shareTokenOf(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/wishlist');
  expect(res.status()).toBe(200);
  const { shareUrl } = (await res.json()) as WishlistResponse;
  const token = shareUrl.split('/s/')[1];
  if (!token) throw new Error(`no token in ${shareUrl}`);
  return token;
}

/** A browser with no session: someone the owner sent the link to. */
export function guest(browser: Browser, baseURL: string): Promise<BrowserContext> {
  return browser.newContext({ baseURL });
}

/** Claims through the API, as a gifter's browser would. */
export async function claimViaApi(
  request: APIRequestContext,
  baseURL: string,
  shareToken: string,
  itemId: string,
  body: Partial<CreateClaimRequest> & { claimerName: string },
): Promise<CreateClaimResponse> {
  const res = await request.post(`/api/shared/${shareToken}/items/${itemId}/claims`, {
    headers: { origin: baseURL },
    data: body,
  });
  if (res.status() !== 201) throw new Error(`claim answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as CreateClaimResponse;
}
```

Create `e2e/tests/local/share.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

test('a gifter sees the list, who is getting what, and that Ada can’t see it (spec §7, D40)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-read');
  const kettle = await addItemViaApi(page.request, base, {
    title: 'Enamel stovetop kettle',
    url: 'https://www.hearthware.example/kettle',
    priceText: '$48.00',
  });
  const socks = await addItemViaApi(page.request, base, {
    title: 'Merino hiking socks',
    quantity: 3,
    note: 'Size M. Any colour but white.',
  });
  await addItemViaApi(page.request, base, { title: 'Pottery class for two' });
  const token = await shareTokenOf(page.request);
  const others = await guest(browser, base);
  await claimViaApi(others.request, base, token, kettle.id, { claimerName: 'Aunt Sue' });
  await claimViaApi(others.request, base, token, socks.id, { claimerName: 'Sam' });

  const gifter = await (await guest(browser, base)).newPage();
  const res = await gifter.goto(`/s/${token}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(gifter).toHaveTitle("Ada's wishlist | Hanker");
  await expect(gifter.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await expect(
    gifter.getByText('Ada can’t see who’s getting what, so the surprise is safe.'),
  ).toBeVisible();
  const cards = gifter
    .getByRole('list', { name: 'Ada’s items, most wanted first' })
    .getByRole('listitem');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Taken care of: Aunt Sue is getting this');
  await expect(cards.nth(1)).toContainText('Ada wants 3. Sam is getting 1, so 2 are left.');
  await expect(cards.nth(1)).toContainText('Size M. Any colour but white.');
  await expect(cards.nth(2)).toContainText('An idea');
  await expect(
    cards.nth(0).getByRole('link', { name: 'See it at hearthware.example' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  await expectAccessible(gifter);
});

test('the owner on their own link sees no claim, no claimer, and a way back (spec §2, Review Focus 5)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-owner');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });

  await page.goto(`/s/${token}`);
  await expect(
    page.getByText('Claims are hidden from you, so nothing’s spoiled.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit your list' })).toHaveAttribute('href', '/list');
  await expect(page.getByText('Taken care of')).toHaveCount(0);
  // Not in the page, nor in the data the page was rendered from.
  expect(await page.content()).not.toContain('Aunt Sue');
  await expectAccessible(page);
});

test('a replaced, unknown or mangled link gets the dead-link page with a 404 (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-dead');
  const token = await shareTokenOf(page.request);
  const rotated = await page.request.post('/api/wishlist/share-token/rotate', {
    headers: { origin: base },
    data: {},
  });
  expect(rotated.status()).toBe(200);

  const visitor = await (await guest(browser, base)).newPage();
  for (const path of [`/s/${token}`, '/s/abcdefghijklmnopqrstuv', '/s/not-a-token', `/s/${token}.`]) {
    const res = await visitor.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      visitor.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
    ).toBeVisible();
  }
  await expect(
    visitor.getByText('If you claimed something, the link you saved for your claim still works.'),
  ).toBeVisible();
  await expectAccessible(visitor);
});

test('long titles, names and shops fit a phone (Review Focus 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-long');
  const renamed = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { title: 'W'.repeat(100) },
  });
  expect(renamed.status()).toBe(200);
  const socks = await addItemViaApi(page.request, base, {
    title: 'Extraordinarily'.repeat(14).slice(0, 200),
    url: 'https://www.a-very-long-shop-name-that-keeps-going-for-testing.example/item',
    priceText: '$'.padEnd(50, '9'),
    quantity: 3,
  });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, socks.id, {
    claimerName: 'Bartholomew'.repeat(5).slice(0, 50),
  });

  const gifter = await (await guest(browser, base)).newPage();
  await expectFitsPhone(gifter, `/s/${token}`);
  await expectAccessible(gifter);
});
```

Run: `pnpm test:e2e -- tests/local/share.spec.ts`
Expected: FAIL. `/s/…` is the generic 404 page.

- [ ] **Step 5: Add the icons and the header variant**

In `apps/web/src/components/list/icons.tsx`, add:

```tsx
export const CheckIcon = () => (
  <Icon>
    <path d="M5 10.5 8.5 14 15 6.5" />
  </Icon>
);
export const ExternalIcon = () => (
  <Icon>
    <path d="M7 13 15 5M8 5h7v7" />
  </Icon>
);
export const EyeOffIcon = () => (
  <Icon>
    <path d="M3 3l14 14M8.2 5.3A8 8 0 0 1 10 5c4.5 0 7.5 5 7.5 5a14 14 0 0 1-2 2.6M5.6 7A13 13 0 0 0 2.5 10s3 5 7.5 5a7.6 7.6 0 0 0 3.3-.8M8.6 8.6a2 2 0 0 0 2.8 2.8" />
  </Icon>
);
```

In `apps/web/src/components/site-header.tsx`, widen the prop to `action?: 'login' | 'signup' | 'list' | 'none'`, change the doc comment to `/** The header outside the account pages: the wordmark, and the one link the page needs. */`, and add before `</header>`:

```tsx
      {action === 'list' ? (
        <Link href="/list" className={LINK}>
          Edit your list
        </Link>
      ) : null}
```

- [ ] **Step 6: Add the server reads**

Create `apps/web/src/lib/shared-list.server.ts`:

```ts
import 'server-only';
import {
  CAPABILITY_TOKEN_PATTERN,
  ClaimDetailsResponseSchema,
  SharedWishlistResponseSchema,
  type ClaimDetailsResponse,
  type SharedWishlistResponse,
} from '@wishlist/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * No such list or claim: any 404, and the router's 400 for an undecodable escape (Plan 4a's ruling
 * on Task 3). Anything else is a real failure, for error.tsx.
 */
function isDeadLink(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

/**
 * The list behind a share link, as this visitor may see it (spec §5.1). The cookie is forwarded,
 * so the API knows the owner. One call per request: the page and its metadata share it.
 */
export const loadSharedList = cache(async (shareToken: string): Promise<SharedWishlistResponse> => {
  // A token that can't be one never reaches the API (Plan 4b rule 10).
  if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) notFound();
  try {
    return await (await serverApi()).get(`/shared/${shareToken}`, SharedWishlistResponseSchema);
  } catch (error) {
    if (isDeadLink(error)) notFound();
    throw error;
  }
});

/** A claim, by its manage link (spec §5): the claimer's own view. */
export const loadClaim = cache(async (manageToken: string): Promise<ClaimDetailsResponse> => {
  if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) notFound();
  try {
    return await (await serverApi()).get(`/claims/${manageToken}`, ClaimDetailsResponseSchema);
  } catch (error) {
    if (isDeadLink(error)) notFound();
    throw error;
  }
});
```

- [ ] **Step 7: Build the cards and the page**

Create `apps/web/src/components/share/card-photo.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';

/** A card's photo, full width. One that won't load is left out (Plan 3b rule 10). */
export function CardPhoto({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  // An image that failed before hydration never fires onError; catch it as the element attaches.
  const catchEarlyFailure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- photos come from any https host; next/image would fetch them through our server, which spec §2 rules out.
    <img
      ref={catchEarlyFailure}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-[150px] w-full bg-placeholder object-cover"
    />
  );
}
```

Create `apps/web/src/components/share/share-card.tsx`:

```tsx
import type { SharedItem } from '@wishlist/contracts';
import type { ReactNode } from 'react';
import { ExternalIcon, IdeaIcon } from '@/components/list/icons';
import { shopName } from '@/lib/item-display';
import { cn } from '@/lib/utils';
import { CardPhoto } from './card-photo';

type CardItem = Pick<SharedItem, 'id' | 'title' | 'url' | 'imageUrl' | 'priceText' | 'note'>;

export const CARD = 'overflow-hidden rounded-card border border-border bg-card';

/**
 * What a card shows of an item: photo, title, price, the shop's link, the owner's note. The share
 * page and the manage page both use it. The title takes focus when the claim sheet closes and its
 * button is gone (Plan 4b, Task 4).
 */
export function ItemCardBody({ item, footer }: { item: CardItem; footer?: ReactNode }) {
  const shop = shopName(item.url);
  return (
    <>
      {item.imageUrl ? <CardPhoto src={item.imageUrl} /> : null}
      <div className="p-4">
        {item.url === null ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            <IdeaIcon />
            An idea
          </p>
        ) : null}
        <h2
          id={`item-${item.id}`}
          tabIndex={-1}
          className={cn(
            'text-[17px] leading-snug font-semibold [overflow-wrap:anywhere]',
            item.url === null && 'mt-1.5',
          )}
        >
          {item.title}
        </h2>
        {item.priceText || (item.url && shop) ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] text-muted-foreground">
            {item.priceText ? (
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">
                {item.priceText}
              </span>
            ) : null}
            {item.url && shop ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-0 items-center gap-1 text-foreground underline [overflow-wrap:anywhere]"
              >
                See it at {shop}
                <ExternalIcon />
              </a>
            ) : null}
          </p>
        ) : null}
        {item.note ? (
          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
            {item.note}
          </p>
        ) : null}
        {footer}
      </div>
    </>
  );
}

/** One item on the share page, as the approved share board draws it. */
export function ShareCard({ item, footer }: { item: CardItem; footer: ReactNode }) {
  return (
    <li className={CARD}>
      <ItemCardBody item={item} footer={footer} />
    </li>
  );
}
```

Create `apps/web/src/components/share/card-status.tsx`:

```tsx
import { CheckIcon } from '@/components/list/icons';
import { countLine, isTaken, mineOf, takenLine, type ItemClaims } from '@/lib/share-copy';

/**
 * What a card says about its claims: who has it covered, or how many are left. Rendered on the
 * server for the owner, and inside the gifter's footer in the browser.
 */
export function CardStatus({ status }: { status: ItemClaims }) {
  if (isTaken(status) && mineOf(status) === 0) {
    return (
      <p className="-mx-4 mt-3 -mb-4 flex items-center gap-2 bg-success-wash px-4 py-3 text-[15px] font-medium text-success-foreground">
        <CheckIcon />
        <span className="[overflow-wrap:anywhere]">{takenLine(status)}</span>
      </p>
    );
  }
  const line = countLine(status);
  return line ? (
    <p className="mt-2.5 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
      {line}
    </p>
  ) : null;
}
```

Create `apps/web/src/components/share/owner-note.tsx`:

```tsx
import Link from 'next/link';
import { EyeOffIcon } from '@/components/list/icons';

/** The owner on their own link (spec §2 Spoilers): what they're seeing, and where to change it. */
export function OwnerNote({ ownerSeesClaims }: { ownerSeesClaims: boolean }) {
  return (
    <div
      role="note"
      className="mt-4 flex items-start gap-2.5 rounded-control border border-border bg-card px-3.5 py-3 text-[15px] leading-snug"
    >
      {ownerSeesClaims ? null : <EyeOffIcon />}
      <p>
        This is your list as people you share it with see it.{' '}
        {ownerSeesClaims
          ? 'You’ve chosen to see who’s getting what.'
          : 'Claims are hidden from you, so nothing’s spoiled.'}{' '}
        <Link href="/settings" className="font-medium underline">
          Change this in Settings
        </Link>
        .
      </p>
    </div>
  );
}
```

Create `apps/web/src/components/share/share-page.tsx`:

```tsx
import type { SharedWishlistResponse } from '@wishlist/contracts';
import { ownerSeesLine } from '@/lib/share-copy';
import { CardStatus } from './card-status';
import { OwnerNote } from './owner-note';
import { ShareCard } from './share-card';

const H1 = 'font-display text-[clamp(2.5rem,6vw,4rem)] leading-none [overflow-wrap:anywhere]';

/** The list behind a share link (spec §7): readable before any JavaScript loads. */
export function SharePage({ list }: { list: SharedWishlistResponse; shareToken: string }) {
  const owner = list.ownerDisplayName;
  const wants = list.viewerIsOwner ? 'You want' : `${owner} wants`;
  return (
    <>
      <h1 className={H1}>{list.title}</h1>
      {list.viewerIsOwner ? (
        <OwnerNote ownerSeesClaims={list.ownerSeesClaims} />
      ) : (
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Claim what you’ll give, so nobody else buys it too.{' '}
          {ownerSeesLine(owner, list.ownerSeesClaims)}
        </p>
      )}
      {list.items.length === 0 ? (
        <p className="mt-8 text-[15px] text-muted-foreground">
          {list.viewerIsOwner
            ? 'Your list is empty. What you add shows here.'
            : `${owner} hasn’t added anything yet.`}
        </p>
      ) : (
        <ol
          aria-label={
            list.viewerIsOwner ? 'Your items, most wanted first' : `${owner}’s items, most wanted first`
          }
          className="mt-6 flex flex-col gap-4"
        >
          {list.items.map((item) => (
            <ShareCard
              key={item.id}
              item={item}
              footer={
                <CardStatus
                  status={{
                    wants,
                    quantity: item.quantity,
                    ...(item.claims ? { claims: item.claims } : {}),
                  }}
                />
              }
            />
          ))}
        </ol>
      )}
    </>
  );
}
```

(`shareToken` is in the props for Task 4, which wraps the gifter's cards with it.)

Create `apps/web/src/app/s/[shareToken]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { SharePage } from '@/components/share/share-page';
import { SiteHeader } from '@/components/site-header';
import { loadSharedList } from '@/lib/shared-list.server';

interface Props {
  params: Promise<{ shareToken: string }>;
}

/** The list's own title, never the token (Global Constraints). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const list = await loadSharedList((await params).shareToken);
  return { title: list.title };
}

/** `/s/[shareToken]` (spec §7): the page a share link opens. */
export default async function SharedListPage({ params }: Props) {
  const { shareToken } = await params;
  const list = await loadSharedList(shareToken);
  return (
    <>
      <SiteHeader action={list.viewerIsOwner ? 'list' : 'none'} />
      <main className="mx-auto max-w-[680px] px-4 pt-10 pb-24 sm:px-7">
        <SharePage list={list} shareToken={shareToken} />
      </main>
    </>
  );
}
```

Create `apps/web/src/app/s/[shareToken]/not-found.tsx`:

```tsx
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

/** A share link that's mistyped, unknown, or replaced by a rotation (spec §2, §7). */
export default function ShareLinkNotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <h1 className="font-display text-5xl leading-tight">This list’s link doesn’t work.</h1>
        <p className="mt-4 text-muted-foreground">
          It may be mistyped, or the owner may have made a new link. Ask whoever sent it to you for
          the current one.
        </p>
        <p className="mt-3 text-muted-foreground">
          If you claimed something, the link you saved for your claim still works.
        </p>
        <p className="mt-8">
          <Link href="/" className="inline-flex min-h-11 items-center underline">
            Go to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test:e2e -- tests/local/share.spec.ts`
Expected: PASS, all four.

- [ ] **Step 9: Run the layer's gate, then commit**

Run the full gate from "How to run things". Expected: all green.

```bash
git add apps/web e2e
git commit -m "feat(web): show a shared list, the owner's own view of it, and a page for a dead link

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 4: The claim sheet, the browser's claims, and a lost response (D42, D45)

**Files:**
- Modify: `apps/web/package.json` (add `"@radix-ui/react-dialog": "1.2.0"` to `dependencies`), `pnpm-lock.yaml`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/lib/manage-token.ts`, `apps/web/src/lib/manage-token.spec.ts`
- Create: `apps/web/src/lib/claim-records.ts`, `apps/web/src/lib/claim-records.spec.ts`
- Create: `apps/web/src/lib/use-can-share.ts`; Modify: `apps/web/src/components/list/share-actions.tsx` (import it)
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.spec.ts`
- Modify: `apps/web/src/lib/share-copy.ts`, `apps/web/src/lib/share-copy.spec.ts`
- Modify: `apps/web/src/components/list/quantity-stepper.tsx` (`max` and `hint`)
- Create: `apps/web/src/components/share/share-claims.tsx`, `claim-sheet.tsx`, `claim-done.tsx`, `gifter-footer.tsx`
- Modify: `apps/web/src/components/share/share-page.tsx`
- Create: `e2e/tests/local/claim.spec.ts`

**Interfaces:**
- Consumes: Task 3's `ShareCard`, `CardStatus`, `ItemClaims`, `mineOf`, `isTaken`, `countLine`, `ownerSeesLine`, `EyeOffIcon`, `CheckIcon`; Task 1's `manageToken` on a claim.
- Produces:
  - `mintManageToken(random?: (bytes: Uint8Array) => Uint8Array): string`
  - `claim-records.ts`: `type ClaimRecord = { itemId: string; manageToken: string; claimId?: string | undefined }`; `RECORDS_KEY`, `NAME_KEY`; `parseRecords(raw: string | null): ClaimRecord[]`; `saveRecord(records, record)`; `dropRecord(records, manageToken)`; `pendingTokenFor(records, itemId): string | undefined`; `ownClaimsOn(records, itemId): ClaimRecord[]`; `reconcile(records, items): { kept: ClaimRecord[]; pending: ClaimRecord[] }`; `interface KeyValueStore`; `readRecords(store?)`, `writeRecords(records, store?)` (tells subscribers), `updateRecords(change, store?)`, `recordsSnapshot(store?)`, `subscribeRecords(listener): () => void`, `readClaimerName(store?)`, `writeClaimerName(name, store?)`.
  - `useCanShare(): boolean` from `@/lib/use-can-share`.
  - `messages.ts`: `LAST_ONE_GONE`, `ITEM_TAKEN_OFF`, `claimConflictMessage(left: number): string`; `ERROR_MESSAGES` entries for `OWNER_CANNOT_CLAIM`, `MANAGE_TOKEN_IN_USE`, `SHARE_LINK_NOT_FOUND`.
  - `share-copy.ts`: `stepperHint(max: number): string | undefined`, `claimButtonLabel(max: number, afterConflict: boolean): string`, `claimedLine(quantity: number, wanted: number, owner: string, name: string): string`, `ownStripText(mine: number): string`.
  - `QuantityStepper` takes `max?: number` (default 99) and `hint?: string`.
  - `Sheet`, `SheetContent`, `SheetTitle`, `SheetDescription`, `SheetClose` from `@/components/ui/sheet`.
  - `useShareClaims()` from `share-claims.tsx`: `{ records, open(item, trigger), remember(record), forget(manageToken) }`. The records are read with `useSyncExternalStore` over `claim-records.ts`, so no effect copies them into state (the React Compiler lint in `eslint-config-next` refuses a `setState` called synchronously in an effect).

- [ ] **Step 0: Start the layer, and add the dependency**

```bash
gh stack add web/claim-sheet
pnpm --filter @wishlist/web add @radix-ui/react-dialog@1.2.0 --save-exact
```

Check `apps/web/package.json` says `"@radix-ui/react-dialog": "1.2.0"` with no `^`, and that `git diff pnpm-lock.yaml` adds no new package (the lockfile already had 1.2.0 for `react-alert-dialog`).

- [ ] **Step 1: Write the failing unit tests**

Create `apps/web/src/lib/manage-token.spec.ts`:

```ts
import { CAPABILITY_TOKEN_PATTERN } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { mintManageToken } from './manage-token';

describe('mintManageToken (D42)', () => {
  it('is 16 random bytes in base64url: 22 characters the API accepts', () => {
    expect(mintManageToken()).toMatch(CAPABILITY_TOKEN_PATTERN);
    expect(mintManageToken()).not.toBe(mintManageToken());
  });

  it('encodes the bytes without padding, using - and _', () => {
    expect(mintManageToken((bytes) => bytes.fill(0))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(mintManageToken((bytes) => bytes.fill(255))).toBe('_____________________w');
    expect(mintManageToken((bytes) => bytes.fill(0xfb))).toMatch(/^[-\w]{22}$/);
  });
});
```

Create `apps/web/src/lib/claim-records.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  dropRecord,
  NAME_KEY,
  ownClaimsOn,
  parseRecords,
  pendingTokenFor,
  readClaimerName,
  readRecords,
  reconcile,
  RECORDS_KEY,
  recordsSnapshot,
  saveRecord,
  subscribeRecords,
  updateRecords,
  writeClaimerName,
  writeRecords,
  type ClaimRecord,
  type KeyValueStore,
} from './claim-records';

const T1 = 'aaaaaaaaaaaaaaaaaaaaaa';
const T2 = 'bbbbbbbbbbbbbbbbbbbbbb';
const T3 = 'cccccccccccccccccccccc';
const KETTLE = 'item-kettle';
const SOCKS = 'item-socks';

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}
const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('the browser’s claims (D45)', () => {
  it('reads only well-formed records, and nothing from garbage', () => {
    expect(parseRecords(null)).toEqual([]);
    expect(parseRecords('not json')).toEqual([]);
    expect(parseRecords('{"itemId":"x"}')).toEqual([]);
    expect(
      parseRecords(
        JSON.stringify([
          { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
          { itemId: SOCKS, manageToken: 'short' },
          { itemId: SOCKS, manageToken: T2 },
          'junk',
        ]),
      ),
    ).toEqual([
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
      { itemId: SOCKS, manageToken: T2 },
    ]);
  });

  it('saves a record once per token, and drops it by token', () => {
    const pending: ClaimRecord = { itemId: KETTLE, manageToken: T1 };
    const done: ClaimRecord = { itemId: KETTLE, manageToken: T1, claimId: 'c1' };
    expect(saveRecord(saveRecord([], pending), done)).toEqual([done]);
    expect(dropRecord([done, { itemId: SOCKS, manageToken: T2 }], T1)).toEqual([
      { itemId: SOCKS, manageToken: T2 },
    ]);
  });

  it('finds the pending token for an item, and the item’s answered claims', () => {
    const records: ClaimRecord[] = [
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
      { itemId: KETTLE, manageToken: T2 },
      { itemId: SOCKS, manageToken: T3, claimId: 'c3' },
    ];
    expect(pendingTokenFor(records, KETTLE)).toBe(T2);
    expect(pendingTokenFor(records, SOCKS)).toBeUndefined();
    expect(ownClaimsOn(records, KETTLE)).toEqual([records[0]]);
  });

  it('reconciles with the page: drops claims that are gone, and lists the ones to look up (Plan 4b rule 8)', () => {
    const records: ClaimRecord[] = [
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' }, // still on the item
      { itemId: KETTLE, manageToken: T2, claimId: 'gone' }, // cancelled or deleted
      { itemId: SOCKS, manageToken: T3 }, // its answer never came
      { itemId: 'another-list-item', manageToken: T1.replace(/a/g, 'd'), claimId: 'c9' },
    ];
    const items = [
      { id: KETTLE, claims: [{ id: 'c1' }] },
      { id: SOCKS, claims: [] },
    ];
    const { kept, pending } = reconcile(records, items);
    expect(kept).toEqual([records[0], records[2], records[3]]);
    expect(pending).toEqual([records[2]]);
  });

  it('keeps every record when the page doesn’t carry claims', () => {
    const records: ClaimRecord[] = [{ itemId: KETTLE, manageToken: T1, claimId: 'c1' }];
    expect(reconcile(records, [{ id: KETTLE }]).kept).toEqual(records);
  });

  it('stores records and the name under their keys', () => {
    const store = memory();
    writeRecords([{ itemId: KETTLE, manageToken: T1 }], store);
    expect(JSON.parse(store.data[RECORDS_KEY] ?? '')).toEqual([{ itemId: KETTLE, manageToken: T1 }]);
    expect(readRecords(store)).toEqual([{ itemId: KETTLE, manageToken: T1 }]);
    expect(
      updateRecords((all) => saveRecord(all, { itemId: SOCKS, manageToken: T2 }), store),
    ).toHaveLength(2);
    writeClaimerName('Priya', store);
    expect(store.data[NAME_KEY]).toBe('Priya');
    expect(readClaimerName(store)).toBe('Priya');
  });

  it('gives one snapshot until storage changes, and tells subscribers when it does', () => {
    const store = memory();
    const first = recordsSnapshot(store);
    expect(recordsSnapshot(store)).toBe(first);
    const heard = vi.fn();
    const stop = subscribeRecords(heard);
    writeRecords([{ itemId: KETTLE, manageToken: T1 }], store);
    expect(heard).toHaveBeenCalledOnce();
    expect(recordsSnapshot(store)).toEqual([{ itemId: KETTLE, manageToken: T1 }]);
    expect(recordsSnapshot(store)).toBe(recordsSnapshot(store));
    stop();
    expect(recordsSnapshot(throwing)).toEqual([]);
  });

  it('treats storage that throws as empty, and never throws itself (Plan 4b rule 7)', () => {
    expect(readRecords(throwing)).toEqual([]);
    expect(() => writeRecords([{ itemId: KETTLE, manageToken: T1 }], throwing)).not.toThrow();
    expect(updateRecords((all) => all, throwing)).toEqual([]);
    expect(readClaimerName(throwing)).toBe('');
    expect(() => writeClaimerName('Priya', throwing)).not.toThrow();
    expect(readRecords(undefined)).toEqual([]);
  });
});
```

In `apps/web/src/lib/share-copy.spec.ts`, add `claimButtonLabel`, `claimedLine`, `ownStripText` and `stepperHint` to the import and add:

```ts
describe('claim sheet copy', () => {
  it('hints at the most you can claim, but not when it’s one', () => {
    expect(stepperHint(2)).toBe('Up to 2');
    expect(stepperHint(1)).toBeUndefined();
  });

  it('names the button for the last one after someone got there first', () => {
    expect(claimButtonLabel(2, false)).toBe('Claim it');
    expect(claimButtonLabel(1, false)).toBe('Claim it');
    expect(claimButtonLabel(2, true)).toBe('Claim it');
    expect(claimButtonLabel(1, true)).toBe('Claim the last one');
  });

  it('says what was claimed, and as whom', () => {
    expect(claimedLine(1, 3, 'Ada', 'Priya')).toBe('1 of the 3 Ada wants, as Priya.');
    expect(claimedLine(1, 1, 'Ada', 'Priya')).toBe('As Priya.');
    expect(ownStripText(2)).toBe('You’re getting 2');
  });
});
```

In `apps/web/src/lib/messages.spec.ts`, add `claimConflictMessage` to the import from `./messages` and add:

```ts
describe('claimConflictMessage', () => {
  it('says how many are left, and that the stepper was set to it', () => {
    expect(claimConflictMessage(1)).toBe(
      'Someone else claimed some while you were choosing, so only 1 is left. We’ve set how many to 1.',
    );
    expect(claimConflictMessage(2)).toBe(
      'Someone else claimed some while you were choosing, so only 2 are left. We’ve set how many to 2.',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @wishlist/web exec vitest run src/lib`
Expected: FAIL. The new modules and functions don't exist.

- [ ] **Step 3: Implement the pure modules**

Create `apps/web/src/lib/manage-token.ts`:

```ts
/**
 * A manage token minted in the browser (D42): 16 random bytes, base64url without padding, 22
 * characters, the same shape the API mints. The sheet saves it before sending the claim, so a
 * lost answer can be found again. `random` is for tests.
 */
export function mintManageToken(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

Create `apps/web/src/lib/claim-records.ts`:

```ts
import { CAPABILITY_TOKEN_PATTERN } from '@wishlist/contracts';
import { z } from 'zod';

/**
 * A claim this browser knows (D45). Written before the claim is sent, with no `claimId` until the
 * API answers (D42). Item IDs are unique on their own, so a rotated share link keeps them.
 */
const RecordSchema = z.object({
  itemId: z.string().min(1),
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN),
  claimId: z.string().min(1).optional(),
});
export type ClaimRecord = z.infer<typeof RecordSchema>;

export const RECORDS_KEY = 'hanker:claims';
export const NAME_KEY = 'hanker:claimerName';

/** What storage held, keeping only well-formed records. */
export function parseRecords(raw: string | null): ClaimRecord[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = RecordSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Adds the record, or replaces the one with its manage token. */
export function saveRecord(records: readonly ClaimRecord[], record: ClaimRecord): ClaimRecord[] {
  return [...records.filter((r) => r.manageToken !== record.manageToken), record];
}

export function dropRecord(records: readonly ClaimRecord[], manageToken: string): ClaimRecord[] {
  return records.filter((r) => r.manageToken !== manageToken);
}

/** The token of this item's claim whose answer never came (Plan 4b rule 4). */
export function pendingTokenFor(records: readonly ClaimRecord[], itemId: string): string | undefined {
  return records.find((r) => r.itemId === itemId && r.claimId === undefined)?.manageToken;
}

/** This browser's answered claims on the item. */
export function ownClaimsOn(records: readonly ClaimRecord[], itemId: string): ClaimRecord[] {
  return records.filter((r) => r.itemId === itemId && r.claimId !== undefined);
}

interface PageItem {
  id: string;
  claims?: readonly { id: string }[];
}

/**
 * Squares the records with the page (Plan 4b rule 8). A record whose claim isn't on its item any
 * more is dropped; records for items elsewhere are kept, since they may be on another list. The
 * pending records for items on this page are the ones to look up.
 */
export function reconcile(
  records: readonly ClaimRecord[],
  items: readonly PageItem[],
): { kept: ClaimRecord[]; pending: ClaimRecord[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = records.filter((record) => {
    const claims = byId.get(record.itemId)?.claims;
    if (claims === undefined || record.claimId === undefined) return true;
    return claims.some((claim) => claim.id === record.claimId);
  });
  const pending = kept.filter((r) => r.claimId === undefined && byId.has(r.itemId));
  return { kept, pending };
}

/** The part of Storage this uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, or nothing: touching it throws in some private windows (Plan 4b rule 7). */
function browserStorage(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readRecords(store: KeyValueStore | undefined = browserStorage()): ClaimRecord[] {
  try {
    return parseRecords(store?.getItem(RECORDS_KEY) ?? null);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; records: ClaimRecord[] } = { raw: null, records: [] };

export function writeRecords(
  records: readonly ClaimRecord[],
  store: KeyValueStore | undefined = browserStorage(),
): void {
  try {
    store?.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Full or blocked: the manage link is still the way back (spec §7).
  }
  for (const listener of listeners) listener();
}

/**
 * The records for useSyncExternalStore: the same array until what's stored changes, so React
 * re-renders only on a real change. Storage that throws reads as no records.
 */
export function recordsSnapshot(store: KeyValueStore | undefined = browserStorage()): ClaimRecord[] {
  let raw: string | null = null;
  try {
    raw = store?.getItem(RECORDS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== snapshot.raw) snapshot = { raw, records: parseRecords(raw) };
  return snapshot.records;
}

export function subscribeRecords(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads, changes and writes in one step, so a change never works from a stale copy. */
export function updateRecords(
  change: (records: ClaimRecord[]) => ClaimRecord[],
  store: KeyValueStore | undefined = browserStorage(),
): ClaimRecord[] {
  const next = change(readRecords(store));
  writeRecords(next, store);
  return next;
}

export function readClaimerName(store: KeyValueStore | undefined = browserStorage()): string {
  try {
    return store?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeClaimerName(
  name: string,
  store: KeyValueStore | undefined = browserStorage(),
): void {
  try {
    store?.setItem(NAME_KEY, name);
  } catch {
    // As above: only a convenience.
  }
}
```

Append to `apps/web/src/lib/share-copy.ts`:

```ts
/** Under the claim sheet's stepper: the most you can claim. Nothing to say when it's one. */
export function stepperHint(max: number): string | undefined {
  return max > 1 ? `Up to ${max}` : undefined;
}

/** The claim sheet's button. After a 409 leaves one, it says so (the Plan 4b mockups). */
export function claimButtonLabel(max: number, afterConflict: boolean): string {
  return afterConflict && max === 1 ? 'Claim the last one' : 'Claim it';
}

/** Under "You're getting …" once a claim is made. */
export function claimedLine(quantity: number, wanted: number, owner: string, name: string): string {
  return wanted > 1 ? `${quantity} of the ${wanted} ${owner} wants, as ${name}.` : `As ${name}.`;
}

/** The card's strip for this browser's own claim. */
export function ownStripText(mine: number): string {
  return `You’re getting ${mine}`;
}
```

In `apps/web/src/lib/messages.ts`, add to `ERROR_MESSAGES`:

```ts
  [ErrorCode.OWNER_CANNOT_CLAIM]: 'You can’t claim from your own list.',
  [ErrorCode.MANAGE_TOKEN_IN_USE]: 'Something went wrong with this claim. Close this and try again.',
  [ErrorCode.SHARE_LINK_NOT_FOUND]: 'This list’s link doesn’t work any more.',
```

and after `ITEM_GONE`:

```ts
/** The claim sheet, when someone else took the last one first (spec §7 step 4). */
export const LAST_ONE_GONE = 'Someone else just claimed the last one.';

/** The claim sheet, when the owner deleted the item while it was open. */
export const ITEM_TAKEN_OFF = 'This item was just taken off the list.';

/** The claim sheet's 409 when some are still left: the stepper was set to them (spec §7). */
export function claimConflictMessage(left: number): string {
  return `Someone else claimed some while you were choosing, so only ${left} ${left === 1 ? 'is' : 'are'} left. We’ve set how many to ${left}.`;
}
```

Create `apps/web/src/lib/use-can-share.ts` by moving `nothingToWatch` and `useCanShare` out of `share-actions.tsx`:

```ts
'use client';

import { useSyncExternalStore } from 'react';

const nothingToWatch = () => () => undefined;

/** Whether this browser can open the system share sheet. False while rendering on the server. */
export function useCanShare(): boolean {
  return useSyncExternalStore(
    nothingToWatch,
    () => typeof navigator.share === 'function',
    () => false,
  );
}
```

In `share-actions.tsx`, delete those two definitions and the `useSyncExternalStore` import, and add `import { useCanShare } from '@/lib/use-can-share';`.

Run: `pnpm --filter @wishlist/web exec vitest run src/lib`
Expected: PASS.

- [ ] **Step 4: Write the failing E2E tests**

Create `e2e/tests/local/claim.spec.ts`:

```ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { CreateItemRequest, SharedWishlistResponse } from '@wishlist/contracts';
import { expectAccessible, expectNoSidewaysScroll, PHONE } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** Ada's list with one item, and a gifter's page open on it. */
async function setUp(
  page: Page,
  browser: Browser,
  base: string,
  label: string,
  item: Partial<CreateItemRequest> & { title: string } = { title: 'Enamel kettle' },
) {
  await verifiedOwner(page, base, label);
  const added = await addItemViaApi(page.request, base, item);
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const gifter = await context.newPage();
  await gifter.goto(`/s/${token}`);
  return { added, token, context, gifter };
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });

async function claimsOn(page: Page, token: string) {
  const shared = (await (await page.request.get(`/api/shared/${token}`)).json()) as SharedWishlistResponse;
  return shared.items.flatMap((item) => item.claims ?? []);
}

test('a gifter claims in three taps and keeps the manage link (spec §1 criterion 2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-taps');
  await gifter.setViewportSize(PHONE);
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog', { name: 'Enamel kettle' });
  await expect(sheet.getByLabel('Your name')).toBeFocused();
  await expect(sheet).toContainText('Ada can’t see who’s getting what, so the surprise is safe.');
  await expectAccessible(gifter);
  await sheet.getByLabel('Your name').fill('Aunt Sue');
  await sheet.getByRole('button', { name: 'Claim it' }).click();

  const done = gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' });
  await expect(done.getByText('Save this link to change or cancel your claim.')).toBeVisible();
  const manageUrl = (await done.getByText(/\/c\/[\w-]{22}$/).textContent()) ?? '';
  await expectAccessible(gifter);
  await expectNoSidewaysScroll(gifter);
  await done.getByRole('button', { name: 'Back to Ada’s list' }).click();

  const kettle = card(gifter, 'Enamel kettle');
  await expect(kettle).toContainText('You’re getting 1');
  await expect(kettle.getByRole('link', { name: /^Change/ })).toHaveAttribute(
    'href',
    new URL(manageUrl).pathname,
  );
  await expect(kettle.getByRole('button', { name: 'I’ll get this' })).toHaveCount(0);
  expect(await claimsOn(gifter, token)).toEqual([
    expect.objectContaining({ claimerName: 'Aunt Sue', quantity: 1 }),
  ]);
});

test('the stepper stops at what is left, and the name is remembered', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-stepper', {
    title: 'Merino socks',
    quantity: 3,
  });
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  await gifter.reload();
  await card(gifter, 'Merino socks').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog', { name: 'Merino socks' });
  await expect(sheet).toContainText('Ada wants 3. Sam is getting 1, so 2 are left.');
  await expect(sheet.getByText('Up to 2')).toBeVisible();
  await sheet.getByRole('button', { name: 'More' }).click();
  await expect(sheet.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('2');
  await expect(sheet.getByRole('button', { name: 'More' })).toBeDisabled();
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await gifter.getByRole('button', { name: 'Back to Ada’s list' }).click();
  await expect(card(gifter, 'Merino socks')).toContainText('You’re getting 2');

  await addItemViaApi(page.request, base, { title: 'Pottery class' });
  await gifter.reload();
  await card(gifter, 'Pottery class').getByRole('button', { name: 'I’ll get this' }).click();
  await expect(gifter.getByRole('dialog').getByLabel('Your name')).toHaveValue('Priya');
});

test('says so when someone else claimed the last one first (spec §7 step 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-last');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Someone else just claimed the last one.');
  await sheet.getByRole('button', { name: 'Back to the list' }).click();
  await expect(card(gifter, 'Enamel kettle')).toContainText('Taken care of: Sam is getting this');
});

test('resets the stepper when someone else took some first (spec §7 step 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-some', {
    title: 'Merino socks',
    quantity: 3,
  });
  await card(gifter, 'Merino socks').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog');
  await sheet.getByRole('button', { name: 'More' }).click();
  await sheet.getByRole('button', { name: 'More' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
    quantity: 2,
  });
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'Someone else claimed some while you were choosing, so only 1 is left. We’ve set how many to 1.',
  );
  await expect(sheet.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('1');
  await sheet.getByRole('button', { name: 'Claim the last one' }).click();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Merino socks' })).toBeVisible();
});

test('a lost answer is found again by Try again, not claimed twice (D42, Review Focus 1)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-retry');
  let lost = false;
  await gifter.route('**/api/shared/*/items/*/claims', async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch(); // the API makes the claim…
    await route.abort('internetdisconnected'); // …and its answer never arrives
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toContainText('reach Hanker');
  await sheet.getByRole('button', { name: 'Try again' }).click();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' })).toBeVisible();
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('a lost answer comes back on reload, with nothing to tap (D42)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-reload');
  await gifter.route('**/api/shared/*/items/*/claims', async (route) => {
    await route.fetch();
    await route.abort('internetdisconnected');
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(gifter.getByRole('dialog').getByRole('alert')).toContainText('reach Hanker');
  await gifter.unrouteAll();
  await gifter.reload();
  await expect(card(gifter, 'Enamel kettle')).toContainText('You’re getting 1');
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('a double tap makes one claim (Review Focus 1)', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-double', {
    title: 'Enamel kettle',
    quantity: 3,
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).dblclick();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' })).toBeVisible();
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('claims without storage, and still hands over the manage link (Review Focus 2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'claim-nostorage');
  await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('storage is blocked');
      },
    });
  });
  const gifter = await context.newPage();
  const errors: string[] = [];
  gifter.on('pageerror', (error) => errors.push(error.message));
  await gifter.goto(`/s/${token}`);
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(gifter.getByText(/\/c\/[\w-]{22}$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('says when the item was taken off the list while the sheet was open (Review Focus 3)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, gifter } = await setUp(page, browser, base, 'claim-deleted');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const removed = await page.request.delete(`/api/wishlist/items/${added.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(removed.status()).toBe(204);
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('This item was just taken off the list.');
  await sheet.getByRole('button', { name: 'Back to the list' }).click();
  await expect(card(gifter, 'Enamel kettle')).toHaveCount(0);
});

test('lands on the dead-link page when the link was replaced while the sheet was open (Review Focus 3)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { gifter } = await setUp(page, browser, base, 'claim-rotated');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await page.request.post('/api/wishlist/share-token/rotate', { headers: { origin: base }, data: {} });
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
  ).toBeVisible();
});
```

Run: `pnpm test:e2e -- tests/local/claim.spec.ts`
Expected: FAIL. There's no "I’ll get this" button.

- [ ] **Step 5: Give the stepper a maximum and a hint**

In `apps/web/src/components/list/quantity-stepper.tsx`, change the signature and body:

```tsx
/**
 * "How many": 1–99 (spec §2), or fewer where less is left. The number is an <output>, so a change
 * is announced.
 */
export function QuantityStepper({
  id,
  value,
  onChange,
  max = MAX,
  hint,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  hint?: string | undefined;
}) {
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  const fewer = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  // A button that disables itself drops focus to <body>; hand it to the other one first.
  const step = (next: number) => {
    onChange(next);
    if (next <= MIN) more.current?.focus();
    if (next >= max) fewer.current?.focus();
  };
```

then give the `role="group"` element `aria-describedby={hintId}`, change the "More" button's `disabled` to `value >= max`, and after the group's closing `</div>` add:

```tsx
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
```

The editor's form keeps working unchanged: it passes no `max`.

- [ ] **Step 6: Add the sheet primitive**

Create `apps/web/src/components/ui/sheet.tsx`:

```tsx
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;

/**
 * A modal dialog that rises from the bottom of the screen (spec §7 Claim flow). Radix traps focus,
 * closes on Escape, and marks the rest of the page inert.
 */
export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[calc(100dvh-2rem)] w-full max-w-[680px] overflow-y-auto rounded-t-card border-t border-border bg-background px-4 pt-2 pb-6 sm:px-7',
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-input" />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        'font-display text-[32px] leading-tight [overflow-wrap:anywhere] focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1.5 text-[15px] leading-snug text-muted-foreground', className)}
      {...props}
    />
  );
}
```

- [ ] **Step 7: Build the browser's claims and the sheet**

Create `apps/web/src/components/share/share-claims.tsx`:

```tsx
'use client';

import { ClaimDetailsResponseSchema, type SharedItem } from '@wishlist/contracts';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import {
  dropRecord,
  readRecords,
  reconcile,
  recordsSnapshot,
  saveRecord,
  subscribeRecords,
  updateRecords,
  writeRecords,
  type ClaimRecord,
} from '@/lib/claim-records';
import { ClaimSheet } from './claim-sheet';

interface ShareClaims {
  /** This browser's claims (D45). Empty on the server and while hydrating, so the two agree. */
  records: readonly ClaimRecord[];
  open(item: SharedItem, trigger: HTMLElement): void;
  remember(record: ClaimRecord): void;
  forget(manageToken: string): void;
}

const ShareClaimsContext = createContext<ShareClaims | null>(null);
const NO_RECORDS: ClaimRecord[] = [];
const currentRecords = () => recordsSnapshot();
const noRecords = () => NO_RECORDS;

/** The gifter's side of the share page: their claims, and the one claim sheet. */
export function ShareClaimsProvider({
  shareToken,
  ownerName,
  ownerSeesClaims,
  items,
  children,
}: {
  shareToken: string;
  ownerName: string;
  ownerSeesClaims: boolean;
  items: readonly SharedItem[];
  children: ReactNode;
}) {
  // Storage is the store: every write tells React, so no state is copied out of it.
  const records = useSyncExternalStore(subscribeRecords, currentRecords, noRecords);
  const [openItem, setOpenItem] = useState<SharedItem | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const remember = useCallback((record: ClaimRecord) => {
    updateRecords((all) => saveRecord(all, record));
  }, []);
  const forget = useCallback((manageToken: string) => {
    updateRecords((all) => dropRecord(all, manageToken));
  }, []);
  const open = useCallback((item: SharedItem, from: HTMLElement) => {
    trigger.current = from;
    setOpenItem(item);
  }, []);

  // Claims that are gone are dropped, and a claim whose answer never came is looked up by its
  // token (D42, Plan 4b rule 8). Runs again when a refresh brings new items.
  useEffect(() => {
    const { kept, pending } = reconcile(readRecords(), items);
    writeRecords(kept);
    let current = true;
    for (const record of pending) {
      browserApi.get(`/claims/${record.manageToken}`, ClaimDetailsResponseSchema).then(
        (details) => {
          if (current) remember({ ...record, claimId: details.claim.id });
        },
        (error: unknown) => {
          if (current && error instanceof ApiError && error.status === 404) {
            forget(record.manageToken);
          }
        },
      );
    }
    return () => {
      current = false;
    };
  }, [items, remember, forget]);

  // The button that opened the sheet, or the item's title once a claim has replaced the button.
  const returnFocus = useCallback(() => {
    const from = trigger.current;
    const target = from?.isConnected
      ? from
      : openItem
        ? document.getElementById(`item-${openItem.id}`)
        : null;
    target?.focus();
  }, [openItem]);

  const value = useMemo(
    () => ({ records, open, remember, forget }),
    [records, open, remember, forget],
  );
  return (
    <ShareClaimsContext value={value}>
      {children}
      {openItem ? (
        <ClaimSheet
          key={openItem.id}
          item={openItem}
          shareToken={shareToken}
          ownerName={ownerName}
          ownerSeesClaims={ownerSeesClaims}
          onClose={() => setOpenItem(null)}
          returnFocus={returnFocus}
        />
      ) : null}
    </ShareClaimsContext>
  );
}

export function useShareClaims(): ShareClaims {
  const claims = use(ShareClaimsContext);
  if (!claims) throw new Error('useShareClaims is only for components inside ShareClaimsProvider');
  return claims;
}
```

Create `apps/web/src/components/share/claim-done.tsx`:

```tsx
'use client';

import type { CreateClaimResponse } from '@wishlist/contracts';
import { useState } from 'react';
import { CopyIcon, ShareIcon } from '@/components/list/icons';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SheetClose } from '@/components/ui/sheet';
import { useCanShare } from '@/lib/use-can-share';

/** After a claim (spec §7 step 2): the manage link, to copy or share, and the way back. */
export function ClaimDone({
  claim,
  itemTitle,
  ownerName,
}: {
  claim: CreateClaimResponse;
  itemTitle: string;
  ownerName: string;
}) {
  const canShare = useCanShare();
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const say = (text: string) => setMessage((last) => ({ text, id: (last?.id ?? 0) + 1 }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(claim.manageUrl);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${claim.manageUrl}`);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `Your claim: ${itemTitle}`, url: claim.manageUrl });
    } catch (error) {
      // Closing the share sheet rejects with AbortError: the person chose not to share.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copy();
    }
  }

  return (
    <>
      <p className="mt-5 text-base font-semibold">Save this link to change or cancel your claim.</p>
      <p className="mt-2 rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[15px] [overflow-wrap:anywhere]">
        {claim.manageUrl}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="compact" onClick={() => void copy()}>
          <CopyIcon />
          Copy link
        </Button>
        {canShare ? (
          <Button variant="secondary" size="compact" onClick={() => void share()}>
            <ShareIcon />
            Share
          </Button>
        ) : null}
      </div>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-3">
            {message.text}
          </Notice>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-snug text-muted-foreground">
        This browser remembers your claim too, but only the link works on another phone or
        computer. Send it to yourself, or keep it with your notes.
      </p>
      <SheetClose asChild>
        <Button variant="secondary" className="mt-6 w-full">
          Back to {ownerName}’s list
        </Button>
      </SheetClose>
    </>
  );
}
```

Create `apps/web/src/components/share/claim-sheet.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClaimConflictProblemSchema,
  ClaimerNameSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  type CreateClaimResponse,
  type SharedItem,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CloseIcon, EyeOffIcon } from '@/components/list/icons';
import { QuantityStepper } from '@/components/list/quantity-stepper';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { pendingTokenFor, readClaimerName, writeClaimerName } from '@/lib/claim-records';
import { formErrorMap } from '@/lib/form-errors';
import { mintManageToken } from '@/lib/manage-token';
import {
  claimConflictMessage,
  errorMessage,
  fieldErrors,
  hasCode,
  ITEM_TAKEN_OFF,
  LAST_ONE_GONE,
} from '@/lib/messages';
import {
  claimButtonLabel,
  claimedLine,
  countLine,
  ownerSeesLine,
  stepperHint,
} from '@/lib/share-copy';
import { ClaimDone } from './claim-done';
import { useShareClaims } from './share-claims';

const NameSchema = z.object({ claimerName: ClaimerNameSchema });

type Phase =
  | { kind: 'form' }
  | { kind: 'done'; claim: CreateClaimResponse }
  | { kind: 'ended'; message: string };

/** The claim sheet (spec §7 Claim flow, the Plan 4b mockups). Mounted fresh for each item. */
export function ClaimSheet({
  item,
  shareToken,
  ownerName,
  ownerSeesClaims,
  onClose,
  returnFocus,
}: {
  item: SharedItem;
  shareToken: string;
  ownerName: string;
  ownerSeesClaims: boolean;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const router = useRouter();
  const { records, remember, forget } = useShareClaims();
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [max, setMax] = useState(Math.max(1, item.remaining ?? item.quantity));
  const [quantity, setQuantity] = useState(1);
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const token = useRef<string | null>(null);
  const inFlight = useRef(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(NameSchema, { error: formErrorMap }),
    defaultValues: { claimerName: readClaimerName() },
  });
  const { ref: nameRef, ...nameField } = register('claimerName');

  // The form's button is gone once the sheet says what happened: the title takes focus.
  useEffect(() => {
    if (phase.kind !== 'form') title.current?.focus();
  }, [phase.kind]);

  const submit = handleSubmit(async ({ claimerName }) => {
    // Reuse a claim whose answer never came, so a retry finds it rather than making another (D42).
    token.current ??= pendingTokenFor(records, item.id) ?? mintManageToken();
    const manageToken = token.current;
    writeClaimerName(claimerName);
    remember({ itemId: item.id, manageToken });
    setFormError(null);
    try {
      const claim = await browserApi.post(
        `/shared/${shareToken}/items/${item.id}/claims`,
        { claimerName, quantity, manageToken },
        CreateClaimResponseSchema,
      );
      remember({ itemId: item.id, manageToken, claimId: claim.claim.id });
      setPhase({ kind: 'done', claim });
      router.refresh();
    } catch (error) {
      // A refusal means no claim was made. A lost answer may hide one, so it keeps its token
      // (Plan 4b rule 5).
      if (error instanceof ApiError && error.status < 500) {
        forget(manageToken);
        token.current = null;
      }
      failed(error);
    }
  });

  function failed(error: unknown) {
    setRetry(false);
    if (hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING)) {
      const left =
        error instanceof ApiError
          ? (ClaimConflictProblemSchema.safeParse(error.problem).data?.remaining ?? 0)
          : 0;
      router.refresh();
      if (left === 0) {
        setPhase({ kind: 'ended', message: LAST_ONE_GONE });
        return;
      }
      setMax(left);
      setQuantity(left);
      setConflict(claimConflictMessage(left));
      return;
    }
    if (hasCode(error, ErrorCode.SHARE_LINK_NOT_FOUND)) {
      // The page itself is gone: the refresh lands on the dead-link page.
      onClose();
      router.refresh();
      return;
    }
    if (hasCode(error, ErrorCode.NOT_FOUND)) {
      router.refresh();
      setPhase({ kind: 'ended', message: ITEM_TAKEN_OFF });
      return;
    }
    const nameError = fieldErrors(error).claimerName;
    if (nameError) {
      setError('claimerName', { message: nameError }, { shouldFocus: true });
      return;
    }
    setRetry(!(error instanceof ApiError) || error.status >= 500);
    setFormError(errorMessage(error));
  }

  // One request per press (Plan 2b Review Focus 5): the disabled button stops a second press, and
  // this guard stops a second submit that arrives before the re-render disables it.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (inFlight.current) {
      event.preventDefault();
      return;
    }
    inFlight.current = true;
    void submit(event).finally(() => {
      inFlight.current = false;
    });
  };

  const description =
    phase.kind === 'done'
      ? claimedLine(phase.claim.claim.quantity, item.quantity, ownerName, phase.claim.claim.claimerName)
      : (countLine({
          wants: `${ownerName} wants`,
          quantity: item.quantity,
          ...(item.claims ? { claims: item.claims } : {}),
        }) ?? 'Claim it, so nobody else buys it too.');

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <div className="flex items-start gap-2">
          <SheetTitle ref={title} tabIndex={-1} className="mt-1.5 flex-1">
            {phase.kind === 'done' ? `You’re getting ${item.title}` : item.title}
          </SheetTitle>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
            >
              <CloseIcon />
            </button>
          </SheetClose>
        </div>
        <SheetDescription>{description}</SheetDescription>

        {phase.kind === 'done' ? (
          <ClaimDone claim={phase.claim} itemTitle={item.title} ownerName={ownerName} />
        ) : phase.kind === 'ended' ? (
          <>
            <Notice tone="error" className="mt-4">
              {phase.message}
            </Notice>
            <SheetClose asChild>
              <Button variant="secondary" className="mt-6 w-full">
                Back to the list
              </Button>
            </SheetClose>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-5">
            {conflict ? <Notice tone="error">{conflict}</Notice> : null}
            <Field
              id="claimerName"
              label="Your name"
              hint="Other gifters see it, so nobody doubles up."
              error={errors.claimerName?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  {...nameField}
                  ref={(element) => {
                    nameRef(element);
                    nameInput.current = element;
                  }}
                  autoComplete="name"
                />
              )}
            </Field>
            <QuantityStepper
              id="claim-quantity"
              value={quantity}
              onChange={setQuantity}
              max={max}
              hint={stepperHint(max)}
            />
            <p className="flex items-start gap-2 text-sm leading-snug text-muted-foreground">
              {ownerSeesClaims ? null : <EyeOffIcon />}
              {ownerSeesLine(ownerName, ownerSeesClaims)}
            </p>
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {retry ? 'Try again' : claimButtonLabel(max, conflict !== null)}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

When the sheet ends without a claim, its message is an error `Notice` (`role="alert"`), so it's announced at once; the description keeps the item's count line.

Create `apps/web/src/components/share/gifter-footer.tsx`:

```tsx
'use client';

import type { SharedItem } from '@wishlist/contracts';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ownClaimsOn } from '@/lib/claim-records';
import { isTaken, mineOf, ownStripText, type ItemClaims } from '@/lib/share-copy';
import { CardStatus } from './card-status';
import { useShareClaims } from './share-claims';

/**
 * The bottom of a card for a gifter: who has it covered, this browser's own claim with its way to
 * change it, or the button that opens the claim sheet. One claim per item from one browser
 * (Plan 4b rule 6): the manage page raises it.
 */
export function GifterFooter({ item, ownerName }: { item: SharedItem; ownerName: string }) {
  const { records, open } = useShareClaims();
  const mine = ownClaimsOn(records, item.id).filter((record) =>
    item.claims?.some((claim) => claim.id === record.claimId),
  );
  const status: ItemClaims = {
    wants: `${ownerName} wants`,
    quantity: item.quantity,
    ...(item.claims ? { claims: item.claims } : {}),
    ownIds: new Set(mine.flatMap((record) => (record.claimId ? [record.claimId] : []))),
  };
  const getting = mineOf(status);
  const manageToken = mine[0]?.manageToken;
  return (
    <>
      <CardStatus status={status} />
      {getting > 0 && manageToken ? (
        <p className="mt-3 flex items-center gap-2 rounded-control bg-success-wash py-1 pr-1 pl-3.5 text-[15px] font-medium text-success-foreground">
          <span className="flex-1">{ownStripText(getting)}</span>
          <Link
            href={`/c/${manageToken}`}
            prefetch={false}
            className="inline-flex min-h-11 items-center px-3 font-semibold underline"
          >
            Change<span className="sr-only"> your claim on {item.title}</span>
          </Link>
        </p>
      ) : isTaken(status) ? null : (
        <Button className="mt-3 w-full" onClick={(event) => open(item, event.currentTarget)}>
          I’ll get this<span className="sr-only">: {item.title}</span>
        </Button>
      )}
    </>
  );
}
```

In `apps/web/src/components/share/share-page.tsx`, import `GifterFooter` and `ShareClaimsProvider`, take `shareToken` from the props, and replace the `<ol>…</ol>` with a version that gives gifters their footer inside the provider:

```tsx
      ) : list.viewerIsOwner ? (
        <ol aria-label="Your items, most wanted first" className="mt-6 flex flex-col gap-4">
          {list.items.map((item) => (
            <ShareCard
              key={item.id}
              item={item}
              footer={
                <CardStatus
                  status={{
                    wants,
                    quantity: item.quantity,
                    ...(item.claims ? { claims: item.claims } : {}),
                  }}
                />
              }
            />
          ))}
        </ol>
      ) : (
        <ShareClaimsProvider
          shareToken={shareToken}
          ownerName={owner}
          ownerSeesClaims={list.ownerSeesClaims}
          items={list.items}
        >
          <ol aria-label={`${owner}’s items, most wanted first`} className="mt-6 flex flex-col gap-4">
            {list.items.map((item) => (
              <ShareCard
                key={item.id}
                item={item}
                footer={<GifterFooter item={item} ownerName={owner} />}
              />
            ))}
          </ol>
        </ShareClaimsProvider>
      )}
```

The owner never gets a sheet, a strip, or a claim button (spec §2).

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e -- tests/local/claim.spec.ts tests/local/share.spec.ts
```
Expected: PASS.

- [ ] **Step 9: Run the layer's gate, then commit**

Run the full gate. Expected: all green.

```bash
git add apps/web e2e pnpm-lock.yaml
git commit -m "feat(web): claim from the share page, and keep the claim when its answer is lost

The claim sheet mints its manage token and saves it before sending (D42); the browser's claims live
under one key, by item (D45).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 5: The manage page: change, cancel, and the pages after

**Files:**
- Create: `apps/web/src/app/c/[manageToken]/page.tsx`, `apps/web/src/app/c/[manageToken]/not-found.tsx`
- Create: `apps/web/src/components/manage/manage-claim.tsx`, `change-claim-form.tsx`, `cancel-claim.tsx`, `claim-gone.tsx`
- Modify: `apps/web/src/lib/share-copy.ts`, `share-copy.spec.ts`, `apps/web/src/lib/messages.ts`, `messages.spec.ts`
- Create: `e2e/tests/local/manage.spec.ts`

**Interfaces:**
- Consumes: Task 3's `loadClaim`, `ItemCardBody`, `CARD`, `ownerSeesLine`, icons; Task 4's `QuantityStepper` `max`/`hint`, `updateRecords`, `saveRecord`, `dropRecord`.
- Produces: `yourClaimLine(quantity: number, wanted: number, owner: string): string`; `manageHint(remaining: number, current: number): string`; `claimChangeConflictMessage(max: number): string`; `ClaimGone({ headingRef? })`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add web/manage-claim
```

- [ ] **Step 1: Write the failing unit tests**

In `apps/web/src/lib/share-copy.spec.ts`, add `manageHint` and `yourClaimLine` to the import, and:

```ts
describe('manage page copy', () => {
  it('says how much of the item is yours', () => {
    expect(yourClaimLine(1, 3, 'Ada')).toBe('You’re getting 1 of the 3 Ada wants');
    expect(yourClaimLine(1, 1, 'Ada')).toBe('You’re getting this');
  });

  it('says how high the claim can go, and how many more are free (spec §2)', () => {
    expect(manageHint(1, 1)).toBe('Up to 2: 1 more is free');
    expect(manageHint(2, 1)).toBe('Up to 3: 2 more are free');
    expect(manageHint(0, 2)).toBe('Up to 2');
  });
});
```

In `apps/web/src/lib/messages.spec.ts`, add `claimChangeConflictMessage` to the import, and:

```ts
describe('claimChangeConflictMessage', () => {
  it('says the new most, and that the stepper was set to it', () => {
    expect(claimChangeConflictMessage(2)).toBe(
      'Someone else claimed some, so you can have up to 2 now. We’ve set how many to 2.',
    );
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/share-copy.spec.ts src/lib/messages.spec.ts`
Expected: FAIL. The functions don't exist.

- [ ] **Step 2: Implement the copy**

Append to `apps/web/src/lib/share-copy.ts`:

```ts
/** On the manage page's card: how much of the item is yours. */
export function yourClaimLine(quantity: number, wanted: number, owner: string): string {
  return wanted > 1 ? `You’re getting ${quantity} of the ${wanted} ${owner} wants` : 'You’re getting this';
}

/** Under the manage page's stepper: what's left plus what the claim holds (spec §2). */
export function manageHint(remaining: number, current: number): string {
  const most = `Up to ${remaining + current}`;
  return remaining > 0 ? `${most}: ${remaining} more ${isAre(remaining)} free` : most;
}
```

In `apps/web/src/lib/messages.ts`, after `claimConflictMessage`:

```ts
/** The manage page's 409: the claim can go no higher than this now (spec §2). */
export function claimChangeConflictMessage(max: number): string {
  return `Someone else claimed some, so you can have up to ${max} now. We’ve set how many to ${max}.`;
}
```

Run the same tests. Expected: PASS.

- [ ] **Step 3: Write the failing E2E tests**

Create `e2e/tests/local/manage.spec.ts`:

```ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { ClaimDetailsResponse, CreateItemRequest } from '@wishlist/contracts';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** Ada's list with one item that Priya has claimed one of, and Priya's browser. */
async function claimed(
  page: Page,
  browser: Browser,
  base: string,
  label: string,
  item: Partial<CreateItemRequest> & { title: string } = { title: 'Merino socks', quantity: 3 },
) {
  await verifiedOwner(page, base, label);
  const added = await addItemViaApi(page.request, base, item);
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const { manageToken } = await claimViaApi(context.request, base, token, added.id, {
    claimerName: 'Priya',
  });
  return { added, token, manageToken, context, gifter: await context.newPage() };
}

async function detailsOf(page: Page, manageToken: string) {
  return (await (await page.request.get(`/api/claims/${manageToken}`)).json()) as ClaimDetailsResponse;
}

test('shows the claim, and saves a new name and quantity (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { manageToken, gifter } = await claimed(page, browser, base, 'manage-change', {
    title: 'Merino socks',
    quantity: 3,
    priceText: '$24.00',
    url: 'https://trailpost.example/socks',
  });
  const res = await gifter.goto(`/c/${manageToken}`);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(gifter).toHaveTitle('Your claim | Hanker');
  await expect(gifter.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expect(gifter.getByRole('link', { name: "Ada's wishlist" })).toBeVisible();
  await expect(gifter.getByText('You’re getting 1 of the 3 Ada wants')).toBeVisible();
  await expect(gifter.getByText('Up to 3: 2 more are free')).toBeVisible();
  await expect(
    gifter.getByText('Ada can’t see who’s getting what, so the surprise is safe.'),
  ).toBeVisible();
  await expectAccessible(gifter);

  await gifter.getByLabel('Your name').fill('Priya K');
  await gifter.getByRole('button', { name: 'More' }).click();
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(gifter.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(gifter.getByText('You’re getting 2 of the 3 Ada wants')).toBeVisible();
  expect((await detailsOf(gifter, manageToken)).claim).toMatchObject({
    claimerName: 'Priya K',
    quantity: 2,
  });
  await expectFitsPhone(gifter, `/c/${manageToken}`);
});

test('raising past what is left says so, and sets the most (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, manageToken, gifter } = await claimed(page, browser, base, 'manage-409');
  await gifter.goto(`/c/${manageToken}`);
  await gifter.getByRole('button', { name: 'More' }).click();
  await gifter.getByRole('button', { name: 'More' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(gifter.getByRole('alert')).toHaveText(
    'Someone else claimed some, so you can have up to 2 now. We’ve set how many to 2.',
  );
  await expect(gifter.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('2');
});

test('cancelling asks first, then the link stops working (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, manageToken, gifter } = await claimed(page, browser, base, 'manage-cancel');
  await gifter.goto(`/c/${manageToken}`);
  await gifter.getByRole('button', { name: 'Cancel my claim' }).click();
  const dialog = gifter.getByRole('alertdialog', { name: 'Cancel your claim?' });
  await expect(dialog).toContainText('Merino socks goes back on the list for someone else.');
  await dialog.getByRole('button', { name: 'Keep my claim' }).click();
  await expect(gifter.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();

  await gifter.getByRole('button', { name: 'Cancel my claim' }).click();
  await gifter.getByRole('alertdialog').getByRole('button', { name: 'Cancel claim' }).click();
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'Your claim is cancelled.' }),
  ).toBeFocused();
  await expectAccessible(gifter);
  await gifter.getByRole('link', { name: "Back to Ada's wishlist" }).click();
  await expect(gifter).toHaveURL(`/s/${token}`);
  await expect(gifter.getByText('Priya')).toHaveCount(0);

  const res = await gifter.goto(`/c/${manageToken}`);
  expect(res?.status()).toBe(404);
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'This claim no longer exists.' }),
  ).toBeVisible();
});

test('opening the manage link on another device puts the claim on that device’s share page (D45)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, manageToken } = await claimed(page, browser, base, 'manage-device');
  const laptop = await (await guest(browser, base)).newPage();
  await laptop.goto(`/c/${manageToken}`);
  await expect(laptop.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await laptop.goto(`/s/${token}`);
  await expect(laptop.getByRole('listitem').first()).toContainText('You’re getting 1');
});

test('a dead or mangled manage link gets the gone page with a 404', async ({ browser, baseURL }) => {
  const visitor = await (await guest(browser, baseURL ?? '')).newPage();
  for (const path of ['/c/abcdefghijklmnopqrstuv', '/c/nope']) {
    const res = await visitor.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      visitor.getByRole('heading', { level: 1, name: 'This claim no longer exists.' }),
    ).toBeVisible();
  }
  await expectAccessible(visitor);
});
```

Run: `pnpm test:e2e -- tests/local/manage.spec.ts`
Expected: FAIL. `/c/…` is the generic 404.

- [ ] **Step 4: Build the page**

Create `apps/web/src/components/manage/claim-gone.tsx`:

```tsx
import Link from 'next/link';
import type { Ref } from 'react';

/** A claim that's gone (spec §2): for the 404 page, and for a change or cancel that finds it gone. */
export function ClaimGone({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display text-5xl leading-tight focus:outline-none"
      >
        This claim no longer exists.
      </h1>
      <p className="mt-4 text-muted-foreground">
        The owner may have removed the item. If you still have the list’s link, open it to see
        what’s on there now.
      </p>
      <p className="mt-8">
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          Go to the home page
        </Link>
      </p>
    </>
  );
}
```

Create `apps/web/src/app/c/[manageToken]/not-found.tsx`:

```tsx
import { ClaimGone } from '@/components/manage/claim-gone';
import { SiteHeader } from '@/components/site-header';

/** A manage link that's mistyped, or whose claim was cancelled or deleted (spec §2). */
export default function ClaimNotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <ClaimGone />
      </main>
    </>
  );
}
```

Create `apps/web/src/app/c/[manageToken]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ManageClaim } from '@/components/manage/manage-claim';
import { SiteHeader } from '@/components/site-header';
import { loadClaim } from '@/lib/shared-list.server';

export const metadata: Metadata = { title: 'Your claim' };

interface Props {
  params: Promise<{ manageToken: string }>;
}

/** `/c/[manageToken]` (spec §7): one claim, by its private link. */
export default async function ManageClaimPage({ params }: Props) {
  const { manageToken } = await params;
  const details = await loadClaim(manageToken);
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-[680px] px-4 pt-10 pb-24 sm:px-7">
        <ManageClaim details={details} manageToken={manageToken} />
      </main>
    </>
  );
}
```

Create `apps/web/src/components/manage/change-claim-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClaimConflictProblemSchema,
  ClaimerNameSchema,
  ClaimSchema,
  ErrorCode,
  type ClaimDetailsResponse,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { QuantityStepper } from '@/components/list/quantity-stepper';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { dropRecord, updateRecords } from '@/lib/claim-records';
import { formErrorMap } from '@/lib/form-errors';
import { claimChangeConflictMessage, errorMessage, fieldErrors, hasCode } from '@/lib/messages';
import { manageHint } from '@/lib/share-copy';

const NameSchema = z.object({ claimerName: ClaimerNameSchema });

/** A new name, a new quantity, or both (spec §2, §5): up to what's left plus what it holds. */
export function ChangeClaimForm({
  details,
  manageToken,
  onGone,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
  onGone: () => void;
}) {
  const router = useRouter();
  // What the server holds now, so only what changed is sent.
  const [saved, setSaved] = useState(details.claim);
  const [quantity, setQuantity] = useState(details.claim.quantity);
  const [conflict, setConflict] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({
    resolver: zodResolver(NameSchema, { error: formErrorMap }),
    defaultValues: { claimerName: details.claim.claimerName },
  });
  const max = Math.max(1, details.remaining + details.claim.quantity);
  const changed = isDirty || quantity !== saved.quantity;

  const onSubmit = handleSubmit(async ({ claimerName }) => {
    setSavedNotice(null);
    setConflict(null);
    setFormError(null);
    const body = {
      ...(claimerName !== saved.claimerName ? { claimerName } : {}),
      ...(quantity !== saved.quantity ? { quantity } : {}),
    };
    if (Object.keys(body).length === 0) return;
    try {
      const claim = await browserApi.patch(`/claims/${manageToken}`, body, ClaimSchema);
      setSaved(claim);
      reset({ claimerName: claim.claimerName });
      setQuantity(claim.quantity);
      setSavedNotice((last) => (last ?? 0) + 1);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.NOT_FOUND)) {
        updateRecords((all) => dropRecord(all, manageToken));
        onGone();
        return;
      }
      if (hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING)) {
        // The 409 carries what's left beyond every claim (Plan 4a rule 7).
        const left =
          error instanceof ApiError
            ? (ClaimConflictProblemSchema.safeParse(error.problem).data?.remaining ?? 0)
            : 0;
        const most = left + saved.quantity;
        setQuantity(most);
        setConflict(claimChangeConflictMessage(most));
        router.refresh();
        return;
      }
      const nameError = fieldErrors(error).claimerName;
      if (nameError) {
        setError('claimerName', { message: nameError }, { shouldFocus: true });
        return;
      }
      setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="change-heading" className="mt-5">
      <h2 id="change-heading" className="font-display text-3xl">
        Change your claim
      </h2>
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-5">
        {conflict ? <Notice tone="error">{conflict}</Notice> : null}
        <Field
          id="claimerName"
          label="Your name"
          hint="Other gifters see it, so nobody doubles up."
          error={errors.claimerName?.message}
        >
          {(control) => <Input {...control} {...register('claimerName')} autoComplete="name" />}
        </Field>
        <QuantityStepper
          id="claim-quantity"
          value={quantity}
          onChange={setQuantity}
          max={max}
          hint={manageHint(details.remaining, details.claim.quantity)}
        />
        <Button type="submit" disabled={isSubmitting || !changed} className="w-full">
          Save changes
        </Button>
      </form>
      <div role="status">
        {savedNotice !== null && !changed ? (
          <Notice key={savedNotice} tone="success" announce={false} className="mt-4">
            Saved.
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
```

Create `apps/web/src/components/manage/cancel-claim.tsx`:

```tsx
'use client';

import { ErrorCode, type ClaimDetailsResponse } from '@wishlist/contracts';
import { useState } from 'react';
import { CloseIcon } from '@/components/list/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { dropRecord, updateRecords } from '@/lib/claim-records';
import { errorMessage, hasCode } from '@/lib/messages';

/** Cancel the claim, after a confirmation (spec §2). The link stops working, so it's forgotten. */
export function CancelClaim({
  details,
  manageToken,
  onCancelled,
  onGone,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
  onCancelled: () => void;
  onGone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setError(null);
    try {
      await browserApi.delete(`/claims/${manageToken}`, NoContentSchema, {});
    } catch (failure) {
      if (!hasCode(failure, ErrorCode.NOT_FOUND)) {
        setError(errorMessage(failure));
        return;
      }
      updateRecords((all) => dropRecord(all, manageToken));
      onGone();
      return;
    }
    updateRecords((all) => dropRecord(all, manageToken));
    onCancelled();
  }

  return (
    <div className="mt-8 border-t border-foreground/15 pt-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="link" className="text-destructive">
            <CloseIcon />
            Cancel my claim
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Cancel your claim?</AlertDialogTitle>
          <AlertDialogDescription>
            {details.item.title} goes back on the list for someone else.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my claim</AlertDialogCancel>
            <AlertDialogAction onClick={() => void cancel()}>Cancel claim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
```

Create `apps/web/src/components/manage/manage-claim.tsx`:

```tsx
'use client';

import type { ClaimDetailsResponse } from '@wishlist/contracts';
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, EyeOffIcon } from '@/components/list/icons';
import { CARD, ItemCardBody } from '@/components/share/share-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveRecord, updateRecords } from '@/lib/claim-records';
import { ownerSeesLine, yourClaimLine } from '@/lib/share-copy';
import { useFocusOnMount } from '@/lib/use-focus-on-mount';
import { cn } from '@/lib/utils';
import { CancelClaim } from './cancel-claim';
import { ChangeClaimForm } from './change-claim-form';
import { ClaimGone } from './claim-gone';

/** One claim, by its manage link (spec §2, §7, the Plan 4b mockups). */
export function ManageClaim({
  details,
  manageToken,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
}) {
  const [state, setState] = useState<'open' | 'cancelled' | 'gone'>('open');

  // This device now knows the claim, so its share page shows it too (D45).
  useEffect(() => {
    updateRecords((all) =>
      saveRecord(all, { itemId: details.item.id, manageToken, claimId: details.claim.id }),
    );
  }, [details.item.id, details.claim.id, manageToken]);

  if (state === 'cancelled') return <ClaimCancelled details={details} />;
  if (state === 'gone') return <GoneNow />;
  return (
    <>
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Your claim</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        On{' '}
        <a
          href={details.shareUrl}
          className="inline-flex min-h-11 items-center font-medium text-foreground underline [overflow-wrap:anywhere]"
        >
          {details.wishlistTitle}
        </a>
      </p>
      <article aria-labelledby={`item-${details.item.id}`} className={cn(CARD, 'mt-3')}>
        <ItemCardBody
          item={details.item}
          footer={
            <p className="mt-3 flex items-center gap-2 rounded-control bg-success-wash px-3.5 py-2.5 text-[15px] font-medium text-success-foreground">
              <CheckIcon />
              {yourClaimLine(details.claim.quantity, details.item.quantity, details.ownerDisplayName)}
            </p>
          }
        />
      </article>
      <ChangeClaimForm details={details} manageToken={manageToken} onGone={() => setState('gone')} />
      <p className="mt-5 flex items-start gap-2 text-sm leading-snug text-muted-foreground">
        {details.ownerSeesClaims ? null : <EyeOffIcon />}
        {ownerSeesLine(details.ownerDisplayName, details.ownerSeesClaims)}
      </p>
      <PageLink manageToken={manageToken} />
      <CancelClaim
        details={details}
        manageToken={manageToken}
        onCancelled={() => setState('cancelled')}
        onGone={() => setState('gone')}
      />
    </>
  );
}

/** Copy this page's own link: the only way back from another device (spec §7). */
function PageLink({ manageToken }: { manageToken: string }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const say = (text: string) => setMessage((last) => ({ text, id: (last?.id ?? 0) + 1 }));
  async function copy() {
    const url = `${window.location.origin}/c/${manageToken}`;
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${url}`);
    }
  }
  return (
    <section aria-labelledby="page-link-heading" className="mt-6">
      <h2 id="page-link-heading" className="text-[15px] font-semibold">
        This page’s link
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        It’s the only way back to your claim from another phone or computer.
      </p>
      <Button variant="secondary" size="compact" className="mt-3" onClick={() => void copy()}>
        <CopyIcon />
        Copy link
      </Button>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-3">
            {message.text}
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

/** Shown in the browser: a refresh would fetch a link that no longer works (spec §7). */
function ClaimCancelled({ details }: { details: ClaimDetailsResponse }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="pt-6">
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-[clamp(2.5rem,6vw,3.5rem)] leading-tight focus:outline-none"
      >
        Your claim is cancelled.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {details.item.title} is back on {details.ownerDisplayName}’s list for someone else to get.
        This page’s link no longer works.
      </p>
      <a
        href={details.shareUrl}
        className={cn(buttonVariants({ variant: 'secondary' }), 'mt-7 w-full [overflow-wrap:anywhere]')}
      >
        Back to {details.wishlistTitle}
      </a>
    </div>
  );
}

function GoneNow() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="pt-6">
      <ClaimGone headingRef={heading} />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e -- tests/local/manage.spec.ts tests/local/claim.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Run the layer's gate, then commit**

Run the full gate. Expected: all green.

```bash
git add apps/web e2e
git commit -m "feat(web): change or cancel a claim from its manage link

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 6: The owner's spoiler toggle, and claims on the editor's rows (D33)

**Files:**
- Modify: `apps/web/src/lib/list-cache.ts`, `apps/web/src/lib/list-cache.spec.ts`
- Create: `apps/web/src/lib/editor-claims.ts`, `apps/web/src/lib/editor-claims.spec.ts`
- Modify: `apps/web/src/components/list/item-row.tsx` (`ItemSummary`)
- Modify: `apps/web/src/components/list/list-editor.tsx`
- Modify: `apps/web/src/components/query-provider.tsx`
- Create: `apps/web/src/components/account/claims-card.tsx`
- Modify: `apps/web/src/app/(account)/settings/page.tsx`
- Create: `e2e/tests/local/owner-claims.spec.ts`

**Interfaces:**
- Consumes: `remainingOf` (Task 1), `joinNames` (Task 3), `CheckIcon` (Task 3), `updateCachedList` (Plan 3b).
- Produces: `stripClaims(list: WishlistResponse): WishlistResponse`; `appendItem`/`replaceItem` keep claim fields for an opted-in list; `editorClaimLine(item: Pick<Item, 'quantity' | 'claims'>): { text: string; kind: 'none' | 'some' | 'taken' } | null`; `invalidateCachedList(): void`; `ClaimsCard({ showClaimsToOwner })`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add web/owner-claims
```

- [ ] **Step 1: Write the failing unit tests**

In `apps/web/src/lib/list-cache.spec.ts`, add `stripClaims` to the import from `./list-cache`, and add:

```ts
const claimOf = (n: number, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  claimerName,
  quantity,
});
const optedIn = (...items: Item[]): WishlistResponse => ({
  ...list(...items),
  showClaimsToOwner: true,
});

describe('claim fields in the cache (Plan 4b rule 13)', () => {
  it('keeps an item’s claims across an edit, and recomputes what is left', () => {
    const before = optedIn(item(1, { quantity: 3, claims: [claimOf(1, 'Sam')], remaining: 2 }));
    const after = replaceItem(before, item(1, { quantity: 2, title: 'Kettle' }));
    expect(after.items[0]).toMatchObject({
      title: 'Kettle',
      quantity: 2,
      claims: [claimOf(1, 'Sam')],
      remaining: 1,
    });
  });

  it('gives a new item no claims and all of it left', () => {
    expect(appendItem(optedIn(), item(2, { quantity: 3 })).items[0]).toMatchObject({
      claims: [],
      remaining: 3,
    });
  });

  it('adds nothing for an owner who hasn’t opted in (spec §5.1)', () => {
    const appended = appendItem(list(), item(2)).items[0];
    expect(appended).not.toHaveProperty('claims');
    expect(appended).not.toHaveProperty('remaining');
    const replaced = replaceItem(list(item(1)), item(1, { title: 'Kettle' })).items[0];
    expect(replaced).not.toHaveProperty('claims');
  });

  it('strips every claim field, and the setting, when the owner opts out', () => {
    const stripped = stripClaims(
      optedIn(item(1, { claims: [claimOf(1, 'Sam')], remaining: 0 }), item(2)),
    );
    expect(stripped.showClaimsToOwner).toBe(false);
    for (const each of stripped.items) {
      expect(each).not.toHaveProperty('claims');
      expect(each).not.toHaveProperty('remaining');
    }
    expect(stripped.items.map((each) => each.title)).toEqual(['Item 1', 'Item 2']);
  });
});
```

Create `apps/web/src/lib/editor-claims.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { editorClaimLine } from './editor-claims';

const claim = (n: number, claimerName: string, quantity = 1) => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  claimerName,
  quantity,
});

describe('editorClaimLine (the Plan 4b mockups)', () => {
  it('says nothing unless the owner has opted in (spec §5.1)', () => {
    expect(editorClaimLine({ quantity: 1 })).toBeNull();
  });

  it('says when nobody has claimed it yet', () => {
    expect(editorClaimLine({ quantity: 1, claims: [] })).toEqual({
      text: 'No claims yet',
      kind: 'none',
    });
  });

  it('names who is getting an item nobody else can claim', () => {
    expect(editorClaimLine({ quantity: 1, claims: [claim(1, 'Aunt Sue')] })).toEqual({
      text: 'Aunt Sue is getting this',
      kind: 'taken',
    });
    expect(
      editorClaimLine({ quantity: 2, claims: [claim(1, 'Aunt Sue'), claim(2, 'Sam')] }),
    ).toEqual({ text: 'Aunt Sue and Sam are getting this', kind: 'taken' });
    // Fewer wanted than claimed (D19) still reads as taken.
    expect(editorClaimLine({ quantity: 1, claims: [claim(1, 'Sam', 3)] })?.kind).toBe('taken');
  });

  it('lists who is getting how many, and what is left', () => {
    expect(
      editorClaimLine({ quantity: 3, claims: [claim(1, 'Sam'), claim(2, 'Priya')] }),
    ).toEqual({ text: 'Sam ×1, Priya ×1 · 1 left', kind: 'some' });
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/list-cache.spec.ts src/lib/editor-claims.spec.ts`
Expected: FAIL. `stripClaims` and `./editor-claims` don't exist, and the opted-in cases lose their claims.

- [ ] **Step 2: Implement the cache rules and the claim line**

In `apps/web/src/lib/list-cache.ts`, change the import to `import { remainingOf, type Item, type WishlistResponse } from '@wishlist/contracts';` and replace `appendItem` and `replaceItem`:

```ts
const optedIn = (list: WishlistResponse) => list.showClaimsToOwner === true;
const claimed = (claims: readonly { quantity: number }[]) =>
  claims.reduce((sum, claim) => sum + claim.quantity, 0);

/**
 * Appends `item`, once: an item already in the list stays where it is. On an opted-in list a new
 * item has no claims yet, and all of it is left (Plan 4b rule 13).
 */
export function appendItem(list: WishlistResponse, item: Item): WishlistResponse {
  if (list.items.some((existing) => existing.id === item.id)) return list;
  const added =
    optedIn(list) && item.claims === undefined
      ? { ...item, claims: [], remaining: item.quantity }
      : item;
  return { ...list, items: [...list.items, added] };
}

/**
 * Puts an item write's answer in place. The answer carries no claim fields, so an opted-in list
 * keeps the claims it had and works out what's left from the new quantity (Plan 4b rule 13).
 */
export function replaceItem(list: WishlistResponse, item: Item): WishlistResponse {
  return {
    ...list,
    items: list.items.map((existing) => {
      if (existing.id !== item.id) return existing;
      if (!optedIn(list) || item.claims !== undefined || existing.claims === undefined) return item;
      return {
        ...item,
        claims: existing.claims,
        remaining: remainingOf(item.quantity, claimed(existing.claims)),
      };
    }),
  };
}

function withoutClaims(item: Item): Item {
  const copy = { ...item };
  delete copy.claims;
  delete copy.remaining;
  return copy;
}

/** The list as an owner who just opted out sees it: no claim data at all (spec §5.1). */
export function stripClaims(list: WishlistResponse): WishlistResponse {
  return { ...list, showClaimsToOwner: false, items: list.items.map(withoutClaims) };
}
```

Create `apps/web/src/lib/editor-claims.ts`:

```ts
import { remainingOf, type Item } from '@wishlist/contracts';
import { joinNames } from './share-copy';

export interface EditorClaimLine {
  text: string;
  kind: 'none' | 'some' | 'taken';
}

/**
 * The line under an item on /list once the owner has opted in (D33, the Plan 4b mockups). Null
 * when the API sent no claims: the owner hasn't opted in (spec §5.1).
 */
export function editorClaimLine({
  quantity,
  claims,
}: Pick<Item, 'quantity' | 'claims'>): EditorClaimLine | null {
  if (claims === undefined) return null;
  if (claims.length === 0) return { text: 'No claims yet', kind: 'none' };
  const remaining = remainingOf(
    quantity,
    claims.reduce((sum, claim) => sum + claim.quantity, 0),
  );
  if (remaining === 0) {
    const names = [...new Set(claims.map((claim) => claim.claimerName))];
    return {
      text: `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} getting this`,
      kind: 'taken',
    };
  }
  const who = claims.map((claim) => `${claim.claimerName} ×${claim.quantity}`).join(', ');
  return { text: `${who} · ${remaining} left`, kind: 'some' };
}
```

In `apps/web/src/components/query-provider.tsx`, add after `updateCachedList`:

```ts
/** Marks the cached list stale, so /list fetches it again when it next shows (Plan 4b rule 12). */
export function invalidateCachedList(): void {
  void browser?.client.invalidateQueries({ queryKey: WISHLIST_KEY });
}
```

Run the two unit test files. Expected: PASS.

- [ ] **Step 3: Write the failing E2E tests**

Create `e2e/tests/local/owner-claims.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import type { WishlistResponse } from '@wishlist/contracts';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

const toggle = (page: Page) => page.getByRole('switch', { name: 'Show me who’s getting what' });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const row = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Your items, most wanted first' })
    .getByRole('listitem')
    .filter({ hasText: title });
const setting = async (page: Page) =>
  ((await (await page.request.get('/api/wishlist')).json()) as WishlistResponse).showClaimsToOwner;

test('turning claims on asks first, and keeping the surprise changes nothing (spec §2 Spoilers)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'toggle-ask');
  await page.goto('/settings');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await toggle(page).click();
  const dialog = page.getByRole('alertdialog', { name: 'See who’s getting what?' });
  await expect(dialog).toContainText('you can’t unsee what you’ve seen');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep it a surprise' }).click();
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await setting(page)).toBe(false);
});

test('with claims on, the owner sees them on /list and on their link, and gifters are told (D33, D40)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-on');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const socks = await addItemViaApi(page.request, base, { title: 'Merino socks', quantity: 3 });
  const token = await shareTokenOf(page.request);
  const sue = (await guest(browser, base)).request;
  await claimViaApi(sue, base, token, kettle.id, { claimerName: 'Aunt Sue' });
  await claimViaApi(sue, base, token, socks.id, { claimerName: 'Sam' });

  await page.goto('/list');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await toggle(page).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You’ll see who’s getting what.' })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(await setting(page)).toBe(true);

  // Back to the list by a client-side navigation: the cached list must fetch the claims.
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page.getByText('You can see who’s getting what.')).toBeVisible();
  await expect(row(page, 'Enamel kettle')).toContainText('Aunt Sue is getting this');
  await expect(row(page, 'Merino socks')).toContainText('Sam ×1 · 2 left');
  await expectAccessible(page);

  await page.goto(`/s/${token}`);
  await expect(page.getByText('You’ve chosen to see who’s getting what.')).toBeVisible();
  await expect(page.getByText('Taken care of: Aunt Sue is getting this')).toBeVisible();

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  await expect(gifter.getByText('Ada can see who’s getting what.')).toBeVisible();
});

test('while on, an edit keeps its row’s claim line, and a new item has none yet (Plan 4b rule 13)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-edit');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });
  const on = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });
  expect(on.status()).toBe(200);

  await page.goto('/list');
  // The row is found by its title button's text, which keeps the old title until the save lands.
  const kettleRow = row(page, 'Enamel kettle');
  await kettleRow.getByRole('button', { name: /^Enamel kettle/ }).click();
  await kettleRow.getByLabel('Title', { exact: true }).fill('Enamel stovetop kettle');
  await kettleRow.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved “Enamel stovetop kettle”.' })).toBeVisible();
  await expect(row(page, 'Enamel stovetop kettle')).toContainText('Aunt Sue is getting this');

  await page.getByLabel('Add to your list').fill('Pottery class for two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(row(page, 'Pottery class for two')).toContainText('No claims yet');
});

test('turning claims off hides them at once, with no reload (Review Focus 5)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-off');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });
  await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });

  await page.goto('/list');
  await expect(row(page, 'Enamel kettle')).toContainText('Aunt Sue is getting this');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  // Hold every list fetch, so only the cache can be what /list shows next.
  await page.route('**/api/wishlist', (route) =>
    route.request().method() === 'GET' ? new Promise(() => undefined) : route.continue(),
  );
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'Claims are hidden from you again.' })).toBeVisible();
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(row(page, 'Enamel kettle')).toBeVisible();
  await expect(page.getByText('Aunt Sue')).toHaveCount(0);
  await expect(page.getByText('You can see who’s getting what.')).toHaveCount(0);
});
```

(The last test holds `GET /api/wishlist` forever, so a refetch can't hide a cache that still held the claims. The `/list` page's server render calls the API directly, not through this route, so it isn't held; it's a client navigation in any case.)

Run: `pnpm test:e2e -- tests/local/owner-claims.spec.ts`
Expected: FAIL. There's no switch on `/settings`.

- [ ] **Step 4: Build the toggle and the claim lines**

Create `apps/web/src/components/account/claims-card.tsx`:

```tsx
'use client';

import { ErrorCode, WishlistSettingsResponseSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { invalidateCachedList, updateCachedList } from '@/components/query-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { stripClaims } from '@/lib/list-cache';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/**
 * The spoiler setting (spec §2 Spoilers, D33). Turning it on asks first; turning it off doesn't,
 * and drops the claims this browser holds before the request returns (Plan 4b rule 12).
 */
export function ClaimsCard({ showClaimsToOwner }: { showClaimsToOwner: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(showClaimsToOwner);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  async function save(next: boolean) {
    setBusy(true);
    setFormError(null);
    setOn(next);
    if (!next) updateCachedList(stripClaims);
    try {
      const settings = await browserApi.patch(
        '/wishlist',
        { showClaimsToOwner: next },
        WishlistSettingsResponseSchema,
      );
      const savedOn = settings.showClaimsToOwner === true;
      setOn(savedOn);
      if (savedOn) {
        updateCachedList((list) => ({ ...list, showClaimsToOwner: true }));
        invalidateCachedList();
      }
      setMessage((last) => ({
        text: savedOn ? 'You’ll see who’s getting what.' : 'Claims are hidden from you again.',
        id: (last?.id ?? 0) + 1,
      }));
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      // The server still has the old setting: the refetch brings the list back in line with it.
      setOn(!next);
      invalidateCachedList();
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="claims-heading">
      <h2 id="claims-heading" className="font-display text-3xl">
        Claims
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        {on
          ? 'You can see who claimed each item, on your list and on your share page. Gifters are told you can see.'
          : 'Gifters claim items so nobody buys the same thing twice. You can’t see their claims, so your gifts stay a surprise.'}
      </p>
      <div className="mt-4 flex min-h-11 items-center gap-3">
        <span id="claims-switch-label" className="flex-1 text-[15px] font-semibold">
          Show me who’s getting what
        </span>
        <button
          ref={toggle}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="claims-switch-label"
          disabled={busy}
          onClick={() => (on ? void save(false) : setConfirming(true))}
          className="group inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-[1.5px] border-input bg-card p-[3px] disabled:opacity-60 aria-checked:border-foreground aria-checked:bg-foreground"
        >
          <span className="size-6 rounded-full bg-input transition-transform group-aria-checked:translate-x-5 group-aria-checked:bg-background motion-reduce:transition-none" />
        </button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            toggle.current?.focus();
          }}
        >
          <AlertDialogTitle>See who’s getting what?</AlertDialogTitle>
          <AlertDialogDescription>
            Your list and your share page will show who claimed each item, and how many are left.
            Gifters will see a note that you can see their claims. You can turn this off again, but
            you can’t unsee what you’ve seen.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it a surprise</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save(true)}>Show me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
```

In `apps/web/src/app/(account)/settings/page.tsx`, import `ClaimsCard` and add it after `<ShareLinkCard … />`:

```tsx
              <ClaimsCard showClaimsToOwner={list.showClaimsToOwner === true} />
```

In `apps/web/src/components/list/item-row.tsx`, import `editorClaimLine` from `@/lib/editor-claims` and `CheckIcon` from `./icons`, and in `ItemSummary`, after the details `<span>…</span>`, add:

```tsx
      {claimLine ? (
        <span
          className={cn(
            'mt-0.5 flex items-center gap-1.5 text-sm [overflow-wrap:anywhere]',
            claimLine.kind === 'none' ? 'text-muted-foreground' : 'text-success-foreground',
            claimLine.kind === 'taken' && 'font-medium',
          )}
        >
          {claimLine.kind === 'taken' ? <CheckIcon /> : null}
          {claimLine.text}
        </span>
      ) : null}
```

with `const claimLine = editorClaimLine(item);` beside `const shop = shopName(item.url);`.

In `apps/web/src/components/list/list-editor.tsx`, import `Link` from `next/link` and add after the intro paragraph:

```tsx
      {list.showClaimsToOwner ? (
        <p className="mt-2 text-[15px] text-muted-foreground">
          You can see who’s getting what.{' '}
          <Link href="/settings" className="font-medium text-foreground underline">
            Turn this off in Settings
          </Link>
          .
        </p>
      ) : null}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e -- tests/local/owner-claims.spec.ts tests/local/list.spec.ts tests/local/edit-item.spec.ts tests/local/settings.spec.ts
```
Expected: PASS. The 3b editor and settings tests still pass: an owner who hasn't opted in gets no claim line.

- [ ] **Step 6: Run the layer's gate, then commit**

Run the full gate. Expected: all green.

```bash
git add apps/web e2e
git commit -m "feat(web): let the owner choose to see claims, and show them on the list

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 7: A blocked or failed security check says so, and the stale reminder goes (D38)

**Files:**
- Modify: `apps/web/src/components/turnstile.tsx`
- Modify: `apps/web/src/components/auth/signup-form.tsx`, `apps/web/src/components/auth/email-link-form.tsx`
- Modify: `apps/web/src/lib/messages.ts`
- Create: `e2e/tests/local/go-live.spec.ts`

**Interfaces:**
- Produces: `TURNSTILE_BLOCKED`, `TURNSTILE_FAILED` in `messages.ts`. `Turnstile`'s props are unchanged.

- [ ] **Step 0: Start the layer**

```bash
gh stack add web/go-live-fixes
```

- [ ] **Step 1: Write the failing E2E tests**

Create `e2e/tests/local/go-live.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { passTurnstile } from '../../support/turnstile.js';

// Cloudflare's script, wherever the page asks for it.
const TURNSTILE_SCRIPT = '**/turnstile/v0/api.js*';
const FINISH_CHECK = 'Finish the check above, then try again.';

test('a blocked security check says why, instead of leaving the form stuck (D38)', async ({
  page,
}) => {
  await page.route(TURNSTILE_SCRIPT, (route) => route.abort('blockedbyclient'));
  for (const path of ['/signup', '/reset-password']) {
    await page.goto(path);
    await expect(page.getByRole('alert')).toHaveText(
      'We couldn’t load the security check. If you use a content blocker, allow hanker.dev, or try another browser.',
    );
  }
});

test('the reminder to finish the check goes once the check is done (D38)', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(uniqueEmail('finish-check'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(FINISH_CHECK)).toBeVisible();
  release();
  await passTurnstile(page);
  await expect(page.getByText(FINISH_CHECK)).toHaveCount(0);
});
```

Run: `pnpm test:e2e -- tests/local/go-live.spec.ts`
Expected: FAIL. Nothing says the script was blocked, and the reminder stays after the token arrives.

- [ ] **Step 2: Implement**

In `apps/web/src/lib/messages.ts`, after `FINISH_CHECK`:

```ts
/** Turnstile's script never loaded: a content blocker, or a network that drops it (D38). */
export const TURNSTILE_BLOCKED =
  'We couldn’t load the security check. If you use a content blocker, allow hanker.dev, or try another browser.';

/** The widget loaded, then failed. */
export const TURNSTILE_FAILED = 'The check didn’t work. Reload the page to try again.';
```

In `apps/web/src/components/turnstile.tsx`:
- import `Notice` from `@/components/ui/notice` and `TURNSTILE_BLOCKED`, `TURNSTILE_FAILED` from `@/lib/messages`;
- add `const [failure, setFailure] = useState<'blocked' | 'error' | null>(null);`;
- in `api.render`'s options, replace the two callbacks:

```ts
      callback: (token) => {
        setFailure(null);
        latest.current(token);
      },
      'expired-callback': () => latest.current(null),
      'error-callback': () => {
        latest.current(null);
        setFailure('error');
      },
```

- give `<Script>` `onError={() => setFailure('blocked')}`;
- after the widget's `<div ref={container} … />`, add:

```tsx
      {failure ? (
        <Notice tone="error">{failure === 'blocked' ? TURNSTILE_BLOCKED : TURNSTILE_FAILED}</Notice>
      ) : null}
```

- extend the doc comment: `A script that won't load, or a widget that fails, says so under the widget (D38).`

In both `signup-form.tsx` and `email-link-form.tsx`, add inside the component:

```ts
  // A token means the check is done, so a reminder to finish it is out of date (D38).
  const onToken = (next: string | null) => {
    setToken(next);
    if (next) setFormError((current) => (current === FINISH_CHECK ? null : current));
  };
```

and pass `onToken={onToken}` to `<Turnstile>` in place of `onToken={setToken}`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:e2e -- tests/local/go-live.spec.ts tests/local/signup.spec.ts tests/local/email-links.spec.ts`
Expected: PASS. The widget-error message has no automated test (Plan 4b rule 15); the executor ledgers that.

- [ ] **Step 4: Commit**

```bash
git add apps/web e2e
git commit -m "fix(web): say when the security check can't load, and clear the stale reminder once it passes

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 8: JSON on every bodiless write, and a list change that fails off-page (3b carries)

**Files:**
- Modify: `apps/web/src/lib/api-client.ts:49-67`, `apps/web/src/lib/api-client.spec.ts`
- Modify: `apps/web/src/lib/list-mutations.ts:92`, `apps/web/src/components/manage/cancel-claim.tsx`
- Create: `apps/web/src/lib/off-page-failure.ts`, `apps/web/src/lib/off-page-failure.spec.ts`
- Modify: `apps/web/src/components/query-provider.tsx`, `apps/web/src/components/list/list-editor.tsx`, `apps/web/src/components/account-header.tsx`
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `e2e/tests/local/go-live.spec.ts`

**Interfaces:**
- Produces: `reportListFailure(): void`, `editorShown(): () => void`, `hasUnseenListFailure(): boolean`, `useUnseenListFailure(): boolean`; `LIST_CHANGE_NOT_SAVED` in `messages.ts`. `createApiClient` sends `{}` for any non-GET request without a body.

- [ ] **Step 1: Write the failing unit tests**

In `apps/web/src/lib/api-client.spec.ts`, add inside `describe('createApiClient', …)`:

```ts
  it('sends {} as JSON on a write with no body, so the CSRF guard passes (spec §6.2, §7)', async () => {
    const { client, calls } = clientReturning(new Response(null, { status: 204 }));
    await client.delete('/claims/abcdefghijklmnopqrstuv', NoContentSchema);
    expect(calls[0]?.init.body).toBe('{}');
    expect(calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('sends no body and no content type on a GET', async () => {
    const { client, calls } = clientReturning(json({ id: 't1' }));
    await client.get('/things/t1', Thing);
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).not.toHaveProperty('content-type');
  });
```

Create `apps/web/src/lib/off-page-failure.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store is module state, so each test loads a fresh copy.
let store: typeof import('./off-page-failure');
beforeEach(async () => {
  vi.resetModules();
  store = await import('./off-page-failure');
});

describe('a list change that fails off-page (Plan 4b rule 14)', () => {
  it('is kept when the editor isn’t on screen', () => {
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(true);
  });

  it('is ignored while the editor is on screen: it says so itself', () => {
    const hide = store.editorShown();
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(false);
    hide();
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(true);
  });

  it('is cleared once the editor is shown again', () => {
    store.reportListFailure();
    store.editorShown();
    expect(store.hasUnseenListFailure()).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/api-client.spec.ts src/lib/off-page-failure.spec.ts`
Expected: FAIL. The bodiless DELETE sends no body, and `./off-page-failure` doesn't exist.

- [ ] **Step 2: Implement**

In `apps/web/src/lib/api-client.ts`, at the top of `request` after `const endpoint = …`, add:

```ts
    // Every write carries JSON, `{}` when it has nothing to send, so the CSRF guard's content-type
    // check holds for a bodiless write such as DELETE /claims/:manageToken (spec §6.2, §7).
    const payload = body === undefined && method !== 'GET' ? {} : body;
```

and use `payload` in place of `body` in the `content-type` and `body` lines of the `fetchFn` call.

In `apps/web/src/lib/list-mutations.ts`, change the delete to `api.delete(`/wishlist/items/${id}`, NoContentSchema)`. In `apps/web/src/components/manage/cancel-claim.tsx`, change it to `browserApi.delete(`/claims/${manageToken}`, NoContentSchema)`.

Create `apps/web/src/lib/off-page-failure.ts`:

```ts
import { useSyncExternalStore } from 'react';

// A list change keeps going when the owner leaves /list, but the editor that would say it failed
// has gone, and so have its mutate() callbacks. The mutation cache reports the failure here, and
// the account header shows it (Plan 4b rule 14).

let editors = 0;
let unseen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** A list change failed. Kept only when no editor is on screen to say so. */
export function reportListFailure(): void {
  if (editors > 0 || unseen) return;
  unseen = true;
  notify();
}

/** The editor is on screen: it reports its own failures, and stands in for any from before. */
export function editorShown(): () => void {
  editors += 1;
  if (unseen) {
    unseen = false;
    notify();
  }
  return () => {
    editors -= 1;
  };
}

export function hasUnseenListFailure(): boolean {
  return unseen;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnseenListFailure(): boolean {
  return useSyncExternalStore(subscribe, hasUnseenListFailure, () => false);
}
```

In `apps/web/src/components/query-provider.tsx`, import `MutationCache` from `@tanstack/react-query` and `reportListFailure` from `@/lib/off-page-failure`, and give `new QueryClient({…})` a mutation cache:

```ts
    // Every mutation here is a list change. One that fails after the editor has gone would
    // otherwise fail silently (Plan 3b carry).
    mutationCache: new MutationCache({ onError: () => reportListFailure() }),
```

In `apps/web/src/components/list/list-editor.tsx`, import `useEffect` and `editorShown`, and add at the top of `Editor`:

```ts
  useEffect(() => editorShown(), []);
```

In `apps/web/src/lib/messages.ts`, add:

```ts
/** On /settings, when a list change made on /list failed after the owner left it. */
export const LIST_CHANGE_NOT_SAVED = 'A change to your list didn’t save.';
```

In `apps/web/src/components/account-header.tsx`, import `useUnseenListFailure` and `LIST_CHANGE_NOT_SAVED`, add `const listFailed = useUnseenListFailure();`, and after the logout error notice add:

```tsx
        {current === 'settings' && listFailed ? (
          <Notice tone="error" className="basis-full">
            {LIST_CHANGE_NOT_SAVED}{' '}
            <Link href="/list" className="underline">
              Check your list
            </Link>
            .
          </Notice>
        ) : null}
```

Run the two unit test files. Expected: PASS.

- [ ] **Step 3: Write the E2E test**

Append to `e2e/tests/local/go-live.spec.ts` (add `import { addItemViaApi, verifiedOwner } from '../../support/owner.js';`):

```ts
test('a list change that fails after leaving the list still says so (3b carry)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'off-page');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/wishlist/items/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await held;
    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: 'e2e',
      }),
    });
  });
  const mainNav = page.getByRole('navigation', { name: 'Main' });
  await page.goto('/list');
  await page.getByRole('button', { name: /^Kettle/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Stovetop kettle');
  await page.getByRole('button', { name: 'Save' }).click();
  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('A change to your list didn’t save.');
  await page.getByRole('link', { name: 'Check your list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('A change to your list didn’t save.')).toHaveCount(0);
});
```

Run:
```bash
pnpm test:e2e -- tests/local/go-live.spec.ts tests/local/manage.spec.ts tests/local/edit-item.spec.ts
```
Expected: PASS. The manage page's cancel and the editor's delete now send no explicit body and still pass the CSRF guard.

- [ ] **Step 4: Commit**

```bash
git add apps/web e2e
git commit -m "fix(web): send JSON on every bodiless write, and report a list change that fails off-page

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 9: The golden path, the smoke test, and the docs

**Files:**
- Modify: `e2e/tests/local/golden-path.spec.ts`
- Modify: `e2e/tests/smoke/smoke.spec.ts`
- Modify: `AGENTS.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`, `docs/deployment.md`

- [ ] **Step 1: Put sharing and claiming on the golden path (spec §8)**

In `e2e/tests/local/golden-path.spec.ts`, add `browser` to the test's fixtures (`async ({ context, page, browser }) =>`), rename the test to `'a new person signs up, confirms, builds and shares a list, a gifter claims and manages it, the owner sees it, then renames, resets the password and leaves (spec §8)'`, and insert after the `Link copied.` assertion:

```ts
  // A gifter claims in another browser and changes the claim; the owner chooses to see it.
  const { shareUrl } = (await (await page.request.get('/api/wishlist')).json()) as {
    shareUrl: string;
  };
  const gifterContext = await browser.newContext();
  const gifter = await gifterContext.newPage();
  await gifter.goto(shareUrl);
  await gifter
    .getByRole('listitem')
    .filter({ hasText: 'Enamel kettle' })
    .getByRole('button', { name: 'I’ll get this' })
    .click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Aunt Sue');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  const manageUrl =
    (await gifter.getByRole('dialog').getByText(/\/c\/[\w-]{22}$/).textContent()) ?? '';
  await gifter.goto(manageUrl);
  await gifter.getByLabel('Your name').fill('Aunt Susan');
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(gifter.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await gifterContext.close();

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show me who’s getting what' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show me' }).click();
  await expect(
    page.getByRole('switch', { name: 'Show me who’s getting what' }),
  ).toHaveAttribute('aria-checked', 'true');
  await mainNav.getByRole('link', { name: 'Your list' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Enamel kettle' })).toContainText(
    'Aunt Susan is getting this',
  );
```

The test then carries on to Settings, as before.

- [ ] **Step 2: Add a read-only smoke test of the share page**

Append to `e2e/tests/smoke/smoke.spec.ts`:

```ts
test('an unknown share page is a 404 that search engines skip (spec §6.7)', async ({ page }) => {
  const res = await page.goto('/s/AAAAAAAAAAAAAAAAAAAAAA');
  expect(res?.status()).toBe(404);
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
  ).toBeVisible();
});
```

It writes nothing, so it's safe against previews and production.

- [ ] **Step 3: Update the docs**

In `AGENTS.md`:
- append to the **Claims (Plan 4a)** bullet: ` A claim may carry the client's own \`manageToken\`; the same token for the same item returns that claim with \`201\`, and on another item it's \`409 MANAGE_TOKEN_IN_USE\` (D42).`
- add to the **Web** list, after the `/list` editor bullet:

```markdown
  - **Share and claim pages (Plan 4b):** `/s/[shareToken]` and `/c/[manageToken]` are Server Components that read through `lib/shared-list.server.ts` (a dead link is `notFound()`). The claim sheet, the manage form and the "You're getting" strips are client islands that write through `browserApi` and then `router.refresh()`; TanStack Query isn't used there. The sheet mints the manage token and saves it under `localStorage` `hanker:claims`, by item ID, before it sends the claim, so a lost answer is replayed or found again on reload (D42, D45); storage that throws is treated as empty. Sentences built from claim numbers live in `lib/share-copy.ts`. Owner pages show claim data only from fields the API sent, and turning the setting off strips them from the editor's cache first (`stripClaims`).
```

In `docs/superpowers/plans/2026-10-07-roadmap.md`, change row 4b's plan cell to `[Share & claim web, and go-live](2026-10-14-plan-4b-share-claim-web.md)` and its status to `Done`.

In `docs/deployment.md`, under "Opening sign-up (end of Plan 4)", replace the line that begins `Then redeploy (or merge to` with:

````markdown
A runtime variable applies to the next deployment, so deploy `main` again and wait for every job to pass:

```bash
gh workflow run deploy.yml --ref main
```

Then check, without making an account: a sign-up with a made-up Turnstile token is now refused with `400 CAPTCHA_FAILED`, not `503 CAPTCHA_UNAVAILABLE`. Finally, sign up with a real address on https://hanker.dev, and check that the verification email arrives from `no-reply@mail.hanker.dev`.
````

- [ ] **Step 4: Run the whole gate, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
pnpm test:e2e
```
Expected: all green, the golden path included.

```bash
git add e2e AGENTS.md docs
git commit -m "docs: describe the share and claim pages, and put claiming on the golden path

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 10: ⏸ Checkpoint — review, submit, Ted's pass, merge, go live

Nothing in this task is automatic. Each **Ted** step waits for him.

- [ ] **Step 1: Final review.** The whole-branch review (Opus) over `main..web/go-live-fixes`, one fix wave, a scoped re-review. Rebase the stack if a fix lands in a lower layer (`gh stack rebase`), then rerun the gate.

- [ ] **Step 2: Ask Ted to approve the first submit of this stack.** On approval: `gh stack submit --open` from the top branch. Give every PR a Conventional Commit title and a summary body (`gh pr edit <n> --title … --body-file …`), each body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Wait for CI to pass on every PR.

- [ ] **Step 3: Ted's pass on the top PR's preview** (two devices: a phone and a laptop, as the preview's seeded owner, as in the 3b and 4a passes):
  1. On the laptop, copy the share link; open it on the phone. Claim an item.
  2. Both devices: open the sheet on the same last unit, and claim on both. One gets it; the other is told someone else did.
  3. **The lost answer (D42):** open the sheet, fill the name, turn on airplane mode, tap **Claim it**. The sheet says it couldn't reach Hanker. Turn airplane mode off, tap **Try again**: one claim, with its link. Then repeat, but reload the page instead of **Try again**: the strip comes back.
  4. Manage: change the name and quantity; cancel; open a manage link on the laptop, then the share page there shows the strip.
  5. The owner's own link with the toggle off (no claims shown anywhere), then on (claims on `/list` and the link), then off again (gone at once).
  6. A short screen-reader check (Orca and Firefox, as in 3b): the sheet announces its title and line; a 409 is read; the cancel dialog announces its title and question.
  7. Tell Ted about Plan 4b rule 6: the 3b share board's "Get the last one too" button isn't built; a gifter raises their claim on its manage page.

- [ ] **Step 4: Ted merges** with `gh stack merge <top PR> --squash`. Never merge for him.

- [ ] **Step 5: Verify production, read-only (still dark):**
  - the deploy passes every job, the smoke tests included;
  - `/api/health` reports the merge SHA and `migrationsApplied: 4` (this plan adds no migration);
  - `https://hanker.dev/s/AAAAAAAAAAAAAAAAAAAAAA` is a 404 with `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`; `/c/AAAAAAAAAAAAAAAAAAAAAA` likewise;
  - `https://hanker.dev/robots.txt` disallows `/s/` and `/c/`;
  - a well-formed sign-up still answers `503 CAPTCHA_UNAVAILABLE`.

- [ ] **Step 6: Ted opens sign-up.** He follows `docs/deployment.md` "Opening sign-up": sets `TURNSTILE_SECRET_KEY` himself with the hidden prompt, then runs the deploy. Nobody else reads, echoes or sets the secret (D31).

- [ ] **Step 7: Verify sign-up is open,** read-only: a well-formed sign-up with a made-up Turnstile token answers `400 CAPTCHA_FAILED` (refused before any account or email). Then Ted signs up with a real address from his phone, confirms the email from `no-reply@mail.hanker.dev`, builds a list and shares it. Hanker is live.

- [ ] **Step 8: Clean up.** Delete this plan's SDD workspace; `gh stack sync --prune`; switch to `main` and pull; record the merge SHA and the go-live date in the roadmap if Step 3 of Task 9 didn't already, and in memory.
