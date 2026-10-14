# Plan 4a — Claims API (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API behind sharing and claiming:
- the share link's read, which knows the owner from a guest;
- claiming, serialized on the item so the last unit is never claimed twice;
- the private manage link: read, change and cancel a claim;
- the spoiler projection, `ownerSeesClaims` (D40) and `showClaimsToOwner` (D33);
- the go-live hardening that must land before sign-up opens: unfurl's DNS lookups off libuv's threadpool, a raw-byte cap on compressed bodies, and blank-looking names refused (D41).

All of it ships dark: sign-up stays closed until the end of Plan 4b (D31, D39), and there's no web UI for any of it yet.

**Architecture:**
- **A new `ClaimsModule`** (`apps/api/src/claims/`) with two controllers:
  - `shared` (`GET /shared/:shareToken`, `POST /shared/:shareToken/items/:itemId/claims`), behind a new `OptionalSessionGuard` that resolves a session if there is one and never refuses;
  - `claims` (`GET`, `PATCH` and `DELETE /claims/:manageToken`), with no session at all: the token is the capability.
- **One pure projection.** `projectWishlist(items, claims, viewer)` is the only place claim data joins an item (spec §5.1). `GET /shared` and `GET /wishlist` both go through it.
- **Concurrency.** A claim write locks its item's row `FOR UPDATE` and nothing else (spec §6.3), so it keeps the users → wishlists → items lock order. A read that returns claims runs in one `REPEATABLE READ, READ ONLY` transaction.
- **Unfurl** gets a c-ares resolver (`unfurl/dns.ts`) with a concurrency cap and cancellation, and a raw-byte cap in `PageFetcher`.

**Tech Stack:** NestJS 12, Drizzle with `pg`, Zod 4, Vitest, Testcontainers. **No new dependencies.**

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §2 Claims, Spoilers, Share link and Visible text; §4 `claims`; §5 Public endpoints and "How the public endpoints work"; §5.1; §6.3; §6.6 (claim limits); §6.8 (resolver, raw cap); §8. It was amended for this plan (6a148c5 and this plan's commit): D39–D41, `ownerSeesClaims`, `manageUrl`, `SHARE_LINK_NOT_FOUND`, the claim-change cap, the per-list limit key, the c-ares resolver and the raw-byte cap.

The API it builds on is [Plan 3a](2026-10-12-plan-3a-owner-api.md). The web from [Plan 3b](2026-10-13-plan-3b-owner-web.md) is untouched: 4b builds the pages.

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1–3b still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`; relative imports in `api` and `contracts` end in `.js`.
- Exact version pins, and Vitest. **No new dependencies in this plan.**
- Explicit `@Inject(…)` on every constructor parameter, classes included.
- Every error is problem+json with a stable `code`. An error's `detail` never echoes what the caller sent.
- No personal data or tokens in logs. A share or manage token never appears in a log line or a problem body.
- State-changing test requests go through `test/support/client.ts`.
- A migration works alongside the API that's currently deployed (expand only here).
- Behavior changes are written test-first.
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it: replace `<the model that wrote this commit>` in the commit steps below, e.g. `Claude Sonnet 5.5`.

**Dark.** No environment variable, secret or Vercel setting changes. `TURNSTILE_SECRET_KEY` stays unset in production (D31).

**Web untouched.** No file under `apps/web` changes, except the one fallback Task 6 names if the contracts change breaks the settings form's types. The web must still typecheck, build and pass its tests.

**Lock order.** users → wishlists → items. A claim write locks only its item's row (`FOR UPDATE`), never a `wishlists` row.

**Reads with claims.** `GET /shared`, `GET /claims` and `GET /wishlist` read in one `db.transaction(…, SNAPSHOT)` where `SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' }`.

**Values fixed by this plan:**

| Thing | Value |
|---|---|
| Claimer name | `DisplayNameSchema`: trimmed, 1–50 UTF-16 units, visible characters only (D35, D41) |
| Claim quantity | Integer 1–99 (`QuantitySchema`); 1 when a create omits it |
| Share and manage tokens | 16 random bytes, base64url, 22 characters: `/^[A-Za-z0-9_-]{22}$/` (`CAPABILITY_TOKEN_PATTERN`) |
| Manage token storage | SHA-256, hex (`hashToken`), column `manage_token_hash`, unique |
| Manage URL | `${APP_ORIGIN}/c/${manageToken}` |
| Share URL | `${APP_ORIGIN}/s/${shareToken}` (unchanged) |
| Claim limits | `CLAIMS_PER_IP` 20 per 3600 s, key `ipRateLimitKey('claims:ip', ip)`; `CLAIMS_PER_LIST` 30 per 3600 s, key `rateLimitKey('claims:list', wishlistId)`. `POST …/claims` and `PATCH /claims/:t` share both; `DELETE` has none |
| New error codes | `CLAIM_EXCEEDS_REMAINING` (409, extension member `remaining`), `OWNER_CANNOT_CLAIM` (403), `SHARE_LINK_NOT_FOUND` (404) |
| Remaining | `max(0, item.quantity − Σ claim.quantity)` |
| New claim fits | `requested ≤ remaining` |
| Changed claim fits | `next ≤ remaining + current` (spec §2; §6.3 as amended) |
| DNS | c-ares `Resolver({ timeout: 2000, tries: 2 })`, one per lookup; A and AAAA in parallel; at most 4 lookups at once per process |
| Body caps | 1,048,576 bytes decoded (unchanged) and 1,048,576 raw bytes before decompression |
| Blank letters (D41) | U+115F, U+1160, U+3164, U+FFA0, U+2800, U+034F, U+17B4, U+17B5 |

## Rulings this plan makes on gaps in the spec

The executor records each one in the ledger as it lands.

1. **`projectWishlist(items, claims, viewer)`.** The spec writes `projectWishlist(wishlist, items, claims, viewer)`, but the list matters only for its `showClaimsToOwner`, which the owner viewer already carries. So the function takes the items, the claims and the viewer, and returns the items; each endpoint wraps them in its own envelope (owner: `{title, shareUrl, showClaimsToOwner, items}`; share page: `{title, ownerDisplayName, viewerIsOwner, ownerSeesClaims, items}`).
2. **Contracts import one way.** `ClaimSchema` and `ITEM_CLAIM_FIELDS` live in `wishlist.ts`, and `claims.ts` imports from `wishlist.ts` and `auth.ts`, never the reverse. An ESM import cycle between two schema modules fails at load time with a temporal-dead-zone error.
3. **A rotation racing a claim.** The list is found by its token outside the claim's transaction. A claim whose lookup ran just before a rotation committed still lands, exactly as one that arrived a moment earlier would. Its manage link works, as every claim's does after a rotation (spec §2).
4. **Order of refusals.** Nest runs guards (the optional session) and body validation before the handler, so a malformed token sent with an invalid body is a `400`, not a `404`. Neither reveals anything. Inside the handler, the order is the spec's.
5. **Owner detection** compares the session's user ID with the list's `owner_id`, verified or not. An unverified owner is still the owner.
6. **`DELETE /claims/:t` has no rate limit,** as spec §6.6 lists only `POST` and `PATCH`. A 128-bit token can't be guessed, and deleting can't over-commit anything.
7. **A `PATCH` claim's 409** carries the item's `remaining` (what's left beyond every claim), the same number `GET /claims` shows. The manage page adds the claim's current quantity to get its maximum.
8. **A `PATCH` claim's list bucket** is the list its item is on, found through the item.
9. **Responses.** `POST …/claims` → `201 {claim, manageToken, manageUrl}`; `GET /claims/:t` → `200` details; `PATCH /claims/:t` → `200` the claim; `DELETE /claims/:t` → `204`. Every new route sends `Cache-Control: no-store`.
10. **Claims are listed oldest first** (`created_at`, then `id`), so "Sue, then Sam" reads the same on every load.
11. **The built-title carry (Plan 2b).** `signup.int-spec.ts` has asserted `"Ada's wishlist"` since Plan 2a, so that carry was already met. What's missing is proof that *every* valid display name builds a valid title, which D41 now bears on. The template moves into contracts as `defaultWishlistTitle`, signup calls it, and a contracts test runs it over the edge-case names (Task 9).
12. **UTF-16 lengths stay** (D41). No schema changes how it counts.

## Review Focus

The input classes the spec implies but no requirement names, most likely to bite a person first. Each has a test in the task named.

1. **A share link copied from a text message arrives mangled:** a trailing full stop or bracket, a character short, or percent-encoded. It gets `404 SHARE_LINK_NOT_FOUND`, never a 400 or a 500. Task 3.
2. **A gifter's browser holds a session cookie that's dead** (expired, revoked, or from an account that's gone). The share page treats them as a guest, never answers 401, and sets no cookie. Task 3.
3. **The owner edits, reorders or deletes an item, or deletes the account, while a gifter is claiming it.** The claim is judged against whichever state committed first, or gets a `404`; never a 500, never a deadlock, and never a claim left on a deleted item. Task 4.
4. **A claimer's name is pasted with a trailing newline, or typed with an emoji or in Persian.** It's trimmed and kept. A name of only spaces, joiners or blank letters is a `400`. Tasks 1 and 9.
5. **The same manage link is used on two devices at once:** one cancels while the other changes the quantity. The change gets `404 NOT_FOUND` or lands just before the cancel; never a 500, and nothing is left behind. Task 5.

## Stacks and order

One stack, started on `docs/plan-4a` (already initialized, not submitted). One layer per reviewable concern; seven layers stay under Neon's preview cap.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-4a` | this plan, the spec amendments, the roadmap rows |
| `api/claims-model` | 1, 2 |
| `api/shared-read` | 3 |
| `api/claiming` | 4 |
| `api/manage-claims` | 5 |
| `api/owner-claims` | 6 |
| `api/go-live-hardening` | 7, 8, 9, 10 |

Then Task 11 is a ⏸ checkpoint: the final review, Ted's approval for the first submit, his merge, and production verified (still dark).

The first task in each layer starts with `gh stack add <branch>`. Nothing is pushed until Task 11.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/claims.ts` (new) | Claim request and response schemas, `CAPABILITY_TOKEN_PATTERN`, the 409 problem shape |
| `packages/contracts/src/wishlist.ts` | `ClaimSchema`, `ITEM_CLAIM_FIELDS`; later the owner's optional claim fields, `PATCH /wishlist`'s new shape, `defaultWishlistTitle` |
| `packages/contracts/src/text.ts` | `visibleOnly`, with blank letters (D41) |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/0003_claims.sql` | The `claims` table |
| `apps/api/src/claims/remaining.ts` (new) | Remaining and the two "fits" rules, pure |
| `apps/api/src/claims/projection.ts` (new) | `Viewer`, `ClaimRow`, `seesClaims`, `projectWishlist`, pure |
| `apps/api/src/claims/queries.ts` (new) | `SNAPSHOT`, column sets, `readSharedItems`, `readClaims`, `claimedTotal` |
| `apps/api/src/claims/claims-errors.ts` (new) | The claim failures |
| `apps/api/src/claims/rate-limits.ts` (new) | The two claim buckets and their keys |
| `apps/api/src/claims/shared-list.service.ts` (new) | `GET /shared` |
| `apps/api/src/claims/claims.service.ts` (new) | Create, details, change, cancel |
| `apps/api/src/claims/shared.controller.ts`, `claims.controller.ts`, `claims.module.ts` (new) | Routes and wiring |
| `apps/api/src/auth/session.guard.ts` | `OptionalSessionGuard`, `OptionalAuth` |
| `apps/api/src/wishlist/links.ts` (new) | `shareUrl`, `manageUrl` |
| `apps/api/src/wishlist/wishlist.service.ts`, `wishlist.controller.ts` | Owner reads through the projection; `PATCH /wishlist` takes `showClaimsToOwner` |
| `apps/api/src/unfurl/dns.ts` (new) | `createCaresResolve` |
| `apps/api/src/unfurl/page-fetcher.ts` | Passes the deadline to `resolve`; raw-byte cap |
| `apps/api/test/support/lists.ts`, `rate-limits.ts` (new) | Straight-to-the-database setup for claim tests |
| `apps/api/test/claims-schema.int-spec.ts`, `shared.int-spec.ts`, `claims.int-spec.ts`, `manage-claims.int-spec.ts` (new) | Integration tests |
| `e2e/tests/smoke/smoke.spec.ts` | The unknown-share-link smoke test |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use                                            # Node 24
pnpm --filter @wishlist/contracts test                                     # contracts unit tests
pnpm --filter @wishlist/contracts build                                    # before API tests, after a contracts change
pnpm --filter @wishlist/api exec vitest run --project unit <file-or-name>  # one API unit test file
pnpm --filter @wishlist/api exec vitest run --project integration <name>   # one integration file (Docker)
pnpm --filter @wishlist/api test:integration                               # every integration file (Docker)
```

The full gate, run at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
```

---

### Task 1: The claims contracts

**Files:**
- Modify: `packages/contracts/src/wishlist.ts` (add `ClaimSchema` and `ITEM_CLAIM_FIELDS` above `ItemSchema`)
- Create: `packages/contracts/src/claims.ts`
- Create: `packages/contracts/src/claims.spec.ts`
- Modify: `packages/contracts/src/error-codes.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (from `@wishlist/contracts`):
  - `ClaimSchema` / `Claim` = `{ id: string; claimerName: string; quantity: number }`
  - `ITEM_CLAIM_FIELDS` = `{ remaining: ZodOptional<ZodNumber>; claims: ZodOptional<ZodArray<typeof ClaimSchema>> }`
  - `CAPABILITY_TOKEN_PATTERN: RegExp`
  - `ClaimerNameSchema`, `CreateClaimRequestSchema` / `CreateClaimRequest` (`quantity` defaults to 1), `UpdateClaimRequestSchema` / `UpdateClaimRequest`
  - `SharedItemSchema` / `SharedItem`, `SharedWishlistResponseSchema` / `SharedWishlistResponse`
  - `CreateClaimResponseSchema` / `CreateClaimResponse`, `ClaimDetailsResponseSchema` / `ClaimDetailsResponse`, `ClaimConflictProblemSchema`
  - `ErrorCode.CLAIM_EXCEEDS_REMAINING`, `ErrorCode.OWNER_CANNOT_CLAIM`, `ErrorCode.SHARE_LINK_NOT_FOUND`

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/claims-model
```

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/claims.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TOKEN_PATTERN,
  ClaimConflictProblemSchema,
  ClaimDetailsResponseSchema,
  ClaimerNameSchema,
  CreateClaimRequestSchema,
  CreateClaimResponseSchema,
  SharedWishlistResponseSchema,
  UpdateClaimRequestSchema,
} from './claims.js';
import { ErrorCode } from './error-codes.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';
const TOKEN = 'abcdefghijklmnopqrstuv';
const ITEM = {
  id: ID,
  title: 'Kettle',
  url: null,
  imageUrl: null,
  priceText: '$40.00',
  note: null,
  quantity: 2,
};

describe('ClaimerNameSchema (spec §2: the display-name rule)', () => {
  it.each([
    [' Aunt Sue\n', 'Aunt Sue'],
    ['Zoë', 'Zoë'],
    ['\u{1F469}‍\u{1F373} Sam', '\u{1F469}‍\u{1F373} Sam'],
    ['می‌خواهم', 'می‌خواهم'],
  ])('keeps %j as %j (Review Focus 4)', (input, stored) => {
    expect(ClaimerNameSchema.parse(input)).toBe(stored);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['51 characters', 'a'.repeat(51)],
    ['a right-to-left override', 'Sue‮eus'],
    ['a newline inside', 'Aunt\nSue'],
  ])('refuses a name that is %s', (_label, input) => {
    expect(ClaimerNameSchema.safeParse(input).success).toBe(false);
  });
});

describe('CreateClaimRequestSchema (spec §5)', () => {
  it('claims one unless told otherwise', () => {
    expect(CreateClaimRequestSchema.parse({ claimerName: 'Sue' })).toEqual({
      claimerName: 'Sue',
      quantity: 1,
    });
  });

  it.each([0, 100, 1.5, '2'])('refuses a quantity of %j', (quantity) => {
    expect(CreateClaimRequestSchema.safeParse({ claimerName: 'Sue', quantity }).success).toBe(
      false,
    );
  });
});

describe('UpdateClaimRequestSchema (spec §5)', () => {
  it('takes a new name, a new quantity, or both', () => {
    expect(UpdateClaimRequestSchema.parse({ claimerName: ' Sam ' })).toEqual({
      claimerName: 'Sam',
    });
    expect(UpdateClaimRequestSchema.parse({ quantity: 2 })).toEqual({ quantity: 2 });
  });

  it('refuses a change that changes nothing', () => {
    expect(UpdateClaimRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('the public responses (spec §5)', () => {
  it('let the share page leave claim data out entirely (spec §5.1)', () => {
    const parsed = SharedWishlistResponseSchema.parse({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: true,
      ownerSeesClaims: false,
      items: [ITEM],
    });
    expect(parsed.items[0]).not.toHaveProperty('remaining');
    expect(parsed.items[0]).not.toHaveProperty('claims');
  });

  it('carry what is left and who is getting what when the viewer may see them', () => {
    const parsed = SharedWishlistResponseSchema.parse({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: false,
      ownerSeesClaims: false,
      items: [{ ...ITEM, remaining: 1, claims: [{ id: ID, claimerName: 'Sue', quantity: 1 }] }],
    });
    expect(parsed.items[0]?.remaining).toBe(1);
    expect(parsed.items[0]?.claims).toEqual([{ id: ID, claimerName: 'Sue', quantity: 1 }]);
  });

  it('return the manage link with a new claim', () => {
    const parsed = CreateClaimResponseSchema.parse({
      claim: { id: ID, claimerName: 'Sue', quantity: 1 },
      manageToken: TOKEN,
      manageUrl: `https://hanker.dev/c/${TOKEN}`,
    });
    expect(parsed.manageToken).toBe(TOKEN);
  });

  it('give the claimer the item without anyone else’s claims (spec §5.1)', () => {
    const parsed = ClaimDetailsResponseSchema.parse({
      claim: { id: ID, claimerName: 'Sue', quantity: 1 },
      item: ITEM,
      wishlistTitle: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      remaining: 1,
      shareUrl: `https://hanker.dev/s/${TOKEN}`,
      ownerSeesClaims: false,
    });
    expect(Object.keys(parsed.item).sort()).toEqual(
      ['id', 'imageUrl', 'note', 'priceText', 'quantity', 'title', 'url'].sort(),
    );
  });

  it('read how many are left from a 409', () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      requestId: 'r1',
      remaining: 0,
    };
    expect(ClaimConflictProblemSchema.parse(problem).remaining).toBe(0);
  });
});

describe('CAPABILITY_TOKEN_PATTERN (spec §4)', () => {
  it.each([TOKEN, 'A-_0123456789abcdefghi'])('matches %j', (token) => {
    expect(CAPABILITY_TOKEN_PATTERN.test(token)).toBe(true);
  });

  it.each([
    'abcdefghijklmnopqrstu',
    'abcdefghijklmnopqrstuvw',
    'abcdefghijklmnopqrstu.',
    'abcdefghijklmnopqrstu=',
    '',
  ])('refuses %j', (token) => {
    expect(CAPABILITY_TOKEN_PATTERN.test(token)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, because `./claims.js` doesn't exist.

- [ ] **Step 3: Add the claim shape to `wishlist.ts`**

In `packages/contracts/src/wishlist.ts`, directly above `/** An item as the owner sees it. …` (the `ItemSchema` comment), add:

```ts
/** A claim as gifters, and an owner who opted in, see it (spec §5). Never its manage token. */
export const ClaimSchema = z.object({
  id: z.uuid(),
  claimerName: z.string(),
  quantity: z.number().int(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * The claim fields an item carries when its viewer may see them (spec §5.1). They're optional
 * because the projection leaves them out, rather than empty, for everyone else.
 */
export const ITEM_CLAIM_FIELDS = {
  remaining: z.number().int().min(0).optional(),
  claims: z.array(ClaimSchema).optional(),
};
```

`claims.ts` imports these from `wishlist.ts`, never the reverse (Plan 4a rule 2).

- [ ] **Step 4: Write `claims.ts`**

Create `packages/contracts/src/claims.ts`:

```ts
import { z } from 'zod';
import { DisplayNameSchema } from './auth.js';
import { ProblemSchema } from './problem.js';
import { ClaimSchema, ITEM_CLAIM_FIELDS, ItemSchema, QuantitySchema } from './wishlist.js';

/**
 * A share or manage token: 16 random bytes, base64url without padding (spec §4). The API checks
 * path parameters against it first: a malformed token gets the same 404 as an unknown one.
 */
export const CAPABILITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A gifter's name, which the other gifters see: the display-name rule (spec §2, D35, D41). */
export const ClaimerNameSchema = DisplayNameSchema;

export const CreateClaimRequestSchema = z.object({
  claimerName: ClaimerNameSchema,
  quantity: QuantitySchema.default(1),
});
export type CreateClaimRequest = z.infer<typeof CreateClaimRequestSchema>;

/** A new name, a new quantity, or both (spec §5). */
export const UpdateClaimRequestSchema = z
  .object({ claimerName: ClaimerNameSchema.optional(), quantity: QuantitySchema.optional() })
  .refine((body) => body.claimerName !== undefined || body.quantity !== undefined, {
    message: 'Change the name or the quantity',
  });
export type UpdateClaimRequest = z.infer<typeof UpdateClaimRequestSchema>;

/**
 * An item on the share page (spec §5): the owner's fields without its position, plus `remaining`
 * and `claims` when the viewer may see them (spec §5.1).
 */
export const SharedItemSchema = ItemSchema.omit({ position: true }).extend(ITEM_CLAIM_FIELDS);
export type SharedItem = z.infer<typeof SharedItemSchema>;

/** `GET /shared/:shareToken` (spec §5). `ownerSeesClaims` is the list's setting (D40). */
export const SharedWishlistResponseSchema = z.object({
  title: z.string(),
  ownerDisplayName: z.string(),
  viewerIsOwner: z.boolean(),
  ownerSeesClaims: z.boolean(),
  items: z.array(SharedItemSchema),
});
export type SharedWishlistResponse = z.infer<typeof SharedWishlistResponseSchema>;

/** `201` from `POST …/claims`. The manage token is shown this once; the API keeps only its hash. */
export const CreateClaimResponseSchema = z.object({
  claim: ClaimSchema,
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN),
  manageUrl: z.url(),
});
export type CreateClaimResponse = z.infer<typeof CreateClaimResponseSchema>;

/**
 * `GET /claims/:manageToken`: the claimer's own view (spec §5.1). It always has `remaining`, and
 * never anyone else's claims.
 */
export const ClaimDetailsResponseSchema = z.object({
  claim: ClaimSchema,
  item: SharedItemSchema.omit({ remaining: true, claims: true }),
  wishlistTitle: z.string(),
  ownerDisplayName: z.string(),
  remaining: z.number().int().min(0),
  shareUrl: z.url(),
  ownerSeesClaims: z.boolean(),
});
export type ClaimDetailsResponse = z.infer<typeof ClaimDetailsResponseSchema>;

/** `409 CLAIM_EXCEEDS_REMAINING` says how many are left, so a stepper can reset (spec §7). */
export const ClaimConflictProblemSchema = ProblemSchema.extend({
  remaining: z.number().int().min(0),
});
```

- [ ] **Step 5: Add the error codes and the export**

In `packages/contracts/src/error-codes.ts`, after `ORDER_CONFLICT`, add:

```ts
  /** 409: a claim would take more than the item has left. Carries `remaining` (spec §5). */
  CLAIM_EXCEEDS_REMAINING: 'CLAIM_EXCEEDS_REMAINING',
  /** 403: the list's owner tried to claim from their own list (spec §2). */
  OWNER_CANNOT_CLAIM: 'OWNER_CANNOT_CLAIM',
  /** 404: a share link that's malformed, unknown, or was replaced by a rotation (spec §5). */
  SHARE_LINK_NOT_FOUND: 'SHARE_LINK_NOT_FOUND',
```

In `packages/contracts/src/index.ts`, add `export * from './claims.js';` in alphabetical order (after `./auth.js`).

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts exec tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts
git commit -F - <<'EOF'
feat(contracts): add the claims contracts

The share page's read, the claim request and its 201, the manage
page's details, a claim change, the 409's `remaining` member and three
error codes (spec §5, D40). Claim fields on an item are optional,
because the projection leaves them out for viewers who may not see
them (spec §5.1). A claimer's name follows the display-name rule.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 2: The claims table, remaining, and the projection

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create (generated, then edited): `apps/api/drizzle/0003_claims.sql`, `apps/api/drizzle/meta/0003_snapshot.json`, `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/test/claims-schema.int-spec.ts`
- Create: `apps/api/src/claims/remaining.ts`, `apps/api/src/claims/remaining.spec.ts`
- Create: `apps/api/src/claims/projection.ts`, `apps/api/src/claims/projection.spec.ts`

**Interfaces:**
- Consumes: `Claim` from `@wishlist/contracts` (Task 1).
- Produces:
  - `claims` table in `schema.ts`: `id`, `itemId`, `claimerName`, `quantity`, `manageTokenHash`, `createdAt`, `updatedAt`.
  - `remaining.ts`: `remainingOf(quantity: number, claimed: number): number`, `fitsNewClaim(requested: number, quantity: number, claimed: number): boolean`, `fitsChangedClaim(next: number, current: number, quantity: number, claimed: number): boolean` (`claimed` counts every claim, this one included).
  - `projection.ts`: `type Viewer = { kind: 'guest' } | { kind: 'owner'; showClaims: boolean }`, `interface ClaimRow { id: string; itemId: string; claimerName: string; quantity: number }`, `seesClaims(viewer: Viewer): boolean`, `projectWishlist<T extends { id: string; quantity: number }>(items: readonly T[], claims: readonly ClaimRow[], viewer: Viewer): ProjectedItem<T>[]` where `type ProjectedItem<T> = T & { remaining?: number; claims?: Claim[] }`.

- [ ] **Step 1: Write the table's failing test**

Create `apps/api/test/claims-schema.int-spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const LIST = '0199a3b2-0000-7000-8000-00000000000a';
const ITEM = '0199a3b2-0000-7000-8000-0000000000b1';

async function insertItem() {
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [ADA],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
    [LIST, ADA],
  );
  await db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position) values ($1, $2, 'Kettle', 2, 0)`,
    [ITEM, LIST],
  );
}

const insertClaim = (quantity: number, hash: string) =>
  db.pool.query(
    `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash)
     values (gen_random_uuid(), $1, 'Sue', $2, $3)`,
    [ITEM, quantity, hash],
  );

const count = async () =>
  Number((await db.pool.query<{ n: string }>('select count(*) as n from claims')).rows[0]?.n);

describe('claims (spec §4)', () => {
  it('rejects a quantity below 1', async () => {
    await insertItem();
    await expect(insertClaim(0, 'h0')).rejects.toThrow(/claims_quantity_check/);
  });

  it('allows one claim per manage token', async () => {
    await insertItem();
    await insertClaim(1, 'same');
    await expect(insertClaim(1, 'same')).rejects.toThrow(/claims_manage_token_hash_unique/);
  });

  it('goes with its item (spec §2)', async () => {
    await insertItem();
    await insertClaim(1, 'h1');
    await db.pool.query('delete from items');
    expect(await count()).toBe(0);
  });

  it('goes with the owner’s account, through the list and the item (spec §2)', async () => {
    await insertItem();
    await insertClaim(1, 'h1');
    await db.pool.query('delete from users');
    expect(await count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims-schema`
Expected: FAIL with `relation "claims" does not exist`.

- [ ] **Step 3: Add the table**

In `apps/api/src/db/schema.ts`, after the `items` table, add:

```ts
/**
 * Claims (spec §2, §4): who is getting how many of an item. Remaining is computed, never stored.
 * A claim reaches its list through its item, so deleting the item, the list or the account takes
 * the claim with it. The manage token is shown once; only its SHA-256 is kept.
 */
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    claimerName: text('claimer_name').notNull(),
    quantity: integer('quantity').notNull(),
    manageTokenHash: text('manage_token_hash').notNull().unique(),
    ...timestamps(),
  },
  (t) => [
    index('claims_item_id_idx').on(t.itemId),
    check('claims_quantity_check', sql`${t.quantity} >= 1`),
  ],
);
```

Then generate the migration:

```bash
pnpm --filter @wishlist/api db:generate --name claims
```

Open `apps/api/drizzle/0003_claims.sql`. As in every earlier migration, add these two lines at the very top:

```sql
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
```

Expected SQL after that (Drizzle's exact text wins):
- `CREATE TABLE "claims"` with `CONSTRAINT "claims_manage_token_hash_unique" UNIQUE("manage_token_hash")` and `CONSTRAINT "claims_quantity_check" CHECK ("claims"."quantity" >= 1)`;
- `ALTER TABLE "claims" ADD CONSTRAINT "claims_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action`;
- `CREATE INDEX "claims_item_id_idx" ON "claims" USING btree ("item_id")`.

It only adds a table, so the deployed API is unaffected. Lint it the way CI does:

```bash
npx --yes squawk-cli@2.67.0 apps/api/drizzle/0003_claims.sql
```

Expected: no violations, as with `0002_items.sql`, which has the same shape. Report the output either way.

- [ ] **Step 4: Run the table test to see it pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims-schema`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the arithmetic's failing test**

Create `apps/api/src/claims/remaining.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fitsChangedClaim, fitsNewClaim, remainingOf } from './remaining.js';

describe('remainingOf (spec §2)', () => {
  it.each([
    [3, 0, 3],
    [3, 2, 1],
    [3, 3, 0],
    // The owner lowered the quantity below what's claimed (D19): never negative.
    [1, 2, 0],
  ])('wants %i, %i claimed: %i left', (quantity, claimed, left) => {
    expect(remainingOf(quantity, claimed)).toBe(left);
  });
});

describe('fitsNewClaim (spec §6.3)', () => {
  it('fits up to what is left, and no more', () => {
    expect(fitsNewClaim(1, 3, 2)).toBe(true);
    expect(fitsNewClaim(2, 3, 2)).toBe(false);
    expect(fitsNewClaim(1, 1, 2)).toBe(false);
  });
});

describe('fitsChangedClaim (spec §2: up to remaining plus what it holds)', () => {
  it('lets a claim grow into what is left', () => {
    // Wants 3; this claim holds 1 and another holds 1: 1 left, so this one may hold 2.
    expect(fitsChangedClaim(2, 1, 3, 2)).toBe(true);
    expect(fitsChangedClaim(3, 1, 3, 2)).toBe(false);
  });

  it('never refuses keeping or lowering what a claim holds, even past an owner’s cut (D19)', () => {
    // Wants 1 now; this claim and another hold 1 each, so 2 are claimed.
    expect(fitsChangedClaim(1, 1, 1, 2)).toBe(true);
    // Wants 1 now; this claim holds 3.
    expect(fitsChangedClaim(2, 3, 1, 3)).toBe(true);
    expect(fitsChangedClaim(2, 1, 1, 2)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to see it fail, then write `remaining.ts`**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit remaining`
Expected: FAIL, because `./remaining.js` doesn't exist.

Create `apps/api/src/claims/remaining.ts`:

```ts
/**
 * How many of an item are still wanted (spec §2): what the owner wants less what's claimed. Never
 * stored, and never below 0, because an owner may lower a quantity below what's claimed (D19).
 */
export function remainingOf(quantity: number, claimed: number): number {
  return Math.max(0, quantity - claimed);
}

/** A new claim may take at most what's left (spec §6.3). */
export function fitsNewClaim(requested: number, quantity: number, claimed: number): boolean {
  return requested <= remainingOf(quantity, claimed);
}

/**
 * A changed claim may hold up to what's left plus what it holds already (spec §2, and §6.3 as
 * amended in Plan 4a). `claimed` counts every claim on the item, this one included. Keeping or
 * lowering a quantity always fits, even after the owner wanted fewer than were claimed.
 */
export function fitsChangedClaim(
  next: number,
  current: number,
  quantity: number,
  claimed: number,
): boolean {
  return next <= remainingOf(quantity, claimed) + current;
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit remaining`
Expected: PASS.

- [ ] **Step 7: Write the projection's failing test**

Create `apps/api/src/claims/projection.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectWishlist, seesClaims, type ClaimRow, type Viewer } from './projection.js';

const KETTLE = { id: 'kettle', title: 'Kettle', quantity: 3 };
const SOCKS = { id: 'socks', title: 'Socks', quantity: 1 };
// The owner wants 1 lamp now, but 2 were claimed before the change (D19).
const LAMP = { id: 'lamp', title: 'Lamp', quantity: 1 };
const ITEMS = [KETTLE, SOCKS, LAMP];
const CLAIMS: ClaimRow[] = [
  { id: 'c1', itemId: 'kettle', claimerName: 'Sue', quantity: 1 },
  { id: 'c2', itemId: 'kettle', claimerName: 'Sam', quantity: 1 },
  { id: 'c3', itemId: 'lamp', claimerName: 'Kim', quantity: 2 },
  // A claim on an item that isn't in the list given: ignored.
  { id: 'c4', itemId: 'gone', claimerName: 'Lee', quantity: 1 },
];

const GUEST: Viewer = { kind: 'guest' };
const OWNER_OPTED_OUT: Viewer = { kind: 'owner', showClaims: false };
const OWNER_OPTED_IN: Viewer = { kind: 'owner', showClaims: true };

const WITH_CLAIMS = [
  {
    ...KETTLE,
    remaining: 1,
    claims: [
      { id: 'c1', claimerName: 'Sue', quantity: 1 },
      { id: 'c2', claimerName: 'Sam', quantity: 1 },
    ],
  },
  { ...SOCKS, remaining: 1, claims: [] },
  { ...LAMP, remaining: 0, claims: [{ id: 'c3', claimerName: 'Kim', quantity: 2 }] },
];

describe('projectWishlist (spec §5.1)', () => {
  it.each([
    ['a guest', GUEST],
    ['an owner who opted in', OWNER_OPTED_IN],
  ])('shows %s what is left and who is getting what', (_label, viewer) => {
    expect(projectWishlist(ITEMS, CLAIMS, viewer)).toEqual(WITH_CLAIMS);
  });

  it('leaves the claim fields out, not empty, for an owner who has not opted in', () => {
    const items = projectWishlist(ITEMS, CLAIMS, OWNER_OPTED_OUT);
    expect(items).toEqual(ITEMS);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'quantity', 'title']);
    }
  });

  it('gives each claim only its ID, name and quantity: never its item or its token', () => {
    const [kettle] = projectWishlist(ITEMS, CLAIMS, GUEST);
    for (const claim of kettle?.claims ?? []) {
      expect(Object.keys(claim).sort()).toEqual(['claimerName', 'id', 'quantity']);
    }
  });

  it('keeps the list’s order and changes nothing it was given', () => {
    const items = ITEMS.map((item) => ({ ...item }));
    const projected = projectWishlist(items, CLAIMS, GUEST);
    expect(projected.map((item) => item.id)).toEqual(['kettle', 'socks', 'lamp']);
    expect(items).toEqual(ITEMS);
  });
});

describe('seesClaims (spec §5.1)', () => {
  it.each([
    [GUEST, true],
    [OWNER_OPTED_OUT, false],
    [OWNER_OPTED_IN, true],
  ])('%j → %s', (viewer, sees) => {
    expect(seesClaims(viewer)).toBe(sees);
  });
});
```

- [ ] **Step 8: Run it to see it fail, then write `projection.ts`**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit projection`
Expected: FAIL, because `./projection.js` doesn't exist.

Create `apps/api/src/claims/projection.ts`:

```ts
import type { Claim } from '@wishlist/contracts';
import { remainingOf } from './remaining.js';

/** Who is looking at a list (spec §5.1). The owner's opt-in travels with the viewer. */
export type Viewer = { kind: 'guest' } | { kind: 'owner'; showClaims: boolean };

/** A claim as the database gives it to the projection. */
export interface ClaimRow {
  id: string;
  itemId: string;
  claimerName: string;
  quantity: number;
}

export type ProjectedItem<T> = T & { remaining?: number; claims?: Claim[] };

/** Whether this viewer may see claim data: gifters always, the owner only after opting in. */
export function seesClaims(viewer: Viewer): boolean {
  return viewer.kind === 'guest' || viewer.showClaims;
}

/**
 * The items as `viewer` may see them (spec §5.1). This is the only place claim data joins an
 * item. For a viewer who may not see it, `remaining` and `claims` are absent, not empty, so not
 * even "nothing is claimed yet" reaches the owner (success criterion 4).
 *
 * The spec writes `projectWishlist(wishlist, items, claims, viewer)`; the list's one input, its
 * opt-in, travels in the owner viewer instead (Plan 4a rule 1).
 */
export function projectWishlist<T extends { id: string; quantity: number }>(
  items: readonly T[],
  claims: readonly ClaimRow[],
  viewer: Viewer,
): ProjectedItem<T>[] {
  if (!seesClaims(viewer)) return items.map((item) => ({ ...item }));
  const byItem = new Map<string, Claim[]>();
  for (const { id, itemId, claimerName, quantity } of claims) {
    const list = byItem.get(itemId) ?? [];
    list.push({ id, claimerName, quantity });
    byItem.set(itemId, list);
  }
  return items.map((item) => {
    const own = byItem.get(item.id) ?? [];
    const claimed = own.reduce((sum, claim) => sum + claim.quantity, 0);
    return { ...item, remaining: remainingOf(item.quantity, claimed), claims: own };
  });
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit projection`
Expected: PASS.

- [ ] **Step 9: Gate the layer, then commit**

```bash
pnpm --filter @wishlist/contracts build
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): add the claims table and the spoiler projection

The claims table follows spec §4: a quantity of at least 1, the manage
token's SHA-256 only, cascading from the item. Remaining and the two
"fits" rules are pure functions; a changed claim may hold up to what's
left plus what it holds, so keeping or lowering never fails, even after
the owner cut the quantity (spec §2, D19).

projectWishlist is the one place claim data joins an item: an owner who
hasn't opted in gets items without `remaining` or `claims` at all
(spec §5.1).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 3: The share link's read

**Files:**
- Modify: `apps/api/src/auth/session.guard.ts` (add `OptionalSessionGuard`, `OptionalAuth`)
- Modify: `apps/api/src/auth/auth.module.ts` (provide and export `OptionalSessionGuard`)
- Create: `apps/api/src/claims/claims-errors.ts`
- Create: `apps/api/src/claims/queries.ts`
- Create: `apps/api/src/claims/shared-list.service.ts`
- Create: `apps/api/src/claims/shared.controller.ts`
- Create: `apps/api/src/claims/claims.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/support/lists.ts`
- Create: `apps/api/test/shared.int-spec.ts`
- Modify: `e2e/tests/smoke/smoke.spec.ts`

**Interfaces:**
- Consumes: `projectWishlist`, `seesClaims`, `Viewer`, `ClaimRow` (Task 2); `SharedWishlistResponse`, `CAPABILITY_TOKEN_PATTERN`, `ErrorCode.SHARE_LINK_NOT_FOUND` (Task 1).
- Produces:
  - `OptionalSessionGuard` (never refuses; sets `req.auth` when the session is live) and `OptionalAuth()` param decorator → `AuthContext | null`, both from `auth/session.guard.ts`.
  - `queries.ts`: `SNAPSHOT`, `SHARED_ITEM_COLUMNS`, `CLAIM_COLUMNS`, `readSharedItems(tx: Transaction, wishlistId: string)`, `readClaims(tx: Transaction, wishlistId: string): Promise<ClaimRow[]>`.
  - `claims-errors.ts`: `shareLinkNotFound(): AppError`.
  - `SharedListService.get(shareToken: string, viewerId: string | null): Promise<SharedWishlistResponse>`.
  - `ClaimsModule`, imported by `AppModule`.
  - Test support `test/support/lists.ts`: `wishlistIdOf`, `shareTokenOf`, `seedItem`, `seedClaim`, `setShowClaims`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/shared-read
```

- [ ] **Step 1: Write the test support**

Create `apps/api/test/support/lists.ts`:

```ts
import { hashToken, newToken } from '../../src/security/tokens.js';
import type { TestDatabase } from './database.js';

// Straight-to-the-database setup for the claim tests: faster than requests, and able to make
// states the API won't, such as more claimed than the owner now wants (D19).

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`no ${what}`);
  return row;
}

export async function wishlistIdOf(db: TestDatabase, email: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    'select w.id from wishlists w join users u on u.id = w.owner_id where u.email = $1',
    [email],
  );
  return first(rows, `list for ${email}`).id;
}

export async function shareTokenOf(db: TestDatabase, email: string): Promise<string> {
  const { rows } = await db.pool.query<{ token: string }>(
    'select w.share_token as token from wishlists w join users u on u.id = w.owner_id where u.email = $1',
    [email],
  );
  return first(rows, `list for ${email}`).token;
}

/** Appends an item to the list of the account with this email, and returns its ID. */
export async function seedItem(
  db: TestDatabase,
  email: string,
  title: string,
  quantity = 1,
): Promise<string> {
  const wishlistId = await wishlistIdOf(db, email);
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into items (id, wishlist_id, title, quantity, position)
     values (gen_random_uuid(), $1, $2, $3,
             (select coalesce(max(position) + 1, 0) from items where wishlist_id = $1))
     returning id`,
    [wishlistId, title, quantity],
  );
  return first(rows, 'item').id;
}

/** A claim as a gifter would have made it. `clock_timestamp()` keeps them in the order made. */
export async function seedClaim(
  db: TestDatabase,
  itemId: string,
  claimerName: string,
  quantity: number,
): Promise<{ id: string; manageToken: string }> {
  const manageToken = newToken(16);
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into claims (id, item_id, claimer_name, quantity, manage_token_hash, created_at)
     values (gen_random_uuid(), $1, $2, $3, $4, clock_timestamp())
     returning id`,
    [itemId, claimerName, quantity, hashToken(manageToken)],
  );
  return { id: first(rows, 'claim').id, manageToken };
}

/** The owner's spoiler setting, set directly. `PATCH /wishlist` takes it from Task 6 on. */
export async function setShowClaims(db: TestDatabase, email: string, on: boolean): Promise<void> {
  await db.pool.query(
    `update wishlists w set show_claims_to_owner = $2
     from users u where u.id = w.owner_id and u.email = $1`,
    [email, on],
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/shared.int-spec.ts`:

```ts
import { ErrorCode, ProblemSchema, SharedWishlistResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, setCookies, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedClaim, seedItem, setShowClaims, shareTokenOf } from './support/lists.js';

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

const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase 2',
  displayName: 'Bob',
};

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const shared = (token: string, cookie?: string) => client(t.app, cookie).get(`/shared/${token}`);
type Body = { viewerIsOwner: boolean; ownerSeesClaims: boolean; items: object[] };

/** Ada wants 3 kettles (Sue and Sam are getting one each) and a pair of socks nobody has claimed. */
async function adasList() {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', 3);
  const socks = await seedItem(db, ADA.email, 'Socks', 1);
  const sue = await seedClaim(db, kettle, 'Sue', 1);
  const sam = await seedClaim(db, kettle, 'Sam', 1);
  return { token: await shareTokenOf(db, ADA.email), kettle, socks, sue, sam };
}

describe('GET /shared/:shareToken (spec §5)', () => {
  it('shows a guest the list in order, what is left, and who is getting what', async () => {
    const { token, kettle, socks, sue, sam } = await adasList();
    const res = await shared(token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const fields = { url: null, imageUrl: null, priceText: null, note: null };
    expect(SharedWishlistResponseSchema.parse(res.body)).toEqual({
      title: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      viewerIsOwner: false,
      ownerSeesClaims: false,
      items: [
        {
          id: kettle,
          title: 'Kettle',
          ...fields,
          quantity: 3,
          remaining: 1,
          claims: [
            { id: sue.id, claimerName: 'Sue', quantity: 1 },
            { id: sam.id, claimerName: 'Sam', quantity: 1 },
          ],
        },
        { id: socks, title: 'Socks', ...fields, quantity: 1, remaining: 1, claims: [] },
      ],
    });
  });

  it('sends no position, and nothing from a claim but its ID, name and quantity', async () => {
    const { token } = await adasList();
    const { items } = (await shared(token)).body as { items: { claims: object[] }[] };
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ['claims', 'id', 'imageUrl', 'note', 'priceText', 'quantity', 'remaining', 'title', 'url'],
    );
    expect(Object.keys(items[0]?.claims[0] ?? {}).sort()).toEqual([
      'claimerName',
      'id',
      'quantity',
    ]);
  });

  it('tells the signed-in owner nothing about claims until they opt in (spec §5.1, §8)', async () => {
    const { token } = await adasList();
    const res = await shared(token, await logIn(t));
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([true, false]);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('remaining');
      expect(item).not.toHaveProperty('claims');
    }
    expect(JSON.stringify(res.body)).not.toContain('Sue');
  });

  it('treats an owner whose email is unconfirmed as the owner too (Plan 4a rule 5)', async () => {
    await signUp(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 1);
    await seedClaim(db, kettle, 'Sue', 1);
    const res = await shared(await shareTokenOf(db, ADA.email), await logIn(t));
    expect((res.body as Body).viewerIsOwner).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('Sue');
  });

  it('shows the owner the claims once they opt in', async () => {
    const { token } = await adasList();
    await setShowClaims(db, ADA.email, true);
    const body = SharedWishlistResponseSchema.parse((await shared(token, await logIn(t))).body);
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([true, true]);
    expect(body.items[0]?.claims?.map((claim) => claim.claimerName)).toEqual(['Sue', 'Sam']);
  });

  it('tells a guest which way the owner’s setting is (D40)', async () => {
    const { token } = await adasList();
    await setShowClaims(db, ADA.email, true);
    const body = SharedWishlistResponseSchema.parse((await shared(token)).body);
    expect([body.viewerIsOwner, body.ownerSeesClaims]).toEqual([false, true]);
    expect(body.items[0]?.remaining).toBe(1);
  });

  it('treats anyone else who is signed in as a guest', async () => {
    const { token } = await adasList();
    await signUpVerified(t, BOB);
    const body = SharedWishlistResponseSchema.parse((await shared(token, await logIn(t, BOB))).body);
    expect(body.viewerIsOwner).toBe(false);
    expect(body.items[0]?.remaining).toBe(1);
  });

  it('treats a dead session as a guest, and sets no cookie (Review Focus 2)', async () => {
    const { token } = await adasList();
    const res = await shared(token, `__Host-session=${'x'.repeat(43)}`);
    expect(res.status).toBe(200);
    expect((res.body as Body).viewerIsOwner).toBe(false);
    expect(setCookies(res)).toEqual([]);
  });

  it('shows 0 left, not less, when the owner wants fewer than were claimed (D19)', async () => {
    await signUpVerified(t);
    const lamp = await seedItem(db, ADA.email, 'Lamp', 1);
    await seedClaim(db, lamp, 'Kim', 2);
    const body = SharedWishlistResponseSchema.parse(
      (await shared(await shareTokenOf(db, ADA.email))).body,
    );
    expect(body.items[0]?.remaining).toBe(0);
  });

  it('answers 404 SHARE_LINK_NOT_FOUND for a link that is unknown or was replaced (spec §2)', async () => {
    const { token } = await adasList();
    await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate');
    for (const res of [await shared(token), await shared('abcdefghijklmnopqrstuv')]) {
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
    }
  });

  it.each([
    ['a trailing full stop', (token: string) => `${token}.`],
    ['a character missing', (token: string) => token.slice(0, 21)],
    ['a trailing bracket, encoded', (token: string) => `${token}%29`],
    ['a trailing space, encoded', (token: string) => `${token}%20`],
  ])('answers 404 SHARE_LINK_NOT_FOUND for a link with %s (Review Focus 1)', async (_label, mangle) => {
    const { token } = await adasList();
    const res = await shared(mangle(token));
    expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration shared`
Expected: FAIL: every request answers `404` with code `NOT_FOUND` (there's no route yet), so the first assertion that reads `200` or `SHARE_LINK_NOT_FOUND` fails.

- [ ] **Step 4: The optional session guard**

In `apps/api/src/auth/session.guard.ts`, after `CurrentAuth`, add:

```ts
/**
 * Resolves the session if there is one, and never refuses. The public routes use it to tell the
 * list's owner from a guest (spec §5). Unlike SessionGuard it leaves a dead cookie alone: the
 * share page calls the API server to server, where a Set-Cookie never reaches the browser (D27).
 */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (session) req.auth = { sessionId: session.sessionId, user: session.user };
    return true;
  }
}

/** The session OptionalSessionGuard found, or null for a guest. Use it only behind that guard. */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | null =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth ?? null,
);
```

In `apps/api/src/auth/auth.module.ts`, import `OptionalSessionGuard` from `./session.guard.js`, add it to `providers` after `SessionGuard`, and to `exports`: `exports: [SessionsService, SessionGuard, OptionalSessionGuard, VerifiedGuard]`.

- [ ] **Step 5: The error and the reads**

Create `apps/api/src/claims/claims-errors.ts`:

```ts
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// Claim failures. As everywhere, no detail echoes what the caller sent: never a token.

/** Malformed, unknown and replaced links all look the same (spec §5). */
export const shareLinkNotFound = (): AppError =>
  new AppError(
    404,
    ErrorCode.SHARE_LINK_NOT_FOUND,
    'This share link does not work. The owner may have made a new one.',
  );
```

Create `apps/api/src/claims/queries.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { claims, items } from '../db/schema.js';
import type { ClaimRow } from './projection.js';

/**
 * Every read that returns claims runs in one snapshot, so `remaining` always agrees with the items
 * beside it (Plan 3a final review; spec §5).
 */
export const SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** An item as gifters see it: the owner's fields without its position (spec §5). */
export const SHARED_ITEM_COLUMNS = {
  id: items.id,
  title: items.title,
  url: items.url,
  imageUrl: items.imageUrl,
  priceText: items.priceText,
  note: items.note,
  quantity: items.quantity,
};

/** A claim as the API returns it (`Claim` in contracts): never its item or its token's hash. */
export const CLAIM_COLUMNS = {
  id: claims.id,
  claimerName: claims.claimerName,
  quantity: claims.quantity,
};

export function readSharedItems(tx: Transaction, wishlistId: string) {
  return tx
    .select(SHARED_ITEM_COLUMNS)
    .from(items)
    .where(eq(items.wishlistId, wishlistId))
    .orderBy(asc(items.position), asc(items.id));
}

/** Every claim on the list, oldest first (Plan 4a rule 10). */
export function readClaims(tx: Transaction, wishlistId: string): Promise<ClaimRow[]> {
  return tx
    .select({ ...CLAIM_COLUMNS, itemId: claims.itemId })
    .from(claims)
    .innerJoin(items, eq(items.id, claims.itemId))
    .where(eq(items.wishlistId, wishlistId))
    .orderBy(asc(claims.createdAt), asc(claims.id));
}
```

- [ ] **Step 6: The service, the controller and the module**

Create `apps/api/src/claims/shared-list.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CAPABILITY_TOKEN_PATTERN, type SharedWishlistResponse } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { users, wishlists } from '../db/schema.js';
import { shareLinkNotFound } from './claims-errors.js';
import { projectWishlist, seesClaims, type Viewer } from './projection.js';
import { readClaims, readSharedItems, SNAPSHOT } from './queries.js';

/** The list behind a share link (spec §5). Anyone holding the link may look. */
@Injectable()
export class SharedListService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The list as `viewerId` may see it (spec §5.1): the owner, signed in, sees claims only once
   * they opt in. A malformed token is refused before the database is asked.
   */
  async get(shareToken: string, viewerId: string | null): Promise<SharedWishlistResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) throw shareLinkNotFound();
    return this.db.transaction(async (tx) => {
      const [list] = await tx
        .select({
          id: wishlists.id,
          ownerId: wishlists.ownerId,
          title: wishlists.title,
          showClaims: wishlists.showClaimsToOwner,
          ownerDisplayName: users.displayName,
        })
        .from(wishlists)
        .innerJoin(users, eq(users.id, wishlists.ownerId))
        .where(eq(wishlists.shareToken, shareToken));
      if (!list) throw shareLinkNotFound();
      const viewerIsOwner = viewerId === list.ownerId;
      const viewer: Viewer = viewerIsOwner
        ? { kind: 'owner', showClaims: list.showClaims }
        : { kind: 'guest' };
      const rows = await readSharedItems(tx, list.id);
      // An owner who hasn't opted in never gets claim data: it isn't even read (spec §5).
      const claimRows = seesClaims(viewer) ? await readClaims(tx, list.id) : [];
      return {
        title: list.title,
        ownerDisplayName: list.ownerDisplayName,
        viewerIsOwner,
        ownerSeesClaims: list.showClaims,
        items: projectWishlist(rows, claimRows, viewer),
      };
    }, SNAPSHOT);
  }
}
```

Create `apps/api/src/claims/shared.controller.ts`:

```ts
import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import type { SharedWishlistResponse } from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { SharedListService } from './shared-list.service.js';

/** What anyone with a share link may do (spec §5 Public endpoints). */
@Controller('shared')
@UseGuards(OptionalSessionGuard)
export class SharedController {
  constructor(@Inject(SharedListService) private readonly lists: SharedListService) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('shareToken') shareToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<SharedWishlistResponse> {
    return this.lists.get(shareToken, auth?.user.id ?? null);
  }
}
```

Create `apps/api/src/claims/claims.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SharedController } from './shared.controller.js';
import { SharedListService } from './shared-list.service.js';

/** Share links and claims (spec §5 Public endpoints, §5.1, §6.3). */
@Module({
  imports: [AuthModule],
  controllers: [SharedController],
  providers: [SharedListService],
})
export class ClaimsModule {}
```

In `apps/api/src/app.module.ts`, import `ClaimsModule` from `./claims/claims.module.js` and add it to `imports` after `WishlistModule`.

- [ ] **Step 7: Run the test to see it pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration shared`
Expected: PASS (14 tests).

- [ ] **Step 8: The smoke test**

In `e2e/tests/smoke/smoke.spec.ts`, after the `auth is live` test, add:

```ts
test('an unknown share link answers 404 SHARE_LINK_NOT_FOUND (spec §8)', async ({ request }) => {
  // 22 characters, so it's well-formed; the chance a real list has it is 2^-128.
  const res = await request.get('/api/shared/AAAAAAAAAAAAAAAAAAAAAA');
  expect(res.status()).toBe(404);
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.SHARE_LINK_NOT_FOUND);
});
```

It's read-only, so it runs against previews and production (spec §8). It runs for real once the stack has previews (Task 11); `pnpm turbo run lint typecheck` checks it compiles now.

- [ ] **Step 9: Gate the layer, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api e2e
git commit -F - <<'EOF'
feat(api): read a list through its share link

GET /shared/:shareToken answers the list, its owner's name, and claim
data for whoever may see it (spec §5.1). An optional session guard
tells the owner from a guest without refusing anyone, and leaves a dead
cookie alone (D27). The owner gets no `remaining` or `claims` until they
opt in; a guest is told which way that's set (D40). The list, items
and claims are read in one REPEATABLE READ snapshot.

A malformed, unknown or replaced link is 404 SHARE_LINK_NOT_FOUND, and
the smoke test checks it on previews and production.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 4: Claiming

**Files:**
- Create: `apps/api/src/wishlist/links.ts`
- Modify: `apps/api/src/wishlist/wishlist.service.ts` (its private `shareUrl` uses `links.ts`)
- Create: `apps/api/src/claims/rate-limits.ts`
- Modify: `apps/api/src/claims/claims-errors.ts`
- Modify: `apps/api/src/claims/queries.ts` (add `claimedTotal`)
- Create: `apps/api/src/claims/claims.service.ts`
- Modify: `apps/api/src/claims/shared.controller.ts`, `apps/api/src/claims/claims.module.ts`
- Create: `apps/api/test/support/rate-limits.ts`
- Create: `apps/api/test/claims.int-spec.ts`

**Interfaces:**
- Consumes: `CreateClaimRequestSchema`, `CreateClaimResponse`, `ClaimConflictProblemSchema` (Task 1); `remainingOf`, `fitsNewClaim` (Task 2); `CLAIM_COLUMNS`, `OptionalAuth`, `shareLinkNotFound` (Task 3); `itemNotFound` from `wishlist/wishlist-errors.ts`; `RateLimiter.enforce(key, rule)`; `ClientIp`.
- Produces:
  - `links.ts`: `shareUrl(appOrigin: string, shareToken: string): string`, `manageUrl(appOrigin: string, manageToken: string): string`.
  - `rate-limits.ts`: `CLAIMS_PER_IP`, `CLAIMS_PER_LIST`, `claimsIpKey(ip: string): string`, `claimsListKey(wishlistId: string): string`.
  - `claims-errors.ts`: `ownerCannotClaim()`, `claimExceedsRemaining(remaining: number)`.
  - `queries.ts`: `claimedTotal(tx: Transaction, itemId: string): Promise<number>`.
  - `ClaimsService.create(shareToken, itemId, input: CreateClaimRequest, viewerId: string | null, ip: string): Promise<CreateClaimResponse>`.
  - Test support `test/support/rate-limits.ts`: `fillBucket(db, key, count, windowSeconds?)`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/claiming
```

- [ ] **Step 1: The rate-limit test support**

Create `apps/api/test/support/rate-limits.ts`:

```ts
import { fixedWindow } from '../../src/rate-limit/window.js';
import { TEST_START } from './auth-app.js';
import type { TestDatabase } from './database.js';

/**
 * Sets a rate-limit counter in the current window, as if `count` requests had been made already.
 * The test clock stands at TEST_START, so that's the window the API counts in.
 */
export async function fillBucket(
  db: TestDatabase,
  key: string,
  count: number,
  windowSeconds = 3600,
): Promise<void> {
  const { start } = fixedWindow(TEST_START.getTime(), windowSeconds);
  await db.pool.query(
    `insert into rate_limits (key, window_start, count) values ($1, $2, $3)
     on conflict (key, window_start) do update set count = excluded.count`,
    [key, start, count],
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/claims.int-spec.ts`:

```ts
import {
  ClaimConflictProblemSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  ProblemSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimsListKey } from '../src/claims/rate-limits.js';
import { hashToken } from '../src/security/tokens.js';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedItem, shareTokenOf, wishlistIdOf } from './support/lists.js';
import { fillBucket } from './support/rate-limits.js';

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

const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase 2',
  displayName: 'Bob',
};
const UNKNOWN_ID = '0199a3b2-0000-7000-8000-0000000000ff';
const UNKNOWN_TOKEN = 'abcdefghijklmnopqrstuv';

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const claim = (token: string, itemId: string, body: object, cookie?: string) =>
  client(t.app, cookie).post(`/shared/${token}/items/${itemId}/claims`, body);
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
const claimedSum = async () =>
  Number(
    (await db.pool.query<{ n: string }>('select coalesce(sum(quantity), 0) as n from claims'))
      .rows[0]?.n,
  );

/** Ada's list with one kettle, of which Ada wants `quantity`. */
async function adasKettle(quantity = 1) {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', quantity);
  return { token: await shareTokenOf(db, ADA.email), kettle };
}

describe('POST /shared/:shareToken/items/:itemId/claims (spec §5)', () => {
  it('claims for a guest, and returns the manage link this once', async () => {
    const { token, kettle } = await adasKettle(3);
    const res = await claim(token, kettle, { claimerName: ' Aunt Sue\n', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = CreateClaimResponseSchema.parse(res.body);
    expect(body.claim).toEqual({ id: expect.any(String) as string, claimerName: 'Aunt Sue', quantity: 2 });
    expect(body.manageUrl).toBe(`http://localhost:3000/c/${body.manageToken}`);
  });

  it('keeps only the manage token’s hash (spec §4)', async () => {
    const { token, kettle } = await adasKettle();
    const { manageToken } = CreateClaimResponseSchema.parse(
      (await claim(token, kettle, { claimerName: 'Sue' })).body,
    );
    const { rows } = await db.pool.query('select * from claims');
    expect(rows[0]).toMatchObject({ quantity: 1, manage_token_hash: hashToken(manageToken) });
    expect(JSON.stringify(rows)).not.toContain(manageToken);
  });

  it.each([
    { claimerName: '' },
    { claimerName: '   ' },
    { claimerName: 'a'.repeat(51) },
    { claimerName: 'Sue‮eus' },
    { claimerName: 'Sue', quantity: 0 },
    { claimerName: 'Sue', quantity: 100 },
    { quantity: 1 },
  ])('refuses %j with 400 VALIDATION_FAILED (Review Focus 4)', async (body) => {
    const { token, kettle } = await adasKettle();
    const res = await claim(token, kettle, body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    expect(await count('claims')).toBe(0);
  });

  it('answers 409 with what is left when a claim asks for more (spec §6.3)', async () => {
    const { token, kettle } = await adasKettle(3);
    expect((await claim(token, kettle, { claimerName: 'Sue', quantity: 2 })).status).toBe(201);
    const over = await claim(token, kettle, { claimerName: 'Sam', quantity: 2 });
    expect(over.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(over.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 1,
    });
    expect((await claim(token, kettle, { claimerName: 'Sam', quantity: 1 })).status).toBe(201);
    const none = await claim(token, kettle, { claimerName: 'Kim', quantity: 1 });
    expect(ClaimConflictProblemSchema.parse(none.body).remaining).toBe(0);
    expect(await claimedSum()).toBe(3);
  });

  it('refuses the owner with 403, never a 409 that would say what is left (spec §2, §5)', async () => {
    const { token, kettle } = await adasKettle(1);
    const cookie = await logIn(t);
    const first = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([first.status, codeOf(first)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
    expect((await claim(token, kettle, { claimerName: 'Sue' })).status).toBe(201);
    const full = await claim(token, kettle, { claimerName: 'Ada' }, cookie);
    expect([full.status, codeOf(full)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
    expect(full.body).not.toHaveProperty('remaining');
    expect(await count('claims')).toBe(1);
  });

  it('refuses an owner whose email is unconfirmed (Plan 4a rule 5)', async () => {
    await signUp(t);
    const kettle = await seedItem(db, ADA.email, 'Kettle', 1);
    const res = await claim(await shareTokenOf(db, ADA.email), kettle, { claimerName: 'Ada' }, await logIn(t));
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.OWNER_CANNOT_CLAIM]);
  });

  it('lets someone else who is signed in claim', async () => {
    const { token, kettle } = await adasKettle();
    await signUpVerified(t, BOB);
    expect((await claim(token, kettle, { claimerName: 'Bob' }, await logIn(t, BOB))).status).toBe(201);
  });

  it('answers 404 SHARE_LINK_NOT_FOUND for a replaced link, and NOT_FOUND for an item not on it', async () => {
    const { token, kettle } = await adasKettle();
    await signUpVerified(t, BOB);
    const bobsItem = await seedItem(db, BOB.email, 'Bike', 1);
    for (const itemId of [UNKNOWN_ID, 'kettle', bobsItem]) {
      const res = await claim(token, itemId, { claimerName: 'Sue' });
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
    await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate');
    const replaced = await claim(token, kettle, { claimerName: 'Sue' });
    expect([replaced.status, codeOf(replaced)]).toEqual([404, ErrorCode.SHARE_LINK_NOT_FOUND]);
    expect(await count('claims')).toBe(0);
  });

  it('refuses a claim that does not come from the app (spec §6.2)', async () => {
    const { token, kettle } = await adasKettle();
    const res = await http(t.app)
      .post(`/api/shared/${token}/items/${kettle}/claims`)
      .send({ claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.FORBIDDEN_ORIGIN]);
  });

  it('lets exactly one of 20 racing claims take the last kettle (spec §8)', async () => {
    const { token, kettle } = await adasKettle(1);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    const conflicts = results.filter((res) => res.status === 409);
    expect(conflicts).toHaveLength(19);
    for (const res of conflicts) expect(ClaimConflictProblemSchema.parse(res.body).remaining).toBe(0);
    expect(await claimedSum()).toBe(1);
    // All 20 counted against the IP, the 409s too (spec §6.6), so a 21st is turned away.
    const next = await claim(token, kettle, { claimerName: 'Gifter 20' });
    expect([next.status, codeOf(next)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  it('counts 20 attempts an hour per IP before looking the link up, then answers 429 (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(99);
    for (let i = 0; i < 20; i++) {
      expect((await claim(UNKNOWN_TOKEN, kettle, { claimerName: 'Sue' })).status).toBe(404);
    }
    const res = await claim(token, kettle, { claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await count('claims')).toBe(0);
  });

  it('allows 30 claims an hour on one list, whoever makes them (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(99);
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const res = await claim(token, kettle, { claimerName: 'Sue' });
    expect([res.status, codeOf(res)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  it('a claim racing the owner deleting the account leaves no claim behind (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const cookie = await logIn(t);
    const [deletion, ...claims] = await Promise.all([
      client(t.app, cookie).delete('/me', { password: ADA.password }),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of claims) expect([201, 404]).toContain(res.status);
    expect(await count('claims')).toBe(0);
  });

  it('claims racing the owner deleting the item leave no claim behind (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const cookie = await logIn(t);
    const [deletion, ...claims] = await Promise.all([
      client(t.app, cookie).delete(`/wishlist/items/${kettle}`),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of claims) expect([201, 404]).toContain(res.status);
    expect(await count('claims')).toBe(0);
  });

  it('claims racing the owner’s quantity change and reorder never fail with a 500 (Review Focus 3)', async () => {
    const { token, kettle } = await adasKettle(5);
    const socks = await seedItem(db, ADA.email, 'Socks', 1);
    const cookie = await logIn(t);
    const [change, reorder, ...claims] = await Promise.all([
      client(t.app, cookie).patch(`/wishlist/items/${kettle}`, { quantity: 1 }),
      client(t.app, cookie).put('/wishlist/items/order', { itemIds: [socks, kettle] }),
      ...Array.from({ length: 5 }, (_, i) => claim(token, kettle, { claimerName: `Gifter ${i}` })),
    ]);
    expect([change?.status, reorder?.status]).toEqual([200, 204]);
    for (const res of claims) expect([201, 409]).toContain(res.status);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims.int-spec`
Expected: FAIL: the POST route doesn't exist, so claims answer `404 NOT_FOUND` where the tests expect `201`, `400` or `409`.

- [ ] **Step 4: The links, the limits and the errors**

Create `apps/api/src/wishlist/links.ts`:

```ts
/** The share page (spec §2). Its token is the capability: anyone holding the link may look. */
export function shareUrl(appOrigin: string, shareToken: string): string {
  return `${appOrigin}/s/${shareToken}`;
}

/** A claim's manage page (spec §5), built here beside the share link so both come from one place. */
export function manageUrl(appOrigin: string, manageToken: string): string {
  return `${appOrigin}/c/${manageToken}`;
}
```

In `apps/api/src/wishlist/wishlist.service.ts`, import `shareUrl` from `./links.js` and change the private method's body to `return shareUrl(this.env.APP_ORIGIN, shareToken);`. Its name stays `shareUrl`, so rename the import: `import { shareUrl as shareUrlFor } from './links.js';` and `return shareUrlFor(this.env.APP_ORIGIN, shareToken);`.

Create `apps/api/src/claims/rate-limits.ts`:

```ts
import { ipRateLimitKey, rateLimitKey } from '../rate-limit/keys.js';
import type { RateLimitRule } from '../rate-limit/window.js';

/**
 * Spec §6.6: new claims and claim changes share one bucket per IP and one per list. The list's is
 * keyed by its ID, not its share token: a change arrives by manage token, and a rotation shouldn't
 * reset the count.
 */
export const CLAIMS_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 3600 };
export const CLAIMS_PER_LIST: RateLimitRule = { limit: 30, windowSeconds: 3600 };

export const claimsIpKey = (ip: string): string => ipRateLimitKey('claims:ip', ip);
export const claimsListKey = (wishlistId: string): string =>
  rateLimitKey('claims:list', wishlistId);
```

In `apps/api/src/claims/claims-errors.ts`, add:

```ts
export const ownerCannotClaim = (): AppError =>
  new AppError(403, ErrorCode.OWNER_CANNOT_CLAIM, 'You cannot claim items on your own list.');

/** Carries what's left, so the claim sheet can reset its stepper (spec §7). */
export const claimExceedsRemaining = (remaining: number): AppError =>
  new AppError(
    409,
    ErrorCode.CLAIM_EXCEEDS_REMAINING,
    'There are not that many left to claim.',
    { remaining },
  );
```

In `apps/api/src/claims/queries.ts`, add `sql` to the `drizzle-orm` import, and:

```ts
/** How many of an item are claimed, every claim counted. */
export async function claimedTotal(tx: Transaction, itemId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${claims.quantity}), 0)::int` })
    .from(claims)
    .where(eq(claims.itemId, itemId));
  return row?.total ?? 0;
}
```

- [ ] **Step 5: The service**

Create `apps/api/src/claims/claims.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  CAPABILITY_TOKEN_PATTERN,
  type CreateClaimRequest,
  type CreateClaimResponse,
} from '@wishlist/contracts';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { claims, items, wishlists } from '../db/schema.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { hashToken, newToken } from '../security/tokens.js';
import { manageUrl } from '../wishlist/links.js';
import { itemNotFound } from '../wishlist/wishlist-errors.js';
import { claimExceedsRemaining, ownerCannotClaim, shareLinkNotFound } from './claims-errors.js';
import { CLAIM_COLUMNS, claimedTotal } from './queries.js';
import { CLAIMS_PER_IP, CLAIMS_PER_LIST, claimsIpKey, claimsListKey } from './rate-limits.js';
import { fitsNewClaim, remainingOf } from './remaining.js';

const ItemIdSchema = z.uuid();

/** Claims, made and managed by gifters through capability links (spec §5, §6.3). */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Claims some of an item on the list behind `shareToken` (spec §5). The checks run in the
   * spec's order: malformed IDs, the IP's limit, the list, its limit, the owner, and only then the
   * transaction, so the owner never sees a 409's `remaining`.
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
    await this.limiter.enforce(claimsListKey(list.id), CLAIMS_PER_LIST);
    if (viewerId === list.ownerId) throw ownerCannotClaim();

    const manageToken = newToken(16);
    const claim = await this.db.transaction(async (tx) => {
      // Spec §6.3: the item's row lock serializes every claim write on it. Only the item is
      // locked, never the list, so the users → wishlists → items order holds.
      const [item] = await tx
        .select({ quantity: items.quantity })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.wishlistId, list.id)))
        .for('update');
      if (!item) throw itemNotFound();
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
          manageTokenHash: hashToken(manageToken),
          createdAt: now,
          updatedAt: now,
        })
        .returning(CLAIM_COLUMNS);
      if (!row) throw new Error('claim insert returned no row');
      return row;
    });
    return { claim, manageToken, manageUrl: manageUrl(this.env.APP_ORIGIN, manageToken) };
  }
}
```

- [ ] **Step 6: The route**

In `apps/api/src/claims/shared.controller.ts`, inject `ClaimsService` too, and add the route:

```ts
import { Body, Controller, Get, Header, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateClaimRequestSchema,
  type CreateClaimRequest,
  type CreateClaimResponse,
  type SharedWishlistResponse,
} from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';
import { SharedListService } from './shared-list.service.js';

/** What anyone with a share link may do (spec §5 Public endpoints). */
@Controller('shared')
@UseGuards(OptionalSessionGuard)
export class SharedController {
  constructor(
    @Inject(SharedListService) private readonly lists: SharedListService,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
  ) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('shareToken') shareToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<SharedWishlistResponse> {
    return this.lists.get(shareToken, auth?.user.id ?? null);
  }

  @Post(':shareToken/items/:itemId/claims')
  @Header('Cache-Control', 'no-store')
  create(
    @Param('shareToken') shareToken: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(CreateClaimRequestSchema)) body: CreateClaimRequest,
    @OptionalAuth() auth: AuthContext | null,
    @ClientIp() ip: string,
  ): Promise<CreateClaimResponse> {
    return this.claims.create(shareToken, itemId, body, auth?.user.id ?? null, ip);
  }
}
```

In `apps/api/src/claims/claims.module.ts`, import `RateLimitModule` from `../rate-limit/rate-limit.module.js` and `ClaimsService`; set `imports: [AuthModule, RateLimitModule]` and `providers: [SharedListService, ClaimsService]`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration claims.int-spec wishlist`
Expected: PASS. `wishlist.int-spec` proves the share URL is unchanged after the move to `links.ts`.

- [ ] **Step 8: Gate the layer, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): claim an item through its share link

POST /shared/:shareToken/items/:itemId/claims runs spec §6.3: the
item's row is locked, its claims are summed, and the claim fits or
answers 409 with what's left. Only the item is locked, so the lock
order holds (users → wishlists → items). Twenty racing claims on the
last kettle give one 201 and nineteen 409s.

The checks run in the spec's order, so the owner is refused (403)
before anything is summed and never sees `remaining`. Claims count 20
an hour per IP and 30 per list, keyed by the list's ID so a rotation
doesn't reset it. The manage token is returned once, with its URL, and
stored as its SHA-256.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 5: The manage link

**Files:**
- Modify: `apps/api/src/claims/claims-errors.ts` (add `claimNotFound`)
- Modify: `apps/api/src/claims/claims.service.ts` (add `details`, `update`, `cancel`)
- Create: `apps/api/src/claims/claims.controller.ts`
- Modify: `apps/api/src/claims/claims.module.ts`
- Create: `apps/api/test/manage-claims.int-spec.ts`

**Interfaces:**
- Consumes: everything Task 4 produced; `ClaimDetailsResponse`, `UpdateClaimRequestSchema`, `UpdateClaimRequest`, `Claim` (Task 1); `fitsChangedClaim` (Task 2); `SNAPSHOT`, `SHARED_ITEM_COLUMNS` (Task 3); `shareUrl` from `wishlist/links.ts` (Task 4).
- Produces: `ClaimsService.details(manageToken): Promise<ClaimDetailsResponse>`, `ClaimsService.update(manageToken, input: UpdateClaimRequest, ip: string): Promise<Claim>`, `ClaimsService.cancel(manageToken): Promise<void>`; `claimNotFound(): AppError`; `ClaimsController` at `/claims/:manageToken`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/manage-claims
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/manage-claims.int-spec.ts`:

```ts
import {
  ClaimConflictProblemSchema,
  ClaimDetailsResponseSchema,
  ClaimSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  ProblemSchema,
  RotateShareTokenResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimsIpKey, claimsListKey } from '../src/claims/rate-limits.js';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUpVerified } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';
import { seedItem, shareTokenOf, wishlistIdOf } from './support/lists.js';
import { fillBucket } from './support/rate-limits.js';

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

const UNKNOWN_TOKEN = 'abcdefghijklmnopqrstuv';
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async () =>
  Number((await db.pool.query<{ n: string }>('select count(*) as n from claims')).rows[0]?.n);
const claimedSum = async () =>
  Number(
    (await db.pool.query<{ n: string }>('select coalesce(sum(quantity), 0) as n from claims'))
      .rows[0]?.n,
  );

const details = (manageToken: string) => client(t.app).get(`/claims/${manageToken}`);
const change = (manageToken: string, body: object) =>
  client(t.app).patch(`/claims/${manageToken}`, body);
const cancel = (manageToken: string) => client(t.app).delete(`/claims/${manageToken}`);

/** Ada wants `quantity` kettles. */
async function adasKettle(quantity: number) {
  await signUpVerified(t);
  const kettle = await seedItem(db, ADA.email, 'Kettle', quantity);
  return { token: await shareTokenOf(db, ADA.email), kettle };
}

/** A claim made the way a gifter makes one. */
async function claimed(token: string, itemId: string, claimerName: string, quantity = 1) {
  const res = await client(t.app).post(`/shared/${token}/items/${itemId}/claims`, {
    claimerName,
    quantity,
  });
  if (res.status !== 201) throw new Error(`claim answered ${res.status}`);
  return CreateClaimResponseSchema.parse(res.body);
}

describe('GET /claims/:manageToken (spec §5)', () => {
  it('gives the claimer their claim, the item, what is left and the list’s link', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue', 2);
    const res = await details(sue.manageToken);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ClaimDetailsResponseSchema.parse(res.body)).toEqual({
      claim: sue.claim,
      item: {
        id: kettle,
        title: 'Kettle',
        url: null,
        imageUrl: null,
        priceText: null,
        note: null,
        quantity: 3,
      },
      wishlistTitle: "Ada's wishlist",
      ownerDisplayName: 'Ada',
      remaining: 1,
      shareUrl: `http://localhost:3000/s/${token}`,
      ownerSeesClaims: false,
    });
  });

  it('never shows anyone else’s claim (spec §5.1)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await claimed(token, kettle, 'Sam');
    const res = await details(sue.manageToken);
    expect(JSON.stringify(res.body)).not.toContain('Sam');
    expect(res.body.item).not.toHaveProperty('claims');
  });

  it('gives the new share link after the owner replaces it (spec §5)', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const rotated = RotateShareTokenResponseSchema.parse(
      (await client(t.app, await logIn(t)).post('/wishlist/share-token/rotate')).body,
    );
    const body = ClaimDetailsResponseSchema.parse((await details(sue.manageToken)).body);
    expect(body.shareUrl).toBe(rotated.shareUrl);
  });

  it.each(['abcdefghijklmnopqrstu', `${UNKNOWN_TOKEN}.`, UNKNOWN_TOKEN])(
    'answers 404 NOT_FOUND for the token %j',
    async (manageToken) => {
      const res = await details(manageToken);
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    },
  );

  it('answers 404 once the owner deletes the item, or the account (spec §2)', async () => {
    const { token, kettle } = await adasKettle(2);
    const sue = await claimed(token, kettle, 'Sue');
    const cookie = await logIn(t);
    await client(t.app, cookie).delete(`/wishlist/items/${kettle}`);
    expect((await details(sue.manageToken)).status).toBe(404);

    const lamp = await seedItem(db, ADA.email, 'Lamp', 1);
    const kim = await claimed(token, lamp, 'Kim');
    await client(t.app, cookie).delete('/me', { password: ADA.password });
    expect((await details(kim.manageToken)).status).toBe(404);
  });
});

describe('PATCH /claims/:manageToken (spec §5)', () => {
  it('changes the name, trimmed', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await change(sue.manageToken, { claimerName: ' Aunt Sue ' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ClaimSchema.parse(res.body)).toEqual({ ...sue.claim, claimerName: 'Aunt Sue' });
  });

  it.each([{}, { claimerName: '' }, { quantity: 0 }])(
    'refuses %j with 400 VALIDATION_FAILED',
    async (body) => {
      const { token, kettle } = await adasKettle(1);
      const sue = await claimed(token, kettle, 'Sue');
      const res = await change(sue.manageToken, body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
    },
  );

  it('lets a claim grow into what is left, and no further (spec §2)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    await claimed(token, kettle, 'Sam');
    expect((await change(sue.manageToken, { quantity: 2 })).status).toBe(200);
    const over = await change(sue.manageToken, { quantity: 3 });
    expect(over.status).toBe(409);
    expect(ClaimConflictProblemSchema.parse(over.body)).toMatchObject({
      code: ErrorCode.CLAIM_EXCEEDS_REMAINING,
      remaining: 0,
    });
    expect(await claimedSum()).toBe(3);
  });

  it('never refuses a claimer who keeps what they hold after the owner wanted fewer (D19, §6.3)', async () => {
    const { token, kettle } = await adasKettle(2);
    await claimed(token, kettle, 'Sue');
    const sam = await claimed(token, kettle, 'Sam');
    const cut = await client(t.app, await logIn(t)).patch(`/wishlist/items/${kettle}`, {
      quantity: 1,
    });
    expect(cut.status).toBe(200);
    expect((await change(sam.manageToken, { claimerName: 'Uncle Sam' })).status).toBe(200);
    expect((await change(sam.manageToken, { quantity: 1 })).status).toBe(200);
    const more = await change(sam.manageToken, { quantity: 2 });
    expect(ClaimConflictProblemSchema.parse(more.body).remaining).toBe(0);
  });

  it('lets only as many racing increases through as there are kettles left', async () => {
    // Ada wants 10. Five people hold one each, so 5 are left, and each asks to hold 3 (+2).
    const { token, kettle } = await adasKettle(10);
    const holders = [];
    for (let i = 0; i < 5; i++) holders.push(await claimed(token, kettle, `Gifter ${i}`));
    const results = await Promise.all(
      holders.map((holder) => change(holder.manageToken, { quantity: 3 })),
    );
    expect(results.filter((res) => res.status === 200)).toHaveLength(2);
    expect(results.filter((res) => res.status === 409)).toHaveLength(3);
    expect(await claimedSum()).toBe(9);
  });

  it('shares the claim limits: the list’s and the IP’s (spec §6.6)', async () => {
    const { token, kettle } = await adasKettle(5);
    const sue = await claimed(token, kettle, 'Sue');
    await fillBucket(db, claimsListKey(await wishlistIdOf(db, ADA.email)), 30);
    const byList = await change(sue.manageToken, { quantity: 2 });
    expect([byList.status, codeOf(byList)]).toEqual([429, ErrorCode.RATE_LIMITED]);

    await db.pool.query('truncate rate_limits');
    await fillBucket(db, claimsIpKey('127.0.0.1'), 20);
    const byIp = await change(sue.manageToken, { quantity: 2 });
    expect([byIp.status, codeOf(byIp)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  it('answers 404 NOT_FOUND for a token that is malformed or unknown', async () => {
    for (const manageToken of ['short', UNKNOWN_TOKEN]) {
      const res = await change(manageToken, { claimerName: 'Sue' });
      expect([res.status, codeOf(res)]).toEqual([404, ErrorCode.NOT_FOUND]);
    }
  });
});

describe('DELETE /claims/:manageToken (spec §5)', () => {
  it('cancels the claim, and frees what it held', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    expect((await cancel(sue.manageToken)).status).toBe(204);
    expect((await details(sue.manageToken)).status).toBe(404);
    expect((await claimed(token, kettle, 'Sam')).claim.quantity).toBe(1);
  });

  it('answers 404 NOT_FOUND when the claim is already gone', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    await cancel(sue.manageToken);
    const again = await cancel(sue.manageToken);
    expect([again.status, codeOf(again)]).toEqual([404, ErrorCode.NOT_FOUND]);
  });

  it('refuses a cancel that does not come from the app (spec §6.2)', async () => {
    const { token, kettle } = await adasKettle(1);
    const sue = await claimed(token, kettle, 'Sue');
    const res = await http(t.app)
      .delete(`/api/claims/${sue.manageToken}`)
      .set('content-type', 'application/json')
      .send('{}');
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.FORBIDDEN_ORIGIN]);
    expect(await count()).toBe(1);
  });

  it('a change racing a cancel from another device ends cleanly (Review Focus 5)', async () => {
    const { token, kettle } = await adasKettle(3);
    const sue = await claimed(token, kettle, 'Sue');
    const [changed, cancelled] = await Promise.all([
      change(sue.manageToken, { quantity: 2 }),
      cancel(sue.manageToken),
    ]);
    expect(cancelled.status).toBe(204);
    expect([200, 404]).toContain(changed.status);
    expect(await count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration manage-claims`
Expected: FAIL: `/claims/…` has no routes, so `GET` and `PATCH` answer `404` where the tests expect `200`.

- [ ] **Step 3: The error**

In `apps/api/src/claims/claims-errors.ts`, add:

```ts
/** Malformed, unknown and deleted claims all look the same (spec §2). */
export const claimNotFound = (): AppError =>
  new AppError(
    404,
    ErrorCode.NOT_FOUND,
    'This claim no longer exists. The owner may have removed the item.',
  );
```

- [ ] **Step 4: The service methods**

In `apps/api/src/claims/claims.service.ts`, extend the imports:
- from `@wishlist/contracts`: `type Claim`, `type ClaimDetailsResponse`, `type UpdateClaimRequest`;
- from `../db/schema.js`: `users` as well;
- from `../wishlist/links.js`: `shareUrl` as well;
- from `./claims-errors.js`: `claimNotFound` as well;
- from `./queries.js`: `SHARED_ITEM_COLUMNS` and `SNAPSHOT` as well;
- from `./remaining.js`: `fitsChangedClaim` as well.

Then add these methods to `ClaimsService`:

```ts
  /** The claimer's own view (spec §5.1): the manage token is the capability. */
  async details(manageToken: string): Promise<ClaimDetailsResponse> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          claim: CLAIM_COLUMNS,
          item: SHARED_ITEM_COLUMNS,
          wishlistTitle: wishlists.title,
          shareToken: wishlists.shareToken,
          ownerSeesClaims: wishlists.showClaimsToOwner,
          ownerDisplayName: users.displayName,
        })
        .from(claims)
        .innerJoin(items, eq(items.id, claims.itemId))
        .innerJoin(wishlists, eq(wishlists.id, items.wishlistId))
        .innerJoin(users, eq(users.id, wishlists.ownerId))
        .where(eq(claims.manageTokenHash, hashToken(manageToken)));
      if (!row) throw claimNotFound();
      const claimed = await claimedTotal(tx, row.item.id);
      return {
        claim: row.claim,
        item: row.item,
        wishlistTitle: row.wishlistTitle,
        ownerDisplayName: row.ownerDisplayName,
        remaining: remainingOf(row.item.quantity, claimed),
        // The list's current link, so it's right after a rotation (spec §5).
        shareUrl: shareUrl(this.env.APP_ORIGIN, row.shareToken),
        ownerSeesClaims: row.ownerSeesClaims,
      };
    }, SNAPSHOT);
  }

  /**
   * A new name, a new quantity, or both (spec §5). The new quantity may be at most what's left
   * plus what the claim holds (spec §2), so keeping or lowering it never fails (D19).
   */
  async update(manageToken: string, input: UpdateClaimRequest, ip: string): Promise<Claim> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    await this.limiter.enforce(claimsIpKey(ip), CLAIMS_PER_IP);
    const tokenHash = hashToken(manageToken);
    const [found] = await this.db
      .select({ itemId: claims.itemId, wishlistId: items.wishlistId })
      .from(claims)
      .innerJoin(items, eq(items.id, claims.itemId))
      .where(eq(claims.manageTokenHash, tokenHash));
    if (!found) throw claimNotFound();
    await this.limiter.enforce(claimsListKey(found.wishlistId), CLAIMS_PER_LIST);

    return this.db.transaction(async (tx) => {
      // The same lock as a new claim's (spec §6.3): the item's row, and nothing else.
      const [item] = await tx
        .select({ quantity: items.quantity })
        .from(items)
        .where(eq(items.id, found.itemId))
        .for('update');
      // The claim may have gone while we waited: cancelled, or deleted with its item.
      const [current] = item
        ? await tx
            .select({ id: claims.id, quantity: claims.quantity })
            .from(claims)
            .where(eq(claims.manageTokenHash, tokenHash))
        : [];
      if (!item || !current) throw claimNotFound();
      if (input.quantity !== undefined) {
        const claimed = await claimedTotal(tx, found.itemId);
        if (!fitsChangedClaim(input.quantity, current.quantity, item.quantity, claimed)) {
          throw claimExceedsRemaining(remainingOf(item.quantity, claimed));
        }
      }
      const [row] = await tx
        .update(claims)
        .set({
          ...(input.claimerName !== undefined && { claimerName: input.claimerName }),
          ...(input.quantity !== undefined && { quantity: input.quantity }),
          updatedAt: this.clock.now(),
        })
        .where(eq(claims.id, current.id))
        .returning(CLAIM_COLUMNS);
      if (!row) throw claimNotFound();
      return row;
    });
  }

  /** Cancels the claim (spec §5). No lock: removing a claim can't over-commit an item (§6.3). */
  async cancel(manageToken: string): Promise<void> {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) throw claimNotFound();
    const deleted = await this.db
      .delete(claims)
      .where(eq(claims.manageTokenHash, hashToken(manageToken)))
      .returning({ id: claims.id });
    if (deleted.length === 0) throw claimNotFound();
  }
```

- [ ] **Step 5: The controller and the module**

Create `apps/api/src/claims/claims.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
} from '@nestjs/common';
import {
  UpdateClaimRequestSchema,
  type Claim,
  type ClaimDetailsResponse,
  type UpdateClaimRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';

/** One claim, through its private manage link (spec §5). The token is the only authorization. */
@Controller('claims')
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Get(':manageToken')
  @Header('Cache-Control', 'no-store')
  details(@Param('manageToken') manageToken: string): Promise<ClaimDetailsResponse> {
    return this.claims.details(manageToken);
  }

  @Patch(':manageToken')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('manageToken') manageToken: string,
    @Body(new ZodValidationPipe(UpdateClaimRequestSchema)) body: UpdateClaimRequest,
    @ClientIp() ip: string,
  ): Promise<Claim> {
    return this.claims.update(manageToken, body, ip);
  }

  @Delete(':manageToken')
  @HttpCode(204)
  async cancel(@Param('manageToken') manageToken: string): Promise<void> {
    await this.claims.cancel(manageToken);
  }
}
```

In `apps/api/src/claims/claims.module.ts`, add `ClaimsController` to `controllers`: `controllers: [SharedController, ClaimsController]`.

- [ ] **Step 6: Run the test to see it pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration manage-claims claims.int-spec`
Expected: PASS.

- [ ] **Step 7: Gate the layer, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): read, change and cancel a claim by its manage link

GET /claims/:manageToken is the claimer's own view: their claim, the
item, what's left and the list's current share link (spec §5, §5.1).
PATCH changes the name or the quantity under the item's lock; the new
quantity may be at most what's left plus what the claim holds (spec §2,
§6.3 as amended), so keeping or lowering never fails after an owner
cuts the quantity (D19). It shares the claim limits. DELETE cancels.

A malformed, unknown or deleted claim is 404 NOT_FOUND.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 6: The owner's opt-in

**Files:**
- Modify: `packages/contracts/src/wishlist.ts` (`ItemSchema`, `WishlistResponseSchema`, `WishlistSettingsResponseSchema`, `UpdateWishlistRequestSchema`)
- Modify: `packages/contracts/src/wishlist.spec.ts`
- Modify: `apps/api/src/wishlist/wishlist.service.ts`, `apps/api/src/wishlist/wishlist.controller.ts`
- Modify: `apps/api/test/wishlist.int-spec.ts`

**Interfaces:**
- Consumes: `projectWishlist`, `seesClaims`, `Viewer` (Task 2); `readClaims`, `SNAPSHOT` (Task 3); test support `seedItem`, `seedClaim`, `shareTokenOf` (Task 3).
- Produces:
  - `UpdateWishlistRequestSchema` = `{ title?: string; showClaimsToOwner?: boolean }`, at least one.
  - `WishlistResponse` gains optional `showClaimsToOwner`; `Item` gains optional `remaining` and `claims`; `WishlistSettingsResponse` gains optional `showClaimsToOwner`.
  - `WishlistService.updateSettings(ownerId: string, changes: UpdateWishlistRequest): Promise<WishlistSettingsResponse>` (replaces `rename`).

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/owner-claims
```

- [ ] **Step 1: Write the failing contract test**

In `packages/contracts/src/wishlist.spec.ts`, replace the existing `UpdateWishlistRequestSchema` tests (search for `describe('UpdateWishlistRequestSchema`; if there's no such block, add this one) with:

```ts
describe('UpdateWishlistRequestSchema (spec §5, D33)', () => {
  it('takes a title, the spoiler setting, or both', () => {
    expect(UpdateWishlistRequestSchema.parse({ title: ' Birthday ' })).toEqual({
      title: 'Birthday',
    });
    expect(UpdateWishlistRequestSchema.parse({ showClaimsToOwner: true })).toEqual({
      showClaimsToOwner: true,
    });
  });

  it.each([{}, { showClaimsToOwner: 'yes' }, { title: '' }])('refuses %j', (body) => {
    expect(UpdateWishlistRequestSchema.safeParse(body).success).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL: `{ showClaimsToOwner: true }` doesn't parse, because `title` is required.

- [ ] **Step 2: Change the contracts**

In `packages/contracts/src/wishlist.ts`:

```ts
/** A new title, the spoiler setting, or both (spec §5, D33). */
export const UpdateWishlistRequestSchema = z
  .object({ title: WishlistTitleSchema.optional(), showClaimsToOwner: z.boolean().optional() })
  .refine((body) => body.title !== undefined || body.showClaimsToOwner !== undefined, {
    message: 'Change the title or the spoiler setting',
  });
```

Add `...ITEM_CLAIM_FIELDS` as the last entry of `ItemSchema`'s object, and update its comment: `An item as the owner sees it. Every field is present; empty ones are null (Plan 3a rule 1). \`remaining\` and \`claims\` appear only once the owner opts in (spec §5.1).`

Add `showClaimsToOwner: z.boolean().optional(),` to `WishlistResponseSchema` (after `shareUrl`), and to `WishlistSettingsResponseSchema`. Replace `WishlistResponseSchema`'s comment with: `/** \`GET /wishlist\` (spec §5). Fields added after Plan 3a are optional, for expand/contract (spec §10). */`. Delete the now-stale comment `/** \`showClaimsToOwner\` joins this in Plan 4, with the claims it controls (D33). */`.

`SharedItemSchema` (Task 1) is `ItemSchema.omit({ position: true }).extend(ITEM_CLAIM_FIELDS)`; extending with fields it now already has is harmless, so leave it.

Run: `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`
Expected: PASS.

- [ ] **Step 3: Check the web still compiles against the new request shape**

`apps/web/src/components/account/list-name-form.tsx` uses `UpdateWishlistRequestSchema` as its form resolver and always submits `{ title }`.

Run: `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run typecheck test --filter=@wishlist/web`
Expected: PASS, with no change under `apps/web`.

**Fallback, only if this fails:** add to `packages/contracts/src/wishlist.ts`

```ts
/** The settings page's list-name form: always a title (spec §7). */
export const WishlistTitleFormSchema = z.object({ title: WishlistTitleSchema });
```

and change the form's resolver to `zodResolver(WishlistTitleFormSchema, { error: formErrorMap })`, the import to match. That is the one web change this plan allows. Record it in the ledger.

- [ ] **Step 4: Write the failing integration tests**

In `apps/api/test/wishlist.int-spec.ts`:
- add `ClaimDetailsResponseSchema`, `CreateClaimResponseSchema` and `SharedWishlistResponseSchema` to the `@wishlist/contracts` import;
- add `ADA` to the existing import from `./support/accounts.js`;
- add `import { seedClaim, seedItem, shareTokenOf } from './support/lists.js';`.
- **replace** the test `'carries no claim data and no spoiler setting before Plan 4 (D33)'` with:

```ts
  it('says whether the owner sees claims, and carries none until the owner opts in (spec §5.1, §8)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    await seedClaim(db, kettle, 'Sue', 1);
    const res = await client(t.app, cookie).get('/wishlist');
    expect(Object.keys(res.body as object).sort()).toEqual([
      'items',
      'shareUrl',
      'showClaimsToOwner',
      'title',
    ]);
    const body = res.body as { showClaimsToOwner: boolean; items: object[] };
    expect(body.showClaimsToOwner).toBe(false);
    expect(body.items[0]).not.toHaveProperty('remaining');
    expect(body.items[0]).not.toHaveProperty('claims');
    expect(JSON.stringify(res.body)).not.toContain('Sue');
  });
```

- **replace** the test `'ignores showClaimsToOwner until Plan 4 (D33)'` with:

```ts
  it('turns the spoiler setting on and off, leaving the title alone (D33)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    const sue = await seedClaim(db, kettle, 'Sue', 1);

    const on = await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    expect(on.status).toBe(200);
    expect(WishlistSettingsResponseSchema.parse(on.body)).toMatchObject({
      title: "Ada's wishlist",
      showClaimsToOwner: true,
    });
    const shown = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(shown.items[0]).toMatchObject({
      remaining: 1,
      claims: [{ id: sue.id, claimerName: 'Sue', quantity: 1 }],
    });

    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: false });
    const hidden = (await client(t.app, cookie).get('/wishlist')).body as { items: object[] };
    expect(hidden.items[0]).not.toHaveProperty('claims');
  });

  it('renames without touching the spoiler setting', async () => {
    const cookie = await owner();
    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    const res = await client(t.app, cookie).patch('/wishlist', { title: 'Birthday' });
    expect(WishlistSettingsResponseSchema.parse(res.body)).toMatchObject({
      title: 'Birthday',
      showClaimsToOwner: true,
    });
  });

  it.each([{}, { showClaimsToOwner: 'yes' }])('refuses %j with 400', async (body) => {
    const res = await client(t.app, await owner()).patch('/wishlist', body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('tells gifters which way the setting is, on the share page and the manage page (D40)', async () => {
    const cookie = await owner();
    const kettle = await seedItem(db, ADA.email, 'Kettle', 2);
    const token = await shareTokenOf(db, ADA.email);
    const made = CreateClaimResponseSchema.parse(
      (
        await client(t.app).post(`/shared/${token}/items/${kettle}/claims`, {
          claimerName: 'Sue',
        })
      ).body,
    );
    await client(t.app, cookie).patch('/wishlist', { showClaimsToOwner: true });
    const page = SharedWishlistResponseSchema.parse((await client(t.app).get(`/shared/${token}`)).body);
    const manage = ClaimDetailsResponseSchema.parse(
      (await client(t.app).get(`/claims/${made.manageToken}`)).body,
    );
    expect([page.ownerSeesClaims, manage.ownerSeesClaims]).toEqual([true, true]);
  });
```

Also update `'returns the list sign-up made, its share link and no items, and is never cached'`: its `toEqual` gains `showClaimsToOwner: false`.

- [ ] **Step 5: Run them to see them fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration wishlist.int-spec`
Expected: FAIL: `GET /wishlist` has no `showClaimsToOwner`, and `PATCH /wishlist` with `{ showClaimsToOwner: true }` answers 400.

- [ ] **Step 6: The service and the controller**

In `apps/api/src/wishlist/wishlist.service.ts`, replace `get` and `rename`:

```ts
  /**
   * The owner's list, its items in order, and claim data only after opting in (spec §5.1). One
   * snapshot, so `remaining` agrees with the items beside it.
   */
  async get(ownerId: string): Promise<WishlistResponse> {
    return this.db.transaction(async (tx) => {
      const [list] = await tx
        .select({
          id: wishlists.id,
          title: wishlists.title,
          shareToken: wishlists.shareToken,
          showClaims: wishlists.showClaimsToOwner,
        })
        .from(wishlists)
        .where(eq(wishlists.ownerId, ownerId));
      if (!list) throw unauthenticated();
      const rows = await tx
        .select(ITEM_COLUMNS)
        .from(items)
        .where(eq(items.wishlistId, list.id))
        .orderBy(asc(items.position), asc(items.id));
      const viewer: Viewer = { kind: 'owner', showClaims: list.showClaims };
      // An owner who hasn't opted in never gets claim data: it isn't even read (spec §5).
      const claimRows = seesClaims(viewer) ? await readClaims(tx, list.id) : [];
      return {
        title: list.title,
        shareUrl: this.shareUrl(list.shareToken),
        showClaimsToOwner: list.showClaims,
        items: projectWishlist(rows, claimRows, viewer),
      };
    }, SNAPSHOT);
  }

  /** A new title, the spoiler setting, or both (spec §5, D33). One UPDATE takes the row lock. */
  async updateSettings(
    ownerId: string,
    changes: UpdateWishlistRequest,
  ): Promise<WishlistSettingsResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({
        ...(changes.title !== undefined && { title: changes.title }),
        ...(changes.showClaimsToOwner !== undefined && {
          showClaimsToOwner: changes.showClaimsToOwner,
        }),
        updatedAt: this.clock.now(),
      })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({
        title: wishlists.title,
        shareToken: wishlists.shareToken,
        showClaimsToOwner: wishlists.showClaimsToOwner,
      });
    if (!list) throw unauthenticated();
    return {
      title: list.title,
      shareUrl: this.shareUrl(list.shareToken),
      showClaimsToOwner: list.showClaimsToOwner,
    };
  }
```

Add the imports: `type UpdateWishlistRequest` from `@wishlist/contracts`; `projectWishlist`, `seesClaims`, `type Viewer` from `../claims/projection.js`; `readClaims`, `SNAPSHOT` from `../claims/queries.js`. Update the class comment to `/** The list itself: reading it, its settings, and rotating its share link (spec §5). */`.

In `apps/api/src/wishlist/wishlist.controller.ts`, rename the handler `rename` to `update` and call `this.wishlist.updateSettings(auth.user.id, body)`.

- [ ] **Step 7: Run the tests to see them pass, then the settings E2E**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration wishlist shared claims
pnpm test:e2e tests/local/settings.spec.ts
```

Expected: PASS. The E2E proves the settings form still renames the list with the new request schema.

- [ ] **Step 8: Gate the layer, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add packages/contracts apps/api
git commit -F - <<'EOF'
feat(api): let the owner opt in to seeing claims

PATCH /wishlist takes `showClaimsToOwner` beside `title` (D33). GET
/wishlist reads through the same projection as the share page: until
the owner opts in, its items carry no `remaining` or `claims`, and the
claims aren't even read (spec §5.1). It reads in one REPEATABLE READ
snapshot. The new response fields are optional in the contracts, for
expand/contract (spec §10).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 7: Unfurl's DNS lookups on c-ares (I2)

**Files:**
- Create: `apps/api/src/unfurl/dns.ts`, `apps/api/src/unfurl/dns.spec.ts`
- Modify: `apps/api/src/unfurl/page-fetcher.ts`, `apps/api/src/unfurl/page-fetcher.spec.ts`

**Interfaces:**
- Produces: `dns.ts`: `type Resolve = (hostname: string, signal: AbortSignal) => Promise<string[]>`, `interface DnsResolver { resolve4; resolve6; cancel }`, `createCaresResolve(options?: { maxConcurrent?: number; newResolver?: () => DnsResolver }): Resolve`. `page-fetcher.ts` re-exports `type Resolve`, and its default `resolveAll` becomes `createCaresResolve()`.

- [ ] **Step 0: Start the layer**

```bash
gh stack add api/go-live-hardening
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/unfurl/dns.spec.ts`:

```ts
import { Resolver } from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaresResolve, type DnsResolver } from './dns.js';

/** A stand-in for c-ares: answers when told, and fails its queries when cancelled, as c-ares does. */
class FakeResolver implements DnsResolver {
  cancelled = false;
  private readonly pending: ((error: Error) => void)[] = [];
  constructor(private readonly answer: (family: 4 | 6) => Promise<string[]>) {}
  resolve4(): Promise<string[]> {
    return this.query(4);
  }
  resolve6(): Promise<string[]> {
    return this.query(6);
  }
  cancel(): void {
    this.cancelled = true;
    for (const fail of this.pending.splice(0)) {
      fail(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
    }
  }
  private query(family: 4 | 6): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.pending.push(reject);
      this.answer(family).then(resolve, reject);
    });
  }
}

const noRecords = () => Promise.reject(Object.assign(new Error('none'), { code: 'ENODATA' }));
const never = () => new Promise<string[]>(() => undefined);
const live = () => new AbortController().signal;
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCaresResolve (spec §6.8, Plan 4a)', () => {
  it('joins the A and AAAA answers', async () => {
    const resolve = createCaresResolve({
      newResolver: () =>
        new FakeResolver((family) =>
          Promise.resolve(family === 4 ? ['93.184.216.34'] : ['2606:2800:220:1::1']),
        ),
    });
    await expect(resolve('shop.example', live())).resolves.toEqual([
      '93.184.216.34',
      '2606:2800:220:1::1',
    ]);
  });

  it('uses one family’s answer when the other has none', async () => {
    const resolve = createCaresResolve({
      newResolver: () =>
        new FakeResolver((family) =>
          family === 4 ? Promise.resolve(['93.184.216.34']) : noRecords(),
        ),
    });
    await expect(resolve('shop.example', live())).resolves.toEqual(['93.184.216.34']);
  });

  it('fails when neither family answers', async () => {
    const resolve = createCaresResolve({ newResolver: () => new FakeResolver(noRecords) });
    await expect(resolve('nowhere.example', live())).rejects.toThrow();
  });

  it('runs at most four lookups at once, and starts the next as one finishes', async () => {
    const release: (() => void)[] = [];
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 4,
      newResolver: () => {
        created++;
        return new FakeResolver((family) =>
          family === 4
            ? new Promise((answer) => release.push(() => answer(['93.184.216.34'])))
            : noRecords(),
        );
      },
    });
    const lookups = Array.from({ length: 5 }, () => resolve('shop.example', live()));
    await flush();
    expect(created).toBe(4);
    release[0]?.();
    await lookups[0];
    await flush();
    expect(created).toBe(5);
    for (const answer of release.slice(1)) answer();
    await Promise.all(lookups);
  });

  it('never starts a lookup still waiting for its turn at the deadline', async () => {
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 1,
      newResolver: () => {
        created++;
        return new FakeResolver(never);
      },
    });
    const first = new AbortController();
    const running = resolve('slow.example', first.signal);
    const second = new AbortController();
    const waiting = resolve('next.example', second.signal);
    second.abort(new Error('deadline'));
    await expect(waiting).rejects.toThrow('deadline');
    first.abort(new Error('deadline'));
    await expect(running).rejects.toThrow();
    expect(created).toBe(1);
  });

  it('cancels its own resolver at the deadline, and no one else’s', async () => {
    const resolvers: FakeResolver[] = [];
    const resolve = createCaresResolve({
      newResolver: () => {
        const resolver = new FakeResolver(never);
        resolvers.push(resolver);
        return resolver;
      },
    });
    const mine = new AbortController();
    const theirs = new AbortController();
    const myLookup = resolve('slow.example', mine.signal);
    const theirLookup = resolve('other.example', theirs.signal);
    await flush();
    mine.abort(new Error('deadline'));
    await expect(myLookup).rejects.toThrow();
    expect(resolvers.map((resolver) => resolver.cancelled)).toEqual([true, false]);
    theirs.abort(new Error('deadline'));
    await expect(theirLookup).rejects.toThrow();
  });

  it('frees its turn when a lookup is cancelled, so the next can start', async () => {
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 1,
      newResolver: () => {
        created++;
        return new FakeResolver(created === 1 ? never : () => Promise.resolve(['93.184.216.34']));
      },
    });
    const first = new AbortController();
    const stuck = resolve('slow.example', first.signal);
    const next = resolve('shop.example', live());
    first.abort(new Error('deadline'));
    await expect(stuck).rejects.toThrow();
    await expect(next).resolves.toEqual(['93.184.216.34']);
  });

  it('asks c-ares by default, not getaddrinfo', async () => {
    // resolve4 and resolve6 are overloaded, so the stand-ins are cast.
    const v4 = vi
      .spyOn(Resolver.prototype, 'resolve4')
      .mockImplementation((() => Promise.resolve(['93.184.216.34'])) as never);
    vi.spyOn(Resolver.prototype, 'resolve6').mockImplementation((() => noRecords()) as never);
    await expect(createCaresResolve()('shop.example', live())).resolves.toEqual([
      '93.184.216.34',
    ]);
    expect(v4).toHaveBeenCalledWith('shop.example');
  });
});
```

In `apps/api/src/unfurl/page-fetcher.spec.ts`, after the test `'gives up on DNS that is too slow'`, add:

```ts
  it('hands the deadline to the resolver, so a slow lookup is cancelled, not abandoned (Plan 4a)', async () => {
    let seen: AbortSignal | undefined;
    const page = await new PageFetcher({
      timeoutMs: 200,
      resolve: (_hostname, signal) => {
        seen = signal;
        return new Promise<string[]>(() => undefined);
      },
    }).fetch('http://slow-dns.test/');
    expect(page).toMatchObject({ ok: false, reason: 'TIMEOUT' });
    expect(seen?.aborted).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit dns page-fetcher`
Expected: FAIL: `./dns.js` doesn't exist, and `seen` is `undefined` because `resolve` is called with the hostname only.

- [ ] **Step 3: Write `dns.ts`**

Create `apps/api/src/unfurl/dns.ts`:

```ts
import { Resolver } from 'node:dns/promises';

/**
 * Resolves a hostname to every address it has. `signal` aborts at the fetch's deadline, and the
 * lookup should stop then, not just be abandoned (spec §6.8).
 */
export type Resolve = (hostname: string, signal: AbortSignal) => Promise<string[]>;

/** The part of `dns.promises.Resolver` a lookup uses. Tests pass a fake. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export interface CaresResolveOptions {
  /** How many lookups may run at once in this process. */
  maxConcurrent?: number;
  /** Makes the resolver for one lookup. */
  newResolver?: () => DnsResolver;
}

// c-ares gives up by itself after two tries of two seconds, in case nothing cancels it.
const newCaresResolver = (): DnsResolver => new Resolver({ timeout: 2_000, tries: 2 });

/**
 * Hostname lookups for unfurl, with c-ares rather than `dns.lookup` (spec §6.8, Plan 4a).
 * `dns.lookup` is getaddrinfo on one of libuv's four threadpool threads, and it holds that thread
 * until the OS gives up, long after our deadline. A few slow lookups then starve everything else
 * on the pool, argon2 included. c-ares does its own non-blocking I/O.
 * - A and AAAA are asked for in parallel, and the answers joined. One family failing is fine.
 * - Each lookup has its own resolver, cancelled at the deadline: `cancel()` stops every query on a
 *   resolver, so a shared one would cancel other people's lookups too.
 * - At most `maxConcurrent` run at once. One still waiting for its turn at the deadline never
 *   starts.
 */
export function createCaresResolve(options: CaresResolveOptions = {}): Resolve {
  const maxConcurrent = options.maxConcurrent ?? 4;
  const newResolver = options.newResolver ?? newCaresResolver;
  let running = 0;
  const queue: (() => void)[] = [];

  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', giveUp);
        running++;
        resolve();
      };
      const giveUp = () => {
        const index = queue.indexOf(start);
        if (index !== -1) queue.splice(index, 1);
        reject(signal.reason as Error);
      };
      queue.push(start);
      signal.addEventListener('abort', giveUp, { once: true });
    });
  };

  const release = () => {
    running--;
    queue.shift()?.();
  };

  return async (hostname, signal) => {
    await acquire(signal);
    try {
      return await lookUp(newResolver(), hostname, signal);
    } finally {
      release();
    }
  };
}

async function lookUp(
  resolver: DnsResolver,
  hostname: string,
  signal: AbortSignal,
): Promise<string[]> {
  // The deadline may have passed while this lookup waited for its turn to be handed over.
  signal.throwIfAborted();
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    if (v4.status === 'rejected' && v6.status === 'rejected') {
      throw new Error('no A or AAAA records', { cause: v4.reason });
    }
    return [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
```

- [ ] **Step 4: Use it in `PageFetcher`**

In `apps/api/src/unfurl/page-fetcher.ts`:
- delete `import { lookup as dnsLookup } from 'node:dns/promises';`;
- add `import { createCaresResolve, type Resolve } from './dns.js';`;
- replace the `Resolve` type and `resolveAll` with:

```ts
export type { Resolve };

/** The default: c-ares, at most 4 lookups at once per process (spec §6.8, Plan 4a). */
export const resolveAll: Resolve = createCaresResolve();
```

- in `lookUp`, pass the signal: `addresses = await untilAborted(this.resolve(host, signal), signal);`.

The existing tests' `hosts()` fakes take only the hostname, which still satisfies `Resolve`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit dns page-fetcher metadata-fetcher`
Expected: PASS.

- [ ] **Step 6: Check unfurl's E2E path still says "couldn't find that site"**

E2E unfurls `https://hanker-e2e.invalid/…`, which must still fail fast as `DNS_FAILED` through c-ares, not `TIMEOUT`.

Run: `pnpm test:e2e tests/local/add-item.spec.ts`
Expected: PASS. If a test fails because the failure message is the timeout's rather than "We couldn’t find that site", the machine's resolver isn't answering `NXDOMAIN` for `.invalid` quickly through c-ares: stop and report it, with how long the lookup took.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/unfurl
git commit -F - <<'EOF'
fix(api): resolve unfurl's hostnames with c-ares, not the threadpool

dns.lookup is getaddrinfo on one of libuv's four threadpool threads,
held until the OS gives up, long after unfurl's deadline. A few slow
lookups starved everything else on the pool: in Plan 3a's probe, argon2
went from 9 ms to 317 ms. c-ares does its own non-blocking I/O.

Each lookup asks for A and AAAA in parallel with its own resolver,
which the deadline cancels, and at most four run at once per process
(spec §6.8; Plan 3a final review, I2).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 8: A raw-byte cap on compressed bodies (M2)

**Files:**
- Modify: `apps/api/src/unfurl/page-fetcher.ts`, `apps/api/src/unfurl/page-fetcher.spec.ts`

**Interfaces:**
- Produces: `PageFetcherOptions.maxRawBytes?: number` (default 1,048,576).

- [ ] **Step 1: Write the failing test**

In `apps/api/src/unfurl/page-fetcher.spec.ts`, above `beforeAll`, add:

```ts
/**
 * A gzip stream that decodes to PAGE, then 1.5 MB of empty deflate blocks that decode to nothing,
 * and never ends (Plan 4a, M2). Each empty stored block is 5 bytes: a header byte, then a length
 * of 0 and its complement.
 */
function paddedGzip(): Buffer[] {
  const page = Buffer.from(PAGE);
  const length = Buffer.alloc(4);
  length.writeUInt16LE(page.length, 0);
  length.writeUInt16LE(~page.length & 0xffff, 2);
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff]);
  const padding = Buffer.alloc(1_500_000);
  for (let i = 0; i < padding.length; i += 5) padding.fill(0xff, i + 3, i + 5);
  return [Buffer.concat([header, Buffer.from([0x00]), length, page]), padding];
}
```

In the server's `switch`, before `case '/slow':`, add:

```ts
      case '/gzip-padding':
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        for (const chunk of paddedGzip()) res.write(chunk);
        return; // Never ends.
```

After the test `'stops decompressing a compression bomb at 1 MB decoded (Plan 3a rule 8)'`, add:

```ts
  it('stops reading a compressed body at 1 MB raw, and returns what it decoded (Plan 4a, M2)', async () => {
    const page = await fetcher({ timeoutMs: 2_000 }).fetch(at('/gzip-padding'));
    expect(page).toMatchObject({ ok: true, truncated: true });
    expect(page.ok && page.html).toBe(PAGE);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit page-fetcher`
Expected: FAIL with `{ ok: false, reason: 'TIMEOUT' }`: without a raw cap, the fetcher keeps reading padding that decodes to nothing until the deadline.

- [ ] **Step 3: Add the cap**

In `apps/api/src/unfurl/page-fetcher.ts`:
- change `import { pipeline, type Readable } from 'node:stream';` to `import { pipeline, Transform, type Readable, type TransformCallback } from 'node:stream';`;
- add `maxRawBytes?: number;` to `PageFetcherOptions`, a `private readonly maxRawBytes: number;` field, and `this.maxRawBytes = options.maxRawBytes ?? 1_048_576;` in the constructor;
- in the class comment's last bullet, add: `A compressed body also stops at \`maxRawBytes\` before decompression, so a stream that decodes to almost nothing can't keep us reading until the deadline (Plan 4a).`;
- replace the two body lines in `fetch()`:

```ts
        const raw = new RawCap(this.maxRawBytes);
        const body = decoded(res.body, res.headers['content-encoding'], raw);
        const { bytes, truncated } = await readCapped(body, this.maxBytes, raw);
```

- in `decoded`, take `raw: RawCap` as a third parameter and put it before each decompressor: `pipeline(body, raw, createGunzip(), ignore)`, `pipeline(body, raw, createInflate(), ignore)`, `pipeline(body, raw, createBrotliDecompress(), ignore)`. A plain body (`''` or `identity`) skips it: there, raw bytes are the decoded bytes, which `readCapped` already caps;
- add, after `decoded`:

```ts
/**
 * Counts a compressed body's raw bytes, and stops the stream once more than `max` have passed
 * (spec §6.8, Plan 4a). `reached` tells readCapped the stop was the cap, not a failure.
 */
class RawCap extends Transform {
  reached = false;
  private total = 0;

  constructor(private readonly max: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.total += chunk.length;
    if (this.total > this.max) {
      this.reached = true;
      callback(new Error('raw byte cap reached'));
      return;
    }
    callback(null, chunk);
  }
}
```

- change `readCapped` to take the cap and treat its stop as the page's end:

```ts
/**
 * The body's first `max` bytes, counted after decompression, and whether there was more. A body
 * stopped by its raw cap ends here too, with what was decoded so far.
 */
async function readCapped(
  stream: Readable,
  max: number,
  raw: RawCap,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      if (total + buffer.length > max) {
        chunks.push(buffer.subarray(0, max - total));
        // Leaving the loop destroys the stream, so the rest is never downloaded or decompressed.
        // An undici body destroyed before its end emits an abort 'error'. Node's async iterator
        // happens to leave a listener for it; this one means we don't depend on that.
        stream.on('error', () => undefined);
        return { bytes: Buffer.concat(chunks), truncated: true };
      }
      total += buffer.length;
      chunks.push(buffer);
    }
  } catch (error) {
    if (raw.reached) return { bytes: Buffer.concat(chunks), truncated: true };
    throw error;
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @wishlist/api exec vitest run --project unit page-fetcher metadata-fetcher`
Expected: PASS, the compression-bomb test included: a bomb reaches 1 MB decoded long before 1 MB raw.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/unfurl
git commit -F - <<'EOF'
fix(api): cap a compressed body's raw bytes, not only its decoded ones

Reading stopped at 1 MB decoded, so a compressed stream that decodes to
almost nothing (empty deflate blocks) kept unfurl reading until its
5-second deadline. The raw bytes are now capped at 1 MB too, before
decompression, and the page is parsed from what was decoded
(spec §6.8; Plan 3a final review, M2).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 9: Blank-looking names (D41) and the built title

**Files:**
- Modify: `packages/contracts/src/text.ts`
- Modify: `packages/contracts/src/auth.spec.ts`, `packages/contracts/src/wishlist.spec.ts`, `packages/contracts/src/claims.spec.ts`
- Modify: `packages/contracts/src/wishlist.ts` (add `defaultWishlistTitle`)
- Modify: `apps/api/src/auth/signup.service.ts`

**Interfaces:**
- Produces: `defaultWishlistTitle(displayName: string): string` from `@wishlist/contracts`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/src/auth.spec.ts`, beside the existing `DisplayNameSchema` cases (the block that refuses `'only a joiner'`), add:

```ts
  it.each([
    ['a Hangul filler', 'ㅤ'],
    ['Hangul fillers', 'ㅤㅤ'],
    ['the leading and vowel fillers', 'ᅟᅠ'],
    ['a halfwidth filler', 'ﾠ'],
    ['a Braille blank in spaces', ' ⠀ '],
    ['a combining grapheme joiner', '͏'],
    ['Khmer inherent vowels', '឴឵'],
    ['a joiner and a filler', '‍ㅤ'],
  ])('refuses a name that draws nothing: %s (D41)', (_label, name) => {
    expect(DisplayNameSchema.safeParse(name).success).toBe(false);
  });

  it.each(['Adaㅤ', '⠀Ada'])('keeps %j as typed: something in it shows (D41)', (name) => {
    expect(DisplayNameSchema.parse(name)).toBe(name);
  });
```

In `packages/contracts/src/wishlist.spec.ts`, add (importing `DisplayNameSchema` from `./auth.js` and `defaultWishlistTitle` from `./wishlist.js`):

```ts
describe('blank-looking text elsewhere (D41)', () => {
  it.each([
    ['WishlistTitleSchema', WishlistTitleSchema],
    ['ItemTitleSchema', ItemTitleSchema],
    ['PriceTextSchema', PriceTextSchema],
  ] as const)('%s refuses a value that draws nothing', (_name, schema) => {
    expect(schema.safeParse('ㅤ⠀').success).toBe(false);
  });
});

describe('defaultWishlistTitle (spec §2, Plan 4a rule 11)', () => {
  it.each([
    'Ada',
    'a'.repeat(50),
    '\u{1F469}‍\u{1F373} Ada',
    'می‌خواهم',
    "O'Brien",
    'Adaㅤ',
  ])('builds a valid title from the display name %j', (name) => {
    const title = defaultWishlistTitle(DisplayNameSchema.parse(name));
    expect(WishlistTitleSchema.parse(title)).toBe(title);
  });

  it('is the title sign-up gives', () => {
    expect(defaultWishlistTitle('Ada')).toBe("Ada's wishlist");
  });
});
```

In `packages/contracts/src/claims.spec.ts`, add `['only Hangul fillers', 'ㅤㅤ']` to the `ClaimerNameSchema` refusals.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL: the blank-letter names parse, and `defaultWishlistTitle` isn't exported.

- [ ] **Step 3: Change `visibleOnly` and add the title builder**

In `packages/contracts/src/text.ts`, after `JOINERS`, add:

```ts
/**
 * Letters and marks that draw nothing (D41): the Hangul fillers, the Braille blank, the combining
 * grapheme joiner and two Khmer inherent vowels. They aren't control or format characters, so
 * HIDDEN_CHARACTERS lets them through; a name made only of them would still show as blank.
 */
const BLANK_LETTERS = /[ᅟᅠㅤﾠ⠀͏឴឵]/gu;
```

and change `visibleOnly`'s last two lines to:

```ts
  const rest = name.replace(JOINERS, '');
  // Joiners, spaces and blank letters alone would show as a blank name (D41).
  return rest.replace(BLANK_LETTERS, '').trim().length > 0 && !HIDDEN_CHARACTERS.test(rest);
```

Update `visibleOnly`'s comment to `Whether a trimmed name or title is made of visible characters (D35, D41).`, keeping its second sentence.

In `packages/contracts/src/wishlist.ts`, after `WishlistTitleSchema`, add:

```ts
/** The title sign-up gives a new list (spec §2). Any valid display name makes a valid title. */
export function defaultWishlistTitle(displayName: string): string {
  return `${displayName}'s wishlist`;
}
```

In `apps/api/src/auth/signup.service.ts`, import `defaultWishlistTitle` from `@wishlist/contracts` (add to the existing import, as a value import) and change `title: \`${input.displayName}'s wishlist\`,` to `title: defaultWishlistTitle(input.displayName),`.

- [ ] **Step 4: Run the tests to see them pass**

```bash
pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/api exec vitest run --project integration signup
```

Expected: PASS. `signup.int-spec.ts` still finds `"Ada's wishlist"`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/auth/signup.service.ts
git commit -F - <<'EOF'
fix(contracts): refuse names that draw nothing

U+3164 and the other Hangul fillers, the Braille blank, U+034F, U+17B4
and U+17B5 are letters or marks, not format characters, so a name made
only of them passed visibleOnly and showed as blank. They now count as
blank, like spaces; beside something visible they're kept (D41). The
rule covers display names, claimer names, titles and prices, now that
names reach gifters.

The title sign-up builds moves into contracts, so a test can prove
every valid display name makes a valid title (Plan 2b carry).

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

---

### Task 10: The docs

**Files:**
- Modify: `docs/development.md` (a "Trying the claims API" section after "Trying the owner API")
- Modify: `AGENTS.md` (a Conventions bullet)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (row 4a's status)

- [ ] **Step 1: The development guide**

In `docs/development.md`, after the "Trying the owner API" section's bullets, add:

````markdown
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
- Claims and claim changes count against 20 an hour per IP and 30 an hour per list (spec §6.6). The counters are rows in `rate_limits`.
````

- [ ] **Step 2: AGENTS.md**

In `AGENTS.md`, under **Conventions**, after the **API shape** bullet, add:

```markdown
- **Claims (Plan 4a):** a claim write locks only its item's row (`FOR UPDATE`), never the wishlist's, which keeps the users → wishlists → items lock order. A read that returns claims (`GET /shared`, `GET /claims`, `GET /wishlist`) runs in one `REPEATABLE READ, READ ONLY` transaction. Claim data reaches an item only through `projectWishlist` (`apps/api/src/claims/projection.ts`): for an owner who hasn't opted in, `remaining` and `claims` are absent, not empty.
```

- [ ] **Step 3: The roadmap**

In `docs/superpowers/plans/2026-10-07-roadmap.md`, change row 4a's plan cell from `Claims API` to `[Claims API](2026-10-14-plan-4a-claims-api.md)` and its status from `Not started` to `Done`.

- [ ] **Step 4: Gate the layer, then commit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
pnpm test:e2e
git add docs AGENTS.md
git commit -F - <<'EOF'
docs: describe the claims API

How to try the share read, a claim, and its manage link by hand; the
claim conventions for agents (lock order, snapshot reads, the one
projection); and row 4a of the roadmap marked done.

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>
EOF
```

`pnpm test:e2e` runs the whole local suite once, here, because Tasks 6 and 7 touched what the web relies on.

---

### Task 11: ⏸ Checkpoint — review, submit, merge, verify

Nothing here is automatic. Each step waits for Ted where it says so.

- [ ] **Step 1: Final whole-branch review.** The executor's final reviewer reads the stack from `main` to the top layer against the spec and this plan. Fix what it finds in the layer that owns the code, then `gh stack rebase --upstack`.

- [ ] **Step 2: Ted approves the first submit.** It's a new stack, so ask before `gh stack submit --open`. If the permission classifier blocks the command, ask Ted to run `! gh stack submit --open` himself.

- [ ] **Step 3: PR titles and bodies.** Give every PR a Conventional Commit title and a summary body (`gh pr edit <n> --title … --body-file …`), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Previews.** Every layer's CI and preview pass; the top layer's smoke run includes the `SHARE_LINK_NOT_FOUND` test. Optional, for Ted: on the top preview, sign up, verify, add an item, and walk "Trying the claims API" against the preview's origin, then paste a real shop link into `/list` to see an unfurl resolve through c-ares on Vercel.

- [ ] **Step 5: Ted merges** (`gh stack merge <top PR> --squash`). Never merged by the executor.

- [ ] **Step 6: Verify production, read-only.** Production is still dark.
  - The deploy run passes every job, smoke included.
  - `GET https://hanker.dev/api/health` reports the merge SHA and `migrationsApplied: 4`.
  - `GET https://hanker.dev/api/shared/AAAAAAAAAAAAAAAAAAAAAA` answers `404` with `SHARE_LINK_NOT_FOUND`.
  - `POST https://hanker.dev/api/auth/signup` still answers `503 CAPTCHA_UNAVAILABLE`.

Then Plan 4b starts with its own brainstorm and mockups.
