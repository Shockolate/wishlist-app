# Retailer Lookups (Amazon and Etsy) — Design

- **Date:** 2026-10-22
- **Status:** Approved by Ted, 2026-10-22. On the same day, the Etsy Personal App was submitted (E1) and approved (E2), and Ted read Etsy's API terms (E3). Amazon shipped as Plan 8a, and Etsy follows as Plan 8b.
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md). §6.8 gains retailer lookups and a failure code. D34 is narrowed (§5.8). §7's add box gains a waiting panel. The plan assigns decision numbers from D64.
- **Origin:** Ted pasted Amazon and Etsy links into his own list on 2026-10-22, and neither filled in. He decided everything below in conversation that day.

## 1. Intent

When an owner pastes a product link, Hanker fills in the title, photo and price so they only have to check it. That works for most shops. It fails for the two that matter most to Ted's family:

- **Etsy** refuses unfurl outright.
- **Amazon** answers Hanker's server with a bot-check page.

So every Amazon or Etsy item gets typed in by hand, which is the chore unfurl exists to remove. The goal is for a pasted Amazon or Etsy product link to fill in like any other shop's.

Hanker can't fix this by fetching the page harder. D34 forbids impersonating a browser, and §3 shows it wouldn't work against Etsy anyway. Instead, these two shops get looked up through services built to answer that question:

- **Etsy:** Etsy's official API.
- **Amazon:** Bright Data's Amazon scraper. Ted chose this knowingly, as a narrowing of D34 (§5.8).

## 2. Goals, non-goals, anti-goals

### Goals

- An amazon.com product link, including a short link and one full of tracking parameters, prefills the title, photo and price.
- An Etsy listing link, including a short link, prefills the title, photo and price.
- While an Amazon lookup runs, the add box says so, says it can take up to half a minute, and offers a way out (§5.5).
- When a lookup can't be done (credits used up, a service down, a slow answer), the form opens with the link kept and a sentence asking the owner to fill in the details.
- Every manual step (accounts, app registration, secrets) is written out step by step in the plan and in `docs/deployment.md` / `docs/operations.md`, so Ted can follow them without reconstructing anything.

### Non-goals

- Amazon sites other than amazon.com, such as .co.uk or .ca. They keep today's page fetch.
- Amazon or Etsy links that aren't a single product, such as search results, shop pages or storefronts. They keep today's page fetch.
- Refreshing prices or availability after an item is saved. D9's "no price refresh" stands.
- Paying for lookups. No money is kept on deposit with Bright Data.
- Affiliate links. Saved links are the ones the owner pasted.
- Any other retailer.

### Anti-goals

These would make it a failure even if it technically works:

- **Hanker posing as a browser.** D34 still holds for Hanker's own requests. Only Amazon lookups are delegated (§5.8).
- **An owner stuck on a spinner.** The wait is bounded at 30 seconds and can be skipped at any time.
- **A surprise bill.** Running out of free lookups must degrade to typing the details in, never to charges.
- **Leaking more than needed.** Bright Data and Etsy receive only the product identifier, never the owner's tracking parameters, search terms or session IDs (§5.2, §5.3). No personal data goes to either.
- **A privacy page that becomes untrue.** It changes in the same release that starts sending links to these services (§5.7).

## 3. What we know (evidence, 2026-10-22)

- **Production logs:**
  - Etsy: `unfurl BLOCKED_BY_SITE host=www.etsy.com` at 12:27 and 12:28 UTC.
  - Amazon: `unfurl NO_METADATA host=www.amazon.com` at 12:33:19 UTC (region `cle1`). `NO_METADATA` only comes from a page under 1 MB, and Amazon's real product page is about 2.4 MB, so production was served a small bot-check page.
- **Etsy** sits behind DataDome. It answers `403` (`x-datadome-riskscore: 0.957`) to Hanker's user agent, and also to a Chrome user agent from a residential IP.
- **Amazon from a residential IP** serves the real page, but it has no Open Graph tags and no JSON-LD. Only `<title>` matches today's parser.
- **Tracking parameters made no difference** to any of this.
- **Bright Data spike** (synchronous `POST /datasets/v3/scrape`, `dataset_id=gd_l7q7dkf244hwjntr0`, the Amazon Products dataset, from Ted's free-tier account):

  | Link | Time | Result |
  |---|---|---|
  | Frosthaven Play Surface (long search link with tracking) | 21.8 s | title, image, price, currency |
  | Scenery pack (clean link) | 4.2 s | all four |
  | Display case (`?ref=` link) | 7.4 s and 9.1 s | all four |
  | Frosthaven board game | 10.7 s | all four |

  The fields are `title`, `image_url` (1500 px, https), `final_price` (a number) and `currency` (`USD`). The titles are clean, without the "Amazon.com: … : Category" wrapping. A brand-new account answered `400 Customer is not active` until it was activated.
- **Bright Data terms:**
  - Free tier: 5,000 records a month, no card. Credits reset on the 1st and don't roll over.
  - With no funds on deposit, requests fail once credits are used up.
  - The synchronous call gives up at 60 s and then returns `202` with a `snapshot_id`.
- **Etsy Open API v3:**
  - Public listing reads need only `x-api-key: <keystring>:<shared_secret>`.
  - A non-seller registers a **Personal App**, which Etsy reviews by hand against a stated use case, at limited scale. The review takes an unknown time.
  - The terms require the app to state that "Etsy" is Etsy, Inc.'s trademark and that the app isn't endorsed by Etsy.
  - Screen-scraping Etsy is forbidden.
  - The API Terms page (`etsy.com/legal/api`) returned 403 to our fetch, so its **caching rules haven't been read** (§6, step E3).

## 4. Constraints

- **Repo rules hold:**
  - Ports with fakes in `src/testing/fakes.ts`.
  - `@Inject` on every constructor parameter.
  - Exact version pins, and platform `fetch` rather than a new dependency.
  - Problem details never echo the input.
  - Logs carry the host and the reason, never the URL.
  - Unit tests never touch the network.
- **Unfurl's contract is unchanged:** `POST /wishlist/unfurl` always answers `200`, never throws, and a failure carries a `failureReason`.
- **Unchanged limits:**
  - The rate limit stays 60 per hour per user (spec §6.6).
  - Today's 5-second page fetch, SSRF rules and parser are unchanged for every other link.
- **Secrets:**
  - They live only in the API's Vercel production environment, are set by Ted, and are never echoed (AGENTS.md).
  - Previews and CI never hold them, so previews behave as today (§5.6).
- **A link longer than 30 seconds must work end to end:** browser → `/api` rewrite on the web project → API function. The API client sets no timeout of its own. Vercel gives an external rewrite's origin 120 seconds to start answering ([changelog](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes)), which covers our 30. Step V1's 20-second link confirms it in production. Locally, `next dev`'s own rewrite proxy defaults to 30 seconds, which only matters if a developer sets a real key.

## 5. What was decided

### 5.1 Which links go where

One classifier, `retailerOf(url)`, lives in `packages/contracts` so the web and the API agree. It returns `amazon`, `etsy` or nothing. *(Claude's call.)*

| Link | Retailer | What's sent |
|---|---|---|
| `amazon.com` or `www.amazon.com`, path containing `/dp/<ASIN>` or `/gp/product/<ASIN>` | amazon | `https://www.amazon.com/dp/<ASIN>` |
| `amzn.to/…`, `a.co/…` | amazon, once followed | as above, after the redirect lands on a product link |
| `etsy.com` or `www.etsy.com`, path `/listing/<id>` (with any slug, query or locale prefix such as `/uk/listing/…`) | etsy | the listing ID |
| `etsy.me/…` | etsy, once followed | as above |
| anything else, including other Amazon or Etsy pages | none | today's page fetch, unchanged |

An ASIN is 10 characters, `[A-Z0-9]`.

**Short links:** these are followed under §6.8's existing hop rules (scheme, port, vetted addresses, at most 3 hops). Only the `Location` headers are read, and the final page is never fetched.
- If the last hop lands on a recognized product link, it's looked up.
- Otherwise the outcome is `NO_METADATA`. The final page isn't fetched, since it would be a bot check or a `403`. *(Claude's call.)*

### 5.2 Amazon, through Bright Data (Ted's decision)

**The request:** a new port, `AmazonLookup`, whose real adapter calls `POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l7q7dkf244hwjntr0&format=json`.
- Header: `Authorization: Bearer <BRIGHT_DATA_API_KEY>`.
- Body: `{"input":[{"url":"https://www.amazon.com/dp/<ASIN>"}]}`, one input per request.
- Only the canonical URL is sent. The owner's own link, with its search terms, `dib` session blobs and `ref` tags, never leaves Hanker.

**Deadline:** 30 seconds for the whole lookup, short-link hops included, enforced with an abort. *(Ted's choice in the panel's wording.)* Past it, the result is `TIMEOUT`. A `202` with a snapshot (past Bright Data's own 60 s) can't happen inside our deadline. If it somehow arrives, it counts as `TIMEOUT`, and the snapshot is never polled.

**Mapping:**

| Field | Taken from | Rules |
|---|---|---|
| `title` | `title` | through the same `text()` and 200-character `truncate()` as today |
| `imageUrl` | `image_url`, else `images[0]` | through the same https-only `httpsUrl()` check |
| `priceText` | `final_price` and `currency` | through `formatPrice()`, e.g. `240` + `USD` → `"$240.00"` |

All three helpers are today's (`apps/api/src/unfurl/metadata.ts`).

**Outcomes:**

| Bright Data answers | `failureReason` |
|---|---|
| `200` with a record that has a usable title, image or price | none, the prefill |
| `200` with an empty array, or a record that has none of the three, or a record with an error | `NO_METADATA` |
| out of credits, `429`, `5xx`, a network failure, or any other non-`200` | `LOOKUP_UNAVAILABLE` (§5.4) |
| no answer within 30 s | `TIMEOUT` |

### 5.3 Etsy, through the Open API (Ted's decision)

**The request:** a new port, `EtsyLookup`, whose real adapter calls `GET https://api.etsy.com/v3/application/listings/<id>` with the listing's images included.
- Header: `x-api-key: <ETSY_API_KEY>`, where the value is `keystring:shared_secret`.
- Only the listing ID is sent.
- The builder confirms the exact parameter and field names against Etsy's reference (§8).

**Deadline:** 5 seconds, the same as today's page fetch. Etsy links keep today's short "Reading the page…" state.

**Mapping:**

| Field | Taken from | Rules |
|---|---|---|
| `title` | the listing title | HTML entities decoded (Etsy returns titles entity-encoded), then the same `text()` and truncation as Amazon |
| `imageUrl` | the first image by rank, at a large size | the same https-only check |
| `priceText` | the price's `amount ÷ divisor` and `currency_code` | through `formatPrice()` |

**Outcomes:** a listing that isn't found or isn't active (removed, sold out, a draft) is `NO_METADATA`. A service failure is `LOOKUP_UNAVAILABLE`.

**Caching (read in E3, 2026-10-22):** Etsy's API Terms of Use say:

> You will not display listing content more than six (6) hours older than the corresponding information on the Etsy Site or the Etsy Apps. You will not display any other Etsy content more than twenty-four (24) hours older than the content displayed on the Etsy Site or the Etsy Apps. Once you’ve accessed, stored, or displayed Etsy content, you will not cache or store it longer than is reasonably necessary to provide service to your Application’s users.

Read strictly, this rules out keeping Etsy's title, photo and price on a saved item. **Ted's decision: prefill only.**
- The API is called once, when the owner pastes the link, to fill in the add form.
- What the owner saves is their own entry. Hanker never refreshes it, and never calls Etsy again for a saved item.
- The accepted risk is that Etsy reads the terms more strictly and revokes the key. Etsy links would then go back to being typed in by hand, and the fix is to unset `ETSY_API_KEY`.

The alternatives were refreshing Etsy items every 6 hours, which means a schema change and Etsy calls on page views, and not building Etsy lookups at all.

### 5.4 When a lookup can't be done (Ted's decision)

A new failure code, `LOOKUP_UNAVAILABLE`, joins `UNFURL_FAILURE_REASONS` in `packages/contracts`.

- **Copy:** "We couldn't get the details from Amazon right now, so fill them in yourself." The shop name is filled in: "from Amazon" or "from Etsy". *(Ted's wording, condensed by Claude.)* *(Reworded 2026-10-27 to "We couldn’t get the details from Amazon just now. Add them below.", with the other prefill messages.)*
- **Why a new code:** `BLOCKED_BY_SITE`'s "That shop didn't let us read the page" would be untrue when the cause is our credits or a service outage.
- **Reporting** *(Claude's call)*:
  - A `401` or `403` from either service, or Bright Data's `404` for an unknown `dataset_id`, means our configuration is wrong. These are reported through `ERROR_REPORTER` once per occurrence, with no URL and no key.
  - Out of credits, `429` and `5xx` are expected. They're logged only, as `unfurl LOOKUP_UNAVAILABLE host=<host> provider=<amazon|etsy> status=<code>`.
- **Rollout:** adding an enum value is additive. A web build older than the API would fail to parse the new code and fall through to the generic `UNFURL_FAILED` sentence, which is harmless. The plan still ships contracts and web before the API starts sending it.

No alert fires when credits run out. Ted reads usage in Bright Data's dashboard, and `docs/operations.md` says where.

### 5.5 The waiting panel (Ted's choice: mockup B)

When the box holds a link that `retailerOf()` calls `amazon`, submitting shows a panel under the read-only link in place of today's "Reading the page…" line:

- a spinner;
- **"Getting the details from Amazon…"**;
- the line **"Amazon can take up to half a minute."**;
- a **"Skip, I'll type them"** button.

How it behaves:
- **On an answer:** the item form opens prefilled, as today.
- **On Skip:** the browser aborts its request, and the form opens with just the link and the sentence "Fill in the details yourself." The lookup may still finish on the server and use a record, which is accepted.
- **Focus and announcements** follow today's add box: the status text sits in the existing `role="status"` region, and Skip is a real `<button>`. After Skip, focus goes to the form's first field.
- **Colors:** the spinner may use the terracotta `primary` (it carries no text), with the rest on the theme tokens. *(Claude's call.)*
- **Reduced motion:** with `prefers-reduced-motion`, the spinner doesn't spin, and the text alone carries the state. *(Claude's call.)*

Etsy links and every other link keep today's "Reading the page…" state unchanged.

### 5.6 Secrets and a dark launch *(Claude's call)*

Two new optional variables join the API's env schema:
- `BRIGHT_DATA_API_KEY`
- `ETSY_API_KEY` (`keystring:shared_secret`)

How they behave:
- **Unset:** that retailer's links go through today's page fetch, exactly as now. That's how the code ships dark, and how previews and CI behave.
- **Set:** setting one in production and redeploying turns that retailer on. Unsetting it and redeploying turns it off. No code change is needed either way.
- **The web panel** doesn't know whether the key is set. If Amazon is dark, the panel shows briefly and the page fetch answers in under 5 seconds. *(Accepted.)*

### 5.7 Privacy and terms pages (Ted's decision; wording is Claude's to draft and Ted's to check)

Both pages change in the release that turns each retailer on.

- **`/privacy`, "If you make a list":** the sentence about Hanker's server visiting the page gains an exception: "For Amazon and Etsy product links, Hanker asks Bright Data (Amazon) or Etsy for the details instead, sending only the product's ID."
- **`/privacy`, "Who else handles your information":**
  - Bright Data: it sees the Amazon product IDs of links owners paste, and nothing about who pasted them.
  - Etsy: it sees the listing IDs of Etsy links.
- **`/terms`:** Etsy's required statement, as the second paragraph of "Shops and gifts", verbatim from Etsy's terms (read in E3): "The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy." This replaces the draft wording. Etsy asks for the statement to be displayed "prominently", and Ted kept `/terms` knowing that (2026-10-22).

### 5.8 Spec changes

- **D34 narrowed:** Hanker's own requests still identify honestly and never impersonate a browser. Amazon product lookups are delegated to Bright Data, a third party that gets past Amazon's bot defenses. Ted accepted this on 2026-10-22, knowing that Amazon's Conditions of Use forbid automated data gathering.
- **New decisions, from D64:**
  - Amazon through Bright Data, with its 30 s deadline and the canonical `/dp/<ASIN>` URL.
  - Etsy through the Open API.
  - `LOOKUP_UNAVAILABLE`.
  - The waiting panel.
  - No deposit, and no global lookup cap.
- **§6.8** gains a "Retailer lookups" subsection summarizing §5.1–§5.4, and its failure list gains `LOOKUP_UNAVAILABLE`.

## 6. Manual steps (Ted)

The Etsy registration is started first, because its review time is unknown.

**E1. Register the Etsy app (day one, before any code).**
1. Create or sign in to an Etsy account, then open https://www.etsy.com/developers/register.
2. Choose a **Personal App**. Name it "Hanker", with website `https://hanker.dev`.
3. Describe the use case in plain terms: "A family wishlist. When an owner pastes an Etsy listing link, Hanker reads that one listing's title, first photo and price to prefill their item. Read-only public listing data, a few lookups a day, no seller data, no OAuth."
4. Submit, and note the date. Check "Apps You've Made" for the status.

**E2. When Etsy approves** (done 2026-10-22), copy the **keystring** and **shared secret** from "Apps You've Made". Don't paste them anywhere yet (E4 stores them).

**E3. Read Etsy's API Terms of Use** (https://www.etsy.com/legal/api) while signed in to the developer portal, for:
- the caching rules;
- the trademark statement's exact wording;
- the rate limits shown for the app.

Tell Claude what they say. Etsy work starts only after this (§5.3).

*Done 2026-10-22.* The caching rules are in §5.3, and the statement is in §5.7. The app's rate limits are 5 requests a second and 5,000 a day.

**E4. Store the Etsy key in production** (when the Etsy layer is ready to turn on). This follows `docs/deployment.md`'s pattern: hidden prompts, piped straight into Vercel. Paste the keystring at the first silent prompt and the shared secret at the second:
```bash
read -rs K && read -rs S && printf '%s:%s' "$K" "$S" \
  | npx --yes vercel@64.5.0 env add ETSY_API_KEY production --sensitive --project wishlist-api --scope shockolate
unset K S
```
A runtime variable applies to the next deployment, so redeploy `main` and wait for every job to pass: `gh workflow run deploy.yml --ref main`.

**B1. Bright Data account** (done 2026-10-22): free tier, activated, API key created.

**B2. Store the Bright Data key in production** (when the Amazon layer is ready to turn on):
Paste the key at the silent prompt:
```bash
read -rs K && printf %s "$K" \
  | npx --yes vercel@64.5.0 env add BRIGHT_DATA_API_KEY production --sensitive --project wishlist-api --scope shockolate
unset K
```
Then redeploy: `gh workflow run deploy.yml --ref main`.

**B3. Never add funds** to the Bright Data account. With no deposit, running out of credits means lookups fail, never charges (§5.4).

**V1. After each retailer is turned on,** paste one real product link into your own list in production, and confirm the prefill. For Amazon, use one tracking-laden link and one short link.

*Step-by-step text for E1–E4, B2, B3 and V1 also goes into `docs/deployment.md` (secrets) and `docs/operations.md` (checking Bright Data usage; what `LOOKUP_UNAVAILABLE` in the logs means).*

## 7. Order of work *(Claude's proposal; the plan may refine it)*

1. **E1, today.** Ted registers the Etsy app.
2. **Rewrite check:** settled by Vercel's documented 120-second limit (§4). V1 confirms it with a slow link, so there's no throwaway preview route.
3. **Shared pieces:** `retailerOf()`, `LOOKUP_UNAVAILABLE` and its copy in contracts and web.
4. **Amazon:** the port, the adapter and its fake, short-link following, routing in `HttpMetadataFetcher`, the env variable, and the waiting panel. Ships dark. Ted runs B2, then V1. The privacy page change rides in the same layer.
5. **Etsy,** once E2 and E3 are done: the port, the adapter and its fake, `etsy.me` following, the env variable, and the privacy and terms changes. Ships dark. Ted runs E4, then V1.
6. **Docs:** the spec amendments (§5.8), and the roadmap gains this as Plan 8 (8a Amazon, 8b Etsy).

If Etsy's review is still pending when Amazon is done, Amazon ships alone.

## 8. Left to the builder

- Module layout. For example, whether `AmazonLookup` and `EtsyLookup` are separate ports or one `RetailerLookup` port with two adapters, and how `HttpMetadataFetcher` routes to them.
- The exact Etsy endpoint parameters and response fields, confirmed against Etsy's API reference.
- How Bright Data signals "out of credits": status and body, found by reading its docs or, if it can be done safely, by observing it.
- Test fixtures, recorded from the spike's response shape. The real key never goes in a fixture.
- Spinner markup and animation, within §5.5.
- The doc wording, within §5.7 and §6.

## 9. Risks

- **Bright Data could change its dataset, prices or free tier,** or Amazon could defeat it. The failure path is `LOOKUP_UNAVAILABLE` or `NO_METADATA`, so it degrades to typing.
- **Etsy could decline the Personal App.** Etsy links then stay as today, and Ted decides whether to apply again.
- **Latency:** five samples ranged from 4 to 22 seconds. Slower answers become `TIMEOUT` at 30 seconds.
