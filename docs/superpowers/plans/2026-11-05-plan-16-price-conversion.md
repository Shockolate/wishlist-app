# Plan 16 — Price Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a list's new **Convert prices to dollars** setting is on (the default), an unfurled price in another currency prefills the add form in US dollars. A sentence above the form names the original price.

**Architecture:**

- **Contracts:** an optional `convertPrices` on the list settings schemas, and an optional `convertedFrom` on `UnfurlResponse`.
- **API:** the metadata extractors keep the amount and currency they already read, as an internal `price`. A new `ExchangeRates` port, backed by Frankfurter's whole USD table and cached in memory, gives `UnfurlService` the rate. The service converts the price when the owner's `wishlists.convert_prices` is on, then strips `price` before answering.
- **Web:** a `ConvertPricesCard` on `/settings`, a sentence in `prefillMessage`, and a new Frankfurter line on `/privacy`.
- **Docs:** README, AGENTS.md, the main spec, operations.md, deployment.md and the roadmap describe the feature.

**Tech Stack:** NestJS 12, Drizzle, Zod 4, Vitest, Playwright, Next.js, platform `fetch`. No new dependency.

**Spec:** [`docs/superpowers/specs/2026-11-05-price-conversion-design.md`](../specs/2026-11-05-price-conversion-design.md), approved by Ted on 2026-11-05. Section numbers below (§) refer to it.

## Global Constraints

**Carried over:** everything in [AGENTS.md](../../../AGENTS.md) applies:
- ESM, with `.js` relative imports in `api` and `contracts`, and `import type` for types.
- An explicit `@Inject(…)` on every constructor parameter.
- Exact version pins.
- Unit tests never touch the network or Docker.
- Behavior changes are written test-first.
- Every commit ends with a `Co-Authored-By:` trailer naming the model that wrote it.

**Unfurl's contract:** it always answers `200` and never throws, and a failure carries `failureReason`. Conversion can only replace `priceText` and add `convertedFrom`. It never changes any other field and never turns a success into a failure.

**Privacy (§5.3):**
- Frankfurter only ever receives `GET https://api.frankfurter.dev/v2/rates?base=usd`, with no item, amount, currency, cookie or user data.
- Logs carry only `fx UNAVAILABLE status=<n>`, `fx TIMEOUT` or `fx BAD_ANSWER`.
- Logs and reports never carry an amount, a currency code, a URL or a title.

**Values fixed by the design:**

| Thing | Value |
|---|---|
| Rates URL | `https://api.frankfurter.dev/v2/rates?base=usd` |
| Answer | a JSON array of `{ date, base: "USD", quote, rate }`. `rate` is units of `quote` per 1 USD, so dollars = amount ÷ rate |
| Timeout | `RATES_TIMEOUT_MS = 2_000` |
| Fresh | a table younger than `RATES_FRESH_MS = 6 * 3_600_000` is used without refreshing |
| Stale | if a refresh fails, a table up to `RATES_STALE_MS = 48 * 3_600_000` old is still used |
| Request headers | `user-agent: USER_AGENT` (from `page-fetcher.ts`), `accept: application/json` |
| Column | `wishlists.convert_prices boolean DEFAULT true NOT NULL`, migration `0008_convert_prices` |
| Rounding | to cents: `Math.round((amount / rate) * 100) / 100`, formatted with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` |
| Price cap | 50 characters (`PRICE_MAX`): a converted text over it isn't used |
| Form sentence | `Filled in from ${shop}. We converted ${convertedFrom} to dollars at today’s rate. Check it, then add it.` |
| Decisions | D114, D115, D116 (§5.8). D113 is held by the Node 26 upgrade |

**Owners are US-only (Ted, 2026-11-05).** Every non-USD price is converted, and there's no currency picker.

## Rulings this plan makes on gaps in the design

1. **`price` travels through the existing fetchers** in a widened internal type: `UnfurlResult = UnfurlResponse & { price?: Price }`. `MetadataFetcher.fetch` returns it, and `PageMetadata` already flows through as is, so `RoutingMetadataFetcher` needs no change beyond its return type. `UnfurlService` is the only place that removes `price`. The controller doesn't serialize through a schema, so a `price` left in would reach the browser. Task 5 pins that it doesn't.
2. **`formatPrice` stays as it is** for its callers, and `readPrice` sits beside it, returning both the display text and the structured price. `price` is set only when the display text was Intl-formatted, that is, for a known code and a plain decimal amount.
3. **The adapter uses the `Clock` port** (`CLOCK`, global in `CoreModule`), so its tests drive the cache with `FakeClock`.
4. **No list row** (the account was deleted after the session check) means don't convert, as `readSuggestContext` treats it.
5. **The card's copy and saved messages** are fixed by §5.1. The heading `Prices` is an `h2`, as `SuggestTagsCard`'s is.

## Review Focus

1. **`price` leaking into the HTTP answer**, on every path: a page fetch, an Etsy, eBay or Amazon lookup, and the setting off. The browser should never see `price`. Test: Task 5.
2. **An amount that isn't a plain decimal, or an unknown code** (`"1,299.00"`, `"from 20"`, `"ABC"`, a lowercase `"try"` from meta tags). These are never converted, and when the code is known, the display text is what it is today. Test: Task 3.
3. **Frankfurter answers something odd:** HTTP `500`, a JSON object instead of an array, a `rate` of `0` or a negative one, a quote that isn't three letters, or a hang past 2 seconds. The add still succeeds in the source currency, and only a malformed body reaches Sentry. Test: Task 4.
4. **Concurrent cold pastes** make one request to Frankfurter, not one each. After a failed refresh, the next paste retries instead of caching the failure forever. Test: Task 4.
5. **Already in dollars, or in an odd case:** `USD` is untouched, and a tiny amount that rounds to `$0.00` isn't converted. Test: Task 5.

## Stacks and order

One new stack, five layers. Each layer passes the full gate on its own:

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-16` | 0 |
| `contracts/convert-prices` | 1 |
| `api/convert-prices` | 2, 3, 4, 5 |
| `web/convert-prices` | 6 |
| `docs/convert-prices` | 7 |

Task 8 is the gate, the review and the hand-off. The first `gh stack submit` needs Ted's approval (AGENTS.md).

---

### Task 0: Commit the design and this plan, and amend the main spec

**Files:**
- Add: `docs/superpowers/specs/2026-11-05-price-conversion-design.md`, `docs/superpowers/plans/2026-11-05-plan-16-price-conversion.md`
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§5 list settings and the unfurl response; §6.8; decision log after D112)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (row 16)

- [ ] **Step 1: Amend the main spec.**
  - §5: the list settings gain `convertPrices` (default on), next to `suggestTags`, and the unfurl response gains `convertedFrom`.
  - §6.8: a **Price conversion (Plan 16)** paragraph. It converts once at prefill, when the list's setting is on. It downloads Frankfurter's whole USD table, cached 6 hours (up to 48 when stale), with a 2-second timeout. Any failure keeps the source currency. Frankfurter never receives item data.
  - Decision rows D114–D116, worded as in design §5.8, each credited "(Ted, 2026-11-05)", except D115's whole-table detail, credited "(Claude, 2026-11-05)".
- [ ] **Step 2: Add the roadmap row:** `| 16 | [Price conversion](2026-11-05-plan-16-price-conversion.md) | [design 2026-11-05](../specs/2026-11-05-price-conversion-design.md), D114–D116 | Non-USD unfurl prices prefill in dollars via Frankfurter; list setting, on by default; prefill only | In progress |`
- [ ] **Step 3: Check formatting.** Run `pnpm format:check`. Expected: no differences.
- [ ] **Step 4: Commit** with `docs: design and plan for converting prefilled prices to dollars (Plan 16)`.

### Task 1: Contracts

**Files:**
- Modify: `packages/contracts/src/wishlist.ts` (`UpdateWishlistRequestSchema`, `WishlistResponseSchema`, `WishlistSettingsResponseSchema`, `UnfurlResponseSchema`)
- Test: `packages/contracts/src/wishlist.spec.ts`

**Interfaces:**
- Produces:
  - `convertPrices?: boolean` on `UpdateWishlistRequest`, `WishlistResponse` and `WishlistSettingsResponse`. It's optional for expand/contract, and absent means on.
  - `convertedFrom?: string` on `UnfurlResponse`.

- [ ] **Step 1: Write the failing tests:**
  - `UpdateWishlistRequestSchema.parse({ convertPrices: false })` equals `{ convertPrices: false }`, so the "a setting" refine accepts it alone.
  - `UpdateWishlistRequestSchema.safeParse({}).success` is still `false`.
  - `UnfurlResponseSchema.parse({ priceText: '$899.55', convertedFrom: 'TRY 45,000.00' })` round-trips.
  - `WishlistSettingsResponseSchema.parse({ title: 'T', shareUrl: 'https://hanker.dev/s/x', convertPrices: true }).convertPrices` is `true`.
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @wishlist/contracts test`. Expected: the new tests fail.
- [ ] **Step 3: Add the fields.** Doc comments name "price conversion design §5.1/§5.5", and the refine's doc comment lists the new setting.
- [ ] **Step 4: Run the tests and see them pass.** Run `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`. Expected: everything passes.
- [ ] **Step 5: Commit** with `feat(contracts): add the convertPrices setting and convertedFrom to unfurl`.

### Task 2: The setting in the database and the settings API

**Files:**
- Modify: `apps/api/src/db/schema.ts:105` (after `suggestTags`)
- Create: `apps/api/drizzle/0008_convert_prices.sql`, plus its snapshot and journal entry, generated
- Modify: `apps/api/src/wishlist/wishlist.service.ts` (`get`, `updateSettings`)
- Test: `apps/api/test/wishlist.int-spec.ts`

**Interfaces:**
- Consumes: Task 1's `convertPrices`.
- Produces: `wishlists.convertPrices` (Drizzle column `convert_prices`), which Task 5 reads.

- [ ] **Step 1: Write the failing integration tests:**
  - A new owner's `GET /api/wishlist` has `convertPrices: true`.
  - `PATCH /api/wishlist { convertPrices: false }` answers `convertPrices: false`, and a following `GET` agrees.
  - `PATCH { suggestTags: false }` leaves `convertPrices` as it was.
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @wishlist/api test:integration -- wishlist`. Expected: the new tests fail.
- [ ] **Step 3: Add the column and generate the migration.** Add `convertPrices: boolean('convert_prices').notNull().default(true)`, then run `pnpm --filter @wishlist/api db:generate --name convert_prices`. The SQL must be exactly `ALTER TABLE "wishlists" ADD COLUMN "convert_prices" boolean DEFAULT true NOT NULL;`, as `0005` is. No view is touched.
- [ ] **Step 4: Read and write the setting** in `WishlistService.get` and `updateSettings`, next to `suggestTags`. Update the `updateSettings` doc comment.
- [ ] **Step 5: Run the tests and see them pass.** Run `pnpm --filter @wishlist/api test:integration -- wishlist` and `pnpm --filter @wishlist/api test:integration -- stats`. Expected: everything passes, and the stats views are unchanged.
- [ ] **Step 6: Commit** with `feat(api): add the convert-prices list setting`.

### Task 3: Keep the structured price

**Files:**
- Modify: `apps/api/src/unfurl/metadata.ts` (`PageMetadata`, new `Price` and `readPrice`, `extractMetadata`, `productMetadata`, `offerPrice`, `assemble`)
- Modify: `apps/api/src/unfurl/metadata-fetcher.ts` (new `UnfurlResult`; `MetadataFetcher.fetch` and `HttpMetadataFetcher.fetch` return it)
- Modify: `apps/api/src/unfurl/routing-metadata-fetcher.ts` (return types only)
- Modify: `apps/api/src/testing/fakes.ts` (`FakeMetadataFetcher.next: UnfurlResult`)
- Test: `apps/api/src/unfurl/metadata.spec.ts`, `apps/api/src/unfurl/etsy-lookup.spec.ts`, `apps/api/src/unfurl/routing-metadata-fetcher.spec.ts`

**Interfaces:**
- Produces:
  - `export interface Price { amount: string; currency: string }`. `amount` matches `/^\d+(\.\d+)?$/`, and `currency` is an uppercase code in `KNOWN_CURRENCIES`.
  - `PageMetadata.price?: Price`.
  - `export function readPrice(amount: unknown, currency: unknown): { priceText: string; price?: Price } | undefined`.
  - `formatPrice(amount, currency)` keeps its signature and returns `readPrice(...)?.priceText`.
  - `export type UnfurlResult = UnfurlResponse & { price?: Price }`, in `metadata-fetcher.ts`.
  - `MetadataFetcher.fetch(url: string): Promise<UnfurlResult>`.

- [ ] **Step 1: Write the failing tests:**
  - `readPrice('45000.00', 'TRY')` gives `{ priceText: 'TRY 45,000.00', price: { amount: '45000.00', currency: 'TRY' } }`.
  - `readPrice('24.99', 'usd')` gives `price.currency` `'USD'`.
  - `readPrice('1,299.00', 'EUR')`, `readPrice('from 20', 'EUR')` and `readPrice('24.99', 'ABC')` each return a `priceText` exactly as `formatPrice` does today, and no `price`.
  - `extractMetadata` on a page with `product:price:amount=45000` and `product:price:currency=TRY` has `price` `{ amount: '45000', currency: 'TRY' }`. The JSON-LD offer path gets the same treatment.
  - The Etsy lookup spec: a listing priced `{ amount: 4500000, divisor: 100, currency_code: 'TRY' }` yields `price` `{ amount: '45000', currency: 'TRY' }`.
  - The routing spec: an Etsy lookup's `price` survives `RoutingMetadataFetcher.fetch` while `description` is still dropped.
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @wishlist/api test -- metadata etsy-lookup routing-metadata-fetcher`. Expected: the new tests fail.
- [ ] **Step 3: Implement it.**
  - Add `readPrice` with the same branch `formatPrice` has today. `price` is set exactly where the Intl formatting succeeds.
  - Thread `price` through `assemble` as a fifth optional parameter.
  - `HttpMetadataFetcher`'s "nothing found" check stays on `title`, `imageUrl` and `priceText`.
- [ ] **Step 4: Run the tests and see them pass.** Run `pnpm --filter @wishlist/api test && pnpm --filter @wishlist/api typecheck`. Expected: everything passes, and the existing `formatPrice` tests are unchanged.
- [ ] **Step 5: Commit** with `refactor(api): keep an unfurled price's amount and currency`.

### Task 4: The `ExchangeRates` port and the Frankfurter adapter

**Files:**
- Create: `apps/api/src/unfurl/exchange-rates.ts`
- Modify: `apps/api/src/testing/fakes.ts` (`FakeExchangeRates`)
- Modify: `apps/api/src/wishlist/wishlist.module.ts` (provider)
- Modify: `apps/api/test/support/auth-app.ts` (override, expose as `rates`, clear in `reset()`)
- Test: `apps/api/src/unfurl/exchange-rates.spec.ts`

**Interfaces:**
- Consumes: `Clock` and `CLOCK` (`core/clock.ts`), `ErrorReporter` and `ERROR_REPORTER`, and `USER_AGENT` (`unfurl/page-fetcher.ts`).
- Produces:
  - `export interface ExchangeRates { usdPer(currency: string): Promise<number | null> }`. It never throws.
  - `export const EXCHANGE_RATES = Symbol('EXCHANGE_RATES')`.
  - `export class FrankfurterExchangeRates implements ExchangeRates`, with `constructor(clock: Clock, reporter: ErrorReporter, fetchFn: typeof fetch = fetch)`.
  - The exported constants `FRANKFURTER_RATES_URL`, `RATES_TIMEOUT_MS`, `RATES_FRESH_MS` and `RATES_STALE_MS`, with the values in Global Constraints.
  - `FakeExchangeRates`, with `rates: Map<string, number>`, `readonly asked: string[]`, and `usdPer` answering `rates.get(code) ?? null` and recording the code.

- [ ] **Step 1: Write the failing tests** with a stubbed `fetchFn` and `FakeClock`:
  - `asks for exactly the whole USD table`: the URL is `FRANKFURTER_RATES_URL`, and the headers carry `user-agent` and `accept: application/json`, with no other query.
  - `answers the rate for a quote`: the answer `[{date:'2026-11-05',base:'USD',quote:'TRY',rate:50.025}]` makes `usdPer('TRY')` resolve to `50.025`, and `usdPer('XYZ')` to `null`.
  - `reuses a fresh table`: two calls 5 h 59 min apart make one fetch, and a third at 6 h 01 min makes a second.
  - `keeps a stale table when a refresh fails`: after a good fetch, at 30 h a refresh answering `500` still returns `50.025`. At 48 h 01 min, with the fetch still failing, the answer is `null`.
  - `retries after a failure`: a first fetch rejects (`null`), and the next call fetches again and succeeds.
  - `shares one refresh between concurrent callers`: three `usdPer` calls issued before the fetch resolves make one fetch.
  - `gives up after 2 seconds`: a fetch that never resolves (but honors its `AbortSignal`) yields `null`.
  - `reports only a malformed answer`:
    - `{}`, `[{quote:'TRY',rate:0}]`, `[{quote:'TRY',rate:-1}]` and `[{quote:'TR',rate:1}]` each yield `null`, and each makes one `captureWarning('Frankfurter answered an unreadable rates table')`.
    - A `500`, a rejection and a timeout make no warning.
    - The logged lines are `fx BAD_ANSWER`, `fx UNAVAILABLE status=500`, `fx UNAVAILABLE` and `fx TIMEOUT`.
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @wishlist/api test -- exchange-rates`. Expected: they fail, because the module isn't found.
- [ ] **Step 3: Implement `FrankfurterExchangeRates`.**
  - Hold `{ fetchedAt: number; rates: Map<string, number> } | null` and an in-flight `Promise<void> | null`.
  - Parse the body with a Zod array of `{ quote: z.string().regex(/^[A-Z]{3}$/), rate: z.number().positive().finite() }`, ignoring other keys.
  - Use the table when it's fresh. Otherwise await the shared refresh, then use the table if it's within the stale limit.
  - Log with `new Logger('ExchangeRates')`.
- [ ] **Step 4: Wire the providers.**
  - In `WishlistModule`, add `{ provide: EXCHANGE_RATES, inject: [CLOCK, ERROR_REPORTER], useFactory: (clock, reporter) => new FrankfurterExchangeRates(clock, reporter) }`. It's one instance per app, so the cache is shared.
  - Override it in `createAuthTestApp` with `FakeExchangeRates`, and clear `rates` and `asked` in `reset()`.
- [ ] **Step 5: Run the tests and see them pass.** Run `pnpm --filter @wishlist/api test -- exchange-rates && pnpm --filter @wishlist/api typecheck`. Expected: everything passes.
- [ ] **Step 6: Commit** with `feat(api): add an ExchangeRates port backed by Frankfurter`.

### Task 5: Convert in the unfurl

**Files:**
- Create: `apps/api/src/unfurl/convert-price.ts`
- Modify: `apps/api/src/wishlist/unfurl.service.ts`
- Test: `apps/api/src/unfurl/convert-price.spec.ts`, `apps/api/test/unfurl.int-spec.ts`

**Interfaces:**
- Consumes:
  - Task 2's `wishlists.convertPrices`.
  - Task 3's `Price` and `UnfurlResult`.
  - Task 4's `ExchangeRates`, `EXCHANGE_RATES` and `FakeExchangeRates`.
- Produces:
  - `export function convertToUsd(price: Price, usdPer: number): string | null`. It returns the USD display text, or `null` when the result isn't a finite amount above `0` after rounding, or is longer than 50 characters.
  - `UnfurlService.unfurl(userId: string, url: string): Promise<UnfurlResponse>`. Its signature doesn't change, and it never returns `price`.

- [ ] **Step 1: Write the failing unit tests for `convertToUsd`:**
  - `({ amount: '45000.00', currency: 'TRY' }, 50.025)` gives `'$899.55'`.
  - `({ amount: '12000', currency: 'JPY' }, 153.2)` gives `'$78.33'`.
  - `({ amount: '0.001', currency: 'EUR' }, 0.9)` gives `null`.
  - `({ amount: '1', currency: 'EUR' }, Infinity)` gives `null`.
- [ ] **Step 2: Write the failing integration tests**, using the test app's `unfurl` and `rates` fakes and a verified owner:
  - `converts a foreign price when the setting is on`: `unfurl.next = { title: 'Walnut table', priceText: 'TRY 45,000.00', price: { amount: '45000.00', currency: 'TRY' } }` and `rates.rates.set('TRY', 50.025)`. The answer body is exactly `{ title: 'Walnut table', priceText: '$899.55', convertedFrom: 'TRY 45,000.00' }`, with no `price` key.
  - `leaves it alone when the setting is off`: after `PATCH { convertPrices: false }`, the body is `{ title: 'Walnut table', priceText: 'TRY 45,000.00' }`, `rates.asked` is empty, and there's no `price` key.
  - `leaves it alone when no rate is known`: with `rates` empty, the body has `priceText: 'TRY 45,000.00'`, no `convertedFrom` and no `price`.
  - `never asks for USD`: with `price: { amount: '24.99', currency: 'USD' }`, `rates.asked` is empty and there's no `price` key.
  - `a failure is untouched`: `unfurl.next = { failureReason: 'BLOCKED_BY_SITE' }` gives exactly that.
- [ ] **Step 3: Run the tests and see them fail.** Run `pnpm --filter @wishlist/api test -- convert-price` and `pnpm --filter @wishlist/api test:integration -- unfurl`. Expected: the new tests fail.
- [ ] **Step 4: Implement it.**
  - Write `convertToUsd` with the rounding and formatting in Global Constraints.
  - In `UnfurlService`, inject `DB` and `EXCHANGE_RATES`. After `fetcher.fetch`, split off `price` (`const { price, ...response } = result`). Follow §5.4 steps 1–6. The setting is read with one `select({ convertPrices: wishlists.convertPrices }).from(wishlists).where(eq(wishlists.ownerId, userId))`, and no row means don't convert.
  - Update the class doc comment to name §5.4.
- [ ] **Step 5: Run the tests and see them pass.** Run `pnpm --filter @wishlist/api test && pnpm --filter @wishlist/api test:integration`. Expected: everything passes.
- [ ] **Step 6: Commit** with `feat(api): convert unfurled prices to dollars when the list asks for it`.

### Task 6: Web

**Files:**
- Create: `apps/web/src/components/account/convert-prices-card.tsx`
- Modify: `apps/web/src/app/(account)/settings/page.tsx` (render the card after `SuggestTagsCard`)
- Modify: `apps/web/src/lib/messages.ts` (`prefillMessage`)
- Modify: `apps/web/src/app/privacy/page.tsx` (the Frankfurter line, the unfurl sentence and `updated="2026-11-05"`, or the release date)
- Test: `apps/web/src/lib/messages.spec.ts`, `e2e/tests/local/settings.spec.ts`, `e2e/tests/local/add-item.spec.ts`

**Interfaces:**
- Consumes: Task 1's `convertPrices` and `convertedFrom`.
- Produces: `export function ConvertPricesCard({ convertPrices }: { convertPrices: boolean })`, rendered as `<ConvertPricesCard convertPrices={list.convertPrices !== false} />`.

- [ ] **Step 1: Write the failing tests.**
  - `messages.spec.ts`:
    - `prefillMessage({ response: { priceText: '$899.55', convertedFrom: 'TRY 45,000.00' } }, 'https://www.etsy.com/listing/1')` equals `'Filled in from etsy.com. We converted TRY 45,000.00 to dollars at today’s rate. Check it, then add it.'`.
    - The same call without `convertedFrom` still gives `'Filled in from etsy.com. Check it, then add it.'`.
  - `settings.spec.ts`, `the convert-prices switch saves and survives a reload`:
    - The switch named `Convert prices to dollars` starts `aria-checked="true"`.
    - Clicking it shows `Prices will stay in the shop’s currency.` and makes it `false`.
    - After a reload it's still `false`.
    - Clicking it again shows `Hanker will convert prices to dollars.`
  - `add-item.spec.ts`, `says when a price was converted`:
    - Route `**/api/wishlist/unfurl` to `{ title: 'Walnut table', priceText: '$899.55', convertedFrom: 'TRY 45,000.00' }`, then paste `https://www.etsy.com/listing/1234567890`.
    - The status shows the converted sentence, and `getByLabel('Price')` has the value `$899.55`.
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @wishlist/web test -- messages`. Expected: the new test fails. The E2E tests are run in Step 5.
- [ ] **Step 3: Implement it.**
  - **`ConvertPricesCard`:** copy `SuggestTagsCard`'s structure, with `convert-prices-*` ids, `PATCH /wishlist { convertPrices }`, `updateCachedList((list) => ({ ...list, convertPrices: saved }))`, and the §5.1 copy, word for word:
    - Heading: **Prices**
    - Body: "When a shop lists a price in another currency, Hanker converts it to US dollars as you add the item, using that day’s exchange rate. Prices you’ve saved don’t change."
    - Switch: **Convert prices to dollars**
    - Saved: "Hanker will convert prices to dollars." / "Prices will stay in the shop’s currency."

    Use curly apostrophes, and a doc comment naming price conversion design §5.1.
  - **`prefillMessage`:** on success, with `convertedFrom`, return the Global Constraints sentence.
  - **`/privacy`:**
    - The unfurl paragraph gains: "If a price is in another currency, Hanker converts it to US dollars before you see it, unless you turn that off in <Link href="/settings">Settings</Link>."
    - The processor list gains, after eBay: "Frankfurter provides daily exchange rates. Hanker downloads the whole table, so Frankfurter sees only that Hanker asked for the day’s rates, never what you added or who you are."
- [ ] **Step 4: Run the unit tests and checks.** Run `pnpm --filter @wishlist/web test && pnpm --filter @wishlist/web lint && pnpm --filter @wishlist/web typecheck`. Expected: everything passes.
- [ ] **Step 5: Run the E2E suite.** Run `pnpm test:e2e`. It needs Docker running under Colima, and Docker Desktop must not be running. Expected: everything passes, including the two new tests and the existing `legal.spec.ts` and privacy checks.
- [ ] **Step 6: Commit** with `feat(web): add the convert-prices setting and say when a price was converted`.

### Task 7: Documentation

**Files:**
- Modify: `README.md` (lines 36, 52–54, 61, and line 90's list of optional things)
- Modify: `AGENTS.md` (the `apps/api` Layout row, and a **Price conversion (Plan 16)** convention after "Retailer lookups")
- Modify: `docs/operations.md` (the "Where to start" table, after the `tag-suggest` rows)
- Modify: `docs/deployment.md` (the lookups section)

- [ ] **Step 1: README.**
  - The diagram's ports node gains `Frankfurter`.
  - The services table gains the row `| Frankfurter | Exchange rates for converting prices to dollars | Prices stay in the shop’s currency |`.
  - The `apps/api` row's port list gains "exchange rates".
  - Line 90's list of optional things gains "price conversion".
- [ ] **Step 2: AGENTS.md.**
  - The `apps/api` Layout row lists exchange rates among the ports.
  - Add the convention, one paragraph, in the house style: `UnfurlService` converts a non-USD `price` once, at prefill, when `wishlists.convert_prices` is on, through the `ExchangeRates` port (`apps/api/src/unfurl/exchange-rates.ts`). That port downloads only `…/v2/rates?base=usd`. `price` is internal and never leaves the API: the web sees `priceText` and `convertedFrom`. Any failure keeps the source currency. Never log or report an amount or a currency code. Saved prices are never converted or refreshed (D114–D116).
- [ ] **Step 3: operations.md.** Add two rows:
  - **`fx UNAVAILABLE` or `fx TIMEOUT` in the API's logs:** Frankfurter is down or slow. Prices prefill in the shop's currency until it's back, and there's nothing to do.
  - **A Sentry warning "Frankfurter answered an unreadable rates table":** Frankfurter changed its v2 answer. Check https://frankfurter.dev, then update the schema in `exchange-rates.ts`. Until then prices stay in the shop's currency.
- [ ] **Step 4: deployment.md.** Add one sentence where the lookups are described: price conversion needs no key or variable, and it's always on in production. Owners switch it per list in Settings.
- [ ] **Step 5: Check formatting.** Run `pnpm format:check`. Expected: no differences.
- [ ] **Step 6: Commit** with `docs: describe price conversion in the README, AGENTS.md and the runbooks`.

### Task 8: Gate, review and hand-off

- [ ] **Step 1: Run what CI runs:**
  ```bash
  pnpm format:check
  API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
  pnpm test:integration
  pnpm test:e2e
  ```
  Expected: all green. Show the output. CI's squawk check must also accept `0008_convert_prices.sql`.
- [ ] **Step 2: Review the branch.** Run a whole-branch code review against this plan and the design. Check Review Focus items 1–5 explicitly.
- [ ] **Step 3: Ask Ted before the first `gh stack submit --open`.** Then give each PR its Conventional Commit title and a summary body ending with the Claude Code line.
- [ ] **Step 4: Prepare the after-deploy check for Ted.** With the setting on, add a non-US Etsy listing: the form shows dollars and the sentence. Turn the setting off: the shop's currency again. Read the API's logs within the hour (Vercel Hobby keeps one hour), looking for `fx` lines. The roadmap row moves to Done in a follow-up once this passes.
