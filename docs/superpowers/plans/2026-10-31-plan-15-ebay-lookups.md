# Plan 15 — eBay Lookups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pasted `ebay.com` item link fills in its title, photo and price from eBay's Browse API, and never shows an auction's live bid as the price.

**Architecture:**

- **Contracts:** `retailers.ts` learns `ebay.com/itm/<number>` links and their `?var=` option number, and `retailerOf()` can return `'ebay'`.
- **API:** `RoutingMetadataFetcher` gains a third lookup, an `EbayLookup` port whose adapter gets a token, calls `get_item_by_legacy_id`, and falls through to `get_items_by_item_group` when a listing has options and the link names none. It has its own 5-second deadline. Every other link, and every eBay link while either key is unset, keeps today's path.
- **Web:** eBay links keep the plain "Reading the page…" state. When the lookup can't answer, the message names eBay. `/privacy` names eBay.

**Tech Stack:** NestJS 12, Zod 4, Vitest, Playwright, Next.js, platform `fetch`. No new dependency.

**Spec:** [`docs/superpowers/specs/2026-10-31-ebay-lookups-design.md`](../specs/2026-10-31-ebay-lookups-design.md), approved by Ted on 2026-10-31. It builds on Plans 8a and 8b as shipped. Section numbers below (§) are the eBay design's unless a retailer-lookups design is named.

## Global Constraints

**Carried over:** everything in [AGENTS.md](../../../AGENTS.md) and Plan 8b's Global Constraints still applies.

- ESM, with `.js` relative imports in `api` and `contracts`, and `import type` for types.
- Exact version pins, an explicit `@Inject(…)` on every constructor parameter, unit tests never touch the network or Docker, behavior changes written test-first.
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it.
- Unfurl's contract is unchanged: always `200`, never throws, and a failure carries `failureReason`.

**Privacy:** eBay receives the item number, and the option number when the link has one, and nothing else of the pasted link. Logs carry the host, the reason, and, for `LOOKUP_UNAVAILABLE`, `provider=ebay status=<code>`. Logs and error reports never carry a URL, an item number, an option number, a token, `EBAY_CLIENT_ID` or `EBAY_CLIENT_SECRET`.

**Prefill only (Etsy's D69, kept here).** eBay is called once, when the owner pastes the link. No code in this plan stores, caches or refreshes eBay data, and none passes on eBay's description.

**Values fixed by the design and the spike (2026-10-31):**

| Thing | Value |
|---|---|
| eBay hosts | `ebay.com`, `www.ebay.com`. Other eBay countries and `ebay.us` keep the page fetch |
| Item path | `/itm/<number>` or `/itm/<slug>/<number>`; the number is `[1-9]\d{8,14}` |
| Option number | the `var` query parameter, `[1-9]\d{5,14}`, exactly one occurrence; otherwise ignored |
| Token | `POST https://api.ebay.com/identity/v1/oauth2/token`, `Authorization: Basic base64(id:secret)`, form body `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`; fetched for every lookup, not cached |
| Item | `GET https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=<n>[&legacy_variation_id=<v>]` |
| Group | `GET https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group?item_group_id=<n>` |
| Headers (both) | `Authorization: Bearer <token>`, `X-EBAY-C-MARKETPLACE-ID: EBAY_US` |
| Deadline | `EBAY_DEADLINE_MS = 5_000`, covering the token and every call after it |
| Fields | `title`; `image.imageUrl`; `price.value` (a string such as `"230.00"`) and `price.currency` |
| Ignored | `warnings` (the spike saw `11510` about shipping), `shortDescription`, and everything else |
| Env variables | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, both optional; eBay is on only when **both** are set |

## Rulings this plan makes on gaps in the design

1. **A lookup reference is one string.** `RoutingMetadataFetcher` passes each retailer's lookup a single `id` string. For eBay it is `"<itemNumber>"` or `"<itemNumber>:<optionNumber>"`, built and parsed by two helpers exported from `ebay-lookup.ts` (`ebayRef`, `parseEbayRef`). This keeps the router generic; the alternative, a per-retailer call shape, touches Amazon's and Etsy's code for no gain.
2. **A stale `?var=`.** The option number comes from the owner's link, so a `400` or `404` from the item call on a request that carried one is not our configuration's fault. The adapter then tries the group lookup, as for a link with none, and only a failure there is reported. (The design says a `400` other than `11006` is reported; this narrows it for the one case the owner controls.)
3. **An ended listing.** The spike saw only the `404`/`11003` answer for a number that doesn't exist. A `200` whose first `estimatedAvailabilities` entry has `estimatedAvailabilityStatus` of `OUT_OF_STOCK` is also `NO_METADATA`. Prerequisite P2 checks what eBay says for a real ended listing and may change this ruling.
4. **A group's prices are equal** when every item has a `price.value` and `price.currency`, the pairs are identical, and every item's `buyingOptions` contains `FIXED_PRICE` and not `AUCTION`.
5. **Description is dropped on the eBay host too.** `isEtsyHost` in `routing-metadata-fetcher.ts` becomes `dropsDescription(url)`, true for Etsy hosts and for `ebay.com`/`www.ebay.com`, so even the page-fetch path (keys unset, or a non-item eBay page) passes none on.
6. **Only the Amazon waiting panel exists.** `add-item.tsx` shows it only when `retailer === 'amazon'`, so eBay needs no web change beyond its name; Task 4's e2e pins that.

## Review Focus

1. **Lookalike and non-item links** are not eBay and never reach eBay's API: `https://ebay.com.evil.test/itm/366025273219`, `https://www.ebay.co.uk/itm/366025273219`, `https://www.ebay.com/sch/i.html?_nkw=itm/366025273219`, `https://www.ebay.com/itm/0366025273219`, a 16-digit number. Test: Task 1.
2. **Link shapes are eBay and send only numbers:** a slug, tracking parameters, a valid `?var=`, and an invalid or repeated `?var=` (ignored, not an error). Test: Tasks 1 and 3.
3. **No wrong price:** an auction's live bid, a mixed auction, and a group with different prices all leave the price blank; a fixed price and a group with one price keep it. Test: Task 2.
4. **Odd answers:** a stale `?var=`, a token refused, an unreadable body, an ended listing, a group with no items. None crashes, and only real misconfiguration is reported. Test: Task 2.
5. **eBay never leaks description or runs half-on:** with only one of the two keys set, or on a non-item eBay page, links take the page fetch, and no description comes back. Test: Task 3.

## Prerequisites (Ted, before Task 2)

- **P1. EB3:** read eBay's API licence (design §6) and tell Claude what it says on storage, display, attribution and call limits. Task 4 adds any required wording; if it forbids even a one-time prefill, stop and re-plan.
- **P2. Ended listing:** find an ended eBay item (search with "Sold items"), then run `node provider-spike.mjs ebay:<number>` and share the output. Task 2's ended-listing test follows what eBay answers (ruling 3).

## Stacks and order

One new stack, four layers. Each layer passes the full gate on its own:

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-15` | 0 |
| `contracts/ebay-retailer` | 1 |
| `api/ebay-lookup` | 2, 3 |
| `web/ebay` | 4, 5 |

Task 6 is the gate, the review and the hand-off. The first `gh stack submit` needs Ted's approval (AGENTS.md).

---

### Task 0: The plan, and the roadmap

**Files:**
- Create: `docs/superpowers/plans/2026-10-31-plan-15-ebay-lookups.md` (this file)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (new row 15, after row 14)

- [ ] **Step 1:** Add roadmap row 15: `[eBay lookups](2026-10-31-plan-15-ebay-lookups.md)`, design `2026-10-31-ebay-lookups-design.md`, scope "eBay Browse API behind an `EbayLookup` port; fixed prices only, never an auction bid; item groups for links without `?var=`; prefill only", status `Planned`.
- [ ] **Step 2:** Run `pnpm format:check`. Expected: clean.
- [ ] **Step 3:** `gh stack init docs/plan-15`; commit `docs: design and plan 15 for eBay lookups` (the design file is already written; include it).

### Task 1: Contracts recognize eBay links, and the web names eBay

**Files:**
- Modify: `packages/contracts/src/retailers.ts`, `packages/contracts/src/retailers.spec.ts`
- Modify: `apps/web/src/lib/messages.ts` (`RETAILER_NAMES`), `apps/web/src/lib/messages.spec.ts`

**Interfaces:**
- Produces: `type Retailer = 'amazon' | 'etsy' | 'ebay'`; `ebayItemOf(url: UrlLike): { itemId: string; variationId?: string } | null`; `retailerOf` returns `'ebay'` for such links.

- [ ] **Step 1: Write the failing tests** in `retailers.spec.ts`:
  - `ebayItemOf` returns `{ itemId: '366025273219' }` for `https://www.ebay.com/itm/366025273219` and for `https://ebay.com/itm/366025273219?_skw=steam+deck&hash=item34b9597609%3Ag%3AuOMAAOSwLjtninPj`.
  - A slug form `https://www.ebay.com/itm/Valve-Steam-Deck-OLED/960110182451?mkcid=1` returns `{ itemId: '960110182451' }`.
  - `…/itm/226447947273?var=525635725002&itmmeta=x` returns `{ itemId: '226447947273', variationId: '525635725002' }`.
  - A `var` that is not 6–15 digits (`var=abc`, `var=123`, `var=0123456`) or repeated (`?var=525635725002&var=525635725003`) gives no `variationId`, and the item is still returned.
  - Review Focus 1's five links all give `null` from `ebayItemOf` and `retailerOf`.
  - `retailerOf('https://www.ebay.com/itm/366025273219')` is `'ebay'`; `retailerOf('https://ebay.us/abc123')` is `null`; Amazon and Etsy cases are unchanged.
  
  In `messages.spec.ts`: `prefillMessage({ response: { failureReason: 'LOOKUP_UNAVAILABLE' } }, 'https://www.ebay.com/itm/366025273219')` is `We couldn’t get the details from eBay just now. Add them below.`
- [ ] **Step 2:** Run `pnpm --filter @wishlist/contracts test` and `pnpm --filter @wishlist/web test`. Expected: FAIL.
- [ ] **Step 3:** Implement in `retailers.ts`: extend `Retailer`; add `EBAY_HOSTS`, an item-path regex (`^/itm/(?:[^/]+/)?([1-9]\d{8,14})(?:/|$)`), `ebayItemOf`, and the `retailerOf` branch. `ParsedUrl` gains `searchParams: { getAll(name: string): string[] }` (the package compiles without DOM types). `RETAILER_NAMES` gains `ebay: 'eBay'`.
- [ ] **Step 4:** Run both packages' tests and `pnpm turbo run typecheck`. Expected: PASS. (That an eBay link shows no waiting panel is pinned in Task 4's e2e: the web app has no component tests.)
- [ ] **Step 5:** Commit `feat(contracts): recognize eBay item links`; `gh stack add contracts/ebay-retailer` first.

### Task 2: The eBay adapter

**Files:**
- Create: `apps/api/src/unfurl/ebay-lookup.ts`, `apps/api/src/unfurl/ebay-lookup.spec.ts`
- Modify: `apps/api/src/testing/fakes.ts` (add `FakeEbayLookup`)

**Interfaces:**
- Consumes: `LookupResult` (`lookup-result.ts`), `productMetadata` (`metadata.ts`).
- Produces:
  - `interface EbayLookup { lookUp(ref: string, signal: AbortSignal): Promise<LookupResult> }`
  - `class EbayBrowseLookup implements EbayLookup { constructor(clientId: string, clientSecret: string, fetchFn?: typeof fetch) }`
  - `ebayRef(item: { itemId: string; variationId?: string }): string` and `parseEbayRef(ref: string): { itemId: string; variationId?: string }`
  - `class FakeEbayLookup implements EbayLookup` with `next: LookupResult` and `refs: string[]`, shaped like `FakeEtsyLookup`.

- [ ] **Step 1: Write the failing tests** in `ebay-lookup.spec.ts`, with a stub `fetch` that routes by URL (token, item, group) and records calls, as `etsy-lookup.spec.ts` does:
  - `sends the token request with Basic auth and the api_scope, then the item request with a Bearer token and the US marketplace header`: assert both calls and that nothing else of the pasted link is sent.
  - `a fixed-price item prefills the title, the image and "$230.00"`.
  - `an item with options and a variation number sends legacy_variation_id`.
  - `an auction gets no price, whatever price says` (`buyingOptions: ['AUCTION']`, `price` 567.00 equal to `currentBidPrice`): result has title and image, no `priceText`.
  - `a mixed auction (AUCTION and FIXED_PRICE) gets no price`.
  - `an item with BEST_OFFER and FIXED_PRICE keeps its price`.
  - `a 400 with errorId 11006 and no variation falls through to the group lookup`: asserts the group URL is called with the item number.
  - `a group with one price keeps it; a group with two prices (287.99 and 289.99 USD) has none; a group containing an AUCTION item has none`; the title and image come from the first item, and the image from the first item that has one.
  - `a stale variation (item call 400 or 404 with a variation) falls through to the group lookup` (ruling 2); `a 400 from the group call is reported as misconfigured`.
  - `a 404 (errorId 11003) is NO_METADATA`; `an OUT_OF_STOCK item is NO_METADATA` (ruling 3, adjust after P2); `a group with no items is NO_METADATA`; `a 200 with none of the three fields is NO_METADATA`.
  - `a refused token (401) or a refused item (401, 403) is LOOKUP_UNAVAILABLE with misconfigured true`; `429 and 5xx are LOOKUP_UNAVAILABLE with misconfigured false`.
  - `a network failure is an outage, an unreadable body keeps its status, and an abort before or during any call is TIMEOUT`.
  - `never passes on a description`.
  - `ebayRef and parseEbayRef round-trip with and without a variation`.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api test -- ebay-lookup`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `EbayBrowseLookup.lookUp`. Follow `etsy-lookup.ts`'s shape: abort check first, a `try` around each call mapping a thrown error to `TIMEOUT` when the signal is aborted, else `LOOKUP_UNAVAILABLE` (keeping `status` when a response was received). Price per §5.3 and ruling 4; the price string goes to `productMetadata` as `amount: price.value`. The misconfigured set is `{401, 403}` for the token and item calls, and `{400, 401, 403}` for the group call.
- [ ] **Step 4:** Run the spec and `pnpm --filter @wishlist/api typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): add the eBay lookup adapter`; `gh stack add api/ebay-lookup`.

### Task 3: Route eBay links, behind both keys

**Files:**
- Modify: `apps/api/src/unfurl/routing-metadata-fetcher.ts`, `apps/api/src/unfurl/routing-metadata-fetcher.spec.ts`
- Modify: `apps/api/src/core/env.ts`, `apps/api/src/core/env.spec.ts`
- Modify: `apps/api/src/wishlist/wishlist.module.ts`

**Interfaces:**
- Consumes: `EbayLookup`, `ebayRef` (Task 2), `ebayItemOf` (Task 1), `FakeEbayLookup`.
- Produces: `RetailerLookups` gains `ebay: EbayLookup | null`; `EBAY_DEADLINE_MS = 5_000`; the `deadlines` record gains `ebay`.

- [ ] **Step 1: Write the failing tests** in `routing-metadata-fetcher.spec.ts` (constructors change only by the new `ebay` key):
  - `an eBay item link goes to the eBay lookup with the item number only` (asserts `FakeEbayLookup.refs` equals `['366025273219']` for a link with a slug and tracking parameters).
  - `a link with ?var= sends item and option numbers` (`['226447947273:525635725002']`).
  - `with no eBay lookup, the link takes the page fetch`; `a non-item eBay page, another eBay country and ebay.us take the page fetch` (the lookup is never asked).
  - `eBay never returns a description`, on both the lookup path and the page-fetch path.
  - `a misconfigured eBay lookup reports "eBay refused a lookup with status 403" without a URL, number or key, and logs provider=ebay`.
  
  In `env.spec.ts`: both variables optional; mirror the existing pair's tests if `env.ts` validates a pair.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api test`. Expected: FAIL.
- [ ] **Step 3:** Implement. `RETAILERS.ebay`: `idOf` builds `ebayRef(ebayItemOf(url))` or `null`; `isShortLink: () => false`; `refused: 'eBay refused a lookup'`. Replace `isEtsyHost` with `dropsDescription` (ruling 5). In `wishlist.module.ts`, pass `ebay: clientId && clientSecret ? new EbayBrowseLookup(clientId, clientSecret) : null`. Add the two optional variables to `env.ts` with doc comments saying eBay is off unless both are set.
- [ ] **Step 4:** Run `pnpm --filter @wishlist/api test`, `pnpm --filter @wishlist/api typecheck` and `pnpm --filter @wishlist/api lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): route eBay item links through the Browse API`.

### Task 4: Privacy page, terms, and the add box

**Files:**
- Modify: `apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx` (only if P1 requires wording)
- Modify: `e2e/tests/local/legal.spec.ts`, `e2e/tests/local/add-item.spec.ts`

- [ ] **Step 1: Write the failing tests.** In `legal.spec.ts`, `/privacy` contains the two sentences below. In `add-item.spec.ts`, beside the Etsy test: an eBay link with a stubbed `LOOKUP_UNAVAILABLE` shows "Reading the page…", no "Skip" button, then `We couldn’t get the details from eBay just now. Add them below.`, and keeps the link in the field.
- [ ] **Step 2:** Run `pnpm test:e2e` (Docker) for those specs. Expected: FAIL.
- [ ] **Step 3:** Edit the privacy page (curly apostrophes; draft wording for Ted's check):
  - "If you make a list": `For Amazon, Etsy and eBay product links, Hanker asks Bright Data (Amazon), Etsy or eBay for the details instead, and sends only the product’s ID (and, for eBay, the option’s ID when the link names one).`
  - "Who else handles your information": `eBay looks up eBay item links. It sees the item’s ID, and the option’s when the link names one, and nothing about who pasted it.`
  
  If P1 requires attribution or other wording, add it verbatim to `/terms` "Shops and gifts" and move that page's `updated` date.
- [ ] **Step 4:** Re-run the e2e specs. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): name eBay on the privacy page`; `gh stack add web/ebay`.

### Task 5: Spec, AGENTS.md and runbooks

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§6.8 paragraph; decision rows D107–D111 after D106)
- Modify: `docs/superpowers/specs/2026-10-22-retailer-lookups-design.md` (a note pointing to the eBay design in §2's "Any other retailer" and §5.1)
- Modify: `AGENTS.md`, `docs/deployment.md`, `docs/operations.md`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-31-ebay-lookups-design.md` (status "Approved", and the P2 finding if it changed ruling 3)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (row 15 → `Done` only at merge, in the hand-off PR)

- [ ] **Step 1:** Spec §6.8 gains an eBay sentence (Browse API, 5 s, item and option numbers only, price rules, prefill only). Decisions: D107 eBay through the Browse API (first-party, D34 not narrowed); D108 the price rules; D109 item groups for links without `?var=`; D110 `ebay.com` only, no short links; D111 no eBay description.
- [ ] **Step 2:** AGENTS.md: extend the "Retailer lookups" bullet (eBay goes through the `EbayLookup` port, sends only the item and option numbers, unset keys mean today's page fetch, never log the number or keys, never store or refresh eBay data) and the "Tag suggestions" bullet's "never anything from Etsy beyond the title" to cover eBay.
- [ ] **Step 3:** `docs/deployment.md`: a "Turning on eBay lookups" section modelled on the Etsy one (store both keys with hidden prompts and `pnpm vercel env add … production --sensitive --project wishlist-api --scope shockolate`; deploy; V1; how to turn it off and rotate), plus the two variables in the secrets table. `docs/operations.md`: the two secrets in the rotation table, a Sentry-warning row (`eBay refused a lookup with status …`) and a `unfurl LOOKUP_UNAVAILABLE … provider=ebay` row. `README.md`: eBay in the diagram and the services table (title, price and photo for eBay links; fallback: the owner types them).
- [ ] **Step 4:** Run `pnpm format:check` and `node scripts/workflow-policy.test.mjs`. Expected: clean, pass.
- [ ] **Step 5:** Commit `docs: describe eBay lookups`.

### Task 6: Gate, review, hand-off

- [ ] **Step 1:** On each layer, run what CI runs: `pnpm format:check`; `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`; `pnpm test:integration`; `pnpm test:e2e`. Read the output; expected: all green.
- [ ] **Step 2:** Review the whole stack against the design, section by section, with a fresh reviewer on the most capable model. Fix findings with a test first.
- [ ] **Step 3:** Ask Ted before the first `gh stack submit --open`. Give each PR a Conventional Commit title and a summary body ending with the Claude Code line.
- [ ] **Step 4 (Ted):** EB4, **before merging** (Plan 8a ruling 1: the privacy page names eBay in this stack, so the merge's deploy turns eBay on together with it): store `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` in production with hidden prompts.
- [ ] **Step 5 (Ted):** V1 in production on your own list, per design §6: a fixed-price item (filled), a live auction (price blank), a listing with options and `?var=` (that option's photo and price), the same listing without `?var=` (title and photo, price blank when options differ), an ended listing (a sentence asking for the details), and, if one can be found, an auction that also offers Buy It Now (blank by this release). Report anything off; the failures all degrade to typing.
