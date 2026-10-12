# Plan 3a — Owner API (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API behind an owner's list:
- an `items` table and a verified-email gate;
- reading and renaming the list, and rotating its share link;
- creating, editing, deleting and reordering items;
- a best-effort link prefill ("unfurl"), hardened against SSRF.

All of it ships dark, because nobody can sign up in production until the end of Plan 4 (D31).

**Architecture:**
- **Two controllers in a new `WishlistModule`,** behind `SessionGuard` then a new `VerifiedGuard`:
  - `wishlist`: read, rename, rotate, unfurl;
  - `wishlist/items`: create, edit, delete, reorder.
- **Changes serialize per list.** Every change to a list or its items first locks the owner's `wishlists` row, so concurrent tabs can't duplicate positions or slip past the 200-item cap. Lock order: users → wishlists → items.
- **Unfurl** is a `MetadataFetcher` port (spec §8). Its real adapter has two parts:
  - **`PageFetcher`:** undici's `request()` with a pinned `lookup`, an allowlist address policy, manual redirects, a deadline and a byte cap;
  - **`extractMetadata`:** an htmlparser2 scan of Open Graph, JSON-LD and `<title>`.

  Integration tests swap in a fake.

**Tech Stack:**
- **New, exact, in `apps/api` only:** `undici@8.11.2`, `ipaddr.js@2.5.0`, `htmlparser2@12.0.0`.
- **As before:** NestJS 12, Drizzle and Vitest.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §2 Wishlist and Items, §4 `items`, §5 Owner endpoints, §6.6 (unfurl's limit), §6.8, §8 and §9. It was amended for this plan:
- D30–D34;
- §5's serialization note;
- §6.8's allowlist, undici, lookup and failure-code rules, including `UNREACHABLE`.

The API it builds on is [Plan 2a](2026-10-09-plan-2a-auth-api.md), hardened by [Plan 2b](2026-10-10-plan-2b-auth-web.md).

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1, 1b, 2a and 2b still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`.
- Exact version pins, and Vitest.
- Explicit `@Inject` on every constructor dependency.
- Every error is problem+json with a stable `code`.
- An error's `detail` never echoes what the caller sent.
- No personal data in logs.
- State-changing test requests go through `test/support/client.ts`.
- A migration works alongside the API that's currently deployed.

**New dependencies, exact, in `apps/api` only:**
- `undici@8.11.2`
- `ipaddr.js@2.5.0`
- `htmlparser2@12.0.0`

Nothing else.
- **Never Node's global `fetch` for unfurl.** Node 24 bundles undici 7.29, and an npm `undici` dispatcher can't be trusted to plug into it (spec §6.8).
- **Never `setGlobalDispatcher`.** It would route the API's other outbound calls (Resend, Turnstile, HIBP) through the unfurl policy.

**Dark.** No environment variable, secret or Vercel setting changes in this plan. Sign-up stays closed (D31), so the new endpoints can only be reached in tests and on previews.

**Naming.** People see **Hanker**. Code, tables and packages say `wishlist`. Unfurl identifies itself as `Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)` (D34).

**Values fixed by this plan:**

| Thing | Value |
|---|---|
| Wishlist title | 1–100 characters, trimmed |
| Item title | 1–200 characters, trimmed |
| Item `url` | Optional; http or https; at most 2048 characters; trimmed |
| Item `imageUrl` | Optional; https only; at most 2048 characters; trimmed |
| Item `priceText` | Optional; at most 50 characters; trimmed |
| Item `note` | Optional; at most 1000 characters; trimmed |
| Item `quantity` | Integer 1–99; 1 when a create omits it |
| Items per list | 200 (`422 LIST_FULL` on the 201st) |
| Share URL | `${APP_ORIGIN}/s/${shareToken}`; the token is 16 random bytes, base64url (22 characters) |
| Unfurl rate limit | 60 per hour per user, key `rateLimitKey('unfurl:user', userId)` |
| Unfurl fetch | Ports 80 and 443; at most 3 redirects; 5 s for the whole fetch; 1,048,576 bytes after decompression; `Content-Type: text/html` only |
| Unfurl request headers | `User-Agent` as above, `Accept: text/html`, `Accept-Language: en`; no `Accept-Encoding` |
| Unfurl failure codes | `INVALID_URL`, `DISALLOWED_ADDRESS`, `DNS_FAILED`, `UNREACHABLE`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `BLOCKED_BY_SITE`, `NOT_HTML`, `TOO_LARGE`, `NO_METADATA` |
| Lock order | users → wishlists → items |

## Rulings this plan makes on gaps in the spec

The spec says what must happen but not every how. These are the plan's decisions. The executor records each one in the ledger as it lands.

1. **Clearing optional fields.** On create and on `PATCH`, an optional text field that's `null`, or blank after trimming, is stored as `null`. A `PATCH` that omits a field leaves it alone. Responses always carry every field, with `null` for empty ones.
2. **Malformed item IDs are 404s.** An `:id` that isn't a UUID gets the same `404 NOT_FOUND` as an unknown ID or another user's item. Postgres never sees it.
3. **Positions.** A create takes the list's highest position plus one, so a delete leaves a gap, which is harmless. A reorder rewrites them as `0…n−1`. Reads order by position, then ID.
4. **A session whose list has vanished gets a 401.** That means the account was deleted after `SessionGuard` checked the session.
5. **Response shapes:**
   - `GET /wishlist` returns `{title, shareUrl, items}`;
   - `PATCH /wishlist` returns `{title, shareUrl}`;
   - rotation returns `{shareUrl}`;
   - item writes return the item.

   Responses that carry owner data send `Cache-Control: no-store`, like `GET /me`. `showClaimsToOwner` appears nowhere until Plan 4 (D33). A `PATCH /wishlist` that sends it has it stripped like any unknown key.
6. **Unfurl's request body is `{url}`,** at most 2048 characters after trimming, or `400 VALIDATION_FAILED`. Anything that isn't an http(s) URL gets `200` with `failureReason: INVALID_URL`, so the spec's "always 200" holds for every URL. Every call counts against the limit, before any fetching.
7. **The fetcher's failure mapping:**
   - `UNREACHABLE` covers a connection refused or reset, or a failed TLS handshake.
   - `BLOCKED_BY_SITE` covers any status of 400 or more, a 3xx without a usable `Location`, and an unparseable `Location`.
   - `TIMEOUT` covers the deadline passing anywhere, DNS included.
   - An unknown `Content-Encoding` is `NOT_HTML`.
8. **Decompression.** We send no `Accept-Encoding`, so servers should send plain bytes. Some compress anyway, so `gzip`, `x-gzip`, `deflate` and `br` are decoded. The 1 MB cap counts decoded bytes, so a compression bomb is cut off.
9. **Charset.** Use the `Content-Type` charset; otherwise a `<meta charset>` or `http-equiv` charset in the first 1024 bytes; otherwise UTF-8. An unknown label falls back to UTF-8.
10. **Pinning.** Each unfurl creates its own undici `Agent`, and destroys it when done:
    - Its `lookup` answers only for hostnames that `vet()` checked during this unfurl, with exactly the addresses it checked.
    - An IP-literal host never reaches `lookup` (Node skips it), so `vet()` checks the literal itself.
    - `lookup` answers both forms Node uses: `{all: true}`, which wants a list, and the single-address form.
11. **Metadata:**
    - **Precedence:** each field comes from the first source that has it: Open Graph, then a JSON-LD `Product`, then `<title>`.
    - **Title:** whitespace is collapsed and the result trimmed, then cut to 200 characters without splitting a surrogate pair.
    - **Image:** candidates are `og:image:secure_url`, then `og:image`, then the product's images. Each is resolved against the final page URL, and the first that is https and at most 2048 characters wins.
    - **Price:** an Open Graph or JSON-LD amount and currency become `Intl.NumberFormat('en-US', {style: 'currency'})` text, e.g. `"$24.99"`. A non-numeric amount or an unknown currency gives `"<amount> <CODE>"`. Anything over 50 characters is dropped.
    - **JSON-LD strings:** their basic HTML entities are decoded, because `<script>` text isn't.
    - **Nothing usable:** no title, image or price is `NO_METADATA`.
12. **Unfurl logs** one line per failure: `unfurl <REASON> host=<hostname>`. Never a path or a query string.

## Review Focus

The input classes the spec implies but doesn't test, most likely to bite a person first. Each has a test in the task named.

1. **A link pasted from a phone's share sheet** arrives with whitespace around it, a trailing newline, or an upper-case scheme (`HTTPS://…`). It's trimmed and accepted. Task 1, contracts.
2. **The editor clears an optional field** by sending `""` or `null`. Both clear it, and a `PATCH` that omits the field leaves it alone. Task 3.
3. **An item deleted in one tab is then edited or deleted in another.** That's a `404`, not a `500`, and the list is unchanged. Task 3.
4. **A product page's image is relative, protocol-relative (`//cdn…`) or plain http.** It's resolved against the page, and only an https result survives. Task 6.
5. **A shop page in a legacy charset** (windows-1252, from the header or from `<meta>`). Its title reads correctly, not as mojibake. Task 5.

## Stacks and order

One stack, `owner-api`, one layer per reviewable concern. Seven layers stay under Neon's preview cap:

| Layer (branch) | Tasks |
|---|---|
| `api/items-schema` | 1 |
| `api/wishlist` | 2 |
| `api/items` | 3 |
| `api/reorder` | 4 |
| `api/page-fetcher` | 5 |
| `api/unfurl` | 6, 7 |
| `docs/owner-api` | 8 |

Then Task 9 is a ⏸ checkpoint: Ted tries unfurl on a preview, merges, and production is verified (still dark).

**The plan's own PR comes first.** `docs/plan-3a` holds the spec amendments and this plan, and merges before Task 1 starts, so Task 1 branches from a `main` that has them.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/contracts/src/error-codes.ts` | 1 | + `EMAIL_NOT_VERIFIED`, `LIST_FULL`, `ORDER_CONFLICT` |
| `packages/contracts/src/wishlist.ts` (+ `.spec.ts`) | 1 | Field rules, request and response schemas, and unfurl's failure codes |
| `apps/api/src/db/schema.ts` | 1 | + the `items` table |
| `apps/api/drizzle/0002_items.sql` | 1 | Generated migration, with the timeout settings added |
| `apps/api/test/items-schema.int-spec.ts` | 1 | Table constraints and cascade |
| `apps/api/src/auth/verified.guard.ts`, `auth-errors.ts`, `auth.module.ts` | 2 | 403 `EMAIL_NOT_VERIFIED`; export the guards |
| `apps/api/src/wishlist/wishlist.module.ts` | 2, 3, 7 | The owner endpoints |
| `apps/api/src/wishlist/own-wishlist.ts` | 2 | `lockOwnWishlist`, the serialization point |
| `apps/api/src/wishlist/item-columns.ts`, `wishlist-errors.ts` | 2 | Shared item projection and errors |
| `apps/api/src/wishlist/wishlist.service.ts`, `wishlist.controller.ts` | 2, 7 | Read, rename, rotate; then unfurl |
| `apps/api/test/wishlist.int-spec.ts` | 2 | |
| `apps/api/src/wishlist/items.service.ts`, `items.controller.ts` | 3, 4 | Create, edit, delete; then reorder |
| `apps/api/test/items.int-spec.ts`, `reorder.int-spec.ts` | 3, 4 | |
| `apps/api/test/support/client.ts` | 4 | + `put` |
| `apps/api/src/unfurl/address-policy.ts` (+ spec) | 5 | The `unicast` allowlist |
| `apps/api/src/unfurl/page-fetcher.ts` (+ spec) | 5 | Vet, pin, fetch, redirect, cap, decode |
| `apps/api/src/unfurl/metadata.ts` (+ spec) | 6 | `extractMetadata`, `formatPrice` |
| `apps/api/src/unfurl/metadata-fetcher.ts` (+ spec) | 7 | The `MetadataFetcher` port and its real adapter |
| `apps/api/src/wishlist/unfurl.service.ts` | 7 | Rate limit, then the port |
| `apps/api/src/testing/fakes.ts`, `test/support/auth-app.ts` | 7 | `FakeMetadataFetcher` |
| `apps/api/test/unfurl.int-spec.ts` | 7 | |
| `docs/development.md`, `AGENTS.md`, roadmap, three stale comments | 8 | |

---

### Task 1: Contracts and the `items` table

**Files:**
- Modify: `packages/contracts/src/error-codes.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/wishlist.ts`, `packages/contracts/src/wishlist.spec.ts`
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0002_items.sql` (generated, plus its snapshot and journal entry), `apps/api/test/items-schema.int-spec.ts`

**Interfaces:**
- Produces (contracts):
  - Errors: `ErrorCode.EMAIL_NOT_VERIFIED`, `.LIST_FULL`, `.ORDER_CONFLICT`.
  - Limits and field schemas: `MAX_ITEMS = 200`, `WishlistTitleSchema`, `ItemTitleSchema`, `QuantitySchema`, `ItemUrlSchema`, `ImageUrlSchema`, `PriceTextSchema`, `NoteSchema`.
  - Requests: `CreateItemRequestSchema` / `CreateItemRequest`, `UpdateItemRequestSchema` / `UpdateItemRequest`, `ReorderItemsRequestSchema` / `ReorderItemsRequest`, `UpdateWishlistRequestSchema` / `UpdateWishlistRequest`.
  - Responses: `ItemSchema` / `Item`, `WishlistResponseSchema` / `WishlistResponse`, `WishlistSettingsResponseSchema` / `WishlistSettingsResponse`, `RotateShareTokenResponseSchema` / `RotateShareTokenResponse`.
  - Unfurl: `UNFURL_FAILURE_REASONS`, `UnfurlFailureReasonSchema` / `UnfurlFailureReason`, `UnfurlRequestSchema` / `UnfurlRequest`, `UnfurlResponseSchema` / `UnfurlResponse`.
- Produces (API): the `items` Drizzle table, with columns `id, wishlistId, title, url, imageUrl, priceText, note, quantity, position, createdAt, updatedAt`.

- [ ] **Step 1: Start the stack**

The plan PR (`docs/plan-3a`) has merged, so `main` has the amended spec.

```bash
git switch main && git pull --ff-only
gh stack init api/items-schema
```

- [ ] **Step 2: Write the contract tests**

`packages/contracts/src/wishlist.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CreateItemRequestSchema,
  ImageUrlSchema,
  ItemUrlSchema,
  MAX_ITEMS,
  ReorderItemsRequestSchema,
  UnfurlRequestSchema,
  UnfurlResponseSchema,
  UpdateItemRequestSchema,
  UpdateWishlistRequestSchema,
} from './wishlist.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

describe('ItemUrlSchema (spec §2)', () => {
  it.each([
    ['  https://shop.example/kettle  ', 'https://shop.example/kettle'],
    ['https://shop.example/kettle\n', 'https://shop.example/kettle'],
    ['HTTPS://Shop.Example/Kettle', 'HTTPS://Shop.Example/Kettle'],
    ['http://shop.example/', 'http://shop.example/'],
  ])('accepts a pasted link %j and stores it trimmed (Plan 3a Review Focus 1)', (input, stored) => {
    expect(ItemUrlSchema.parse(input)).toBe(stored);
  });

  it.each([
    'javascript:alert(1)',
    'ftp://shop.example/file',
    'mailto:ada@example.com',
    'shop.example/kettle',
    `https://shop.example/${'a'.repeat(2048)}`,
  ])('rejects %j', (input) => {
    expect(ItemUrlSchema.safeParse(input).success).toBe(false);
  });

  it('stores a blank or null link as null (Plan 3a rule 1)', () => {
    expect(ItemUrlSchema.parse('   ')).toBeNull();
    expect(ItemUrlSchema.parse(null)).toBeNull();
  });
});

describe('ImageUrlSchema (spec §2: https only)', () => {
  it('accepts an https image', () => {
    expect(ImageUrlSchema.parse('https://cdn.example/k.jpg')).toBe('https://cdn.example/k.jpg');
  });

  it('rejects an http image', () => {
    expect(ImageUrlSchema.safeParse('http://cdn.example/k.jpg').success).toBe(false);
  });
});

describe('CreateItemRequestSchema', () => {
  it('needs only a title, and makes the quantity 1', () => {
    expect(CreateItemRequestSchema.parse({ title: '  Kettle  ' })).toEqual({
      title: 'Kettle',
      quantity: 1,
    });
  });

  it.each(['', '   ', 'a'.repeat(201)])('rejects the title %j', (title) => {
    expect(CreateItemRequestSchema.safeParse({ title }).success).toBe(false);
  });

  it.each([0, 100, 1.5, '2'])('rejects the quantity %j', (quantity) => {
    expect(CreateItemRequestSchema.safeParse({ title: 'Kettle', quantity }).success).toBe(false);
  });

  it('stores blank optional fields as null (Plan 3a rule 1)', () => {
    expect(CreateItemRequestSchema.parse({ title: 'Kettle', priceText: '  ', note: '' })).toEqual({
      title: 'Kettle',
      priceText: null,
      note: null,
      quantity: 1,
    });
  });

  it('caps the price at 50 characters and the note at 1000', () => {
    expect(CreateItemRequestSchema.safeParse({ title: 'K', priceText: 'a'.repeat(51) }).success).toBe(false);
    expect(CreateItemRequestSchema.safeParse({ title: 'K', note: 'a'.repeat(1001) }).success).toBe(false);
  });
});

describe('UpdateItemRequestSchema (Plan 3a rule 1, Review Focus 2)', () => {
  it('leaves out what was not sent, so it stays as it is', () => {
    expect(UpdateItemRequestSchema.parse({ title: 'New name' })).toEqual({ title: 'New name' });
  });

  it('turns "" and null into null, so they clear the field', () => {
    expect(UpdateItemRequestSchema.parse({ note: '', priceText: null })).toEqual({
      note: null,
      priceText: null,
    });
  });
});

describe('ReorderItemsRequestSchema', () => {
  it('takes item IDs', () => {
    expect(ReorderItemsRequestSchema.parse({ itemIds: [ID] })).toEqual({ itemIds: [ID] });
  });

  it('rejects something that is not a UUID, and more IDs than a list can hold', () => {
    expect(ReorderItemsRequestSchema.safeParse({ itemIds: ['1'] }).success).toBe(false);
    expect(
      ReorderItemsRequestSchema.safeParse({ itemIds: Array(MAX_ITEMS + 1).fill(ID) }).success,
    ).toBe(false);
  });
});

describe('UpdateWishlistRequestSchema', () => {
  it('trims the title and allows up to 100 characters', () => {
    expect(UpdateWishlistRequestSchema.parse({ title: '  Birthday  ' })).toEqual({ title: 'Birthday' });
    expect(UpdateWishlistRequestSchema.safeParse({ title: 'a'.repeat(101) }).success).toBe(false);
    expect(UpdateWishlistRequestSchema.safeParse({ title: '  ' }).success).toBe(false);
  });
});

describe('UnfurlRequestSchema and UnfurlResponseSchema (spec §5, §6.8)', () => {
  it('trims the URL and caps it at 2048 characters', () => {
    expect(UnfurlRequestSchema.parse({ url: ' https://shop.example/k ' })).toEqual({
      url: 'https://shop.example/k',
    });
    expect(UnfurlRequestSchema.safeParse({ url: 'a'.repeat(2049) }).success).toBe(false);
    expect(UnfurlRequestSchema.safeParse({ url: ' ' }).success).toBe(false);
  });

  it('only knows the fixed failure codes', () => {
    expect(UnfurlResponseSchema.safeParse({ failureReason: 'UNREACHABLE' }).success).toBe(true);
    expect(UnfurlResponseSchema.safeParse({ failureReason: 'SOMETHING_ELSE' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
pnpm --filter @wishlist/contracts exec vitest run src/wishlist.spec.ts
```

Expected: FAIL, because `./wishlist.js` doesn't exist.

- [ ] **Step 4: Write the contracts**

In `packages/contracts/src/error-codes.ts`, add after `FORBIDDEN_ORIGIN`:

```ts
  /** 403: the signed-in user hasn't confirmed their email; owner endpoints refuse (spec §5). */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** 422: the list already holds 200 items (spec §2). */
  LIST_FULL: 'LIST_FULL',
  /** 409: a reorder's item IDs aren't exactly the list's current items (spec §5). */
  ORDER_CONFLICT: 'ORDER_CONFLICT',
```

`packages/contracts/src/wishlist.ts`:

```ts
import { z } from 'zod';

/** A list holds at most this many items (spec §2). */
export const MAX_ITEMS = 200;

export const WishlistTitleSchema = z.string().trim().min(1).max(100);
export const ItemTitleSchema = z.string().trim().min(1).max(200);
export const QuantitySchema = z.number().int().min(1).max(99);

// Optional text fields (Plan 3a rule 1): trimmed, and null or blank is stored as null. Wrapped in
// `.optional()` on a PATCH, an omitted field is left alone.
const blankToNull = (value: string | null) => (value === '' ? null : value);

/**
 * A link field: blank, or a URL whose scheme matches `protocol`. Zod's URL check does the parsing:
 * this package compiles without DOM or Node types, so it can't name `URL` itself.
 */
function link(protocol: RegExp, message: string) {
  const url = z.url({ protocol });
  return z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === '' || url.safeParse(value).success, message)
    .nullable()
    .transform(blankToNull);
}

/** A product link: http or https (spec §2). */
export const ItemUrlSchema = link(/^https?$/, 'Enter a link that starts with http:// or https://');

/** Only ever https: shown as a plain <img>, and never fetched by the server (spec §2, §6.9). */
export const ImageUrlSchema = link(/^https$/, 'Enter an image link that starts with https://');

export const PriceTextSchema = z.string().trim().max(50).nullable().transform(blankToNull);
export const NoteSchema = z.string().trim().max(1000).nullable().transform(blankToNull);

export const CreateItemRequestSchema = z.object({
  title: ItemTitleSchema,
  url: ItemUrlSchema.optional(),
  imageUrl: ImageUrlSchema.optional(),
  priceText: PriceTextSchema.optional(),
  note: NoteSchema.optional(),
  quantity: QuantitySchema.default(1),
});
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = z.object({
  title: ItemTitleSchema.optional(),
  url: ItemUrlSchema.optional(),
  imageUrl: ImageUrlSchema.optional(),
  priceText: PriceTextSchema.optional(),
  note: NoteSchema.optional(),
  quantity: QuantitySchema.optional(),
});
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const ReorderItemsRequestSchema = z.object({
  itemIds: z.array(z.uuid()).max(MAX_ITEMS),
});
export type ReorderItemsRequest = z.infer<typeof ReorderItemsRequestSchema>;

/** `showClaimsToOwner` joins this in Plan 4, with the claims it controls (D33). */
export const UpdateWishlistRequestSchema = z.object({ title: WishlistTitleSchema });
export type UpdateWishlistRequest = z.infer<typeof UpdateWishlistRequestSchema>;

/** An item as the owner sees it. Every field is present; empty ones are null (Plan 3a rule 1). */
export const ItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceText: z.string().nullable(),
  note: z.string().nullable(),
  quantity: z.number().int(),
  position: z.number().int(),
});
export type Item = z.infer<typeof ItemSchema>;

/** `GET /wishlist` (spec §5). Claim data arrives in Plan 4, for owners who opt in (D33). */
export const WishlistResponseSchema = z.object({
  title: z.string(),
  shareUrl: z.url(),
  items: z.array(ItemSchema),
});
export type WishlistResponse = z.infer<typeof WishlistResponseSchema>;

export const WishlistSettingsResponseSchema = z.object({ title: z.string(), shareUrl: z.url() });
export type WishlistSettingsResponse = z.infer<typeof WishlistSettingsResponseSchema>;

export const RotateShareTokenResponseSchema = z.object({ shareUrl: z.url() });
export type RotateShareTokenResponse = z.infer<typeof RotateShareTokenResponseSchema>;

/** Why an unfurl came back empty (spec §6.8). The web app maps each to a sentence. */
export const UNFURL_FAILURE_REASONS = [
  'INVALID_URL',
  'DISALLOWED_ADDRESS',
  'DNS_FAILED',
  'UNREACHABLE',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'BLOCKED_BY_SITE',
  'NOT_HTML',
  'TOO_LARGE',
  'NO_METADATA',
] as const;
export const UnfurlFailureReasonSchema = z.enum(UNFURL_FAILURE_REASONS);
export type UnfurlFailureReason = z.infer<typeof UnfurlFailureReasonSchema>;

export const UnfurlRequestSchema = z.object({ url: z.string().trim().min(1).max(2048) });
export type UnfurlRequest = z.infer<typeof UnfurlRequestSchema>;

/** A prefill only: nothing is saved (spec §5). Always 200; a failure carries its reason. */
export const UnfurlResponseSchema = z.object({
  title: z.string().optional(),
  imageUrl: z.string().optional(),
  priceText: z.string().optional(),
  failureReason: UnfurlFailureReasonSchema.optional(),
});
export type UnfurlResponse = z.infer<typeof UnfurlResponseSchema>;
```

Add `export * from './wishlist.js';` to `packages/contracts/src/index.ts`, keeping the alphabetical order.

- [ ] **Step 5: Run the contract tests**

```bash
pnpm --filter @wishlist/contracts exec vitest run
pnpm --filter @wishlist/contracts build
```

Expected: PASS, and the build succeeds. The API imports the built package.

`packages/contracts` compiles with `lib: es2023` and no DOM or Node types, so its code can't name the `URL` global. That's why `link()` uses Zod's own URL check.

- [ ] **Step 6: Write the table test**

`apps/api/test/items-schema.int-spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const LIST = '0199a3b2-0000-7000-8000-00000000000a';
const ITEM = '0199a3b2-0000-7000-8000-0000000000b1';

async function insertList() {
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [ADA],
  );
  await db.pool.query(
    `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
    [LIST, ADA],
  );
}

const insertItem = (quantity: number) =>
  db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position) values ($1, $2, 'Kettle', $3, 0)`,
    [ITEM, LIST, quantity],
  );

describe('items (spec §4)', () => {
  it.each([0, 100])('rejects a quantity of %i', async (quantity) => {
    await insertList();
    await expect(insertItem(quantity)).rejects.toThrow(/items_quantity_check/);
  });

  it('cascades a user deletion through the wishlist to its items', async () => {
    await insertList();
    await insertItem(1);
    await db.pool.query('delete from users');
    const { rows } = await db.pool.query<{ n: string }>('select count(*) as n from items');
    expect(rows[0]?.n).toBe('0');
  });

  it("indexes a list's items by position", async () => {
    const { rows } = await db.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'items_wishlist_id_position_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(wishlist_id, "?position"?\)/);
  });
});
```

- [ ] **Step 7: Run it to see it fail**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration items-schema
```

Expected: FAIL with `relation "items" does not exist`. Integration tests need Docker. If Testcontainers can't find Docker Desktop, see `docs/development.md`.

- [ ] **Step 8: Add the table and generate its migration**

In `apps/api/src/db/schema.ts`, after `wishlists`:

```ts
/**
 * Items (spec §2, §4). An idea is an item without a url. The server sets `position`, under a lock
 * on the owner's wishlist row (spec §5).
 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    wishlistId: uuid('wishlist_id')
      .notNull()
      .references(() => wishlists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url'),
    imageUrl: text('image_url'),
    priceText: text('price_text'),
    note: text('note'),
    quantity: integer('quantity').notNull(),
    position: integer('position').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('items_wishlist_id_position_idx').on(t.wishlistId, t.position),
    check('items_quantity_check', sql`${t.quantity} between 1 and 99`),
  ],
);
```

Then:

```bash
pnpm --filter @wishlist/api db:generate --name items
```

Open `apps/api/drizzle/0002_items.sql`. As in `0001_auth.sql`, add these two lines at the very top:

```sql
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
```

Expected SQL after that. Drizzle's exact text wins:
- `CREATE TABLE "items"`, with the `items_quantity_check` constraint;
- `ALTER TABLE "items" ADD CONSTRAINT "items_wishlist_id_wishlists_id_fk" … ON DELETE cascade`;
- `CREATE INDEX "items_wishlist_id_position_idx" ON "items" USING btree ("wishlist_id","position")`.

It only adds a table, so the deployed API is unaffected (expand only). Lint it the way CI does:

```bash
npx --yes squawk-cli@2.67.0 apps/api/drizzle/0002_items.sql
```

Expected: no violations. If squawk flags the foreign key, check that it's on the table this migration creates. That's the same shape as `0001_auth.sql`, which CI accepted. Report the output either way.

- [ ] **Step 9: Run the table test**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration items-schema
```

Expected: PASS (4 tests).

- [ ] **Step 10: Gate, commit, submit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add packages/contracts apps/api
git commit -F - <<'EOF'
feat: add the items table and the owner API's contracts

The items table follows spec §4: quantity 1–99, positions set by the
server, cascading from the wishlist. The contracts carry the field rules
from spec §2: optional text that is blank or null is stored as null, and
a PATCH that omits a field leaves it alone. They also carry the request
and response shapes, the three new error codes, and unfurl's fixed
failure codes.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Ted's approval of this plan covers the first `gh stack submit` of `owner-api`. Give the PR the commit's title with `gh pr edit <n> --title "…"`, and confirm its checks and preview are green.

---

### Task 2: The verified-email gate, and reading, renaming and sharing the list

**Files:**
- Create: `apps/api/src/auth/verified.guard.ts`
- Modify: `apps/api/src/auth/auth-errors.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/wishlist/wishlist.module.ts`, `own-wishlist.ts`, `item-columns.ts`, `wishlist-errors.ts`, `wishlist.service.ts`, `wishlist.controller.ts`
- Test: `apps/api/test/wishlist.int-spec.ts`

**Interfaces:**
- Consumes: Task 1's contracts and the `items` table; `SessionGuard`, `CurrentAuth`, `AuthContext` (`auth/session.guard.ts`).
- Produces:
  - `VerifiedGuard`: use it as `@UseGuards(SessionGuard, VerifiedGuard)`.
  - `lockOwnWishlist(tx: Transaction, ownerId: string): Promise<string>`, which returns the wishlist ID.
  - `ITEM_COLUMNS`, a Drizzle selection whose rows are `Item`.
  - Errors: `itemNotFound()`, `listFull()`, `orderConflict()`.
  - `WishlistModule`, which Tasks 3, 4 and 7 add to.

- [ ] **Step 1: Add the layer**

```bash
gh stack add api/wishlist
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/wishlist.int-spec.ts`:

```ts
import {
  ErrorCode,
  ProblemSchema,
  RotateShareTokenResponseSchema,
  WishlistResponseSchema,
  WishlistSettingsResponseSchema,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { logIn, signUp, signUpVerified } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';

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

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;

/** A signed-in owner with a verified email: the session cookie. */
async function owner(): Promise<string> {
  await signUpVerified(t);
  return logIn(t);
}

describe('the owner endpoints need a verified owner (spec §5)', () => {
  it('answer 401 without a session', async () => {
    const responses = [
      await client(t.app).get('/wishlist'),
      await client(t.app).patch('/wishlist', { title: 'Birthday' }),
      await client(t.app).post('/wishlist/share-token/rotate'),
    ];
    for (const res of responses) {
      expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
    }
  });

  it('answer 403 EMAIL_NOT_VERIFIED to someone who has not confirmed their email', async () => {
    await signUp(t);
    const cookie = await logIn(t);
    const res = await client(t.app, cookie).get('/wishlist');
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
  });
});

describe('GET /wishlist (spec §5)', () => {
  it('returns the list sign-up made, its share link and no items, and is never cached', async () => {
    const res = await client(t.app, await owner()).get('/wishlist');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(WishlistResponseSchema.parse(res.body)).toEqual({
      title: "Ada's wishlist",
      shareUrl: expect.stringMatching(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{22}$/) as string,
      items: [],
    });
  });

  it('carries no claim data and no spoiler setting before Plan 4 (D33)', async () => {
    const res = await client(t.app, await owner()).get('/wishlist');
    expect(Object.keys(res.body as object).sort()).toEqual(['items', 'shareUrl', 'title']);
  });
});

describe('PATCH /wishlist (spec §5)', () => {
  it('renames the list, trimming the title', async () => {
    const cookie = await owner();
    const res = await client(t.app, cookie).patch('/wishlist', { title: '  Birthday 2026  ' });
    expect(res.status).toBe(200);
    expect(WishlistSettingsResponseSchema.parse(res.body).title).toBe('Birthday 2026');
    const list = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    expect(list.title).toBe('Birthday 2026');
  });

  it.each(['', '   ', 'a'.repeat(101)])('refuses the title %j', async (title) => {
    const res = await client(t.app, await owner()).patch('/wishlist', { title });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('ignores showClaimsToOwner until Plan 4 (D33)', async () => {
    const res = await client(t.app, await owner()).patch('/wishlist', {
      title: 'Birthday',
      showClaimsToOwner: true,
    });
    expect(res.status).toBe(200);
    const { rows } = await db.pool.query<{ show: boolean }>(
      'select show_claims_to_owner as show from wishlists',
    );
    expect(rows[0]?.show).toBe(false);
  });
});

describe('POST /wishlist/share-token/rotate (spec §2)', () => {
  it('replaces the share token, so the old link stops working at once', async () => {
    const cookie = await owner();
    const before = WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
    const res = await client(t.app, cookie).post('/wishlist/share-token/rotate');
    expect(res.status).toBe(200);
    const { shareUrl } = RotateShareTokenResponseSchema.parse(res.body);
    expect(shareUrl).not.toBe(before.shareUrl);
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/);

    const oldToken = before.shareUrl.split('/s/')[1];
    const { rows } = await db.pool.query<{ n: string }>(
      'select count(*) as n from wishlists where share_token = $1',
      [oldToken],
    );
    expect(rows[0]?.n).toBe('0');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration wishlist.int-spec
```

Expected: FAIL. `/wishlist` answers `404 NOT_FOUND` everywhere.

- [ ] **Step 4: The verified-email guard**

Add to `apps/api/src/auth/auth-errors.ts`:

```ts
/** Owner endpoints refuse an address nobody has confirmed (spec §5). */
export const emailNotVerified = (): AppError =>
  new AppError(403, ErrorCode.EMAIL_NOT_VERIFIED, 'Confirm your email address first.');
```

`apps/api/src/auth/verified.guard.ts`:

```ts
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { emailNotVerified } from './auth-errors.js';
import type { AuthContext } from './session.guard.js';

/**
 * Owner endpoints need a confirmed email (spec §5): anyone else gets 403 EMAIL_NOT_VERIFIED. It
 * reads the session SessionGuard attached, so it always comes second:
 * `@UseGuards(SessionGuard, VerifiedGuard)`.
 */
@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    if (!auth) throw new Error('VerifiedGuard must run after SessionGuard');
    if (!auth.user.emailVerified) throw emailNotVerified();
    return true;
  }
}
```

In `apps/api/src/auth/auth.module.ts`:
- add `VerifiedGuard` to `providers`;
- add `exports: [SessionsService, SessionGuard, VerifiedGuard]`, so other modules' controllers can use both guards.

- [ ] **Step 5: The shared pieces**

`apps/api/src/wishlist/own-wishlist.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/database.module.js';
import { wishlists } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';

/**
 * Locks the owner's wishlist row until the transaction ends, and returns its ID. Every change to a
 * list or its items starts here, so the changes to one list run one at a time (spec §5). The lock
 * order is users → wishlists → items, the order an account deletion's cascade takes. No row means
 * the account was deleted after SessionGuard checked the session (Plan 3a rule 4).
 */
export async function lockOwnWishlist(tx: Transaction, ownerId: string): Promise<string> {
  const [row] = await tx
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.ownerId, ownerId))
    .for('update');
  if (!row) throw unauthenticated();
  return row.id;
}
```

`apps/api/src/wishlist/item-columns.ts`:

```ts
import { items } from '../db/schema.js';

/** An item as the API returns it (`Item` in contracts): every field, empty ones as null. */
export const ITEM_COLUMNS = {
  id: items.id,
  title: items.title,
  url: items.url,
  imageUrl: items.imageUrl,
  priceText: items.priceText,
  note: items.note,
  quantity: items.quantity,
  position: items.position,
};
```

`apps/api/src/wishlist/wishlist-errors.ts`:

```ts
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// List failures. As everywhere, no detail echoes what the caller sent.

/** Another user's item, a missing one and a malformed ID all look the same (spec §5). */
export const itemNotFound = (): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, 'That item no longer exists.');

export const listFull = (): AppError =>
  new AppError(422, ErrorCode.LIST_FULL, 'A list holds at most 200 items.');

export const orderConflict = (): AppError =>
  new AppError(409, ErrorCode.ORDER_CONFLICT, 'The list changed. Reload it and try again.');
```

- [ ] **Step 6: The service, controller and module**

`apps/api/src/wishlist/wishlist.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type {
  RotateShareTokenResponse,
  WishlistResponse,
  WishlistSettingsResponse,
} from '@wishlist/contracts';
import { asc, eq } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { DB, type Database } from '../db/database.module.js';
import { items, wishlists } from '../db/schema.js';
import { unauthenticated } from '../http/errors.js';
import { newToken } from '../security/tokens.js';
import { ITEM_COLUMNS } from './item-columns.js';

/** The list itself: reading it, renaming it and rotating its share link (spec §5). */
@Injectable()
export class WishlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The owner's list with its items in order. Claim data joins it in Plan 4 (D33). */
  async get(ownerId: string): Promise<WishlistResponse> {
    const [list] = await this.db
      .select({ id: wishlists.id, title: wishlists.title, shareToken: wishlists.shareToken })
      .from(wishlists)
      .where(eq(wishlists.ownerId, ownerId));
    if (!list) throw unauthenticated();
    const rows = await this.db
      .select(ITEM_COLUMNS)
      .from(items)
      .where(eq(items.wishlistId, list.id))
      .orderBy(asc(items.position), asc(items.id));
    return { title: list.title, shareUrl: this.shareUrl(list.shareToken), items: rows };
  }

  async rename(ownerId: string, title: string): Promise<WishlistSettingsResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({ title, updatedAt: this.clock.now() })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({ title: wishlists.title, shareToken: wishlists.shareToken });
    if (!list) throw unauthenticated();
    return { title: list.title, shareUrl: this.shareUrl(list.shareToken) };
  }

  /** A fresh token: the old link stops working at once, and claims are unaffected (spec §2). */
  async rotateShareToken(ownerId: string): Promise<RotateShareTokenResponse> {
    const [list] = await this.db
      .update(wishlists)
      .set({ shareToken: newToken(16), updatedAt: this.clock.now() })
      .where(eq(wishlists.ownerId, ownerId))
      .returning({ shareToken: wishlists.shareToken });
    if (!list) throw unauthenticated();
    return { shareUrl: this.shareUrl(list.shareToken) };
  }

  private shareUrl(shareToken: string): string {
    return `${this.env.APP_ORIGIN}/s/${shareToken}`;
  }
}
```

`apps/api/src/wishlist/wishlist.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  UpdateWishlistRequestSchema,
  type RotateShareTokenResponse,
  type UpdateWishlistRequest,
  type WishlistResponse,
  type WishlistSettingsResponse,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list (spec §5). The list always comes from the session; no route takes its ID. */
@Controller('wishlist')
@UseGuards(SessionGuard, VerifiedGuard)
export class WishlistController {
  constructor(@Inject(WishlistService) private readonly wishlist: WishlistService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): Promise<WishlistResponse> {
    return this.wishlist.get(auth.user.id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateWishlistRequestSchema)) body: UpdateWishlistRequest,
  ): Promise<WishlistSettingsResponse> {
    return this.wishlist.rename(auth.user.id, body.title);
  }

  @Post('share-token/rotate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  rotate(@CurrentAuth() auth: AuthContext): Promise<RotateShareTokenResponse> {
    return this.wishlist.rotateShareToken(auth.user.id);
  }
}
```

`apps/api/src/wishlist/wishlist.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WishlistController } from './wishlist.controller.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list and its items (spec §5 Owner endpoints). */
@Module({
  imports: [AuthModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
```

Add `WishlistModule` to `AppModule`'s `imports`, after `AuthModule`.

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration wishlist.int-spec
```

Expected: PASS (10 tests).

- [ ] **Step 8: Gate, commit, submit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): gate the owner endpoints on a verified email, and serve the list

Owner endpoints answer 403 EMAIL_NOT_VERIFIED until the address is
confirmed (spec §5). GET /wishlist returns the title, the share URL and
the items in order; PATCH renames the list; rotating the share token
makes the old link stop working at once. Responses carrying owner data
are never cached. The spoiler setting stays out until Plan 4 (D33).

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the new PR its commit's title with `gh pr edit <n> --title "…"`, and confirm its checks are green.

---

### Task 3: Creating, editing and deleting items

**Files:**
- Create: `apps/api/src/wishlist/items.service.ts`, `apps/api/src/wishlist/items.controller.ts`
- Modify: `apps/api/src/wishlist/wishlist.module.ts`
- Test: `apps/api/test/items.int-spec.ts`

**Interfaces:**
- Consumes:
  - `lockOwnWishlist`, `ITEM_COLUMNS`, `itemNotFound()` and `listFull()` (Task 2);
  - the contracts `CreateItemRequest`, `UpdateItemRequest`, `Item` and `MAX_ITEMS` (Task 1).
- Produces:
  - `ItemsService` with `create(ownerId, input): Promise<Item>`, `update(ownerId, itemId, input): Promise<Item>` and `delete(ownerId, itemId): Promise<void>`;
  - `ItemsController` at `wishlist/items`, which Task 4 adds `PUT order` to.

- [ ] **Step 1: Add the layer**

```bash
gh stack add api/items
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/items.int-spec.ts`:

```ts
import {
  ErrorCode,
  ItemSchema,
  ProblemSchema,
  WishlistResponseSchema,
  type Item,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';

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

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const create = (cookie: string, body: object) => client(t.app, cookie).post('/wishlist/items', body);

async function created(cookie: string, title: string, fields: object = {}): Promise<Item> {
  const res = await create(cookie, { title, ...fields });
  if (res.status !== 201) throw new Error(`create answered ${res.status}`);
  return ItemSchema.parse(res.body);
}

async function listOf(cookie: string) {
  return WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body);
}

/** Fills a list straight in the database, at positions 0…n−1: faster than n requests. */
async function seedItems(email: string, n: number) {
  await db.pool.query(
    `insert into items (id, wishlist_id, title, quantity, position)
     select gen_random_uuid(), w.id, 'Seed ' || g, 1, g - 1
     from wishlists w join users u on u.id = w.owner_id, generate_series(1, $2::int) g
     where u.email = $1`,
    [email, n],
  );
}

describe('POST /wishlist/items (spec §2, §5)', () => {
  it('appends each new item at the end, with every field present', async () => {
    const cookie = await owner();
    const kettle = await created(cookie, 'Kettle');
    const teapot = await created(cookie, 'Teapot');
    expect(kettle).toEqual({
      id: expect.any(String) as string,
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: null,
      note: null,
      quantity: 1,
      position: 0,
    });
    expect(teapot.position).toBe(1);
    expect((await listOf(cookie)).items.map((item) => item.title)).toEqual(['Kettle', 'Teapot']);
  });

  it('stores a link and an idea alike: an idea is an item without a url (spec §2)', async () => {
    const cookie = await owner();
    const link = await created(cookie, 'Kettle', {
      url: ' https://shop.example/kettle ',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
      note: 'The blue one',
      quantity: 2,
    });
    expect(link).toMatchObject({
      url: 'https://shop.example/kettle',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
      note: 'The blue one',
      quantity: 2,
    });
    expect((await created(cookie, 'Warm socks')).url).toBeNull();
  });

  it.each([
    { title: '' },
    { title: 'Kettle', url: 'javascript:alert(1)' },
    { title: 'Kettle', imageUrl: 'http://cdn.example/kettle.jpg' },
    { title: 'Kettle', quantity: 0 },
    { title: 'Kettle', quantity: 100 },
  ])('refuses %j with 400 VALIDATION_FAILED', async (body) => {
    const res = await create(await owner(), body);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('refuses the 201st item with 422 LIST_FULL', async () => {
    const cookie = await owner();
    await seedItems(ADA.email, 200);
    const res = await create(cookie, { title: 'One too many' });
    expect([res.status, codeOf(res)]).toEqual([422, ErrorCode.LIST_FULL]);
    expect(await count('items')).toBe(200);
  });

  it('lets exactly enough concurrent creates through to fill the list, none at the same position', async () => {
    const cookie = await owner();
    await seedItems(ADA.email, 195);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(cookie, { title: `Race ${i}` })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(5);
    expect(results.filter((res) => res.status === 422).map(codeOf)).toEqual(
      Array<string>(5).fill(ErrorCode.LIST_FULL),
    );
    const { rows } = await db.pool.query<{ position: number }>(
      'select position from items order by position',
    );
    expect(rows.map((row) => row.position)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('a create racing an account deletion neither deadlocks nor leaves an item behind', async () => {
    const cookie = await owner();
    const [deletion, ...creates] = await Promise.all([
      client(t.app, cookie).delete('/me', { password: ADA.password }),
      ...Array.from({ length: 5 }, (_, i) => create(cookie, { title: `Race ${i}` })),
    ]);
    expect(deletion?.status).toBe(204);
    for (const res of creates) expect([201, 401]).toContain(res.status);
    expect(await count('users')).toBe(0);
    expect(await count('items')).toBe(0);
  });
});

describe('PATCH /wishlist/items/:id (spec §5)', () => {
  it('changes only the fields sent; "" and null clear one (Plan 3a rule 1, Review Focus 2)', async () => {
    const cookie = await owner();
    const item = await created(cookie, 'Kettle', { priceText: '$40.00', note: 'Blue' });

    const renamed = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, {
      title: 'Kettle, blue',
    });
    expect(renamed.status).toBe(200);
    expect(ItemSchema.parse(renamed.body)).toMatchObject({
      title: 'Kettle, blue',
      priceText: '$40.00',
      note: 'Blue',
    });

    const cleared = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, {
      priceText: '',
      note: null,
    });
    expect(ItemSchema.parse(cleared.body)).toMatchObject({
      title: 'Kettle, blue',
      priceText: null,
      note: null,
    });
  });

  it('validates what it changes', async () => {
    const cookie = await owner();
    const item = await created(cookie, 'Kettle');
    const res = await client(t.app, cookie).patch(`/wishlist/items/${item.id}`, { quantity: 0 });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });
});

describe('DELETE /wishlist/items/:id (spec §2)', () => {
  it('deletes the item and leaves the rest in order (Plan 3a rule 3: a gap is fine)', async () => {
    const cookie = await owner();
    const [a, b, c] = [
      await created(cookie, 'A'),
      await created(cookie, 'B'),
      await created(cookie, 'C'),
    ];
    const res = await client(t.app, cookie).delete(`/wishlist/items/${b.id}`);
    expect(res.status).toBe(204);
    const { items } = await listOf(cookie);
    expect(items.map((item) => item.id)).toEqual([a.id, c.id]);
    expect(items.map((item) => item.position)).toEqual([0, 2]);
  });
});

describe('an item that is not yours, or is gone, is a 404 (spec §5)', () => {
  it("leaves another user's item alone", async () => {
    const bob = await owner(BOB);
    const bobsItem = await created(bob, 'Bike');
    const ada = await owner();
    const edit = await client(t.app, ada).patch(`/wishlist/items/${bobsItem.id}`, { title: 'Mine' });
    const removal = await client(t.app, ada).delete(`/wishlist/items/${bobsItem.id}`);
    expect([edit.status, codeOf(edit)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect([removal.status, codeOf(removal)]).toEqual([404, ErrorCode.NOT_FOUND]);
    expect((await listOf(bob)).items.map((item) => item.title)).toEqual(['Bike']);
  });

  it('answers an unknown or malformed ID with 404, not 500 (Plan 3a rule 2)', async () => {
    const cookie = await owner();
    for (const id of [UNKNOWN_ID, 'not-a-uuid']) {
      const edit = await client(t.app, cookie).patch(`/wishlist/items/${id}`, { title: 'X' });
      const removal = await client(t.app, cookie).delete(`/wishlist/items/${id}`);
      expect([edit.status, removal.status]).toEqual([404, 404]);
    }
  });

  it('answers an item deleted in another tab with 404 (Plan 3a Review Focus 3)', async () => {
    const cookie = await owner();
    const keep = await created(cookie, 'Keep');
    const gone = await created(cookie, 'Gone');
    expect((await client(t.app, cookie).delete(`/wishlist/items/${gone.id}`)).status).toBe(204);
    const edit = await client(t.app, cookie).patch(`/wishlist/items/${gone.id}`, { title: 'X' });
    const again = await client(t.app, cookie).delete(`/wishlist/items/${gone.id}`);
    expect([edit.status, again.status]).toEqual([404, 404]);
    expect((await listOf(cookie)).items.map((item) => item.id)).toEqual([keep.id]);
  });
});

describe('the item endpoints need a verified owner', () => {
  it('answer 401 without a session', async () => {
    const res = await client(t.app).post('/wishlist/items', { title: 'Kettle' });
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration items.int-spec
```

Expected: FAIL. `/wishlist/items` answers `404 NOT_FOUND`.

- [ ] **Step 4: The service**

`apps/api/src/wishlist/items.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_ITEMS,
  type CreateItemRequest,
  type Item,
  type UpdateItemRequest,
} from '@wishlist/contracts';
import { and, count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { items } from '../db/schema.js';
import { ITEM_COLUMNS } from './item-columns.js';
import { lockOwnWishlist } from './own-wishlist.js';
import { itemNotFound, listFull } from './wishlist-errors.js';

const ItemIdSchema = z.uuid();

/** The items on the owner's list (spec §2, §5). Every change runs under the list's row lock. */
@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Appends the item to the end of the list (spec §2). The 201st is 422 LIST_FULL. */
  async create(ownerId: string, input: CreateItemRequest): Promise<Item> {
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const [list] = await tx
        .select({ size: count(), last: max(items.position) })
        .from(items)
        .where(eq(items.wishlistId, wishlistId));
      if ((list?.size ?? 0) >= MAX_ITEMS) throw listFull();
      const now = this.clock.now();
      const [item] = await tx
        .insert(items)
        .values({
          id: newId(),
          wishlistId,
          title: input.title,
          url: input.url ?? null,
          imageUrl: input.imageUrl ?? null,
          priceText: input.priceText ?? null,
          note: input.note ?? null,
          quantity: input.quantity,
          position: (list?.last ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning(ITEM_COLUMNS);
      if (!item) throw new Error('item insert returned no row');
      return item;
    });
  }

  /** Changes only the fields sent. Null or blank clears an optional one (Plan 3a rule 1). */
  async update(ownerId: string, itemId: string, input: UpdateItemRequest): Promise<Item> {
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    return this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const [item] = await tx
        .update(items)
        .set({ ...sentFields(input), updatedAt: this.clock.now() })
        .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)))
        .returning(ITEM_COLUMNS);
      if (!item) throw itemNotFound();
      return item;
    });
  }

  async delete(ownerId: string, itemId: string): Promise<void> {
    if (!ItemIdSchema.safeParse(itemId).success) throw itemNotFound();
    await this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const deleted = await tx
        .delete(items)
        .where(and(eq(items.id, itemId), eq(items.wishlistId, wishlistId)))
        .returning({ id: items.id });
      if (deleted.length === 0) throw itemNotFound();
    });
  }
}

/** What a PATCH sent. Undefined means "leave it", and null means "clear it" (Plan 3a rule 1). */
function sentFields(input: UpdateItemRequest): Partial<UpdateItemRequest> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
```

- [ ] **Step 5: The controller and module**

`apps/api/src/wishlist/items.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateItemRequestSchema,
  UpdateItemRequestSchema,
  type CreateItemRequest,
  type Item,
  type UpdateItemRequest,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ItemsService } from './items.service.js';

/**
 * The items on the owner's list (spec §5). An item ID that isn't on the session's own list gets
 * the same 404 as one that doesn't exist.
 */
@Controller('wishlist/items')
@UseGuards(SessionGuard, VerifiedGuard)
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateItemRequestSchema)) body: CreateItemRequest,
  ): Promise<Item> {
    return this.items.create(auth.user.id, body);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateItemRequestSchema)) body: UpdateItemRequest,
  ): Promise<Item> {
    return this.items.update(auth.user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.items.delete(auth.user.id, id);
  }
}
```

In `wishlist.module.ts`, add `ItemsController` to `controllers` and `ItemsService` to `providers`.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration items.int-spec
```

Expected: PASS (17 tests). If the concurrency test is flaky rather than failing, that's a defect: the row lock is meant to make it deterministic. Report it; don't add retries.

- [ ] **Step 7: Gate, commit, submit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): create, edit and delete items on the owner's list

Each change locks the owner's wishlist row first, so concurrent tabs
can't put two items at one position or slip past the 200-item cap
(spec §5, 422 LIST_FULL). An edit changes only the fields it sends;
blank or null clears one. Another user's item, an unknown ID and a
malformed one all answer 404.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the new PR its commit's title with `gh pr edit <n> --title "…"`, and confirm its checks are green.

---

### Task 4: Reordering the whole list

**Files:**
- Modify: `apps/api/src/wishlist/items.service.ts`, `apps/api/src/wishlist/items.controller.ts`, `apps/api/test/support/client.ts`
- Test: `apps/api/test/reorder.int-spec.ts`

**Interfaces:**
- Consumes: `lockOwnWishlist` and `orderConflict()` (Task 2); `ItemsService` and `ItemsController` (Task 3); `ReorderItemsRequestSchema` (Task 1).
- Produces:
  - `ItemsService.reorder(ownerId: string, itemIds: string[]): Promise<void>`;
  - `PUT /wishlist/items/order`;
  - `client(app, cookie).put(path, body)`.

- [ ] **Step 1: Add the layer**

```bash
gh stack add api/reorder
```

- [ ] **Step 2: Give the test client `put`**

In `apps/api/test/support/client.ts`, add to the returned object, after `patch`:

```ts
    put: (path: string, body: object = {}) => mutate(http(app).put(`/api${path}`), body),
```

- [ ] **Step 3: Write the failing tests**

`apps/api/test/reorder.int-spec.ts`:

```ts
import {
  ErrorCode,
  ItemSchema,
  ProblemSchema,
  WishlistResponseSchema,
  type Item,
} from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';

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

const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

async function created(cookie: string, title: string): Promise<Item> {
  const res = await client(t.app, cookie).post('/wishlist/items', { title });
  if (res.status !== 201) throw new Error(`create answered ${res.status}`);
  return ItemSchema.parse(res.body);
}

const reorder = (cookie: string, itemIds: unknown) =>
  client(t.app, cookie).put('/wishlist/items/order', { itemIds });

async function itemsOf(cookie: string) {
  return WishlistResponseSchema.parse((await client(t.app, cookie).get('/wishlist')).body).items;
}

describe('PUT /wishlist/items/order (spec §5)', () => {
  it('rewrites the whole order', async () => {
    const cookie = await owner();
    const [a, b, c] = [await created(cookie, 'A'), await created(cookie, 'B'), await created(cookie, 'C')];
    expect((await reorder(cookie, [c.id, a.id, b.id])).status).toBe(204);
    const items = await itemsOf(cookie);
    expect(items.map((item) => item.title)).toEqual(['C', 'A', 'B']);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('closes the gap a delete left (Plan 3a rule 3)', async () => {
    const cookie = await owner();
    const [a, b, c] = [await created(cookie, 'A'), await created(cookie, 'B'), await created(cookie, 'C')];
    await client(t.app, cookie).delete(`/wishlist/items/${b.id}`);
    expect((await reorder(cookie, [c.id, a.id])).status).toBe(204);
    expect((await itemsOf(cookie)).map((item) => item.position)).toEqual([0, 1]);
  });

  it('accepts an empty order for an empty list', async () => {
    expect((await reorder(await owner(), [])).status).toBe(204);
  });

  it('refuses any set of IDs that is not exactly the list, and changes nothing', async () => {
    const bob = await owner(BOB);
    const bobsItem = await created(bob, 'Bike');
    const cookie = await owner();
    const [a, b, c] = [await created(cookie, 'A'), await created(cookie, 'B'), await created(cookie, 'C')];
    const wrongSets = {
      'one missing': [a.id, b.id],
      'one unknown': [a.id, b.id, c.id, UNKNOWN_ID],
      'one twice': [a.id, a.id, b.id, c.id],
      "another user's item": [a.id, b.id, bobsItem.id],
    };
    for (const [name, ids] of Object.entries(wrongSets)) {
      const res = await reorder(cookie, ids);
      expect([name, res.status, codeOf(res)]).toEqual([name, 409, ErrorCode.ORDER_CONFLICT]);
    }
    expect((await itemsOf(cookie)).map((item) => item.title)).toEqual(['A', 'B', 'C']);
  });

  it('refuses a stale order after another tab added an item (spec §8)', async () => {
    const cookie = await owner();
    const [a, b] = [await created(cookie, 'A'), await created(cookie, 'B')];
    await created(cookie, 'Added in another tab');
    const res = await reorder(cookie, [b.id, a.id]);
    expect([res.status, codeOf(res)]).toEqual([409, ErrorCode.ORDER_CONFLICT]);
  });

  it.each([
    ['a non-UUID', ['not-a-uuid']],
    ['201 IDs', Array<string>(201).fill(UNKNOWN_ID)],
    ['no array', 'A,B'],
  ])('refuses %s with 400 VALIDATION_FAILED', async (_name, itemIds) => {
    const res = await reorder(await owner(), itemIds);
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });

  it('a reorder racing a create never leaves two items at one position', async () => {
    const cookie = await owner();
    const [a, b] = [await created(cookie, 'A'), await created(cookie, 'B')];
    const [moved, added] = await Promise.all([
      reorder(cookie, [b.id, a.id]),
      client(t.app, cookie).post('/wishlist/items', { title: 'C' }),
    ]);
    expect([204, 409]).toContain(moved.status);
    expect(added.status).toBe(201);
    const positions = (await itemsOf(cookie)).map((item) => item.position);
    expect(new Set(positions).size).toBe(3);
  });

  it('needs a session', async () => {
    const res = await client(t.app).put('/wishlist/items/order', { itemIds: [] });
    expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
  });
});
```

- [ ] **Step 4: Run them to see them fail**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration reorder
```

Expected: FAIL. `PUT /wishlist/items/order` answers `404`.

- [ ] **Step 5: Implement the reorder**

Add to `ItemsService`. The imports gain `sql` from `drizzle-orm` and `orderConflict` from `./wishlist-errors.js`:

```ts
  /**
   * Rewrites the whole order (spec §5). The IDs must be exactly the list's current items, each
   * once. Anything else means another tab changed the list, and the editor refetches (409).
   */
  async reorder(ownerId: string, itemIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const wishlistId = await lockOwnWishlist(tx, ownerId);
      const current = await tx
        .select({ id: items.id })
        .from(items)
        .where(eq(items.wishlistId, wishlistId));
      const wanted = new Set(itemIds);
      const exact =
        wanted.size === itemIds.length &&
        wanted.size === current.length &&
        current.every((row) => wanted.has(row.id));
      if (!exact) throw orderConflict();
      if (itemIds.length === 0) return;
      // One statement: each item's new position is its index in itemIds.
      const positions = sql.join(
        itemIds.map((id, index) => sql`when ${id}::uuid then ${index}::int`),
        sql` `,
      );
      await tx
        .update(items)
        .set({ position: sql`case ${items.id} ${positions} end`, updatedAt: this.clock.now() })
        .where(eq(items.wishlistId, wishlistId));
    });
  }
```

The casts matter. Without `::int`, Postgres types the `CASE` result from untyped parameters as `text`, and assigning text to the integer column fails.

Add to `ItemsController`. The imports gain `Put`, plus `ReorderItemsRequestSchema` and `type ReorderItemsRequest`:

```ts
  @Put('order')
  @HttpCode(204)
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ReorderItemsRequestSchema)) body: ReorderItemsRequest,
  ): Promise<void> {
    await this.items.reorder(auth.user.id, body.itemIds);
  }
```

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project integration reorder
```

Expected: PASS (10 tests).

- [ ] **Step 7: Gate, commit, submit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api
git commit -F - <<'EOF'
feat(api): reorder the whole list in one request

PUT /wishlist/items/order takes every item ID in the new order and
rewrites positions 0…n−1 in one statement, under the list's row lock.
A set that isn't exactly the list's items (one missing, unknown,
repeated, or someone else's) is 409 ORDER_CONFLICT and changes nothing,
so a tab with a stale list refetches instead of scrambling it (spec §5).

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the new PR its commit's title with `gh pr edit <n> --title "…"`, and confirm its checks are green.

---

### Task 5: The address policy and the page fetcher (SSRF)

**Files:**
- Modify: `apps/api/package.json` (add `undici@8.11.2` and `ipaddr.js@2.5.0`, exact), `pnpm-lock.yaml`
- Create: `apps/api/src/unfurl/address-policy.ts`, `apps/api/src/unfurl/address-policy.spec.ts`
- Create: `apps/api/src/unfurl/page-fetcher.ts`, `apps/api/src/unfurl/page-fetcher.spec.ts`

**Interfaces:**
- Consumes: `UnfurlFailureReason` (Task 1).
- Produces:
  - `AddressPolicy { allows(address: string, port: number): boolean }`, `PUBLIC_WEB` and `isPublicAddress(address)`.
  - `type Resolve = (hostname: string) => Promise<string[]>`, and `resolveAll`.
  - `USER_AGENT`.
  - `pinnedLookup(vetted)`.
  - `class PageFetcher(options?: { policy?, resolve?, timeoutMs?, maxBytes?, maxRedirects? })`, with `fetch(rawUrl: string): Promise<FetchedPage>`.
  - `type FetchedPage = { ok: true; url: URL; html: string } | { ok: false; reason: UnfurlFailureReason; host?: string }`.

**What this task is guarding against.** Unfurl makes our server fetch a URL a stranger chose. Without these checks, a URL could point at:
- the cloud metadata service (`169.254.169.254`);
- our own loopback interface;
- a private network.

Or a hostname could pass the check and then resolve to one of those at connect time (DNS rebinding). A probe of the exact versions pinned here found:
- **undici 8:** it follows no redirects, sends no `Accept-Encoding` and decompresses nothing. It never calls `lookup` for an IP-literal host, and it calls `lookup` with `{all: true}`.
- **ipaddr.js 2.5:** `process()` turns an IPv4-mapped address into IPv4. Every public address has `range()` equal to `'unicast'`.

- [ ] **Step 1: Add the layer and the dependencies**

```bash
gh stack add api/page-fetcher
pnpm --filter @wishlist/api add -E undici@8.11.2 ipaddr.js@2.5.0
```

Check `apps/api/package.json` shows both at exactly those versions, with no `^`.

- [ ] **Step 2: Write the address policy tests**

`apps/api/src/unfurl/address-policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPublicAddress, PUBLIC_WEB } from './address-policy.js';

describe('isPublicAddress (spec §6.8: an allowlist)', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'CGNAT'],
    ['169.254.169.254', 'link-local: the cloud metadata service'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['192.0.2.1', 'documentation (reserved)'],
    ['198.18.0.1', 'benchmarking'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:0:7f00:1', 'IPv4-translated (RFC 6145)'],
    ['64:ff9b::7f00:1', 'NAT64 (RFC 6052)'],
    ['2002:7f00:1::', '6to4'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['not an address', 'garbage'],
  ])('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('PUBLIC_WEB', () => {
  it('allows public addresses on ports 80 and 443 only', () => {
    expect(PUBLIC_WEB.allows('93.184.216.34', 443)).toBe(true);
    expect(PUBLIC_WEB.allows('93.184.216.34', 80)).toBe(true);
    expect(PUBLIC_WEB.allows('93.184.216.34', 8080)).toBe(false);
    expect(PUBLIC_WEB.allows('127.0.0.1', 443)).toBe(false);
  });
});
```

Run `pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl/address-policy.spec.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Write the address policy**

`apps/api/src/unfurl/address-policy.ts`:

```ts
import ipaddr from 'ipaddr.js';

/** Where unfurl may connect: decided per address and port, before any connection (spec §6.8). */
export interface AddressPolicy {
  allows(address: string, port: number): boolean;
}

/**
 * True only for a public unicast address. It's an allowlist: ipaddr.js names every special-purpose
 * range (private, loopback, link-local, CGNAT, NAT64, 6to4, Teredo, reserved and so on), and
 * anything it doesn't call `unicast` is refused, including a range nobody here thought to list.
 * process() first turns an IPv4-mapped IPv6 address into the IPv4 address it carries.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

/** Production: public addresses, on the web's two ports. */
export const PUBLIC_WEB: AddressPolicy = {
  allows: (address, port) => (port === 80 || port === 443) && isPublicAddress(address),
};
```

Run the spec again. Expected: PASS (30 tests).

- [ ] **Step 4: Write the page fetcher tests**

`apps/api/src/unfurl/page-fetcher.spec.ts`:

```ts
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';
import { PageFetcher, USER_AGENT, pinnedLookup, type Resolve } from './page-fetcher.js';

const PAGE = '<html><head><title>Kettle</title></head></html>';
const CAFE_1252 = Buffer.concat([Buffer.from('<title>Caf'), Buffer.from([0xe9]), Buffer.from('</title>')]);

let server: Server;
let port = 0;
const seen: { url: string; headers: IncomingHttpHeaders }[] = [];

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location });
  res.end();
}

function html(res: ServerResponse, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    switch (req.url) {
      case '/page':
        return html(res, PAGE);
      case '/r1':
        return redirect(res, '/page');
      case '/r2':
        return redirect(res, '/r1');
      case '/r3':
        return redirect(res, '/r2');
      case '/r4':
        return redirect(res, '/r3');
      case '/to-metadata':
        return redirect(res, 'http://169.254.169.254/latest/meta-data');
      case '/to-mapped':
        return redirect(res, 'http://[::ffff:127.0.0.1]/');
      case '/forbidden':
        res.writeHead(403);
        return res.end();
      case '/down':
        res.writeHead(503);
        return res.end();
      case '/json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      case '/huge':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(`<p>${'x'.repeat(1_100_000)}</p>`);
      case '/gzip':
        return html(res, gzipSync(PAGE), { 'content-encoding': 'gzip' });
      case '/latin1':
        res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' });
        return res.end(CAFE_1252);
      case '/meta-charset':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(Buffer.concat([Buffer.from('<meta charset="windows-1252">'), CAFE_1252]));
      case '/slow':
        return; // Never answers.
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen.length = 0;
});

/** Production's rules, plus exactly one exception: the fixture server, 127.0.0.1 on its port. */
const FIXTURE: AddressPolicy = {
  allows: (address, p) => (address === '127.0.0.1' && p === port) || PUBLIC_WEB.allows(address, p),
};

function hosts(map: Record<string, string[]>): Resolve {
  return (hostname) => {
    const addresses = map[hostname];
    return addresses ? Promise.resolve(addresses) : Promise.reject(new Error('ENOTFOUND'));
  };
}

const fetcher = (options: { timeoutMs?: number } = {}) =>
  new PageFetcher({ policy: FIXTURE, resolve: hosts({ 'shop.test': ['127.0.0.1'] }), ...options });

const at = (path: string) => `http://shop.test:${port}${path}`;

describe('PageFetcher (spec §6.8)', () => {
  it('fetches an HTML page and reports where it ended up', async () => {
    expect(await fetcher().fetch(at('/r1'))).toEqual({
      ok: true,
      url: new URL(at('/page')),
      html: PAGE,
    });
  });

  it('identifies itself honestly, and asks for no compression (D34, Plan 3a rule 8)', async () => {
    await fetcher().fetch(at('/page'));
    expect(seen[0]?.headers['user-agent']).toBe(USER_AGENT);
    expect(seen[0]?.headers.accept).toBe('text/html');
    expect(seen[0]?.headers['accept-encoding']).toBeUndefined();
  });

  it('follows three redirects, but not four', async () => {
    expect((await fetcher().fetch(at('/r3'))).ok).toBe(true);
    expect(await fetcher().fetch(at('/r4'))).toMatchObject({
      ok: false,
      reason: 'TOO_MANY_REDIRECTS',
    });
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://10.0.0.1/',
  ])('refuses %s before connecting (spec §8)', async (url) => {
    expect(await new PageFetcher().fetch(url)).toMatchObject({
      ok: false,
      reason: 'DISALLOWED_ADDRESS',
    });
  });

  it.each(['/to-metadata', '/to-mapped'])(
    'refuses a redirect from an allowed page to a private address (%s, spec §8)',
    async (path) => {
      expect(await fetcher().fetch(at(path))).toMatchObject({
        ok: false,
        reason: 'DISALLOWED_ADDRESS',
      });
    },
  );

  it('refuses a host if any one of its addresses is private', async () => {
    const page = await new PageFetcher({
      resolve: hosts({ 'mixed.test': ['93.184.216.34', '10.0.0.1'] }),
    }).fetch('http://mixed.test/');
    expect(page).toMatchObject({ ok: false, reason: 'DISALLOWED_ADDRESS' });
  });

  it('refuses ports other than 80 and 443, before connecting', async () => {
    const page = await new PageFetcher({
      resolve: hosts({ 'shop.example': ['93.184.216.34'] }),
    }).fetch('http://shop.example:8080/');
    expect(page).toMatchObject({ ok: false, reason: 'DISALLOWED_ADDRESS' });
  });

  it('connects to the address it checked, even if DNS changes its answer (rebinding)', async () => {
    let calls = 0;
    const resolve: Resolve = () =>
      Promise.resolve(calls++ === 0 ? ['127.0.0.1'] : ['169.254.169.254']);
    const page = await new PageFetcher({ policy: FIXTURE, resolve }).fetch(
      `http://rebind.test:${port}/page`,
    );
    expect(page.ok).toBe(true);
    expect(calls).toBe(1);
    expect(seen[0]?.headers.host).toBe(`rebind.test:${port}`);
  });

  it.each([
    'ftp://shop.test/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://ada:secret@shop.test/',
    'not a url',
  ])('refuses %j as INVALID_URL', async (url) => {
    expect(await fetcher().fetch(url)).toMatchObject({ ok: false, reason: 'INVALID_URL' });
  });

  it('reports a host that does not resolve as DNS_FAILED', async () => {
    expect(await fetcher().fetch('http://nowhere.test/')).toMatchObject({
      ok: false,
      reason: 'DNS_FAILED',
      host: 'nowhere.test',
    });
  });

  it('reports a refused connection as UNREACHABLE (Plan 3a rule 7)', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const page = await new PageFetcher({
      policy: { allows: (address, p) => address === '127.0.0.1' && p === closedPort },
      resolve: hosts({ 'shop.test': ['127.0.0.1'] }),
    }).fetch(`http://shop.test:${closedPort}/`);
    expect(page).toMatchObject({ ok: false, reason: 'UNREACHABLE' });
  });

  it.each(['/forbidden', '/down'])('reports %s as BLOCKED_BY_SITE', async (path) => {
    expect(await fetcher().fetch(at(path))).toMatchObject({
      ok: false,
      reason: 'BLOCKED_BY_SITE',
    });
  });

  it('refuses anything but HTML', async () => {
    expect(await fetcher().fetch(at('/json'))).toMatchObject({ ok: false, reason: 'NOT_HTML' });
  });

  it('stops reading past 1 MB', async () => {
    expect(await fetcher().fetch(at('/huge'))).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
  });

  it('gives up on a site that is too slow', async () => {
    expect(await fetcher({ timeoutMs: 200 }).fetch(at('/slow'))).toMatchObject({
      ok: false,
      reason: 'TIMEOUT',
    });
  });

  it('gives up on DNS that is too slow', async () => {
    const page = await new PageFetcher({
      timeoutMs: 200,
      resolve: () => new Promise<string[]>(() => undefined),
    }).fetch('http://slow-dns.test/');
    expect(page).toMatchObject({ ok: false, reason: 'TIMEOUT' });
  });

  it('decodes a gzipped page it did not ask for (Plan 3a rule 8)', async () => {
    expect(await fetcher().fetch(at('/gzip'))).toMatchObject({ ok: true, html: PAGE });
  });

  it.each(['/latin1', '/meta-charset'])(
    'reads a windows-1252 page correctly (%s, Plan 3a Review Focus 5)',
    async (path) => {
      const page = await fetcher().fetch(at(path));
      expect(page.ok && page.html).toContain('Café');
    },
  );
});

describe('pinnedLookup (Plan 3a rule 10)', () => {
  const lookup = pinnedLookup(new Map([['shop.test', ['93.184.216.34', '2606:4700::1111']]]));

  const ask = (hostname: string, all: boolean) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
      (resolve) => {
        lookup(hostname, { all }, (error, address, family) => resolve({ error, address, family }));
      },
    );

  it('answers the list form Node uses by default', async () => {
    expect((await ask('shop.test', true)).address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);
  });

  it('answers the single-address form', async () => {
    const { address, family } = await ask('shop.test', false);
    expect([address, family]).toEqual(['93.184.216.34', 4]);
  });

  it('refuses a host nobody checked', async () => {
    expect((await ask('elsewhere.test', true)).error?.code).toBe('ENOTFOUND');
  });
});
```

Run `pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl/page-fetcher.spec.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 5: Write the page fetcher**

`apps/api/src/unfurl/page-fetcher.ts`:

```ts
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { UnfurlFailureReason } from '@wishlist/contracts';
import { Agent, request } from 'undici';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';

/** Resolves a hostname to every address it has. */
export type Resolve = (hostname: string) => Promise<string[]>;

export const resolveAll: Resolve = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** How unfurl introduces itself (D34): honestly, with a page to read about it. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)';

// No Accept-Encoding: we'd rather receive plain bytes (Plan 3a rule 8).
const REQUEST_HEADERS = { 'user-agent': USER_AGENT, accept: 'text/html', 'accept-language': 'en' };

export interface PageFetcherOptions {
  policy?: AddressPolicy;
  resolve?: Resolve;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type FetchedPage =
  | { ok: true; url: URL; html: string }
  | { ok: false; reason: UnfurlFailureReason; host?: string };

/** A failure with a known reason. fetch() throws these internally and returns them as results. */
class FetchFailure extends Error {
  constructor(readonly reason: UnfurlFailureReason) {
    super(reason);
    this.name = 'FetchFailure';
  }
}

/**
 * Fetches one HTML page for unfurl, under spec §6.8's rules:
 * - Every hop is checked before connecting: http or https, no userinfo, an allowed port, and every
 *   address the host resolves to allowed by the policy.
 * - The connection goes to an address that was checked, through undici's `connect.lookup`, so
 *   DNS can't change between the check and the connection (rebinding).
 * - Redirects are followed by hand, each hop checked again.
 * - One deadline covers every hop, DNS included, and the body is cut off at `maxBytes`.
 */
export class PageFetcher {
  private readonly policy: AddressPolicy;
  private readonly resolve: Resolve;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: PageFetcherOptions = {}) {
    this.policy = options.policy ?? PUBLIC_WEB;
    this.resolve = options.resolve ?? resolveAll;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
    this.maxRedirects = options.maxRedirects ?? 3;
  }

  async fetch(rawUrl: string): Promise<FetchedPage> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, reason: 'INVALID_URL' };
    }
    // The hostnames checked during this fetch, with the addresses that passed. pinnedLookup serves
    // only these, and the agent dies with this fetch (Plan 3a rule 10).
    const vetted = new Map<string, string[]>();
    const agent = new Agent({ connect: { lookup: pinnedLookup(vetted) } });
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      for (let redirects = 0; ; redirects++) {
        await this.vet(url, vetted, signal);
        const res = await request(url, {
          dispatcher: agent,
          method: 'GET',
          headers: REQUEST_HEADERS,
          signal,
        });
        if (res.statusCode >= 300 && res.statusCode < 400) {
          await res.body.dump();
          if (redirects === this.maxRedirects) throw new FetchFailure('TOO_MANY_REDIRECTS');
          url = nextHop(res.headers.location, url);
          continue;
        }
        if (res.statusCode >= 400) {
          await res.body.dump();
          throw new FetchFailure('BLOCKED_BY_SITE');
        }
        const type = res.headers['content-type'];
        if (typeof type !== 'string' || mediaType(type) !== 'text/html') {
          await res.body.dump();
          throw new FetchFailure('NOT_HTML');
        }
        const body = decoded(res.body, res.headers['content-encoding']);
        const bytes = await readCapped(body, this.maxBytes);
        return { ok: true, url, html: decodeHtml(bytes, type) };
      }
    } catch (error) {
      return { ok: false, reason: reasonFor(error, signal), host: url.hostname };
    } finally {
      await agent.destroy();
    }
  }

  /** Spec §6.8's checks on one hop, before any connection. Records what passed, for the lookup. */
  private async vet(url: URL, vetted: Map<string, string[]>, signal: AbortSignal): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchFailure('INVALID_URL');
    if (url.username || url.password) throw new FetchFailure('INVALID_URL');
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    const host = bareHost(url.hostname);
    // An IP-literal host never reaches `lookup` (Node skips it), so it's checked as it stands.
    const addresses = isIP(host) ? [host] : await this.lookUp(host, signal);
    if (!addresses.every((address) => this.policy.allows(address, port))) {
      throw new FetchFailure('DISALLOWED_ADDRESS');
    }
    vetted.set(host, addresses);
  }

  private async lookUp(host: string, signal: AbortSignal): Promise<string[]> {
    let addresses: string[];
    try {
      addresses = await untilAborted(this.resolve(host), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new FetchFailure('DNS_FAILED');
    }
    if (addresses.length === 0) throw new FetchFailure('DNS_FAILED');
    return addresses;
  }
}

/**
 * A `lookup` for undici's connector that answers only for hosts vet() checked, with the addresses
 * that passed (Plan 3a rule 10). Node asks in two forms. With `all: true`, the default under
 * autoSelectFamily, it wants a list; otherwise it wants one address and its family.
 */
export function pinnedLookup(vetted: ReadonlyMap<string, readonly string[]>): LookupFunction {
  return (hostname, options, callback) => {
    const entries = (vetted.get(hostname) ?? []).map((address) => ({
      address,
      family: isIP(address),
    }));
    const [first] = entries;
    if (!first) {
      const error: NodeJS.ErrnoException = new Error(`${hostname} was not checked for this fetch`);
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }
    if (options.all) callback(null, entries);
    else callback(null, first.address, first.family);
  };
}

/** The next hop's URL. A redirect without a usable Location is BLOCKED_BY_SITE (Plan 3a rule 7). */
function nextHop(location: string | string[] | undefined, base: URL): URL {
  if (typeof location !== 'string') throw new FetchFailure('BLOCKED_BY_SITE');
  try {
    return new URL(location, base);
  } catch {
    throw new FetchFailure('BLOCKED_BY_SITE');
  }
}

/** `[::1]` → `::1`: URL keeps the brackets on an IPv6 host. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
}

function mediaType(contentType: string): string | undefined {
  return contentType.split(';')[0]?.trim().toLowerCase();
}

/**
 * The body, decompressed. We ask for no compression, but some servers send it anyway (Plan 3a rule
 * 8). pipeline() destroys both sides on an error, so an abort still ends the read.
 */
function decoded(body: Readable, encoding: string | string[] | undefined): Readable {
  const name = typeof encoding === 'string' ? encoding.trim().toLowerCase() : '';
  const ignore = () => undefined;
  switch (name) {
    case '':
    case 'identity':
      return body;
    case 'gzip':
    case 'x-gzip':
      return pipeline(body, createGunzip(), ignore);
    case 'deflate':
      return pipeline(body, createInflate(), ignore);
    case 'br':
      return pipeline(body, createBrotliDecompress(), ignore);
    default:
      body.destroy();
      throw new FetchFailure('NOT_HTML');
  }
}

/** Reads the whole body, but gives up once it passes `max` bytes, counted after decompression. */
async function readCapped(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > max) throw new FetchFailure('TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Text, in the page's own charset (Plan 3a rule 9): the Content-Type charset, else a <meta>
 * charset in the first 1024 bytes, else UTF-8. An unknown label falls back to UTF-8.
 */
function decodeHtml(bytes: Buffer, contentType: string): string {
  const label =
    /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(bytes.subarray(0, 1024).toString('latin1'))?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Rejects with the signal's reason as soon as it aborts, whatever `work` is still doing. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Plan 3a rule 7: a known failure keeps its reason; the deadline is TIMEOUT; the rest UNREACHABLE. */
function reasonFor(error: unknown, signal: AbortSignal): UnfurlFailureReason {
  if (error instanceof FetchFailure) return error.reason;
  if (signal.aborted) return 'TIMEOUT';
  return 'UNREACHABLE';
}
```

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl
```

Expected: PASS, with 30 address-policy tests and 34 page-fetcher tests.

If undici's types reject `connect: { lookup }` or the `headers` shape, adjust the types only; the behaviour stays. Any test that fails on behaviour is a finding to report, not something to relax. That applies especially to the rebinding test and the private-address tests: a failure there is a real security hole.

- [ ] **Step 7: Gate, commit, submit**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
git add apps/api pnpm-lock.yaml
git commit -F - <<'EOF'
feat(api): fetch unfurl pages without letting a URL reach our network

Every hop is checked before connecting: http(s), no userinfo, ports 80
and 443, and every address the host resolves to must be public unicast,
an allowlist (ipaddr.js) so no special-purpose range slips through. The
connection goes to an address that was checked, through undici's
connect lookup, so DNS rebinding can't move it. Redirects are followed
by hand (at most 3), one 5 s deadline covers DNS and every hop, and the
body stops at 1 MB after decompression (spec §6.8).

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the new PR its commit's title with `gh pr edit <n> --title "…"`, and confirm its checks are green.

---

### Task 6: Reading a page's metadata

**Files:**
- Modify: `apps/api/package.json` (add `htmlparser2@12.0.0`, exact), `pnpm-lock.yaml`
- Create: `apps/api/src/unfurl/metadata.ts`, `apps/api/src/unfurl/metadata.spec.ts`

**Interfaces:**
- Produces:
  - `interface PageMetadata { title?: string; imageUrl?: string; priceText?: string }`;
  - `extractMetadata(html: string, pageUrl: URL): PageMetadata`;
  - `formatPrice(amount: unknown, currency: unknown): string | undefined`.

A probe of htmlparser2 12 found two things. It splits `<title>` text across several `ontext` calls, so the parser accumulates them. And it decodes entities in attributes and normal text, but not inside `<script>`, which is HTML's rule. So JSON-LD strings need their own entity decoding.

- [ ] **Step 1: Add the layer and the dependency**

```bash
gh stack add api/unfurl
pnpm --filter @wishlist/api add -E htmlparser2@12.0.0
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/unfurl/metadata.spec.ts`. The fixtures are trimmed copies of how real shops mark up product pages:

```ts
import { describe, expect, it } from 'vitest';
import { extractMetadata, formatPrice } from './metadata.js';

const SHOP = new URL('https://shop.example/products/kettle');

/** A Shopify-style page: Open Graph and product tags, plus JSON-LD that says something else. */
const OPEN_GRAPH = `<!doctype html><html><head>
<meta property="og:title" content="Stovetop Kettle &amp; Lid">
<meta property="og:image" content="https://cdn.shop.example/kettle.jpg">
<meta property="product:price:amount" content="40.00">
<meta property="product:price:currency" content="USD">
<script type="application/ld+json">{"@type":"Product","name":"Not this name","offers":{"price":"99","priceCurrency":"USD"}}</script>
<title>Kettle – Shop</title></head><body></body></html>`;

/** A WooCommerce-style page: no Open Graph, a broken block, then a Product inside @graph. */
const JSON_LD_GRAPH = `<html><head>
<script type="application/ld+json">{ this is not json </script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList","itemListElement":[]},
  {"@type":["Product","Thing"],"name":"Linen Throw &amp; Pillow",
   "image":[{"@type":"ImageObject","url":"https://cdn.shop.example/throw.jpg"}],
   "offers":[{"@type":"AggregateOffer","lowPrice":19,"priceCurrency":"EUR"}]}
]}</script>
<title>Not used when JSON-LD has a name</title></head></html>`;

const TITLE_ONLY = `<html><head><title>
   Tea   &amp;
   Cake  </title></head><body></body></html>`;

const image = (src: string, page = SHOP) =>
  extractMetadata(`<meta property="og:image" content="${src}">`, page).imageUrl;

describe('extractMetadata (spec §6.8, Plan 3a rule 11)', () => {
  it('reads Open Graph first, ahead of JSON-LD and <title>', () => {
    expect(extractMetadata(OPEN_GRAPH, SHOP)).toEqual({
      title: 'Stovetop Kettle & Lid',
      imageUrl: 'https://cdn.shop.example/kettle.jpg',
      priceText: '$40.00',
    });
  });

  it('finds a Product inside @graph, past a broken block, with its image and lowest offer', () => {
    expect(extractMetadata(JSON_LD_GRAPH, SHOP)).toEqual({
      title: 'Linen Throw & Pillow',
      imageUrl: 'https://cdn.shop.example/throw.jpg',
      priceText: '€19.00',
    });
  });

  it('accepts a schema.org URL as the type', () => {
    const html = `<script type="application/ld+json">{"@type":"http://schema.org/Product","name":"Mug"}</script>`;
    expect(extractMetadata(html, SHOP)).toEqual({ title: 'Mug' });
  });

  it('falls back to <title>, decoded and with its whitespace collapsed', () => {
    expect(extractMetadata(TITLE_ONLY, SHOP)).toEqual({ title: 'Tea & Cake' });
  });

  it('ignores an icon title inside <svg>', () => {
    const html = '<html><body><svg><title>Logo</title></svg><h1>Hi</h1></body></html>';
    expect(extractMetadata(html, SHOP)).toEqual({});
  });

  it('returns nothing for a page with nothing to say', () => {
    expect(extractMetadata('<p>Hello</p>', SHOP)).toEqual({});
  });

  it('cuts a long title to 200 characters without splitting an emoji', () => {
    const title = `${'a'.repeat(199)}😀b`;
    expect(extractMetadata(`<title>${title}</title>`, SHOP).title).toBe('a'.repeat(199));
  });
});

describe('images (Plan 3a Review Focus 4)', () => {
  it.each([
    ['/img/kettle.jpg', 'https://shop.example/img/kettle.jpg'],
    ['//cdn.example/kettle.jpg', 'https://cdn.example/kettle.jpg'],
    ['http://cdn.example/kettle.jpg', undefined],
    ['data:image/png;base64,AAAA', undefined],
    ['', undefined],
  ])('turns %j into %j', (src, expected) => {
    expect(image(src)).toBe(expected);
  });

  it('cannot make an https image from a protocol-relative URL on an http page', () => {
    expect(image('//cdn.example/kettle.jpg', new URL('http://shop.example/'))).toBeUndefined();
  });

  it('prefers og:image:secure_url, and falls through an http og:image to JSON-LD', () => {
    const secure = `<meta property="og:image" content="https://cdn.example/a.jpg"><meta property="og:image:secure_url" content="https://cdn.example/b.jpg">`;
    expect(extractMetadata(secure, SHOP).imageUrl).toBe('https://cdn.example/b.jpg');
    const fallThrough = `<meta property="og:image" content="http://cdn.example/a.jpg">
<script type="application/ld+json">{"@type":"Product","name":"K","image":"https://cdn.example/c.jpg"}</script>`;
    expect(extractMetadata(fallThrough, SHOP).imageUrl).toBe('https://cdn.example/c.jpg');
  });
});

describe('formatPrice (spec §2: prices are display strings)', () => {
  it.each([
    ['24.99', 'USD', '$24.99'],
    [1299, 'USD', '$1,299.00'],
    ['19', 'EUR', '€19.00'],
    ['24.99', 'usd', '$24.99'],
    ['24.99', undefined, '24.99'],
    ['about 20', 'USD', 'about 20 USD'],
    ['24.99', 'XX', '24.99 XX'],
    ['', 'USD', undefined],
    [undefined, 'USD', undefined],
    ['9'.repeat(60), 'USD', undefined],
  ])('formats %j %j as %j', (amount, currency, expected) => {
    expect(formatPrice(amount, currency)).toBe(expected);
  });
});
```

Run `pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl/metadata.spec.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Write the parser**

`apps/api/src/unfurl/metadata.ts`:

```ts
import { Parser } from 'htmlparser2';

/** What a page says about the product on it. Every field is optional (spec §6.8). */
export interface PageMetadata {
  title?: string;
  imageUrl?: string;
  priceText?: string;
}

const TITLE_MAX = 200;
const PRICE_MAX = 50;
const URL_MAX = 2048;

type JsonObject = Record<string, unknown>;

/**
 * What a product page says about itself (spec §6.8). Each field comes from the first source that
 * has it: Open Graph tags, then a JSON-LD Product, then <title> (Plan 3a rule 11).
 */
export function extractMetadata(html: string, pageUrl: URL): PageMetadata {
  const page = scan(html);
  const product = findProduct(page.jsonLd);

  const title = text(page.meta.get('og:title')) ?? jsonText(product?.name) ?? text(page.title);
  const imageUrl = [
    page.meta.get('og:image:secure_url'),
    page.meta.get('og:image'),
    ...imagesOf(product),
  ]
    .map((candidate) => httpsUrl(candidate, pageUrl))
    .find((url) => url !== undefined);
  const priceText =
    formatPrice(
      page.meta.get('product:price:amount') ?? page.meta.get('og:price:amount'),
      page.meta.get('product:price:currency') ?? page.meta.get('og:price:currency'),
    ) ?? offerPrice(product);

  const metadata: PageMetadata = {};
  if (title) metadata.title = truncate(title, TITLE_MAX);
  if (imageUrl) metadata.imageUrl = imageUrl;
  if (priceText) metadata.priceText = priceText;
  return metadata;
}

/**
 * A display price (spec §2: prices are strings), such as "$24.99". When the amount isn't a plain
 * number or the currency isn't one Intl knows, it reads "<amount> <CODE>". Over 50 characters,
 * it's dropped.
 */
export function formatPrice(amount: unknown, currency: unknown): string | undefined {
  const value =
    typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? amount.trim() : '';
  if (!value) return undefined;
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  let formatted = code ? `${value} ${code}` : value;
  if (code && /^\d+(\.\d+)?$/.test(value)) {
    try {
      formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(
        Number(value),
      );
    } catch {
      // A malformed currency code: keep "<amount> <CODE>".
    }
  }
  return formatted.length <= PRICE_MAX ? formatted : undefined;
}

/** One pass over the page: its <meta> tags, its JSON-LD blocks and its first <title>. */
function scan(html: string): { meta: Map<string, string>; jsonLd: string[]; title?: string } {
  const meta = new Map<string, string>();
  const jsonLd: string[] = [];
  let title: string | undefined;
  let svgDepth = 0;
  let inTitle = false;
  let inJsonLd = false;
  let buffer = '';

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'svg') svgDepth++;
        else if (name === 'meta') {
          const key = (attribs.property ?? attribs.name)?.trim().toLowerCase();
          if (key && attribs.content !== undefined && !meta.has(key)) meta.set(key, attribs.content);
        } else if (name === 'script' && attribs.type?.trim().toLowerCase() === 'application/ld+json') {
          inJsonLd = true;
          buffer = '';
        } else if (name === 'title' && svgDepth === 0 && title === undefined) {
          inTitle = true;
          buffer = '';
        }
      },
      // Text arrives in pieces, so it's accumulated until the element closes.
      ontext(chunk) {
        if (inJsonLd || inTitle) buffer += chunk;
      },
      onclosetag(name) {
        if (name === 'svg') svgDepth = Math.max(0, svgDepth - 1);
        else if (name === 'script' && inJsonLd) {
          jsonLd.push(buffer);
          inJsonLd = false;
        } else if (name === 'title' && inTitle) {
          title = buffer;
          inTitle = false;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { meta, jsonLd, title };
}

/** The first schema.org Product in any JSON-LD block, looking inside arrays and @graph. */
function findProduct(blocks: string[]): JsonObject | undefined {
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const product = search(data, 0);
    if (product) return product;
  }
  return undefined;
}

function search(node: unknown, depth: number): JsonObject | undefined {
  if (depth > 8) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = search(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(node)) return undefined;
  if (typesOf(node['@type']).includes('product')) return node;
  return search(node['@graph'], depth + 1);
}

function typesOf(type: unknown): string[] {
  return (Array.isArray(type) ? type : [type])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
}

function imagesOf(product: JsonObject | undefined): unknown[] {
  if (!product) return [];
  const images = Array.isArray(product.image) ? product.image : [product.image];
  return images.map((entry) => (isObject(entry) ? (entry.url ?? entry.contentUrl) : entry));
}

function offerPrice(product: JsonObject | undefined): string | undefined {
  if (!product) return undefined;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  for (const offer of offers) {
    if (!isObject(offer)) continue;
    const price = formatPrice(offer.price ?? offer.lowPrice, offer.priceCurrency);
    if (price) return price;
  }
  return undefined;
}

/** An image URL as gifters will load it: resolved against the page, https only (spec §2). */
function httpsUrl(candidate: unknown, base: URL): string | undefined {
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
  try {
    const url = new URL(candidate.trim(), base);
    return url.protocol === 'https:' && url.href.length <= URL_MAX ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whitespace collapsed and trimmed. Empty is "nothing". */
function text(value: string | undefined): string | undefined {
  const collapsed = value?.replace(/\s+/g, ' ').trim();
  return collapsed || undefined;
}

/** A JSON-LD string: <script> text isn't entity-decoded, so the basic entities are decoded here. */
function jsonText(value: unknown): string | undefined {
  return typeof value === 'string' ? text(decodeEntities(value)) : undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const name = entity.toLowerCase();
    if (name.startsWith('#x')) return codePoint(parseInt(name.slice(2), 16)) ?? match;
    if (name.startsWith('#')) return codePoint(parseInt(name.slice(1), 10)) ?? match;
    return NAMED_ENTITIES[name] ?? match;
  });
}

function codePoint(n: number): string | undefined {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : undefined;
}

/** At most `max` UTF-16 units, never ending on half of a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl/metadata.spec.ts
```

Expected: PASS (24 tests).

---

### Task 7: The unfurl endpoint

**Files:**
- Create: `apps/api/src/unfurl/metadata-fetcher.ts`, `apps/api/src/unfurl/metadata-fetcher.spec.ts`
- Create: `apps/api/src/wishlist/unfurl.service.ts`
- Modify: `apps/api/src/wishlist/wishlist.controller.ts`, `apps/api/src/wishlist/wishlist.module.ts`
- Modify: `apps/api/src/testing/fakes.ts`, `apps/api/test/support/auth-app.ts`
- Test: `apps/api/test/unfurl.int-spec.ts`

**Interfaces:**
- Consumes: `PageFetcher`, `FetchedPage` and `Resolve` (Task 5); `extractMetadata` (Task 6); `RateLimiter` and `rateLimitKey` (Plan 2a); `UnfurlRequestSchema` and `UnfurlResponse` (Task 1).
- Produces:
  - `interface MetadataFetcher { fetch(url: string): Promise<UnfurlResponse> }`, the spec §8 port;
  - `METADATA_FETCHER`, `HttpMetadataFetcher` and `FakeMetadataFetcher`;
  - `AuthTestApp.unfurl`;
  - `POST /wishlist/unfurl`.

- [ ] **Step 1: Write the adapter's failing tests**

`apps/api/src/unfurl/metadata-fetcher.spec.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';
import { HttpMetadataFetcher } from './metadata-fetcher.js';
import { PageFetcher } from './page-fetcher.js';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/kettle') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        '<meta property="og:title" content="Kettle"><meta property="product:price:amount" content="40"><meta property="product:price:currency" content="USD">',
      );
    }
    if (req.url === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<p>Nothing here</p>');
    }
    res.writeHead(403);
    return res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

const FIXTURE: AddressPolicy = {
  allows: (address, p) => (address === '127.0.0.1' && p === port) || PUBLIC_WEB.allows(address, p),
};
const fetcher = () =>
  new HttpMetadataFetcher(
    new PageFetcher({ policy: FIXTURE, resolve: () => Promise.resolve(['127.0.0.1']) }),
  );
const at = (path: string) => `http://shop.test:${port}${path}`;

describe('HttpMetadataFetcher (spec §6.8)', () => {
  it("returns the page's metadata", async () => {
    expect(await fetcher().fetch(at('/kettle'))).toEqual({ title: 'Kettle', priceText: '$40.00' });
  });

  it('says NO_METADATA when a page has nothing usable', async () => {
    expect(await fetcher().fetch(at('/empty'))).toEqual({ failureReason: 'NO_METADATA' });
  });

  it("passes the fetcher's failure through", async () => {
    expect(await fetcher().fetch(at('/forbidden'))).toEqual({ failureReason: 'BLOCKED_BY_SITE' });
  });

  it('logs the reason and the host, never the path or query (Plan 3a rule 12)', async () => {
    await fetcher().fetch(at('/secret-path?email=ada@example.com'));
    expect(log).toHaveBeenCalledTimes(1);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toBe('unfurl BLOCKED_BY_SITE host=shop.test');
    expect(message).not.toMatch(/secret|ada@example\.com/);
  });
});
```

Run `pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl/metadata-fetcher.spec.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 2: Write the port and its real adapter**

`apps/api/src/unfurl/metadata-fetcher.ts`:

```ts
import { Logger } from '@nestjs/common';
import type { UnfurlFailureReason, UnfurlResponse } from '@wishlist/contracts';
import { extractMetadata } from './metadata.js';
import { PageFetcher } from './page-fetcher.js';

/** The unfurl port (spec §8): a prefill for a product link. Never throws; a failure has a reason. */
export interface MetadataFetcher {
  fetch(url: string): Promise<UnfurlResponse>;
}

export const METADATA_FETCHER = Symbol('METADATA_FETCHER');

/** The real unfurl: fetch the page under spec §6.8's rules, then read what it says. */
export class HttpMetadataFetcher implements MetadataFetcher {
  private readonly logger = new Logger('Unfurl');

  constructor(private readonly pages: PageFetcher = new PageFetcher()) {}

  async fetch(url: string): Promise<UnfurlResponse> {
    const page = await this.pages.fetch(url);
    if (!page.ok) return this.failed(page.reason, page.host);
    const metadata = extractMetadata(page.html, page.url);
    if (!metadata.title && !metadata.imageUrl && !metadata.priceText) {
      return this.failed('NO_METADATA', page.url.hostname);
    }
    return metadata;
  }

  /** Logs the reason and the host only: a path or a query string can carry personal data. */
  private failed(reason: UnfurlFailureReason, host?: string): UnfurlResponse {
    this.logger.log(host ? `unfurl ${reason} host=${host}` : `unfurl ${reason}`);
    return { failureReason: reason };
  }
}
```

Run the spec again. Expected: PASS (4 tests).

- [ ] **Step 3: The fake, for integration tests**

Add to `apps/api/src/testing/fakes.ts`, with the imports `import type { UnfurlResponse } from '@wishlist/contracts';` and `import type { MetadataFetcher } from '../unfurl/metadata-fetcher.js';`:

```ts
/** Unfurl stand-in. Set `next`; `urls` records every URL asked for. */
export class FakeMetadataFetcher implements MetadataFetcher {
  next: UnfurlResponse = { failureReason: 'NO_METADATA' };
  readonly urls: string[] = [];

  fetch(url: string): Promise<UnfurlResponse> {
    this.urls.push(url);
    return Promise.resolve(this.next);
  }
}
```

In `apps/api/test/support/auth-app.ts`:
- create `const unfurl = new FakeMetadataFetcher();`;
- override it with `.overrideProvider(METADATA_FETCHER).useValue(unfurl)`;
- add `unfurl: FakeMetadataFetcher` to `AuthTestApp` and to the returned object;
- in `reset()`, add `unfurl.next = { failureReason: 'NO_METADATA' }; unfurl.urls.length = 0;`.

- [ ] **Step 4: Write the endpoint's failing tests**

`apps/api/test/unfurl.int-spec.ts`:

```ts
import { ErrorCode, ProblemSchema, UnfurlResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';

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

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const unfurl = (cookie: string | undefined, body: object) =>
  client(t.app, cookie).post('/wishlist/unfurl', body);

describe('POST /wishlist/unfurl (spec §5, §6.8)', () => {
  it('returns the prefill for the trimmed URL, and saves nothing', async () => {
    t.unfurl.next = {
      title: 'Stovetop kettle',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
    };
    const res = await unfurl(await owner(), { url: ' https://shop.example/kettle ' });
    expect(res.status).toBe(200);
    expect(UnfurlResponseSchema.parse(res.body)).toEqual(t.unfurl.next);
    expect(t.unfurl.urls).toEqual(['https://shop.example/kettle']);
    const { rows } = await db.pool.query<{ n: string }>('select count(*) as n from items');
    expect(rows[0]?.n).toBe('0');
  });

  it('reports a failure as 200 with its reason (spec §9)', async () => {
    t.unfurl.next = { failureReason: 'BLOCKED_BY_SITE' };
    const res = await unfurl(await owner(), { url: 'https://shop.example/kettle' });
    expect([res.status, res.body]).toEqual([200, { failureReason: 'BLOCKED_BY_SITE' }]);
  });

  it.each([{}, { url: '' }, { url: 'a'.repeat(2049) }])(
    'refuses %j with 400 (Plan 3a rule 6)',
    async (body) => {
      const res = await unfurl(await owner(), body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
      expect(t.unfurl.urls).toEqual([]);
    },
  );

  it('needs a verified owner', async () => {
    expect((await unfurl(undefined, { url: 'https://shop.example/' })).status).toBe(401);
    await signUp(t);
    const unverified = await unfurl(await logIn(t), { url: 'https://shop.example/' });
    expect([unverified.status, codeOf(unverified)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
  });

  it('allows 60 an hour per owner, then 429 with Retry-After (spec §6.6)', async () => {
    const ada = await owner();
    for (let i = 0; i < 60; i++) {
      expect((await unfurl(ada, { url: `https://shop.example/${i}` })).status).toBe(200);
    }
    const limited = await unfurl(ada, { url: 'https://shop.example/61' });
    expect([limited.status, codeOf(limited)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.unfurl.urls).toHaveLength(60);

    // Another owner has their own budget, and the hour passing restores Ada's.
    expect((await unfurl(await owner(BOB), { url: 'https://shop.example/' })).status).toBe(200);
    t.clock.advance(60 * 60 * 1000);
    expect((await unfurl(ada, { url: 'https://shop.example/again' })).status).toBe(200);
  });
});
```

Run `pnpm --filter @wishlist/api exec vitest run --project integration unfurl`. Expected: FAIL. The route doesn't exist yet, so the requests answer 404.

- [ ] **Step 5: The service, route and wiring**

`apps/api/src/wishlist/unfurl.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { UnfurlResponse } from '@wishlist/contracts';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import type { RateLimitRule } from '../rate-limit/window.js';
import { METADATA_FETCHER, type MetadataFetcher } from '../unfurl/metadata-fetcher.js';

/** Spec §6.6. */
export const UNFURL_PER_USER: RateLimitRule = { limit: 60, windowSeconds: 3600 };

/** A link prefill for the owner (spec §5). Nothing is saved. */
@Injectable()
export class UnfurlService {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(METADATA_FETCHER) private readonly fetcher: MetadataFetcher,
  ) {}

  /** Every call counts against the owner's hourly limit, before anything is fetched. */
  async unfurl(userId: string, url: string): Promise<UnfurlResponse> {
    await this.limiter.enforce(rateLimitKey('unfurl:user', userId), UNFURL_PER_USER);
    return this.fetcher.fetch(url);
  }
}
```

In `wishlist.controller.ts`:
- inject `@Inject(UnfurlService) private readonly unfurls: UnfurlService` in the constructor;
- import `UnfurlRequestSchema`, `type UnfurlRequest` and `type UnfurlResponse`;
- add:

```ts
  /** A prefill only: always 200, and a failure carries its reason (spec §5, §9). */
  @Post('unfurl')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  unfurl(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UnfurlRequestSchema)) body: UnfurlRequest,
  ): Promise<UnfurlResponse> {
    return this.unfurls.unfurl(auth.user.id, body.url);
  }
```

In `wishlist.module.ts`:
- add `RateLimitModule` to `imports`;
- add `UnfurlService` and `{ provide: METADATA_FETCHER, useFactory: () => new HttpMetadataFetcher() }` to `providers`.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/unfurl
pnpm --filter @wishlist/api exec vitest run --project integration unfurl
```

Expected: PASS. The unit project gains 24 + 4 tests; the integration file has 7.

- [ ] **Step 7: Gate, commit, submit**

Tasks 6 and 7 are one layer, with one commit each.

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
git add apps/api/src/unfurl/metadata.ts apps/api/src/unfurl/metadata.spec.ts apps/api/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(api): read a product page's title, image and price

Open Graph first, then a JSON-LD Product (found inside arrays and
@graph, past broken blocks), then <title>, field by field (spec §6.8).
Images resolve against the page and must be https; prices become
display strings like "$24.99"; titles are cut to 200 characters without
splitting an emoji.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
git add apps/api
git commit -F - <<'EOF'
feat(api): prefill an item from its link with POST /wishlist/unfurl

The MetadataFetcher port (spec §8) fetches under §6.8's rules and reads
the page. Every call counts against 60 an hour per owner (spec §6.6),
nothing is saved, and every outcome is a 200: a failure carries its
reason so the editor can say why. Failures log the reason and the host,
never the path or query.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

This layer has two commits, so give its PR a title with `gh pr edit <n> --title "feat(api): prefill items from their links (unfurl)"` and a summary body. Confirm its checks are green.

---

### Task 8: Docs, the roadmap, and three stale comments

**Files:**
- Modify: `docs/development.md`, `AGENTS.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`
- Modify (comments only): `apps/api/src/auth/login.service.ts`, `apps/web/src/app/(account)/list/page.tsx`, `apps/web/src/app/robots.ts`

- [ ] **Step 1: Add the layer**

```bash
gh stack add docs/owner-api
```

- [ ] **Step 2: The development guide**

In `docs/development.md`, add this paragraph after the `## Tests` table:

```markdown
Testcontainers looks for Docker at `/var/run/docker.sock`. With Docker Desktop on Linux, point it at Desktop's socket: `DOCKER_HOST=unix://$HOME/.docker/desktop/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test:integration`.
```

Add this section after `## Trying the pages`:

````markdown
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
````

- [ ] **Step 3: AGENTS.md**

In the Layout table's `apps/api` row, change `External services sit behind ports (email, Turnstile, breached passwords, clock)` to `External services sit behind ports (email, Turnstile, breached passwords, link metadata, clock)`.

- [ ] **Step 4: The roadmap and the comments**

In the roadmap, row `3a`'s status becomes `Done`.

The comments:
- `login.service.ts`: "owner endpoints check verification (Plan 3)" becomes "(Plan 3a)".
- `(account)/list/page.tsx`: "until Plan 3 brings the list editor" becomes "until Plan 3b brings the list editor".
- `robots.ts`: "Plan 3 adds /s/ and /c/." becomes "Plan 4 adds /s/ and /c/."

- [ ] **Step 5: Gate, commit, submit the stack**

```bash
pnpm format:check || (pnpm exec prettier --write docs AGENTS.md && pnpm format:check)
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
git add docs AGENTS.md apps
git commit -F - <<'EOF'
docs: document the owner API and mark Plan 3a done

The development guide shows the owner endpoints and unfurl with curl,
and how to point Testcontainers at Docker Desktop on Linux. AGENTS.md
lists the new link-metadata port. Three comments that promised "Plan 3"
now name the plan that actually delivers.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the new PR its commit's title with `gh pr edit <n> --title "…"`.

Expected: every PR in `owner-api` passes its required checks (`checks`, `actionlint`, `integration`, `migrations-lint`, `e2e`), and has a preview.

---

### Task 9: ⏸ CHECKPOINT: try unfurl on a preview, merge `owner-api`, verify production (still dark)

**Files:** none. Run by the controller with Ted.

- [ ] **Step 1: Ted tries the API on the top preview**

Previews use Turnstile's always-pass test keys and log emails rather than send them, so a preview is the one place a real account can reach the new endpoints.
1. Open the top PR's web alias (`https://<PREVIEW_ALIAS_PREFIX><n>.vercel.app/signup`) and sign up.
2. Find the verification link in the **wishlist-api** preview deployment's logs in the Vercel dashboard (search for `verify-email`). Open it and press Confirm, then log in.
3. On the preview, open the browser's developer console and run:

```js
const post = (path, body) =>
  fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

await post('/wishlist/unfurl', { url: 'https://<a product page you like>' });
await post('/wishlist/unfurl', { url: 'http://169.254.169.254/latest/meta-data' });
await post('/wishlist/items', { title: 'Test kettle' });
await fetch('/api/wishlist').then((r) => r.json());
```

Expected:
- The product page returns a title, image or price, or a sensible `failureReason`. Big retailers often answer `BLOCKED_BY_SITE`, which is expected (D34).
- The metadata address returns `{ failureReason: 'DISALLOWED_ADDRESS' }`.
- The item is created, and the list shows it.

Note any product page that should have worked but didn't, with its `failureReason`. That's input for 3b's copy, not a blocker.

- [ ] **Step 2: Ted merges the stack**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 3: Verify production**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
APP=$(gh variable get APP_PRODUCTION_ORIGIN)
curl -s "$APP/api/health" | jq -c '{sha, db}'
curl -s "$APP/api/wishlist" | jq -r .code
curl -s -X POST "$APP/api/wishlist/unfurl" -H "Origin: $APP" -H 'content-type: application/json' -d '{"url":"https://example.com/"}' | jq -r .code
curl -s -X POST "$APP/api/auth/signup" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase","displayName":"Probe","turnstileToken":"x"}' | jq -r .code
```

Expected:
- **Deploy:** 7/7, including smoke.
- **Health:** the merge's `sha`, and `db.migrationsApplied` is 3.
- **`GET /api/wishlist` and the unfurl probe:** `UNAUTHENTICATED`.
- **Sign-up:** `CAPTCHA_UNAVAILABLE`, so it's still dark (D31).
