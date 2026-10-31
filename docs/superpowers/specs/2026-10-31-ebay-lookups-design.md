# eBay Lookups — Design

- **Date:** 2026-10-31
- **Status:** Approved by Ted, 2026-10-31. Plan 15 implements it. Still open before release: EB3 (Ted reads eBay's API licence) and how an ended listing is answered (§5.4).
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-22-retailer-lookups-design.md`](2026-10-22-retailer-lookups-design.md) (§2's "Any other retailer" non-goal, §5.1's classifier, §5.4's copy and §5.6's secrets gain eBay) and [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md) §6.8. The plan assigns decision numbers from D107.
- **Origin:** Ted asked which other big shops need unfurl to work. A probe on 2026-10-30 and a spike on 2026-10-31 found that eBay, Best Buy, Home Depot and Lowe's refuse Hanker's page fetch, and that eBay's own API answers fast and free. Ted decided everything marked *(Ted's decision)* below in conversation on 2026-10-31.

## 1. Intent

When an owner pastes a product link, Hanker fills in the title, photo and price so they only have to check it. For eBay links that doesn't happen: eBay answers Hanker's server with an error. Every eBay item is typed in by hand.

The goal is for a pasted eBay item link to fill in like any other shop's: **title, photo and price, nothing else** *(Ted's decision)*.

Hanker doesn't fetch the page harder. D34 still forbids impersonating a browser. eBay is looked up through its own official Browse API, so unlike Amazon, **D34 is not narrowed** and no new data processor joins Bright Data.

## 2. Goals, non-goals, anti-goals

### Goals

- An `ebay.com` item link, with or without a slug and with any tracking parameters, prefills the title, photo and price.
- A link that names an option (`?var=`) prefills that option's photo and price.
- A link to a listing with options but no `?var=` prefills the title and photo, and the price only when every option costs the same *(Ted's decision)*.
- When no price can be stated honestly, the price stays blank and the rest still fills in.
- When a lookup can't be done, the form opens with the link kept and a sentence asking the owner to fill in the details (retailer lookups §5.4).

### Non-goals

- eBay sites other than `ebay.com`, such as `.co.uk` or `.de`. They keep today's page fetch. *(Claude's call.)*
- `ebay.us` short links. They keep today's page fetch for now. *(Claude's call.)*
- eBay pages that aren't one item, such as searches, stores or catalog pages.
- eBay's seller-written description, shipping cost, seller, condition, bids, and Best Offer. Only title, photo and price are used. *(Ted's decision; the description part is Claude's reading of it.)*
- Refreshing a saved item from eBay. D9's "no price refresh" stands.
- Best Buy, Home Depot and Lowe's. They are separate decisions: their routes are third-party (Bright Data), and Home Depot's answered in 82 seconds in the spike (§3).

### Anti-goals

- **A wrong price.** A live auction bid shown as if it were what the gift costs. An empty price box is better.
- **Leaking more than needed.** eBay receives the item number, and the option number when the link has one. Never the rest of the link, search terms or session blobs.
- **A privacy page that becomes untrue.** It changes in the same release that starts sending links to eBay (§5.7).
- **Logs or reports that carry an item, an option or a key.**

## 3. What we know (spike, 2026-10-31)

Production keyset, `GET /buy/browse/v1/item/get_item_by_legacy_id`, marketplace `EBAY_US`, client-credentials token (`https://api.ebay.com/oauth/api_scope`, lifetime 7200 s):

| Case | Result |
|---|---|
| Fixed-price item (`buyingOptions: FIXED_PRICE,BEST_OFFER`) | `200` in about 0.5 s: title, `image.imageUrl` (`s-l1600.jpg`), `price` 230.00 USD |
| Pure auction (`buyingOptions: AUCTION`, 9 bids) | `200`. **`price` equals `currentBidPrice`**: the live bid, not a Buy It Now price. Response also had a harmless `warnings` entry (`11510`, shipping cost) |
| Item that doesn't exist | `404`, error `11003` "legacy item Id was not found" |
| Listing with options, item number only | `400`, error `11006`, pointing to `get_items_by_item_group` |
| Same listing with `legacy_variation_id` from the link's `?var=` | `200` in about 0.4 s: that option's title, photo and price (287.99 USD) |
| `get_items_by_item_group` for that listing | `200` in about 0.55 s: 6 options, identical titles, a photo for each, **two different prices** (287.99 and 289.99 USD) |

The token took 0.4–0.6 s. The worst path (token, a `400`, then the group call) is about 1.6 s.

**Not seen:** an auction that also offers Buy It Now (`buyingOptions` containing both), an ended listing, a listing with an auction inside a group, `ebay.us` links, and non-US sites.

## 4. Decisions made in conversation

- **First-party API first** *(Ted's decision)*: eBay's own API over Bright Data, wherever the host has one.
- **Title, photo and price only** *(Ted's decision)*.
- **Auction price** *(Ted's decision, narrowed by Claude, see §5.3)*: use the Buy It Now price; if there isn't one, leave it blank.
- **Links with options and no `?var=`** *(Ted's decision)*: look the listing up as a group, fill in title and photo, and the price only if all options agree.

## 5. Design

### 5.1 Which links go where

`retailerOf(url)` in `packages/contracts` gains `ebay`; its `Retailer` type becomes `'amazon' | 'etsy' | 'ebay'`.

| Link | Retailer | What's sent |
|---|---|---|
| `ebay.com` or `www.ebay.com`, path `/itm/<number>` or `/itm/<slug>/<number>` | ebay | the item number, and the option number from `?var=` when present |
| anything else, including other eBay pages, other eBay countries and `ebay.us` | none | today's page fetch, unchanged |

- The item number is 9–15 digits, so it fits in 64 bits (as Etsy's was capped, Plan 8b ruling 1). The option number from `?var=` is 6–15 digits; a `var` that isn't, or one repeated, is ignored and treated as absent. *(Claude's call.)*
- A new helper `ebayItemOf(url)` returns `{ itemId, variationId? }` or null, never throwing.

### 5.2 The lookup

A new port `EbayLookup`, shaped like `EtsyLookup`: `lookUp(item, signal): Promise<LookupResult>`, never throwing. Its real adapter, `EbayBrowseLookup`, lives in `apps/api/src/unfurl/ebay-lookup.ts`.

**The calls**, all inside one 5-second deadline for the whole lookup *(Claude's call; the worst path measured was about 1.6 s)*:
1. `POST https://api.ebay.com/identity/v1/oauth2/token`, `Authorization: Basic <base64(id:secret)>`, body `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`. The token is fetched for each lookup and **not cached** *(Claude's call: about 0.5 s buys no shared state across serverless instances)*.
2. `GET https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=<n>[&legacy_variation_id=<v>]`, `Authorization: Bearer <token>`, `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.
3. When step 2 is `400` with error `11006` and the link had no `?var=`, or `400` or `404` and the link had one (the option number came from the owner's link and may be stale, Plan 15 ruling 2): `GET …/item/get_items_by_item_group?item_group_id=<n>` with the same headers.

**Mapping** (through today's `productMetadata()` helpers, so the same cleaning, 200-character title cut, https-only image check and `formatPrice()`):

| Field | Taken from |
|---|---|
| `title` | `title` (for a group: the first item's) |
| `imageUrl` | `image.imageUrl` (for a group: the first item that has one) |
| `priceText` | `price.value` and `price.currency`, by the rules in §5.3 |

**No description is passed.** eBay's description is seller-written text and isn't needed for "title, photo and price". Like Etsy's, it must never reach storage or tag suggestions (D74). The routing fetcher's Etsy-only description strip (`isEtsyHost` in `routing-metadata-fetcher.ts`) becomes "this retailer's host", covering eBay, so no path can pass one on. *(Claude's call.)*

### 5.3 Price rules (the heart of the design)

The API's `price` is not always the asking price, so the adapter decides from `buyingOptions`:

| The item's `buyingOptions` | `priceText` |
|---|---|
| contains `FIXED_PRICE` and not `AUCTION` (with or without `BEST_OFFER`) | `price` |
| contains `AUCTION` (alone) | blank: `price` is the live bid |
| contains both `AUCTION` and `FIXED_PRICE` | **blank** *(Claude's call, see below)* |
| group lookup, no `?var=` | `price` only if every option has a fixed price and all prices are equal, else blank |

*(Ted's rule is "Buy It Now price, else blank.")* The API's `price` is the live bid on the one auction seen, and the response had no separate Buy It Now field. A mixed auction (`AUCTION` and `FIXED_PRICE`) wasn't in the spike, so what `price` holds for it is unknown. The first release leaves it blank rather than guess. That is stricter than Ted's rule. The pre-release check in §6 (V1) looks for a real mixed auction; if `price` there is the Buy It Now price, the rule loosens in a small follow-up.

### 5.4 Outcomes

| eBay answers | Result |
|---|---|
| `200` with a usable title, photo or price | the prefill |
| `404` with error `11003`, or a listing that is not for sale (ended or removed) | `NO_METADATA` |
| `200` for a group with no items, or items with none of the three fields | `NO_METADATA` |
| `401` or `403` (token or item), or `400` for any reason that doesn't lead to the group lookup (§5.2 step 3). The group call's own `400`, `401` or `403` is reported too | `LOOKUP_UNAVAILABLE`, reported to `ERROR_REPORTER` as a warning with no URL, no number and no key |
| `429`, `5xx`, a network failure, or a body that can't be read | `LOOKUP_UNAVAILABLE`, logged only |
| no answer within 5 s | `TIMEOUT` |

Logs follow Amazon and Etsy: `unfurl LOOKUP_UNAVAILABLE host=<host> provider=ebay status=<code>`. How an ended listing looks (`404`, or a `200` with an availability status) wasn't observed; the builder confirms it before release (§8).

### 5.5 The waiting state

An eBay answer takes about a second and a half, so it keeps today's short "Reading the page…" state, not the Amazon panel. The web currently uses `retailerOf()` to choose the waiting state, so the plan must make the long panel Amazon-only and check that `ebay` doesn't trigger it.

### 5.6 Secrets and a dark launch

Two new optional API variables, `EBAY_CLIENT_ID` (the App ID) and `EBAY_CLIENT_SECRET` (the Cert ID). **Both** must be set to turn eBay on; with either unset, eBay links take today's page fetch, as on previews and CI. Setting both in production and redeploying turns it on; unsetting turns it off. Never log or report an item number, an option number, a token, or either variable.

### 5.7 Privacy and terms pages

Both pages change in the release that turns eBay on (and so does the AGENTS.md "Retailer lookups" rule).

- **`/privacy`, "If you make a list":** the retailer exception names eBay with Amazon and Etsy: eBay is asked for the details instead, and is sent only the item's number (and the option's, when the link names one).
- **`/privacy`, "Who else handles your information":** eBay sees the item numbers, and option numbers, of links owners paste, and nothing about who pasted them.
- **`/terms`:** any attribution wording eBay's API licence requires, once Ted has read it (EB3).

### 5.8 Spec changes

- **D34 is not narrowed.** eBay's API is the shop's own.
- **New decisions, from D107:** eBay through the Browse API; the price rules (§5.3); item groups for links without `?var=`; `ebay.com` only, no short links; no description.
- **Retailer lookups §5.1, §5.4, §5.6** and **spec §6.8** gain eBay. The roadmap gets a new row.

## 6. Manual steps (Ted)

**EB1. Register the eBay developer account.** *Done 2026-10-31: approved the same day, production keyset issued.*

**EB2. Keep the production keyset's App ID and Cert ID** for EB4. Don't paste them anywhere else.

**EB3. Read eBay's API licence** (https://developer.ebay.com/join/api-license-agreement) while signed in, for: how long Browse data may be stored and displayed, any attribution wording, and the call limits on the app. Tell Claude what they say; eBay work starts only after this. Etsy's terms forced a prefill-only rule (D69); this design already follows it, but eBay's may differ in either direction.

**EB4. Store the keys in production** when the code is ready to turn on: `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` on the API project, entered with a hidden prompt, never echoed (AGENTS.md "Never").

**V1. After the release, with eBay turned on,** paste each of these into the add box and check the form: a fixed-price item; a live auction (price blank); a listing with options and a `?var=` (that option's photo and price); the same listing without `?var=` (title and photo, price blank when options differ); an ended listing; and, if one can be found, an auction that also offers Buy It Now (§5.3).

*Step-by-step text for EB4 and V1 also goes into `docs/deployment.md` (secrets) and `docs/operations.md`.*

## 7. Testing

- **Contracts:** `ebayItemOf` and `retailerOf` specs: slugs, tracking parameters, `?var=` edge cases, look-alike hosts (`notebay.com`, `ebay.com.evil.test`), other eBay countries.
- **Adapter spec** with a stub `fetch`: each row of §5.3 and §5.4, token failure, the `11006` fall-through to the group call, group prices equal and unequal, an unreadable body, an abort.
- **Routing spec:** eBay with and without keys, the description is dropped, the waiting state stays short.
- **A fake** `EbayLookup` in `src/testing/fakes.ts` for the integration suite.
- Behavior changes are written test-first, as everywhere else in the repo.

## 8. Left to the builder

- Confirm, with a real **ended listing**, whether eBay answers `404` or a `200` carrying an availability status, and map it to `NO_METADATA` (§5.4).
- Confirm eBay's parameter and field names against its reference where the spike used the ones that worked.
- Choose the group call's handling of very large groups (the spike's was 6 options). *(Claude suggests reading the first page only.)*

## 9. Risks

- **eBay's licence may restrict storing or showing the data.** The design is prefill-only, like Etsy's. If eBay reads its terms more strictly, the fix is to unset the two variables (EB3 reads them first).
- **A production keyset can be tied to eBay's marketplace-account-deletion compliance.** Nothing blocked the spike, but eBay may enforce it later. The failure is `LOOKUP_UNAVAILABLE`, which degrades to typing.
- **The first option's photo** on a group lookup shows one colour, which may not be the one the person meant.
- **The auction rules are narrower than Ted's** until a mixed auction is seen (§5.3).
- **eBay could change the API.** The failure path is `NO_METADATA` or `LOOKUP_UNAVAILABLE`, so it degrades to typing.
