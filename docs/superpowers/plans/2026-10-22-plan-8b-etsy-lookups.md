# Plan 8b — Etsy Lookups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pasted Etsy listing link, short links included, fills in its title, photo and price from Etsy's Open API. The details are fetched once, for the add form.

**Architecture:**

- **Contracts:** `retailers.ts` learns Etsy listing links and `etsy.me` short links, and `retailerOf()` can return `'etsy'`.
- **API:** `RoutingMetadataFetcher` gains a second lookup, an `EtsyLookup` port whose adapter calls `GET /v3/application/listings/<id>`. It has its own 5-second deadline. Every other link, and every Etsy link while `ETSY_API_KEY` is unset, keeps today's path.
- **Web:** Etsy links keep the plain "Reading the page…" state, with no waiting panel. When the lookup can't answer, the message names Etsy. `/terms` carries Etsy's trademark statement, and the privacy page names Etsy.

**Tech Stack:** NestJS 12, Zod 4, Vitest, Playwright, Next.js, platform `fetch`. One direct dependency is added: `entities@8.1.0`, which is already in the lockfile through `htmlparser2` (ruling 3).

**Spec:**

- The design is [`docs/superpowers/specs/2026-10-22-retailer-lookups-design.md`](../specs/2026-10-22-retailer-lookups-design.md).
- This plan covers its Etsy half: §5.1 (Etsy rows), §5.3, §5.4 (Etsy), §5.6 (Etsy), §5.7 (Etsy), and §6 (E4, V1).
- It builds on Plan 8a as shipped (main `af4368c`).

## Global Constraints

**Carried over:** everything in [AGENTS.md](../../../AGENTS.md) and Plan 8a's Global Constraints still applies.

- ESM, with `.js` relative imports in `api` and `contracts`, and `import type` for types.
- Exact version pins.
- An explicit `@Inject(…)` on every constructor parameter.
- Unit tests never touch the network or Docker.
- Behavior changes are written test-first.
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it.
- Unfurl's contract is unchanged: always `200`, never throws, and a failure carries `failureReason`.

**Privacy:**

- Etsy receives only the listing ID, as the request's path.
- Logs carry the host, the reason, and, for `LOOKUP_UNAVAILABLE`, `provider=etsy status=<code>`. They never carry a URL, a listing ID or the key. Error reports carry none of the three either.

**Ted's decision on Etsy's API terms (E3, 2026-10-22).** Etsy's terms say:
- listing content may not be displayed more than 6 hours older than on Etsy;
- content may not be stored "longer than is reasonably necessary".

Ted chose **prefill only**: the API is called once, when the owner pastes the link, to fill in the add form. What the owner saves is their own entry. Hanker never refreshes it, and never calls Etsy again for a saved item. The accepted risk is that Etsy reads the terms more strictly and revokes the key. Etsy links would then fall back to typing the details in, and the fix is to unset `ETSY_API_KEY`. **No code in this plan stores, caches or refreshes Etsy data.**

**Values fixed by the design and by Etsy's OpenAPI document** (`https://www.etsy.com/openapi/generated/oas/3.0.0.json`, read 2026-10-22):

| Thing | Value |
|---|---|
| Etsy hosts | `etsy.com`, `www.etsy.com`. Short links: `etsy.me` |
| Listing path | `/listing/<id>`, optionally after one locale segment such as `/uk/` or `/en-gb/`. Then a slug, a query or the end of the path |
| Listing ID | `[1-9]\d{0,17}`: positive, and at most 18 digits, so it fits Etsy's int64 (ruling 1) |
| Request | `GET https://api.etsy.com/v3/application/listings/<id>?includes=Images`, with headers `x-api-key: <ETSY_API_KEY>` and `accept: application/json` |
| Key format | `keystring:shared_secret`, as Etsy's security scheme requires |
| Etsy deadline | `ETSY_DEADLINE_MS = 5_000`, covering `etsy.me` hops and the lookup |
| `title` | `decodeHTML(title)` (Etsy encodes entities), then `productMetadata`'s `text()` and truncation |
| `imageUrl` | the image with the lowest `rank`: its `url_570xN`, else its `url_fullxfull` (ruling 2) |
| `priceText` | `formatPrice(price.amount / price.divisor, price.currency_code)`. No price when `divisor` isn't a positive integer |
| Not a prefill | a `404`, or a `200` whose `state` isn't `active` (`inactive`, `sold_out`, `draft`, `removed`, `expired`) → `NO_METADATA` |
| Env variable | `ETSY_API_KEY`, optional. Unset means Etsy links take today's page fetch |
| Rate limits | 5 per second and 5,000 per day for this app. No cap is added: unfurl's own 60 per hour per user stays the only limit, and a `429` is `LOOKUP_UNAVAILABLE`, logged only (as D68 does for Amazon) |

**Copy** (curly apostrophes, as all copy in `apps/web/src/lib/messages.ts`):

| Where | Text |
|---|---|
| `LOOKUP_UNAVAILABLE`, Etsy | `We couldn’t get the details from Etsy right now, so fill them in yourself.` |
| `/terms`, "Shops and gifts", a second paragraph (Etsy's terms, verbatim) | `The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy.` |
| `/privacy`, "If you make a list" | `For Amazon and Etsy product links, Hanker asks Bright Data (Amazon) or Etsy for the details instead, and sends only the product’s ID.` |
| `/privacy`, "Who else handles your information" | `Etsy looks up Etsy listing links. It sees the listing’s ID, and nothing about who pasted it.` |

The `/terms` statement keeps Etsy's straight apostrophes, because it's quoted verbatim.

## Rulings this plan makes on gaps in the design

1. **Listing IDs are capped at 18 digits, with no leading zero.** A longer one would overflow Etsy's int64 and earn a `400`. Because the cap rules that out, a `400` can only mean our own request is wrong, so it's reported like `401` and `403`.
2. **Image size:** `url_570xN` is the size Etsy shows on a listing page. `url_fullxfull` can be several megabytes, so it's only the fallback.
3. **Decoding entities:** `entities@8.1.0` is added as a direct, pinned dependency of `@wishlist/api`. It's already installed through `htmlparser2@12.0.0`, so nothing new is downloaded. The platform has no HTML entity decoder outside the DOM, and decoding numeric and named entities by hand is the kind of code that goes wrong.
4. **Where the trademark statement goes:** on `/terms`, as the design says (Ted, 2026-10-22). Etsy's terms ask for it to be shown "prominently", and Ted kept `/terms` knowing that. It's the second paragraph of "Shops and gifts", the section about shops Hanker doesn't run, and `/terms`'s `updated` date moves to the commit's date. The site footer doesn't change.
5. **When the key goes in.** This is Plan 8a's ruling 1 again. `/terms` and the privacy page name Etsy in this stack, so Ted runs E4 (the key) **before** he merges. The merge's deploy then turns Etsy on together with the pages that describe it.
6. **Routing two retailers.** `RoutingMetadataFetcher` takes its lookups as one object, `{ amazon, etsy }`, each nullable, and its deadlines as `{ amazon, etsy }`. Plan 8a's tests change only in how they construct it, and their assertions stay as they are. Etsy's misconfiguration warning reads `Etsy refused a listing lookup with status <N>`.
7. **Reported statuses.** For Etsy, `400`, `401` and `403` are misconfiguration: reported, and logged. `404` is `NO_METADATA`. `429`, `5xx`, a network failure and an unreadable body are logged only.

## Review Focus

1. **Lookalike and non-listing links:** none of these may be called Etsy, and none reaches Etsy's API.
   - `https://etsy.com.evil.test/listing/123`
   - `https://www.etsy.com/shop/Maker`
   - `https://www.etsy.com/search?q=listing/123`
   - `https://www.etsy.com/listing/0123`
   - a 19-digit ID

   Test: Task 1.
2. **Locale and slug forms are Etsy:**
   - `https://www.etsy.com/uk/listing/1234567890/hand-thrown-mug?ref=hp`
   - `https://etsy.com/listing/1234567890`
   - `https://www.etsy.com/en-gb/listing/1234567890`

   Test: Task 1.
3. **A listing that isn't for sale** (`sold_out`, `removed`, `draft`) is `NO_METADATA`. Hanker never prefills a dead listing as if it were live. Test: Task 2.
4. **Sparse or odd listings:** no images, `divisor: 0` or a missing `price` still prefill what they can, and never crash. Test: Task 2.
5. **An `etsy.me` link that goes astray** (to a shop page, or to a private address) never reaches Etsy's API, and the final page is never fetched. Test: Task 3.

## Stacks and order

One new stack, four layers. Each layer passes the full gate on its own:

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-8b` | 0 |
| `contracts/etsy-retailer` | 1 |
| `api/etsy-lookup` | 2, 3 |
| `web/etsy` | 4, 5 |

Task 6 is the gate, the review and the hand-off.

---

### Task 0: The plan, and the design brought up to date

**Files:**
- Create: `docs/superpowers/plans/2026-10-22-plan-8b-etsy-lookups.md` (this file)
- Modify: `docs/superpowers/specs/2026-10-22-retailer-lookups-design.md`, at the status line, the §5.3 caching paragraph, §5.7's `/terms` bullet, and §6 E2 and E3
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md`, row 8b

- [ ] **Step 1:** Make these edits in the design. Each records what happened, not new design:
  - **Status line:** E1–E3 done 2026-10-22.
  - **§5.3 "Caching":** Etsy's 6-hour and "reasonably necessary" wording (quote it), and Ted's prefill-only decision with its accepted risk, as in this plan's Global Constraints.
  - **§5.7:** the statement's verbatim wording from Etsy's terms, its placement on `/terms` under "Shops and gifts" (ruling 4), and a note that it replaces the draft.
  - **E2, E3:** marked done, with the rate limits (5 per second, 5,000 per day).
- [ ] **Step 2:** In the roadmap, row 8b becomes `[Etsy lookups](2026-10-22-plan-8b-etsy-lookups.md)`, status `Planned`, with its scope column updated to name prefill only and the `/terms` statement.
- [ ] **Step 3:** Run `pnpm format:check`. Expected: clean.
- [ ] **Step 4:** On a new stack, `gh stack init docs/plan-8b`, commit with `docs: design and plan 8b for Etsy lookups`.

### Task 1: Contracts recognize Etsy links

**Files:**
- Modify: `packages/contracts/src/retailers.ts`
- Test: `packages/contracts/src/retailers.spec.ts`

**Interfaces:**
- Produces:
  - `type Retailer = 'amazon' | 'etsy'`;
  - `etsyListingOf(url: UrlLike): { listingId: string } | null`;
  - `isEtsyShortLink(url: UrlLike): boolean`;
  - `retailerOf(url)`, which now returns `'etsy'` for a listing link or an `etsy.me` link.

- [ ] **Step 1: Write the failing tests** in `retailers.spec.ts`, in a new `describe('etsyListingOf (retailer lookups §5.1)')`, beside the Amazon ones:

```ts
it.each([
  ['https://www.etsy.com/listing/1234567890/hand-thrown-mug?ref=hp_rv', '1234567890'],
  ['https://etsy.com/listing/1234567890', '1234567890'],
  ['https://www.etsy.com/uk/listing/1234567890/hand-thrown-mug', '1234567890'],
  ['https://www.etsy.com/en-gb/listing/987654321', '987654321'],
  ['https://WWW.ETSY.COM/listing/1234567890', '1234567890'],
])('reads the listing ID of %s', (url, listingId) => {
  expect(etsyListingOf(url)).toEqual({ listingId });
});

it.each([
  'https://etsy.com.evil.test/listing/1234567890',
  'https://example.com/listing/1234567890',
  'https://www.etsy.com/shop/Maker',
  'https://www.etsy.com/search?q=listing/1234567890',
  'https://www.etsy.com/shop/Maker/listing/1234567890',
  'https://www.etsy.com/listing/0123456789',
  'https://www.etsy.com/listing/1234567890123456789', // 19 digits
  'https://m.etsy.com/listing/1234567890',
  'not a url',
])('is not an Etsy listing: %s (Review Focus 1)', (url) => {
  expect(etsyListingOf(url)).toBeNull();
});

it('knows etsy.me short links', () => {
  expect(isEtsyShortLink('https://etsy.me/3AbCdEf')).toBe(true);
  expect(isEtsyShortLink('https://etsy.me.evil.test/3AbCdEf')).toBe(false);
});

it('routes Etsy listings and short links to etsy, and leaves Amazon alone', () => {
  expect(retailerOf('https://www.etsy.com/listing/1234567890')).toBe('etsy');
  expect(retailerOf('https://etsy.me/3AbCdEf')).toBe('etsy');
  expect(retailerOf('https://www.etsy.com/shop/Maker')).toBeNull();
  expect(retailerOf('https://www.amazon.com/dp/B08FK7B2SC')).toBe('amazon');
});
```

- [ ] **Step 2:** Run `pnpm --filter @wishlist/contracts test`. Expected: FAIL, because `etsyListingOf` isn't exported.
- [ ] **Step 3: Implement** in `retailers.ts`, following the Amazon functions' shape:
  - hosts `etsy.com` and `www.etsy.com`; the short host is `etsy.me`;
  - path pattern `/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/listing\/([1-9]\d{0,17})(?:\/|$)/i`, anchored at the path's start;
  - update the `Retailer` JSDoc and `retailerOf`.
- [ ] **Step 4:** Run `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`. Expected: PASS, and the build succeeds. The package has no DOM types, so this proves no DOM types crept in.
- [ ] **Step 5:** `gh stack add contracts/etsy-retailer`, commit with `feat(contracts): recognize Etsy listing links`.

### Task 2: The Etsy adapter

**Files:**
- Create: `apps/api/src/unfurl/etsy-lookup.ts`
- Test: `apps/api/src/unfurl/etsy-lookup.spec.ts`
- Modify: `apps/api/package.json` (`"entities": "8.1.0"` in `dependencies`), and `pnpm-lock.yaml` through `pnpm install`

**Interfaces:**
- Consumes: `LookupResult` from `./amazon-lookup.js`, and `productMetadata` from `./metadata.js`.
- Produces:
  - `interface EtsyLookup { lookUp(listingId: string, signal: AbortSignal): Promise<LookupResult> }`;
  - `class EtsyOpenApiLookup implements EtsyLookup`, built as `constructor(apiKey: string, fetchFn: typeof fetch = fetch)`.

- [ ] **Step 1: Write the failing tests.** Build them like `amazon-lookup.spec.ts`: a `fetchFn` fake that records `(url, init)` and returns a canned `Response`. Use this listing:

```ts
const LISTING = {
  listing_id: 1234567890,
  state: 'active',
  title: 'Hand&#39;thrown mug &amp; saucer',
  price: { amount: 2450, divisor: 100, currency_code: 'USD' },
  images: [
    { rank: 2, url_570xN: 'https://i.etsystatic.com/2/il_570xN.jpg', url_fullxfull: 'https://i.etsystatic.com/2/il_full.jpg' },
    { rank: 1, url_570xN: 'https://i.etsystatic.com/1/il_570xN.jpg', url_fullxfull: 'https://i.etsystatic.com/1/il_full.jpg' },
  ],
};
```

  The tests, by name:
  - `asks for one listing with its images, sending the key and nothing else`: the URL is `https://api.etsy.com/v3/application/listings/1234567890?includes=Images`, the method is GET, and the headers are `x-api-key: 'ks:secret'` and `accept: application/json`. The signal is passed through.
  - `prefills the decoded title, the first image by rank and the price`: the metadata is `{ title: 'Hand'thrown mug & saucer', imageUrl: 'https://i.etsystatic.com/1/il_570xN.jpg', priceText: '$24.50' }`.
  - `falls back to the full-size image when the listing size is missing`.
  - `it.each(['inactive', 'sold_out', 'draft', 'removed', 'expired'])` `a %s listing is NO_METADATA (Review Focus 3)`.
  - `a 404 is NO_METADATA`.
  - `still prefills a listing without images or a usable price (Review Focus 4)`. Cover three cases: `images: []`, `divisor: 0`, and no `price`. The title is still prefilled, and nothing throws.
  - `a listing with nothing usable is NO_METADATA`: a title of `'   '`, no images and no price.
  - `it.each([400, 401, 403])` `a %s is a misconfiguration`: the result is `{ ok: false, reason: 'LOOKUP_UNAVAILABLE', status, misconfigured: true }`.
  - `it.each([429, 500, 503])` `a %s is an outage`: the same, with `misconfigured: false`.
  - `a network failure is an outage, and an unreadable body keeps its status`.
  - `an abort, before or during the request, is TIMEOUT`. Reuse the 8a fake, which rejects at once when the signal is already aborted.

- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run src/unfurl/etsy-lookup.spec.ts`. Expected: FAIL, because the module doesn't exist.
- [ ] **Step 3: Implement** `etsy-lookup.ts`. Mirror `BrightDataAmazonLookup`'s structure and its comments' style:
  - `MISCONFIGURED = new Set([400, 401, 403])` (ruling 7);
  - `404` → `NO_METADATA`;
  - parse the body as JSON;
  - require `state === 'active'`;
  - `decodeHTML` from `entities/decode` before `productMetadata`, with `new URL('https://www.etsy.com/listing/<id>')` as its base;
  - the price only when `amount` is a number and `divisor` is a positive integer.

  First run `pnpm --filter @wishlist/api add entities@8.1.0 --save-exact`. Check that the lockfile resolves the same `entities@8.1.0` that `htmlparser2` already uses: `git diff pnpm-lock.yaml` shows only the importer entry.
- [ ] **Step 4:** Run the spec again. Expected: PASS.
- [ ] **Step 5:** `gh stack add api/etsy-lookup`, commit with `feat(api): an Etsy Open API adapter for listing lookups`.

### Task 3: Route Etsy links, behind `ETSY_API_KEY`

**Files:**
- Modify: `apps/api/src/unfurl/routing-metadata-fetcher.ts` and its spec
- Modify: `apps/api/src/testing/fakes.ts` (`FakeEtsyLookup`, shaped like `FakeAmazonLookup`, recording `listingIds`)
- Modify: `apps/api/src/core/env.ts` (`ETSY_API_KEY: z.string().min(1).optional()`) and `env.spec.ts`
- Modify: `apps/api/src/wishlist/wishlist.module.ts`

**Interfaces:**
- Consumes:
  - `etsyListingOf` and `isEtsyShortLink` (Task 1);
  - `EtsyLookup` and `EtsyOpenApiLookup` (Task 2).
- Produces: `new RoutingMetadataFetcher(pages, links, lookups: { amazon: AmazonLookup | null; etsy: EtsyLookup | null }, reporter, deadlines = { amazon: AMAZON_DEADLINE_MS, etsy: ETSY_DEADLINE_MS })`, plus the exported `ETSY_DEADLINE_MS = 5_000`.

- [ ] **Step 1: Write the failing tests.** First move the existing 8a tests to the new constructor, with `etsy: null`, and change nothing else in them. Then add these, beside them:
  - `sends Etsy links to the page fetch while the key is unset (dark)`.
  - `looks up an Etsy listing by its ID alone`: `FakeEtsyLookup.listingIds` is `['1234567890']`, and the page fetch isn't called.
  - `follows an etsy.me link to its listing, then looks it up`. Use the same `links.resolve` fake as the Amazon short-link test, landing on `https://www.etsy.com/listing/1234567890/mug?ref=share`.
  - `never looks up an etsy.me link that went astray (Review Focus 5)`. A landing on `https://www.etsy.com/shop/Maker` is `NO_METADATA`, and a resolve failure of `DISALLOWED_ADDRESS` keeps that reason. In both cases the lookup is never called.
  - `reports a refused Etsy key without the link or the ID`: `captureWarning` gets `Etsy refused a listing lookup with status 403`. Check that neither the URL nor `1234567890` appears in any warning or log.
  - `only logs an Etsy outage, with provider=etsy`: `unfurl LOOKUP_UNAVAILABLE host=www.etsy.com provider=etsy status=429`.
  - `gives an Etsy lookup its own 5-second deadline`. With `deadlines: { amazon: 30_000, etsy: 20 }`, a hanging Etsy lookup is `TIMEOUT` within the test's timer budget.
  - `env.spec.ts`: `ETSY_API_KEY` is optional, and an empty string is rejected.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run src/unfurl src/core`. Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement.**
  - In `fetch`, find the retailer route first. A route is the provider, the ID (or a short link to follow with its `stopAt`), the lookup and the deadline.
  - Then run Plan 8a's existing flow with that route.
  - Name the provider in the log line and in the warning, using a two-entry message table rather than a branch per field.
  - Keep the `result.ok === true` comparison and its comment (Vercel's non-strict check).
  - In `wishlist.module.ts`, build `etsy: env.ETSY_API_KEY ? new EtsyOpenApiLookup(env.ETSY_API_KEY) : null`, and update the factory's comment.
- [ ] **Step 4:** Run `pnpm --filter @wishlist/api test`. Expected: PASS, with all 8a routing tests still green.
- [ ] **Step 5: Non-strict check.** Vercel's builder type-checks without `strictNullChecks`, where `if (result.ok)` doesn't narrow. Run `pnpm --filter @wishlist/api exec tsc --noEmit -p tsconfig.json --strictNullChecks false`. Expected: 0 errors. CI's `build-api` job is the final word.
- [ ] **Step 6:** Commit with `feat(api): route Etsy listing links to the Open API when its key is set`.

### Task 4: Web copy, `/terms` statement and privacy page

**Files:**
- Modify: `apps/web/src/lib/messages.ts` and `messages.spec.ts`
- Modify: `apps/web/src/app/terms/page.tsx` (the statement, and `updated` set to the date of the commit)
- Modify: `apps/web/src/app/privacy/page.tsx` (both sentences, and `updated` set to the date of the commit)
- Test: `e2e/tests/local/add-item.spec.ts`, `e2e/tests/local/legal.spec.ts`

**Interfaces:**
- Consumes: `retailerOf` returning `'etsy'` (Task 1).
- Produces: `prefillMessage` names the shop for both retailers.

- [ ] **Step 1: Write the failing tests.**
  - `messages.spec.ts`: `names Etsy when its lookup couldn’t answer (retailer lookups §5.4)`. With `https://www.etsy.com/listing/1234567890`, the message is the Etsy copy. The existing Amazon test stays.
  - `add-item.spec.ts`: `an Etsy link reads like any shop, and an unavailable lookup names Etsy`. Route the unfurl to answer `{ failureReason: 'LOOKUP_UNAVAILABLE' }` after a short delay. Check that the status says `Reading the page…`, that no `Skip, I’ll type them` button exists, and then that the Etsy copy appears with the link kept.
  - `legal.spec.ts`:
    - the privacy page contains `Etsy looks up Etsy listing links`;
    - `/terms` contains the statement verbatim.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/web test`, and `pnpm test:e2e -- add-item legal`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Replace `AMAZON_UNAVAILABLE` with a retailer-name map, `{ amazon: 'Amazon', etsy: 'Etsy' }`, used inside the sentence. The Amazon copy doesn't change.
  - On `/terms`, add the statement as a second `<p>` under "Shops and gifts".
  - Update the two privacy sentences as in the copy table.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** `gh stack add web/etsy`, commit with `feat(web): name Etsy when its lookup can't answer; Etsy's statement on /terms; privacy page`.

### Task 5: Spec, AGENTS.md and runbooks

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`:
  - the header's "Amended by" (Plan 8b);
  - §6.8, where the "Retailer lookups" bullet gains Etsy;
  - D65, which becomes present tense;
  - a new **D69**.
- Modify: `AGENTS.md`, the "Retailer lookups" bullet.
- Modify: `docs/deployment.md`:
  - an `ETSY_API_KEY` row;
  - a "Turning on Etsy lookups" section: E4's command verbatim from the design, then the redeploy, then V1 for Etsy.
- Modify: `docs/operations.md`, two rows in "When something breaks":
  - the Etsy warning;
  - Etsy `429`s against the 5,000-a-day limit.

- [ ] **Step 1:** Write D69: "Etsy's details are used once, to prefill the add form. A saved item is the owner's own entry and is never refreshed from Etsy (Ted, 2026-10-22, after Etsy's terms limited displayed listing content to 6 hours old)." In its alternatives column: "Refreshing Etsy items every 6 hours; not building Etsy lookups".
- [ ] **Step 2:** In AGENTS.md, extend the bullet. Etsy listing links go to Etsy's Open API through the `EtsyLookup` port, sending only the listing ID, and unset `ETSY_API_KEY` means today's page fetch. Add the rule: "Never store, cache or refresh Etsy data beyond the one prefill (D69)."
- [ ] **Step 3:** In deployment.md, the V1 step uses one listing link with a slug and `?ref=`, one `etsy.me` link (from Etsy's Share button), and a link from another shop.
- [ ] **Step 4:** Run `pnpm format:check`. Expected: clean. Amend this into the `web/etsy` layer's commit, or add a `docs:` commit on that layer, as 8a did.

### Task 6: Gate, review, hand-off

- [ ] **Step 1: Full gate,** on the top layer:
  - `pnpm format:check`
  - `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
  - `pnpm test:integration`
  - `pnpm test:e2e`

  Expected: all green. Then `gh stack rebase --upstack` if any lower layer changed.
- [ ] **Step 2:** One fresh whole-branch review on the most capable model, given this plan's Review Focus. Run one fix pass for Critical and Important findings, each RED→GREEN. Ledger the minors.
- [ ] **Step 3: Stop and ask Ted** before the first `gh stack submit --open` of this stack. Then set each PR's Conventional Commit title and body.
- [ ] **Step 4: Hand-off to Ted:**
  1. E4's `vercel env add` **before** merging (ruling 5). Skip E4's redeploy, because the merge's deploy picks the key up.
  2. Merge with `gh stack merge <top> --squash`.
  3. V1.

  Then read the API's runtime logs within the hour: no `LOOKUP_UNAVAILABLE … provider=etsy`, and no Sentry warning. Roadmap 8b → Done in a follow-up PR.
