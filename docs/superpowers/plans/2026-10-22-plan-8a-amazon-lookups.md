# Plan 8a — Amazon Lookups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pasted amazon.com product link fills in its title, photo and price by asking Bright Data, while the add box shows a waiting panel with a Skip button.

**Architecture:**

- **Contracts:** `packages/contracts/src/retailers.ts` recognizes Amazon links, for both the web and the API. `LOOKUP_UNAVAILABLE` joins the unfurl failure codes.
- **API:** a new `RoutingMetadataFetcher` sits in front of today's `HttpMetadataFetcher`. It sends Amazon product links, short links included (followed by a new `PageFetcher.resolve`), to an `AmazonLookup` port whose adapter calls Bright Data. Every other link, and every Amazon link while `BRIGHT_DATA_API_KEY` is unset, goes to today's fetcher unchanged.
- **Web:** the add box shows the waiting panel for Amazon links, and Skip aborts the request.

**Tech Stack:** NestJS 12, Zod 4, Vitest, Playwright, Next.js, platform `fetch`. **No new dependencies.**

**Spec:**

- The design is [`docs/superpowers/specs/2026-10-22-retailer-lookups-design.md`](../specs/2026-10-22-retailer-lookups-design.md) (approved 2026-10-22).
- This plan covers its Amazon half and the shared pieces: §5.1 (Amazon rows), §5.2, §5.4, §5.5, §5.6 (Amazon), §5.7 (Bright Data), §5.8, §6 (B2, B3, V1).
- Etsy is Plan 8b. It's written only after Etsy approves the app (E2) and Ted has read Etsy's terms (E3).

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) still applies. In particular:

- **Toolchain:** ESM. Relative imports in `api` and `contracts` end in `.js`. `import type` for types.
- **Dependencies:** exact version pins. **No new dependencies.** Outbound HTTP is the platform `fetch`, injected as `fetchFn: typeof fetch = fetch`, like `PwnedPasswordsChecker` (`apps/api/src/security/breached-passwords.ts`).
- **Nest DI:** an explicit `@Inject(…)` on every constructor parameter, classes included.
- **Tests:** unit tests (`*.spec.ts`) never touch the network or Docker. Behavior changes are written test-first.
- **Commits:** every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it, e.g. `Claude Opus 5.5 <noreply@anthropic.com>`.

**Unfurl's contract is unchanged:** `POST /wishlist/unfurl` always answers `200`, never throws, and a failure carries `failureReason`. The rate limit stays 60 per hour per user.

**Privacy (design §2, §5.2):**

- Bright Data receives only `https://www.amazon.com/dp/<ASIN>`, never the pasted URL.
- Logs carry the host, the reason, and for `LOOKUP_UNAVAILABLE` the provider and HTTP status. Never a URL, an ASIN or the key.
- Error reports carry no URL and no key.

**Values fixed by the design:**

| Thing | Value |
|---|---|
| Amazon hosts | `amazon.com`, `www.amazon.com`; short links `amzn.to`, `a.co` |
| ASIN | 10 characters `[A-Z0-9]` after `/dp/` or `/gp/product/` in the path, matched case-insensitively and uppercased |
| Bright Data request | `POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l7q7dkf244hwjntr0&format=json`, `Authorization: Bearer <key>`, body `{"input":[{"url":"https://www.amazon.com/dp/<ASIN>"}]}` |
| Amazon deadline | `AMAZON_DEADLINE_MS = 30_000`, covering short-link hops and the lookup |
| Field mapping | `title` ← `title`; `imageUrl` ← `image_url`, else `images[0]`; `priceText` ← `formatPrice(final_price, currency)` |
| New failure code | `LOOKUP_UNAVAILABLE` |
| Env variable | `BRIGHT_DATA_API_KEY`, optional; unset means Amazon links take today's page fetch |

**Copy fixed by the design** (curly apostrophes, as all copy in `apps/web/src/lib/messages.ts`):

| Where | Text |
|---|---|
| `LOOKUP_UNAVAILABLE`, Amazon | `We couldn’t get the details from Amazon right now, so fill them in yourself.` |
| `LOOKUP_UNAVAILABLE`, no retailer known | `We couldn’t get the details right now, so fill them in yourself.` |
| Waiting panel, first line | `Getting the details from Amazon…` |
| Waiting panel, second line | `Amazon can take up to half a minute.` |
| Skip button | `Skip, I’ll type them` |
| Form message after Skip | `Fill in the details yourself.` |

## Rulings this plan makes on gaps in the design

1. **When the key goes in.** The privacy page names Bright Data in this stack. So that the page is never untrue, Ted runs B2 (the key) **before** he merges. The merge's deploy then turns Amazon on together with the privacy change. The dark path (key unset) is still built and tested, because previews and CI run that way.
2. **Which non-`200` answers are reported.** `400`, `401`, `403` and `404` mean our account, key, dataset or request is wrong, so they go to `captureWarning`. `400` is included because that's what an inactive account answered in the spike. `429`, `5xx` and network failures are logged only. Task 2, Step 1 reads Bright Data's error documentation first. If out-of-credits has its own status, that status is logged only.
3. **Short-link hops** use `PageFetcher`'s existing hop rules and its own 5-second budget, all inside the 30-second deadline. A short link that ends anywhere but a recognized Amazon product link is `NO_METADATA`, and its final page is never fetched.
4. **An amazon.com link that isn't a product** (a search, a store page) keeps today's page fetch, per the design's non-goals.
5. **Skip** passes an `AbortSignal` into a new optional fourth argument of `browserApi.post`. A late answer or the abort's rejection never changes the step once Skip has run.

## Review Focus

1. **Lookalike links:** `https://amazon.com.evil.test/dp/B08FK7B2SC`, `https://example.com/dp/B08FK7B2SC` and `https://www.amazon.co.uk/dp/B08FK7B2SC` are not Amazon, and are never sent to Bright Data. Test: Task 1.
2. **Sparse records:** a Bright Data record with `final_price: null`, no `currency`, or no image still prefills what it has. A record with none of the three is `NO_METADATA`, never a crash. Test: Task 2.
3. **Skip, then the answer lands:** the owner pressed Skip and started typing, then the request resolved or rejected. The form must keep what they typed. Test: Task 5 (E2E).
4. **A short link that goes astray:** an `amzn.to` link that redirects to a search page is `NO_METADATA`, and one that redirects to a private address is `DISALLOWED_ADDRESS`. Neither reaches Bright Data. Test: Task 3 and Task 4.
5. **Bright Data hangs or answers `202`:** the owner gets `TIMEOUT` by 30 seconds, never a request that outlives the deadline. Test: Task 2 and Task 4.

## Stacks and order

One new stack.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-8a` | 0 |
| `contracts/amazon-retailer` | 1 |
| `api/amazon-lookup` | 2, 3, 4 |
| `web/amazon-wait` | 5, 6 |

Task 7 is a ⏸ checkpoint for review, Ted's approval of the first submit, the key, the merge and the production check.

- Each layer's first task starts with `gh stack add <branch>`. Task 0 instead runs `gh stack init docs/plan-8a`.
- Nothing is pushed before Task 7.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/retailers.ts` (new) + `.spec.ts` | `amazonProductOf`, `isAmazonShortLink`, `retailerOf`, `amazonProductUrl` |
| `packages/contracts/src/wishlist.ts`, `index.ts` | `LOOKUP_UNAVAILABLE`; export retailers |
| `apps/web/src/lib/messages.ts` + `.spec.ts` | The new copy; `prefillMessage` names the retailer |
| `apps/api/src/unfurl/metadata.ts` + `.spec.ts` | `productMetadata()`, shared field cleaning |
| `apps/api/src/unfurl/amazon-lookup.ts` (new) + `.spec.ts` | `AmazonLookup` port, `BrightDataAmazonLookup` |
| `apps/api/src/unfurl/page-fetcher.ts` + `.spec.ts` | `resolve()` for short links |
| `apps/api/src/unfurl/routing-metadata-fetcher.ts` (new) + `.spec.ts` | Routing, deadline, logging, reporting |
| `apps/api/src/testing/fakes.ts` | `FakeAmazonLookup` |
| `apps/api/src/core/env.ts`, `apps/api/src/wishlist/wishlist.module.ts` | Env variable; wiring |
| `apps/web/src/lib/api-client.ts` + `.spec.ts` | Optional `{ signal }` on `post` |
| `apps/web/src/components/list/add-item.tsx`, `lookup-wait.tsx` (new) | Waiting panel and Skip |
| `e2e/tests/local/add-item.spec.ts` | Panel, Skip, `LOOKUP_UNAVAILABLE` |
| `apps/web/src/app/privacy/page.tsx` | Bright Data |
| Docs | Main spec, AGENTS.md, `docs/deployment.md`, `docs/operations.md`, roadmap |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/api exec vitest run src/unfurl          # API unit tests for unfurl
pnpm --filter @wishlist/web exec vitest run src/lib             # web unit tests
pnpm test:e2e -- add-item                                       # Docker
```

The full gate, run at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
```

`pnpm test:e2e` also runs at the end of `web/amazon-wait`.

---

### Task 0: Start the stack with the design and this plan

**Files:**

- Add: `docs/superpowers/specs/2026-10-22-retailer-lookups-design.md`, this plan
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (two rows after 7b)

- [ ] **Step 1:** `gh stack init docs/plan-8a`.
- [ ] **Step 2:** Add the roadmap rows:
  - **8a** | Amazon lookups | [design 2026-10-22](../specs/2026-10-22-retailer-lookups-design.md) §5.1–§5.8 | `retailerOf`; `LOOKUP_UNAVAILABLE`; Bright Data behind an `AmazonLookup` port with a 30 s deadline; short links; the add box's waiting panel with Skip; privacy page; D34 narrowed, D64–D68 | Planned
  - **8b** | Etsy lookups | design §5.1, §5.3, §5.7 | Etsy Open API behind an `EtsyLookup` port; `etsy.me`; privacy and terms. Waits on Etsy's approval (E2) and terms (E3) | Waiting on Etsy
- [ ] **Step 3:** `pnpm format:check` passes. Commit `docs: design and plan 8a for retailer lookups`.

### Task 1: Amazon links in contracts, and the new failure code

**Files:**

- Create: `packages/contracts/src/retailers.ts`, `packages/contracts/src/retailers.spec.ts`
- Modify: `packages/contracts/src/wishlist.ts`, `index.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.spec.ts`

**Interfaces:**

- Produces, in `@wishlist/contracts`:
  - `type Retailer = 'amazon'` (8b widens it)
  - `amazonProductOf(url: URL | string): { asin: string } | null`: a recognized amazon.com product link, else null. Never throws.
  - `isAmazonShortLink(url: URL | string): boolean`
  - `retailerOf(url: string): Retailer | null`: `'amazon'` for a product link or a short link
  - `amazonProductUrl(asin: string): string`, which gives `https://www.amazon.com/dp/${asin}`
  - `'LOOKUP_UNAVAILABLE'` in `UNFURL_FAILURE_REASONS`
- Produces, in `apps/web/src/lib/messages.ts`: `LOOKUP_SKIPPED`, `AMAZON_WAIT`, `AMAZON_WAIT_HINT`, `SKIP_LOOKUP` (the copy table), and `prefillMessage` naming the retailer for `LOOKUP_UNAVAILABLE`.

- [ ] **Step 1:** `gh stack add contracts/amazon-retailer`.
- [ ] **Step 2: Write the failing tests** in `retailers.spec.ts`:
  - `it.each` over Ted's four links from the design §3 spike, with the ASINs `B0D169YKJW`, `B0CB96ZFL8`, `B0CJV2TK6N` and `B08FK7B2SC`. Each gives `amazonProductOf(link)` equal to `{ asin }` and `retailerOf(link)` equal to `'amazon'`.
  - `https://amazon.com/gp/product/b08fk7b2sc` gives `{ asin: 'B08FK7B2SC' }`. So does `https://www.amazon.com/-/es/dp/B08FK7B2SC`.
  - Review Focus 1: `amazon.com.evil.test/dp/…`, `example.com/dp/…`, `www.amazon.co.uk/dp/…`, `https://www.amazon.com/s?k=frosthaven` and `https://www.amazon.com/dp/SHORT` each give `amazonProductOf(…) === null`. The first three also give `retailerOf(…) === null`.
  - `https://amzn.to/3xYz` and `https://a.co/d/abc` give `isAmazonShortLink === true` and `retailerOf === 'amazon'`. `http://amzn.to.evil.test/x` gives false and null.
  - `amazonProductOf('not a url')` is null.
  - `amazonProductUrl('B08FK7B2SC')` is `'https://www.amazon.com/dp/B08FK7B2SC'`.
- [ ] **Step 3:** Run `pnpm --filter @wishlist/contracts test`. The new tests fail.
- [ ] **Step 4: Implement `retailers.ts`.** Match the host exactly against the table. The ASIN pattern runs on `url.pathname` only: `/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i`. Export the module from `index.ts`. Add `'LOOKUP_UNAVAILABLE'` to `UNFURL_FAILURE_REASONS` and extend `wishlist.spec.ts`'s reasons assertion if it lists them.
- [ ] **Step 5:** The contracts tests pass. Run `pnpm --filter @wishlist/contracts build`.
- [ ] **Step 6: Web messages, test first.** In `messages.spec.ts`:
  - `prefillMessage({ response: { failureReason: 'LOOKUP_UNAVAILABLE' } }, 'https://www.amazon.com/dp/B08FK7B2SC')` is the Amazon sentence.
  - With `'https://shop.example/x'` it's the generic sentence.
  - The existing "every reason has a message" test, if present, covers the new code.

  Run `pnpm --filter @wishlist/web exec vitest run src/lib/messages.spec.ts` and see it fail.
- [ ] **Step 7: Implement.**
  - Add the generic sentence as `UNFURL_MESSAGES.LOOKUP_UNAVAILABLE`. In `prefillMessage`, when the reason is `LOOKUP_UNAVAILABLE` and `retailerOf(url)` is `'amazon'`, return the Amazon sentence.
  - Add the four copy constants, each with a one-line doc comment saying where it shows.
  - The web tests pass.
- [ ] **Step 8:** Run the full gate. Commit `feat(contracts): recognize Amazon links; add LOOKUP_UNAVAILABLE`.

### Task 2: The Bright Data adapter

**Files:**

- Create: `apps/api/src/unfurl/amazon-lookup.ts`, `apps/api/src/unfurl/amazon-lookup.spec.ts`
- Modify: `apps/api/src/unfurl/metadata.ts`, `metadata.spec.ts`, `apps/api/src/testing/fakes.ts`

**Interfaces:**

- Produces, in `metadata.ts`: `productMetadata(fields: { title?: unknown; imageUrl?: unknown; amount?: unknown; currency?: unknown }, base: URL): PageMetadata`. It applies the existing private `text()`, `truncate(…, TITLE_MAX)`, `httpsUrl()` and `formatPrice()` exactly as `extractMetadata` does, and drops non-strings for title and image.
- Produces, in `amazon-lookup.ts`:

  ```ts
  export type LookupResult =
    | { ok: true; metadata: PageMetadata }
    | { ok: false; reason: 'NO_METADATA' | 'TIMEOUT' }
    | { ok: false; reason: 'LOOKUP_UNAVAILABLE'; status?: number; misconfigured: boolean };
  export interface AmazonLookup { lookUp(asin: string, signal: AbortSignal): Promise<LookupResult> }
  export const AMAZON_LOOKUP = Symbol('AMAZON_LOOKUP');
  export class BrightDataAmazonLookup implements AmazonLookup {
    constructor(apiKey: string, fetchFn?: typeof fetch);
  }
  ```

  `lookUp` never throws.
- Produces, in `fakes.ts`: `FakeAmazonLookup` with `next: LookupResult` and `asins: string[]`.

- [ ] **Step 1:** `gh stack add api/amazon-lookup`. Read Bright Data's API error documentation (docs.brightdata.com) for the status and body of out-of-credits and of an inactive account. Put what it says in a doc comment on the status classification, with the URL. If it's not documented, say so in the comment and apply ruling 2 as written.
- [ ] **Step 2: Write the failing tests.**

  In `metadata.spec.ts`, `productMetadata`:
  - `{ title: '  Cephalofair Games:​ Frosthaven ', imageUrl: 'https://m.media-amazon.com/images/I/81huEJXkxfL._AC_SL1500_.jpg', amount: 240, currency: 'USD' }` gives `{ title: 'Cephalofair Games: Frosthaven', imageUrl: …same…, priceText: '$240.00' }`.
  - An `http:` image is dropped.
  - `amount: null` gives no `priceText`.
  - A 250-character title is cut to 200.

  In `amazon-lookup.spec.ts`, with a fake `fetchFn` that records its argument:
  - **Request:** it sends exactly the request in Global Constraints for ASIN `B08FK7B2SC`: URL, method, `authorization`, `content-type: application/json` and body.
  - **Success:** a `200` with `[{ title: 'Cephalofair Games: Frosthaven', image_url: 'https://m.media-amazon.com/x.jpg', final_price: 240, currency: 'USD' }]` gives `{ ok: true, metadata: { title, imageUrl, priceText: '$240.00' } }`.
  - **Review Focus 2:**
    - `[{ title: 'X', final_price: null }]` gives a title only.
    - `[{ images: ['https://m.media-amazon.com/y.jpg'] }]` gives the image from `images[0]`.
    - `[]` and `[{}]` give `NO_METADATA`.
    - A body that isn't JSON gives `LOOKUP_UNAVAILABLE` with `status: 200` and `misconfigured: false`.
  - **Statuses:** `202` gives `TIMEOUT` (Review Focus 5). `400`, `401`, `403` and `404` give `LOOKUP_UNAVAILABLE` with `misconfigured: true`. `429` and `503` give `misconfigured: false`. `fetchFn` rejecting with a `TypeError` gives `misconfigured: false` and no `status`.
  - **Abort:** with an already-aborted signal, or a `fetchFn` that rejects with the signal's reason, the result is `TIMEOUT`.
- [ ] **Step 3:** Run `pnpm --filter @wishlist/api exec vitest run src/unfurl/metadata.spec.ts src/unfurl/amazon-lookup.spec.ts`. The tests fail.
- [ ] **Step 4: Implement.**
  - Extract `productMetadata` from `extractMetadata`'s tail, so both use it. `extractMetadata`'s tests must still pass unchanged.
  - Implement `BrightDataAmazonLookup` with the `signal` passed to `fetchFn`.
  - Add `FakeAmazonLookup` to `fakes.ts`, next to `FakeMetadataFetcher`.
- [ ] **Step 5:** The tests pass. Commit `feat(api): Bright Data lookup for Amazon products`.

### Task 3: Following short links without fetching the page

**Files:**

- Modify: `apps/api/src/unfurl/page-fetcher.ts`, `page-fetcher.spec.ts`

**Interfaces:**

- Produces, on `PageFetcher`:

  ```ts
  resolve(rawUrl: string, stopAt: (url: URL) => boolean, signal?: AbortSignal):
    Promise<{ ok: true; url: URL } | { ok: false; reason: UnfurlFailureReason; host?: string }>
  ```

  It follows redirects under the same hop rules and limits as `fetch` (vetting, pinned lookup, `maxRedirects`, its own `timeoutMs`, combined with `signal` through `AbortSignal.any`). Before requesting each hop, it returns `{ ok: true, url }` as soon as `stopAt(url)` is true, so that hop is never requested. A non-redirect answer is drained and gives `{ ok: false, reason: 'NO_METADATA' }`.

- [ ] **Step 1: Write the failing tests**, reusing the spec's local redirect server and `FIXTURE` policy:
  - A chain `/short` → `/r1` → `/dp-page`, with `stopAt` true for `/dp-page`, gives `ok: true` with that URL. The server's request log shows `/dp-page` was never requested.
  - `stopAt` true for the input itself gives `ok: true` with zero requests.
  - A chain ending at a `200` page gives `NO_METADATA`.
  - A hop to `http://127.0.0.1:<a port the policy refuses>/` gives `DISALLOWED_ADDRESS` (Review Focus 4).
  - Four hops give `TOO_MANY_REDIRECTS`.
  - An aborted external `signal` gives `TIMEOUT`.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run src/unfurl/page-fetcher.spec.ts`. The tests fail.
- [ ] **Step 3: Implement `resolve`.** Share the hop loop with `fetch` rather than copying it: a private helper that both call, with `fetch` reading the body where `resolve` stops. `fetch`'s existing tests must pass unchanged.
- [ ] **Step 4:** The tests pass. Commit `feat(api): follow a short link's redirects without fetching the page`.

### Task 4: Routing Amazon links, and turning it on by env

**Files:**

- Create: `apps/api/src/unfurl/routing-metadata-fetcher.ts`, `routing-metadata-fetcher.spec.ts`
- Modify: `apps/api/src/core/env.ts`, `apps/api/src/wishlist/wishlist.module.ts`

**Interfaces:**

- Consumes:
  - `amazonProductOf`, `isAmazonShortLink`, `amazonProductUrl` (Task 1);
  - `AmazonLookup`, `LookupResult`, `FakeAmazonLookup` (Task 2);
  - `PageFetcher.resolve` (Task 3);
  - `MetadataFetcher`, `FakeMetadataFetcher`, `ErrorReporter`, `FakeErrorReporter`.
- Produces:

  ```ts
  export const AMAZON_DEADLINE_MS = 30_000;
  export class RoutingMetadataFetcher implements MetadataFetcher {
    constructor(pages: MetadataFetcher, links: Pick<PageFetcher, 'resolve'>,
                amazon: AmazonLookup | null, reporter: ErrorReporter, deadlineMs?: number);
  }
  ```

  `BRIGHT_DATA_API_KEY: z.string().min(1).optional()` in `EnvSchema`, with a doc comment: "Unset means Amazon links take the page fetch (retailer lookups design §5.6)."

- [ ] **Step 1: Write the failing tests** with the fakes. `links` is a stub whose `resolve` returns a set result and records calls.
  - **Dark:** with `amazon: null`, an Amazon product link goes to `pages.fetch` with the original URL.
  - **Not Amazon:** a non-Amazon link, and `https://www.amazon.com/s?k=x`, go to `pages.fetch`. The lookup's `asins` stays empty.
  - **Product link:** the lookup receives `'B08FK7B2SC'`, and its `ok: true` metadata is returned as the response.
  - **Short link:** an `amzn.to` link calls `links.resolve`. Resolving to `https://www.amazon.com/dp/B0CB96ZFL8?ref=x` looks up `'B0CB96ZFL8'`. A resolve result of `{ ok: false, reason: 'DISALLOWED_ADDRESS' }` is returned as that reason, and the lookup isn't called (Review Focus 4).
  - **Failures:**
    - `NO_METADATA` and `TIMEOUT` results become `{ failureReason }`.
    - `LOOKUP_UNAVAILABLE` with `misconfigured: true, status: 401` gives `{ failureReason: 'LOOKUP_UNAVAILABLE' }` and one `captureWarning`. Its message contains `401` and no `amazon.com/` or ASIN.
    - With `misconfigured: false` there's no warning.
  - **Logging:** spy on `Logger.prototype.log` as `metadata-fetcher.spec.ts` does. A `LOOKUP_UNAVAILABLE` logs exactly `unfurl LOOKUP_UNAVAILABLE host=www.amazon.com provider=amazon status=503`. Success logs nothing.
  - **Deadline (Review Focus 5):** with `deadlineMs: 50` and a lookup that resolves only when its signal aborts, the result is `TIMEOUT` within 1 s.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run src/unfurl/routing-metadata-fetcher.spec.ts`. The tests fail.
- [ ] **Step 3: Implement.**
  - One `AbortSignal.timeout(deadlineMs)` per call, passed to both `resolve` and `lookUp`.
  - Failures are logged in today's format (`HttpMetadataFetcher.failed`), plus `provider` and `status` for `LOOKUP_UNAVAILABLE`.
  - The class doc comment cites design §5.1–§5.4.
- [ ] **Step 4: Wire it in `wishlist.module.ts`.** The `METADATA_FETCHER` factory injects `[ENV, ERROR_REPORTER]` and builds:

  ```ts
  new RoutingMetadataFetcher(
    new HttpMetadataFetcher(pages),
    pages,
    key ? new BrightDataAmazonLookup(key) : null,
    reporter,
  )
  ```

  `pages` is one shared `new PageFetcher()` and `key` is `env.BRIGHT_DATA_API_KEY`. Add an `env.spec.ts` case, if that file exists, that the variable is optional.
- [ ] **Step 5:** The unit tests pass. Then run `pnpm --filter @wishlist/api test:integration`: the unfurl integration tests still pass, because the key is unset there. Run the full gate. Commit `feat(api): route Amazon product links to Bright Data when its key is set`.

### Task 5: The waiting panel and Skip

**Files:**

- Create: `apps/web/src/components/list/lookup-wait.tsx`
- Modify: `apps/web/src/lib/api-client.ts`, `api-client.spec.ts`, `apps/web/src/components/list/add-item.tsx`, `e2e/tests/local/add-item.spec.ts`

**Interfaces:**

- Consumes: `retailerOf` (Task 1), and `AMAZON_WAIT`, `AMAZON_WAIT_HINT`, `SKIP_LOOKUP`, `LOOKUP_SKIPPED` (Task 1).
- Produces:
  - `post(path, body, schema, options?: { signal?: AbortSignal })` on the API client.
  - `LookupWait({ onSkip }: { onSkip: () => void })` in `lookup-wait.tsx`.

- [ ] **Step 1:** `gh stack add web/amazon-wait`.
- [ ] **Step 2: Write the failing tests.**

  In `api-client.spec.ts`: `post` passes `options.signal` through to `fetchFn`'s `init.signal`. Without options, `init` has no `signal` key.

  In `e2e/tests/local/add-item.spec.ts`, with `page.route('**/api/wishlist/unfurl', …)`, as in "says the page is being read while unfurl runs":
  - **The panel:** paste `https://www.amazon.com/dp/B08FK7B2SC` with the route delayed 1500 ms and then answering `{ title: 'Cephalofair Games: Frosthaven' }`.
    - The status region shows `Getting the details from Amazon…`, and the panel shows `Amazon can take up to half a minute.`
    - A button named `Skip, I’ll type them` is visible.
    - Then the Title field holds `Cephalofair Games: Frosthaven`.
    - `expectAccessible(page)` passes while the panel shows.
  - **Skip (Review Focus 3):** the route waits 3000 ms and then answers `{ title: 'Late title' }`.
    - Click Skip. The form opens with Link equal to the Amazon URL, the status shows `Fill in the details yourself.`, and Title is focused.
    - Type `My own title`, then wait 3500 ms. Title still holds `My own title`.
  - **Unavailable:** the route answers `{ failureReason: 'LOOKUP_UNAVAILABLE' }`. The status shows the Amazon sentence.
  - **Not Amazon:** a non-Amazon link still shows `Reading the page…` and no Skip button. The existing test covers the first half; add the no-Skip assertion to it.
- [ ] **Step 3:** Run the unit test and `pnpm test:e2e -- add-item`. The new cases fail.
- [ ] **Step 4: Implement.**
  - **`api-client.ts`:** pass `signal` into the `fetchFn` init only when given.
  - **`lookup-wait.tsx`:** a client component following design §5.5 and mockup B, with the spinner `aria-hidden`. It uses Tailwind `motion-safe:animate-spin`, so it stays still under reduced motion. The spinner may use `primary` because it carries no text. The text uses the theme tokens. `onSkip` is on a real `<Button>`.
  - **`add-item.tsx`:**
    - The `'reading'` step gains `retailer: Retailer | null` and an `AbortController`.
    - The `role="status"` region shows `AMAZON_WAIT` when `retailer === 'amazon'`, else `Reading the page…`. `LookupWait` renders below the box for Amazon, and the submit button text stays as today.
    - **Skip** aborts, then sets the form step with `prefill(url, titleHint, null)` and `LOOKUP_SKIPPED`.
    - After the `await`, and in its `catch`, return without changing the step if this attempt's signal is aborted.
    - The add form's first field takes focus as it already does on open. Confirm it with the E2E.
- [ ] **Step 5:** The unit tests and `pnpm test:e2e -- add-item` pass. Commit `feat(web): a waiting panel with Skip for Amazon links`.

### Task 6: Privacy page and docs

**Files:**

- Modify:
  - `apps/web/src/app/privacy/page.tsx`
  - `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (header, §6.8, §13)
  - `AGENTS.md`
  - `docs/deployment.md`
  - `docs/operations.md`

- [ ] **Step 1: Privacy page** (design §5.7). Bump the page's "last updated" date to the merge day.
  - **"If you make a list":** after "…so the shop sees a visit from Hanker, not from you.", add: "For Amazon product links, Hanker asks Bright Data for the details instead, and sends it only the product’s ID."
  - **"Who else handles your information":** add `<li>Bright Data looks up Amazon product links. It sees the product’s ID, and nothing about who pasted it.</li>` after the Cloudflare item.

  If an E2E or unit test snapshots this page, update it.
- [ ] **Step 2: Main spec.**
  - **Header:** link the retailer-lookups design.
  - **§6.8:** narrow the Identification bullet: "Hanker's own requests…; Amazon product lookups are delegated to Bright Data (D64)". Add a "Retailer lookups" bullet summarizing design §5.1, §5.2 and §5.4, and add `LOOKUP_UNAVAILABLE` to the Failure list.
  - **§13:** amend D34's row with "(narrowed by D64, 2026-10-22)". Add these decisions, each `(Ted, 2026-10-22)` with its rejected alternative:
    - **D64:** Amazon product links are looked up through Bright Data's Amazon dataset, sending only `/dp/<ASIN>`, with a 30 s deadline. Rejected: the Product Advertising API (needs affiliate sales); Amazon-specific HTML parsing (production gets a bot check).
    - **D65:** Etsy listings will be looked up through Etsy's Open API v3 with a Personal App (Plan 8b). Rejected: page fetch (DataDome `403`).
    - **D66:** `LOOKUP_UNAVAILABLE` covers a lookup service that can't answer, including spent credits. Rejected: reusing `BLOCKED_BY_SITE`, which blames the shop.
    - **D67:** Amazon links show a waiting panel with "Amazon can take up to half a minute" and a Skip button. Rejected: today's line alone; a message that changes after 8 s.
    - **D68:** No money on deposit with Bright Data, and no global lookup cap. Spent credits degrade to typing. Rejected: pay-as-you-go.
- [ ] **Step 3: AGENTS.md.** Add one Conventions bullet:

  > **Retailer lookups (Plan 8a):** `retailerOf()` in `packages/contracts` decides which links skip the page fetch. Amazon product links go to Bright Data through the `AmazonLookup` port, inside `RoutingMetadataFetcher`, sending only `https://www.amazon.com/dp/<ASIN>`. Unset `BRIGHT_DATA_API_KEY` means today's page fetch. Never log or report the pasted URL, the ASIN or the key.

- [ ] **Step 4: `docs/deployment.md`.**
  - Add a `BRIGHT_DATA_API_KEY (sensitive)` row to the environment variable table: "Bright Data API key (free tier, no deposit, D68). Unset means Amazon links use the page fetch".
  - Add a "Turning on Amazon lookups" section with steps B2, B3 and V1 from design §6, using the exact command from design §6 B2.
- [ ] **Step 5: `docs/operations.md`.** Add a "Bright Data credits" entry:
  - where to read usage (Bright Data dashboard → Billing/Usage);
  - that credits reset on the 1st;
  - that `unfurl LOOKUP_UNAVAILABLE … provider=amazon` in the logs means spent credits or an outage;
  - that a Sentry warning naming a Bright Data status means the key or account needs attention.
- [ ] **Step 6:** Run `pnpm format:check`, then the full gate. Commit `docs: Amazon lookups in the spec, AGENTS.md and the runbooks; privacy page names Bright Data`.

### Task 7: ⏸ Checkpoint — review, submit, key, merge, verify

Nothing here is automatic. Each step waits for Ted where it says so.

- [ ] **Step 1: Final whole-branch review** of the stack from `main` against the design and this plan. Fix what it finds in the owning layer, then `gh stack rebase --upstack`.
- [ ] **Step 2: Ted approves the first submit.** It's a new stack, so ask before `gh stack submit --open`. Give each PR a Conventional Commit title and a summary body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 3:** Every layer's CI and preview pass. Previews have no key, so Amazon links take the page fetch there.
- [ ] **Step 4: Ted runs B2** from `docs/deployment.md` (ruling 1). The executor never handles the key.
- [ ] **Step 5: Ted merges** (`gh stack merge <top PR> --squash`). The executor never merges.
- [ ] **Step 6: Verify production.**
  - The deploy run passes every job, and `GET https://hanker.dev/api/health` reports the merge SHA.
  - **V1, by Ted, on his own list:**
    - paste `https://www.amazon.com/Cephalofair-Games-115005-Frosthaven-Surface/dp/B0D169YKJW/` (about 20 s in the spike), and see the panel, then a prefill;
    - paste one `amzn.to` link and see a prefill;
    - paste one non-Amazon shop link and see today's behavior.
  - Within the hour, read the API's runtime logs for `host=` lines. There should be no `LOOKUP_UNAVAILABLE` and no Sentry warning.
  - `/privacy` shows the Bright Data item.
- [ ] **Step 7:** A follow-up PR sets the roadmap's 8a row to "Done". Plan 8b is written once E2 and E3 are done.
