# Price Conversion — Design

- **Date:** 2026-11-05
- **Status:** Draft, for Ted's review. Builder check done 2026-11-05.
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md): §5's list settings and unfurl response, §6.8, and the decision log. The plan assigns decision numbers from D114, because D113 is held by the Node 26 upgrade.
- **Origin:** A tester added an Etsy listing from a Turkish shop, and the form prefilled "TRY 45,000.00". Etsy's API answers in the shop's own currency, so the price was correct but meant nothing to a US owner. Ted decided everything marked *(Ted's decision)* below in conversation on 2026-11-05.

## 1. Intent

An owner pastes a link from a shop abroad. Today the price prefills in the shop's currency. With this change it prefills in US dollars, so their list shows dollars *(Ted's decision)*. This is for the **owner**: the converted price is what they save, and gifters see whatever the owner saved.

Conversion happens **once, at prefill**. The add form shows "$899.55" in place of "TRY 45,000.00", and the owner can still edit it. Once saved, the price is ordinary free text like any other: it isn't marked as converted and never updates *(Ted's decision)*. This keeps D9 (no price refresh) and D69 (Etsy data is prefill only) as they are.

## 2. Goals, non-goals, anti-goals

### Goals

- **Every unfurl source is converted.** When the setting is on and an unfurl finds a price in a currency other than USD, the add form opens with that price in US dollars. This covers page meta tags, JSON-LD, Etsy, eBay, and Amazon if Bright Data ever returns a non-USD price. *(Claude's call: the owner wants dollars on their list, wherever the price came from.)*
- **The form says once that it converted.** The line above it reads: "We converted TRY 45,000.00 to dollars at today's rate." *(Ted's decision.)*
- **It's a list setting**, next to "Suggest tags" on `/settings`, **on by default** *(Ted's decision)*. Off means exactly today's behavior: the shop's own currency.
- **It's best-effort.** If rates can't be had, or the currency isn't covered, the price prefills in its own currency as it does today. An add never fails or waits long because of conversion *(Ted's decision)*.

### Non-goals

- **Target currencies other than USD.** Hanker's owners are US-only *(Ted's decision)*, so there's no currency picker. The setting is "dollars or the shop's currency".
- **Converting prices the owner types.** Only unfurl prefills are converted.
- **Converting items that are already saved**, or refreshing a price later. D9 stands.
- **Remembering the original price or the rate on the item** *(Ted's decision)*.
- **Converting on the share page for gifters.** Gifters see the saved text.

### Anti-goals

- **An add that's blocked or noticeably slowed by a rates service.**
- **Item data leaving Hanker for conversion.** The rates service never learns a link, an amount, a title or which currency an owner just pasted (§5.3). The only thing it can learn is that a fetch happened at a certain time.
- **A wrong number shown as if it were right.** If the amount or currency can't be read with certainty, nothing is converted.
- **A privacy page that becomes untrue.** It changes in the same release (§5.7).

## 3. What we know (checked 2026-11-05)

- Frankfurter v2 (`https://api.frankfurter.dev/v2`, [llms.txt](https://frankfurter.dev/llms.txt)) is free, open source, needs no key, and says it has no quotas. It covers 239 currencies from 108 central banks and official sources.
- `GET /v2/rates?base=usd&quotes=try,eur,gbp` returned `200`. The body is a JSON array with one object per quote: `[{"date":"2026-11-05","base":"USD","quote":"TRY","rate":50.025}, …]`. The rate is units of the quote currency per 1 USD, so dollars = amount ÷ rate. TRY 45,000.00 ÷ 50.025 = **$899.55**.
- Other paths in its OpenAPI spec (`/v2/openapi.json`): `/currencies`, `/coverage`, `/rate/{base}/{quote}` and `/providers…`.
- **Not checked:** whether `GET /v2/rates?base=usd` with no `quotes` returns every currency. The plan's first task confirms this. If it doesn't, the adapter asks for every Intl currency code explicitly, which is still the same request whatever was pasted, any rate limits beyond "no quotas", and weekend or holiday behavior. We assume the date is the last business day's.
- **Prices in Hanker are free text** (`items.price_text`, at most 50 characters). Unfurl builds that text in `formatPrice` (`apps/api/src/unfurl/metadata.ts`) from an amount and a currency code, with Intl's `en-US` currency style for codes Intl knows, and `"<amount> <CODE>"` otherwise. Etsy's `priceOf`, eBay's `askingPrice` and Bright Data's `final_price` all reach `formatPrice` through `productMetadata`. Today the amount and currency are thrown away once formatted.
- **The tag-suggestion setting is the model to follow:** column `wishlists.suggest_tags boolean DEFAULT true NOT NULL` (migration `0005`), `suggestTags?: boolean` on `UpdateWishlistRequestSchema`, `WishlistResponseSchema` and `WishlistSettingsResponseSchema` (optional for expand/contract), and `SuggestTagsCard` on `/settings`.
- **E2E stubs `/api/wishlist/unfurl` in the browser** (`page.route`), so E2E never makes the API call Frankfurter.

## 4. Decisions made in conversation

| # | Decision | By |
|---|---|---|
| 1 | Convert to USD, for the owner's own list | Ted |
| 2 | Once, at prefill. Editable. Never refreshed, and the item doesn't remember it was converted | Ted |
| 3 | A list setting, on by default. Off is today's behavior | Ted |
| 4 | Frankfurter for rates, cached in memory. Fall back to the source currency on any failure | Ted |
| 5 | One sentence above the form says what was converted. The price field holds a plain "$899.55" | Ted |
| 6 | All unfurl sources, not just Etsy | Claude |
| 7 | Download the whole USD table, so Frankfurter learns nothing about any item | Claude |
| 8 | Hanker's owners are US-only, so everyone gets dollars, on by default. Owners outside the US aren't a case to design for | Ted |

## 5. Design

### 5.1 The setting

- **Column:** `wishlists.convert_prices boolean DEFAULT true NOT NULL`, added by `db:generate --name convert_prices`. It only adds a column, so it's safe next to the deployed API. No `stats` view uses it, so no view changes. *(Claude's call: a stats count like `lists_suggesting_tags` can come later if Ted wants one.)*
- **Contracts:** `convertPrices: z.boolean().optional()` on `UpdateWishlistRequestSchema` (and in its "a setting" refine), `WishlistResponseSchema` and `WishlistSettingsResponseSchema`. An absent field means on, as with `suggestTags`.
- **API:** `WishlistService` reads and writes it beside `suggestTags`.
- **Web:** a `ConvertPricesCard` on `/settings`, built like `SuggestTagsCard` (a switch, saved at once, no confirm dialog, `updateCachedList` then `router.refresh()`). Copy *(Claude's call, for Ted to check)*:
  - Heading: **Prices**
  - Body: "When a shop lists a price in another currency, Hanker converts it to US dollars as you add the item, using that day's exchange rate. Prices you've saved don't change."
  - Switch: **Convert prices to dollars**
  - Saved: "Hanker will convert prices to dollars." / "Prices will stay in the shop's currency."

### 5.2 Keeping the amount and currency

`PageMetadata` gains `price?: { amount: string; currency: string }` next to `priceText`. It's set only when `formatPrice` formatted a known Intl currency from a plain decimal amount (`/^\d+(\.\d+)?$/`), which is the same test that today decides between "$24.99" and "24.99 ABC". The field is internal: the metadata fetcher passes it to `UnfurlService`, and it never appears in the HTTP response. *(Claude's call. How it's threaded through `MetadataFetcher`'s return type is left to the builder.)*

### 5.3 The `ExchangeRates` port

- **Interface:** `ExchangeRates.usdPer(currency: string): Promise<number | null>`. It returns the rate for 1 USD in that currency, or `null` when the currency isn't covered or rates can't be had. It never throws.
- **Adapter:** `FrankfurterExchangeRates` fetches `GET https://api.frankfurter.dev/v2/rates?base=usd`, the whole table, with a **2-second** timeout. Frankfurter therefore learns nothing about what was pasted, not even the currency. The request carries no query beyond `base`, no cookie and no user data. The User-Agent is the API's usual one, or a generic `Hanker`. *(Claude's call: it doesn't need a key, so there's no environment variable and no dark launch. It's always on in production. Tests and local development wire the fake through DI, as the other ports do.)*
- **Validation:** the body is parsed with Zod, as an array of `{ quote: 3 uppercase letters, rate: a positive finite number }`. A body that doesn't parse counts as unavailable.
- **When it's fetched:** lazily, on the first converting unfurl that finds no usable table. *(Claude's call. Fluid Compute reuses instances across requests, so most pastes find a warm table, and a cold one costs at most the 2-second timeout. Warming at boot would fetch on every cold start, conversion or not. Storing the table in Postgres from the daily cron would need a new table and migration for little gain. If cold-start waits show up in practice, a later change can make a cold miss skip conversion and refresh in the background.)*
- **Cache:** held in memory per API instance. A table younger than **6 hours** is used as is. When it's older, the adapter refreshes, and only one refresh runs at a time (concurrent callers share one promise). If the refresh fails, a table up to **48 hours** old is still used. With nothing usable, the answer is `null`. *(Claude's call: ECB-style rates change once a business day, and 48 hours covers an outage over a weekend.)*
- **Logs and reports:** a failed refresh logs `fx UNAVAILABLE status=<n>`, `fx TIMEOUT` or `fx BAD_ANSWER`, with no amounts or currencies. Only `BAD_ANSWER` goes to Sentry as a warning, through `ERROR_REPORTER`, because it means Frankfurter changed its API. Outages fix themselves. *(Claude's call.)*

### 5.4 Converting in the unfurl

In `UnfurlService.unfurl`, after the rate limit and the fetch:

1. If the metadata has no `price`, or its currency is `USD`, return as today.
2. Read the owner's list's `convert_prices` (one query by `wishlists.owner_id`, the way `tag-suggest/queries.ts` reads `suggest_tags`). If it's off, or there's no list row, return as today.
3. Ask `ExchangeRates.usdPer(currency)`. On `null`, return as today.
4. Compute `amount ÷ rate` and round it to cents. If the result isn't a finite number above zero, return as today.
5. Format the result with the same Intl `en-US` USD style (for example "$899.55"), and if it's longer than 50 characters, return as today.
6. Respond with `priceText` set to the dollar text and **`convertedFrom`** set to the original `priceText` ("TRY 45,000.00").

The conversion doesn't count against the unfurl rate limit a second time, and it doesn't touch `title`, `imageUrl` or `description`. Tag suggestions never see a price.

### 5.5 The response contract

`UnfurlResponseSchema` gains `convertedFrom: z.string().optional()`: the original display price, present only when `priceText` was converted. The change is additive, and a web build that doesn't know the field ignores it.

### 5.6 The sentence above the form

`prefillMessage` in `apps/web/src/lib/messages.ts`, on success with `convertedFrom`:

> Filled in from etsy.com. We converted TRY 45,000.00 to dollars at today’s rate. Check it, then add it.

The middle sentence is Ted's, word for word. The rest is today's success sentence, split around it *(Claude's call)*. It goes through `messages.ts` with a curly apostrophe, like the rest of the copy. Without `convertedFrom`, the message is unchanged.

### 5.7 Privacy page and documentation

Ted asked for every doc to be current in the same release *(Ted's decision)*:

- **`/privacy`** (`apps/web/src/app/privacy/page.tsx`): a processor line, "Frankfurter provides daily exchange rates. Hanker downloads the whole table, so Frankfurter sees only that Hanker asked for the day's rates, never what you added or who you are.", and the `updated` date. The sentence about what unfurl does gains a clause about conversion, with a link to Settings.
- **README.md:** the ports line in the architecture diagram (`Frankfurter`), a row in the external-services table ("Frankfurter | Exchange rates for converting prices to dollars | Prices stay in the shop's currency"), and the `apps/api` row of the layout table ("exchange rates").
- **AGENTS.md:** the `apps/api` Layout row lists exchange rates among the ports, plus a short **Price conversion** convention: once at prefill, only `convertedFrom` reaches the web, the whole table is fetched, never log an amount or a currency, and any failure falls back.
- **Spec** (`2026-10-07-wishlist-app-design.md`): §5 gains the setting and `convertedFrom`, §6.8 gains a conversion paragraph, and the decision log gains D114–D116 (§5.8).
- **docs/operations.md:** "Where to start" rows for `fx UNAVAILABLE`/`fx TIMEOUT` (Frankfurter is down, prices stay in the shop's currency, nothing to do) and for the `BAD_ANSWER` Sentry warning (check Frankfurter's changelog and the v2 schema).
- **docs/deployment.md:** no new secret or variable, so the environment table stays as it is. Add a one-line note that conversion needs no setup, where the lookups are described.
- **Roadmap:** a Plan 16 row.

### 5.8 Decision log entries

- **D114:** Unfurl prices in other currencies are converted to USD once, at prefill, when the list's setting is on (default on). Saved prices are never converted or refreshed. Rejected: leaving them in the source currency, leaving non-USD prices blank, and converting on display.
- **D115:** Rates come from Frankfurter's free v2 API. The API downloads the whole USD table, caches it in memory for 6 hours (stale up to 48), and falls back to the source currency on any failure. Rejected: a keyed paid service, and asking for one currency at a time (which tells the provider what was pasted).
- **D116:** The form says what it converted, in one sentence, and the item doesn't remember it. Rejected: "$899.55 (TRY 45,000.00)" in the price field, which the share page's price filter couldn't read.

## 6. Manual steps (Ted)

None to turn it on. After deploying, add an Etsy listing from a shop outside the US with the setting on, then with it off.

## 7. Testing

Behavior changes are written test-first.

- **Contracts:** `convertPrices` accepted by `UpdateWishlistRequestSchema` on its own; `convertedFrom` parsed by `UnfurlResponseSchema`.
- **API unit:**
  - `formatPrice`/`productMetadata`/`extractMetadata` set `price` only for a known code and a plain decimal amount.
  - `FrankfurterExchangeRates` against a stubbed `fetch`: the URL is exactly `…/v2/rates?base=usd`, the 6-hour reuse, the stale fallback up to 48 hours, `null` beyond it, one refresh for concurrent callers, the timeout, `BAD_ANSWER` reported and the others only logged, and an unknown currency giving `null`.
  - The arithmetic and rounding to cents, for example TRY 45,000.00 at 50.025 giving $899.55, and a zero-decimal currency (JPY) converted to dollars and cents.
- **API integration:** `PATCH /wishlist { convertPrices }` round-trips and defaults to on; `POST /wishlist/unfurl` with a fake fetcher and fake rates converts when on, leaves the price alone when off or when the rate is `null`, and leaves USD alone.
- **Web unit:** `prefillMessage` with and without `convertedFrom`.
- **E2E:**
  - The settings switch saves and survives a reload.
  - A stubbed unfurl answer with `convertedFrom` shows the sentence and the dollar price in the form.
- **Fakes:** `FakeExchangeRates` in `apps/api/src/testing/fakes.ts`.

## 8. Left to the builder

- How `price` travels from the fetchers to `UnfurlService`: a widened internal return type, or an internal result wrapping `UnfurlResponse`. In either case it must never be serialized.
- Whether the converter is a small pure function next to `formatPrice` or a method on the service.
- The exact Zod schema for Frankfurter's answer, once the no-`quotes` call is confirmed.

## 9. Risks

- **Frankfurter goes away or changes v2.** Prices fall back to the source currency, the Sentry warning says so, and the port makes swapping providers a small change.
- **Rounding surprises the owner.** The sentence names the original price, and the field is editable.
- **A shop's meta tags state the wrong currency.** We'd convert a wrong number. That's no worse than today, where the wrong currency shows as is.
