# Tag Suggestions — Design

- **Date:** 2026-10-23
- **Status:** Approved by Ted, 2026-10-23.
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md) §7 (an idea opens the add form instead of saving at once), [`2026-10-21-item-tags-and-filters-design.md`](2026-10-21-item-tags-and-filters-design.md) (the item form's tag field gains a suggestion row) and [`2026-10-22-retailer-lookups-design.md`](2026-10-22-retailer-lookups-design.md) (lookups also return a description, used only for suggestions). The plan assigns decision numbers from D70.
- **Origin:** Ted, in conversation on 2026-10-23. A mockup of the add form (option A, chosen) is in `.superpowers/brainstorm/` locally.

## 1. Intent

Tags (Plan 7) let gifters filter a list. The chore isn't tapping tags onto items. It's inventing the categories before you can tag anything: on a fresh list you have to decide what "Kitchen" or "Coffee" should be before you've seen what you'll add.

So Hanker suggests tags for each item, from what it already knows about the item: the product page's details for a pasted link, or the title and note for an idea. The suggestions reuse the list's existing tags when one fits, and propose a new one only when nothing does. On an empty list, the suggestions effectively build the categories for the owner. The owner only has to accept or ignore them.

## 2. Goals, non-goals, anti-goals

### Goals

- Adding an item, with or without a link, shows up to three suggested tags the owner can tap to add.
- Editing an existing item shows suggestions too, so untagged items already on a list can be tagged the same way.
- Suggestions prefer the list's existing tags. A new tag is suggested only when none fits, and it's marked as new.
- A per-account setting turns suggestions on or off. It's on by default, including for accounts that existed before this feature.
- It runs on a free tier with no way to produce a bill.
- The README describes the feature, with refreshed screenshots, and `/privacy` and `/terms` describe exactly what data is sent and why (§5.6, §5.7). *(Ted's requirement.)*

### Non-goals

- Tagging automatically. Nothing is tagged without a tap.
- Bulk tagging, such as "suggest tags for my whole list".
- Renaming, merging or cleaning up existing tags.
- Suggestions anywhere but the owner's item forms. The share page is unchanged.
- Fetching a page again to suggest tags for an item that's already saved.

### Anti-goals

These would make it a failure even if it technically works:

- **A broken or slower form.** Suggestions arrive after the form is usable and never block typing or saving. When they fail, for any reason, the row doesn't appear and the form works exactly as today.
- **A surprise bill.** Running out of the free allowance must mean no suggestions, never charges.
- **Data going somewhere the owner wasn't told about.** The privacy and terms pages name the service, and say exactly what it sees, in the same release that starts sending data to it. Turning the setting off stops the sending, enforced by the API, not just the web app.
- **Tag sprawl.** Suggesting "Cooking" when "Kitchen" is on the list defeats the point. Reuse is the default; a new tag is the exception.

## 3. What we know (evidence, 2026-10-23)

- **Cloudflare Workers AI** ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)):
  - "Cloudflare does not use Customer Content processed by Workers AI to train AI models." It "does not retain inputs or outputs after they are no longer needed."
  - Every account gets 10,000 Neurons a day, reset at 00:00 UTC. On the Workers **Free** plan there's no pay-as-you-go: past the allowance, "further operations will fail with an error."
  - Example per-million-token costs in Neurons (input / output): `gemma-4-26b-a4b-it` 9,091 / 27,273; `qwen3-30b-a3b-fp8` 4,625 / 30,475; `llama-3.2-3b-instruct` 4,625 / 30,475.
  - At about 400 tokens in and 30 out per request, that's roughly 3–5 Neurons each, or about 2,000–3,500 suggestions a day.
  - Ted already has a Cloudflare account (R2 backups, Turnstile).
- **Alternatives ruled out:**
  - Gemini API free tier: free-tier inputs may be used to improve Google's products and read by human reviewers.
  - Vercel AI Gateway: free monthly credits exist, but zero data retention is Pro and Enterprise only, and production is on Hobby.
  - Neon AI Gateway: not available on Neon's Free plan.
  - Groq: no inference data retained by default and a usable free tier, but its data page doesn't say whether it trains on API data. Runner-up.
- **Today's unfurl** returns only `title`, `imageUrl` and `priceText` (`UnfurlResponseSchema`). `extractMetadata` doesn't read a description. Bright Data's Amazon record has more fields than the three we map; which ones (description, categories) is for the builder to confirm (§8).
- **The rate limiter** (`apps/api/src/rate-limit/`) already guards unfurl at 60 per user per hour (`UNFURL_PER_USER`).

## 4. Constraints

- **Repo rules hold** (AGENTS.md): a port with a fake in `src/testing/fakes.ts`; `@Inject` on every constructor parameter; platform `fetch`, no new dependency; exact pins; problem details never echo input; unit tests never touch the network; behavior changes test-first.
- **Personal data:** logs and error reports never contain an item's title, note, description, URL or tag names, nor the API token. A log line carries the outcome and, where relevant, the HTTP status.
- **Tags (Plan 7a) hold:** a suggested name goes through `TagNameSchema`, and is matched to an existing tag with `keyOfCleanName`, never cleaned twice. Suggestions never write anything; tags are created only when the owner saves the item, through the existing item-write path.
- **Etsy (D69):** Etsy's listing data is used for the one prefill only. Nothing from Etsy beyond the title the owner sees in the form is sent to Cloudflare (§5.3).
- **Migrations are expand-only** and work alongside the deployed API (spec §10).
- **Secrets** live only in the API's Vercel production environment, set by Ted, never echoed. Previews and CI never hold them, so previews show no suggestions.

## 5. What was decided

### 5.1 The add and edit forms (Ted's decisions, mockup A)

A **"Suggested:"** row sits directly under the Tags field. Each suggestion is a dashed chip reading "+ Kitchen". A suggestion that would create a new tag carries a small "new" marker.

- **Tapping a chip** adds that tag to the field, exactly as picking it from the tag combobox would, and removes the chip from the row. An existing tag is added by `{ id }`, a new one by `{ name }`.
- **Untapped suggestions are dropped** when the form is saved or cancelled.
- **At most three suggestions** per item. *(Claude's call, agreed in playback.)*
- **Tags already on the item** are never suggested.
- **On add with a link:** suggestions are requested once the form opens prefilled.
- **On add with a link whose prefill failed or was skipped** (the form opens with an empty title): suggestions are requested when the title field loses focus with a non-empty title, and again on a later blur if the title has changed. Only the latest request's answer is shown. *(Claude's call, from the builder check.)*
- **On add without a link (an idea):** *(Ted's decision, 2026-10-23: option A.)* Typing an idea no longer saves it at once (main spec §7, `add-item.tsx`). It opens the same add form a link does, with the typed text as the title and no link. The owner can add a note, price or tags and then presses "Add to list". Suggestions are requested when the form opens, and again when the title loses focus after being changed. This makes adding an idea two steps instead of one.
  - **With suggestions off, or the service unconfigured, the idea still opens the form.** *(Claude's call: one add flow, not two that depend on a setting. The form also lets an idea get a note and tags up front, which today needs a separate edit.)*
  - Cancel discards the idea, as it discards a link today. The add box's text is kept so nothing typed is lost. *(Claude's call.)*
- **On edit:** suggestions are requested when the edit form opens.
- **While waiting, and on any failure** (setting off, service unconfigured, quota used up, rate limited, timeout, an unusable answer), the row isn't shown. There's no spinner and no error message. *(Ted agreed: "the row simply doesn't appear".)*
- **Accessibility** *(Claude's call)*: the row is a labelled group ("Suggested tags"). Each chip is a real `<button>` named "Add tag Kitchen" or "Add new tag Coffee". After a tap, focus moves to the next chip, or to the tag input when the row empties. The row's arrival isn't announced, since it's optional help, not a state change.
- **Colors** follow the existing tag chips on the theme tokens; the dashed border uses `input`. Terracotta never carries text.

### 5.2 The API (Claude's design, within Ted's decisions)

**A new route,** `POST /api/wishlist/tag-suggestions`, behind the same auth and verified-email gate as the rest of `/wishlist`.

Request (`TagSuggestionsRequestSchema` in `packages/contracts`):

| Field | Required | Notes |
|---|---|---|
| `title` | yes | the form's current title |
| `note` | no | the form's current note |
| `url` | no | only its host is used (e.g. `amazon.com`); the URL itself is never sent on |
| `description` | no | the prefill's description from unfurl (§5.3), on add only |
| `tagIds` | no | the tags already on the item, so they aren't suggested |

Lengths are capped by the schema (the builder sets caps in line with the item contract; the description at about 1,000 characters).

Response (`TagSuggestionsResponseSchema`): `{ suggestions: Array<{ id: string } | { name: string }> }`, at most three. Like unfurl, it **always answers `200`**, with an empty array for every failure, except validation (`400 VALIDATION_FAILED`) and the rate limit (`429`, the existing problem). The web app treats every non-`200` as an empty array.

**What the service does:**
1. Reads the owner's `suggestTags` setting (§5.4). If it's off, it returns `[]` **without calling Cloudflare**.
2. Enforces `TAG_SUGGEST_PER_USER`, 60 per hour, through the existing `RateLimiter`. *(Ted: reuse the existing limiter. The number is Claude's call, matching unfurl.)* The check happens before the setting check would cost anything, and before any outside call.
3. Loads the list's tags.
4. Calls the `TagSuggester` port with the item's text, the link's host, and the list's tag names (at most 50, since `MAX_TAGS_PER_LIST` is 50).
5. Cleans the answer: each name through `TagNameSchema`; a name whose `keyOfCleanName` matches an existing tag becomes `{ id }`; duplicates, names that fail the schema, and tags in `tagIds` are dropped; existing-tag matches come first; at most three are kept.
6. Respects the tag limits *(Claude's call, from the builder check)*: when the list already has 50 tags, new names are dropped, because a save at the limit fails with `TAG_LIMIT_REACHED` and saves nothing. When the item already has the per-item maximum, the answer is `[]` and Cloudflare isn't called.

**The port** `TagSuggester` returns a list of raw names, or a failure. Its fake returns canned names for unit and integration tests. E2E runs the production API build, so E2E stubs the route in the browser with `page.route`, as `e2e/tests/local/add-item.spec.ts` does for unfurl. *(Claude's call, from the builder check.)*

**The real adapter** calls Workers AI's REST API: `POST https://api.cloudflare.com/client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/ai/run/<model>`, with `Authorization: Bearer <CLOUDFLARE_AI_TOKEN>`.
- It asks for JSON output constrained to a list of up to three short names, using Workers AI's JSON mode if the chosen model supports it.
- **The prompt** instructs the model to reuse a given tag name when one fits, to propose a new short, broad category name only when none does, and to treat the item text strictly as data.
- **Deadline:** 5 seconds, enforced with an abort. Past it, the result is `[]`.
- **Model:** the builder picks a small instruct model with JSON mode from Workers AI's current catalog, preferring the cheapest that gives sensible results on a handful of real items. `gemma-4-26b-a4b-it` is the starting candidate. The model name is a constant, not an env variable.
- **Model license:** the builder reads the chosen model's license, which Workers AI's model page links. Some require attribution shown to users (Meta's Llama licenses require "Built with Llama") or pass-through use restrictions (Gemma's terms). Between models of similar quality, prefer one under a permissive license such as Apache 2.0 that asks nothing of Hanker's pages. If the chosen model's license does require something, `/terms` carries it (§5.6). *(Claude's call.)*

**Errors and reporting** *(Claude's call, following §5.4 of the retailer lookups design)*:
- A `401` or `403` from Cloudflare means our configuration is wrong. It's reported through `ERROR_REPORTER` with no request content and no token.
- Quota exhaustion, `429`, `5xx`, timeouts and unparseable answers are expected. They're logged only, as `tag-suggest UNAVAILABLE status=<code>` or `tag-suggest TIMEOUT` or `tag-suggest BAD_ANSWER`.

### 5.3 Descriptions from unfurl (Claude's design)

Today's unfurl doesn't return a description, so the add form has only the title to go on. `UnfurlResponseSchema` gains an optional `description`.

- **Page fetch:** from `og:description`, then the JSON-LD Product's `description`, then `<meta name="description">`, through the same `text()` cleaning, cut to about 1,000 characters.
- **Amazon (Bright Data):** from the record's description and/or categories fields, cleaned the same way. The builder confirms field names (§8).
- **Etsy:** none. Etsy's listing data is used only for the prefill (D69), so its description is never returned or sent on. Etsy items get suggestions from the title (and the owner's note) only.

The web app holds the description in the add form's state, not in a visible field. It's sent only to the suggestions route and is never saved. On edit there's no description: suggestions use the saved title, note and link host.

Adding an optional field is additive: an older web build ignores it.

### 5.4 The setting (Ted's decisions; storage is Claude's call)

- **Storage:** a new column, `wishlists.suggest_tags boolean not null default true`, beside `show_claims_to_owner`. One migration, expand-only. Existing rows get `true`, as Ted chose.
- **Contracts:** `suggestTags` joins `WishlistResponseSchema`, `WishlistSettingsResponseSchema` and `UpdateWishlistRequestSchema`, optional for expand/contract like `showClaimsToOwner`.
- **Settings page:** a switch in `/settings`, in the list section, alongside the claims setting. *(Copy, Claude's draft:)* **"Suggest tags"** — "When you add or edit an item, Hanker asks Cloudflare's AI to suggest tags from its title, note and shop details. Cloudflare doesn't keep or learn from them."
- **Turning it off** stops all requests: the web stops asking, and the API returns `[]` without calling Cloudflare even if an old tab asks.

### 5.5 Secrets and a dark launch *(Claude's call)*

Two new optional variables in the API's env schema, set together or not at all:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_TOKEN`: an API token scoped to **Workers AI: Read and Edit** (Cloudflare's REST guide says a custom token needs both to run models), on that account only.

**Unset** means the port's "unconfigured" adapter, which always returns `[]`. That's how it ships, and how previews and CI behave. The settings switch shows regardless.

### 5.6 Privacy and terms pages (Ted's decision; wording is Claude's to draft and Ted's to check)

Both pages change in the release that sets the token in production, and their "updated" dates change with them. Every claim is checked against the code and Cloudflare's published terms before release, as Plan 6 did.

**What is sent, exactly** (the pages must say no more and no less than this): for one item, its title, its note, the host of its link (not the link), the shop's description of the product on add (never for Etsy), and the names of the list's tags. Nothing identifying the owner (no email, name, account or IP address) and nothing from gifters or claims is sent.

**`/privacy`:**
- **"If you make a list":** a new sentence: "Unless you turn it off in Settings, Hanker sends an item's title, note, shop name and the shop's product description, with your list's tag names, to Cloudflare's AI to suggest tags for it."
- **"Who else handles your information":** the Cloudflare entry gains: "Cloudflare's AI reads the title, note and shop details of items you add or edit, and your list's tag names, to suggest tags. It isn't told who you are, doesn't keep what it reads, and doesn't train on it. You can turn this off in Settings."
- **"How long it's kept":** nothing new is stored, so nothing changes, unless the builder finds Cloudflare retention that contradicts §3.

**`/terms`:**
- **"Your list is yours"** stops being true as written ("You give Hanker only the right to store it and show it to anyone with your link"). It becomes: "You give Hanker only the right to store it, show it to anyone with your link, and, unless you turn tag suggestions off, send an item's details to Cloudflare to suggest tags."
- **A new short section, "Suggested tags":** "Tag suggestions are written by an AI model and can be wrong or odd. They're only suggestions: nothing is tagged unless you tap it."
- **Model attribution,** only if the chosen model's license requires it (§5.2).

### 5.7 README (Ted's requirement)

The README describes the feature and its screenshots are refreshed in the release that turns it on.

- **"What it does":** the Owners bullet gains tags and suggestions. For example: "They tag items so gifters can filter, and Hanker can suggest tags from the shop's details, reusing the list's own tags." The builder may add one line to "Decisions worth a look" on choosing a free tier that doesn't train on or keep the data.
- **Screenshots:** `editor.png`, `share.png` and `claim.png` are retaken from the current UI, which has changed since 2026-10-20 (tags, the share page's filter row). A fourth, `suggestions.png`, shows the add form with the "Suggested:" row, one existing tag and one marked "new". *(Claude's call: a new image rather than replacing the editor shot.)*
- **How they're taken:** from a local stack with the same made-up sample data and phone and desktop sizes as today. The suggestion row comes from the route stubbed with `page.route`, so no Cloudflare token is needed. Each image gets alt text in the README's existing style. Whether this becomes a script (for example a Playwright file under `e2e/` that isn't part of CI) is the builder's call.

### 5.8 Spec changes

- **New decisions, from D70:**
  - Tag suggestions through Cloudflare Workers AI, on the Workers Free plan, behind a `TagSuggester` port.
  - Suggestions are optional help: always `200`, silent on failure, never auto-applied.
  - `suggestTags`, on by default.
  - Unfurl returns a description for suggestions only; never for Etsy.
- The tags design's §4 (the item form) gains the suggestion row.
- **Main spec §7 amended:** "Anything else becomes an item at once, titled with the text" becomes "Anything else opens the add form, titled with the text." The add box's messages, focus handling and the E2E tests that add ideas with one press (`golden-path`, `list`, `add-item`, `focus`, and any others the builder finds) change with it.
- The roadmap gains this as Plan 9. The plan decides whether it splits into API and web layers.

## 6. Manual steps (Ted)

**C1. Confirm the Workers plan is Free.** In the Cloudflare dashboard, Workers & Pages → Plans, check the account is on **Workers Free**, not Workers Paid. On Paid, usage past the allowance is billed. *This is the step that makes "no surprise bill" true.* R2 is billed separately and isn't affected.

**C2. Create the API token** (when the feature is ready to turn on). My Profile → API Tokens → Create Token → Custom token:
- Permissions: Account → **Workers AI** → **Read** and **Edit**.
- Account resources: only this account.
- No IP filtering, and a TTL is optional.

Copy the token, and the **Account ID** from the account's overview page. Don't paste them anywhere yet.

**C3. Store both in production,** following `docs/deployment.md`'s pattern (hidden prompts, piped straight into Vercel):
```bash
read -rs A && printf %s "$A" \
  | npx --yes vercel@64.5.0 env add CLOUDFLARE_ACCOUNT_ID production --sensitive --project wishlist-api --scope shockolate
read -rs T && printf %s "$T" \
  | npx --yes vercel@64.5.0 env add CLOUDFLARE_AI_TOKEN production --sensitive --project wishlist-api --scope shockolate
unset A T
```
Then redeploy: `gh workflow run deploy.yml --ref main`.

**V1. After it's turned on,** in production on your own list: add an Amazon link, a page-fetch link, an Etsy link and an idea, and edit one existing item. Check that each gets sensible suggestions, that existing tags are reused, and that turning the setting off removes the row.

*C1–C3 and V1 also go into `docs/deployment.md`. `docs/operations.md` gains where to see Workers AI usage, and what the `tag-suggest` log lines mean.*

## 7. Order of work *(Claude's proposal; the plan may refine it)*

1. **C1, first.** If the account is on Workers Paid, stop and decide with Ted before going further.
2. **Contracts:** the suggestions request and response, `description` on unfurl, `suggestTags` on the wishlist schemas.
3. **API:** the migration and setting; the port, the unconfigured adapter, the fake and the real adapter; the route with its rate limit and answer cleaning; descriptions from page fetch and Amazon. Ships dark.
4. **Web:** ideas open the add form (its own layer, since it changes a core flow and existing E2E, and is useful with suggestions dark); the setting switch; the suggestion row in the add and edit forms; E2E with the route stubbed.
5. **Turn on:** the privacy and terms pages (§5.6) and the README with refreshed screenshots (§5.7) in the same release; Ted runs C2, C3, then V1.
6. **Docs:** spec amendments (§5.8), roadmap, `deployment.md`, `operations.md`.

## 8. Left to the builder

- The model, from Workers AI's catalog, within §5.2, and the prompt wording.
- How JSON output is requested, per the chosen model's support.
- Bright Data's description and category field names, from its docs or the 8a fixtures.
- Exact length caps on the request fields.
- Module layout: where the port and route live (a new `tag-suggest/` module or inside `wishlist/`).
- Chip markup and the row's layout within §5.1 and the mockup.
- How the web app cancels a stale request when a newer one starts.

## 9. Risks

- **Prompt injection from a product page.** A page description could contain instructions. The answer is constrained to at most three tag names, cleaned through `TagNameSchema`, and only ever offered, never applied. The worst case is an odd suggestion the owner ignores. *Accepted.*
- **Poor suggestions.** A small model may propose tags that are too narrow or too many new ones. V1 checks this, and the prompt or model can change without a schema change.
- **Cloudflare changes its free allowance or retires the model.** The failure path is `[]`, so it degrades to today's form.
- **Shared daily allowance.** One heavy user could use up the day's allowance for everyone; the per-user limit bounds this at 60 an hour. The worst case is no suggestions until 00:00 UTC.
- **The model's license** could require attribution or pass-through terms that change `/terms` (§5.2, §5.6).
- **Etsy's terms.** Sending the owner's form title (which came from Etsy's prefill) to Cloudflare is treated as the owner's own entry, consistent with D69's reading. If Etsy objects, Etsy items can skip suggestions on add.

## 10. Resolved after the builder check

- **Ideas (no link).** An idea was saved at once, with no form to show suggestions in. Ted chose (2026-10-23) that ideas open the add form (§5.1, §5.8), over saving at once and suggesting on the new row, or suggesting only on edit.
