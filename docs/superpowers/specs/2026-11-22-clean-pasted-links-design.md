# Clean pasted links (D118)

A short design. Status: approved by Ted, 2026-11-22.

## Why

A tester asked for it. Product links pasted from shops, apps and newsletters carry tracking and campaign parameters (`utm_*`, `fbclid`, Amazon's `ref=`/`pd_rd_*`, affiliate `tag=`). Hanker saves the link exactly as pasted, so gifters open, and the list carries, that tracking. The cleaned link should still lead to the same item: **when in doubt, keep it.**

This reverses one line of the retailer lookups spec's non-goals ("Saved links are the ones the owner pasted"). From now on, a *pasted* link is cleaned before the owner saves it, and the owner can see that it was.

## Goals

- When a link is pasted, known tracking, campaign and affiliate parameters are removed, along with Amazon's `/ref=…` path segment.
- Everything that might describe the item stays: any parameter not on the list, the path (apart from the rules below), and the fragment. Variant parameters (eBay `var`, Shopify `variant`, Amazon `th`/`psc`, size and colour options) always stay.
- The owner sees the cleaned link in the Link field before saving.

## Non-goals

- Rewriting links already saved.
- Cleaning in the API, or for clients that send a link without pasting it. The API saves what it is sent, as today.
- Expanding short links (`amzn.to`, `etsy.me`) to the full link. They stay as pasted.
- Unwrapping redirect links (`google.com/url?url=…`, `l.facebook.com`).
- Undo or a toggle. To keep the original link, the owner types it in rather than pasting it.

## Anti-goals

- A cleaned link that opens a different variant, or no item at all.
- A new runtime dependency, or LGPL data bundled into the app.

## Approaches

1. **Our own list in `packages/contracts`, using ClearURLs as a reference (chosen).** A pure `cleanLink()` function with global rules plus a few rules for specific sites. A parameter is removed only when we are sure it is tracking. It is easy to review, has no dependency, and leaves alone anything it doesn't know. The cost: the list grows by hand when someone reports a new tracker.
2. **Bundle ClearURLs' rule file.** It covers about 206 sites and is actively maintained, but it is LGPL-3.0 and its rules don't explain themselves. It also removes parameters that may select a variant: Amazon `th`, and eBay `hash`, whose purpose is unclear. That works against "when in doubt, keep it", and most of its coverage is sites that never end up on a wishlist. Rejected.
3. **Clean in the unfurl answer.** It could expand short links, but the edit form never calls unfurl, the field would change a second or so after the paste, and it adds a field to the contract. Rejected. Expanding short links could come later on top of approach 1.

Ted chose approach 1 with ClearURLs as a reference: we read its global, Amazon, eBay and Etsy rules, and take only the parameter names we can confirm are tracking. We copy no regexes, and the spec cites ClearURLs as a source.

## Design

**`cleanLink(url: string): string`** goes in `packages/contracts/src/links.ts`, beside `retailers.ts`, which already parses links the same way.

- It parses with WHATWG `URL`. If parsing fails, or the link isn't http(s), the input comes back unchanged.
- It removes query parameters whose name is on the global list, matched by exact, case-insensitive name, plus a `utm_` prefix rule. The starting list: `utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `igshid`, `igsh`, `si` (only on hosts where it is a share ID; see below), `_ga`, `_gl`.
- Site rules, keyed by the same host checks `retailers.ts` uses:
  - **Amazon:** remove the `/ref=…` path segment and the parameters `ref`, `ref_`, `tag`, `ascsubtag`, `linkCode`, `linkId`, `creative`, `creativeASIN`, `camp`, `pd_rd_*`, `pf_rd_*`, `pd_rd_w`, `content-id`, `qid`, `sr`, `sprefix`, `crid`, `dib`, `dib_tag`, `social_share`, `starsLeft`, `spIA`, `sp_csd`. **Keep** `th`, `psc`, `smid` (the seller whose offer was picked), `keywords` (on a search link it is the search) and every parameter not listed.
  - **eBay:** remove `_trkparms`, `_trksid`, `_from`, `mkevt`, `mkcid`, `mkrid`, `campid`, `toolid`, `customid`. **Keep** `var` and `hash`.
  - **Etsy:** remove `click_key`, `click_sum`, `organic_search_click`, `ref`, `pro`, `frs`, `sts`, `sr_prefetch`, `pf_from`, `ga_*`. **Keep** `variation*` and the rest.
- Order, repeated values and encoding of the kept parameters are preserved. If no parameter is left, the `?` goes too. Otherwise the link is unchanged, character for character, so an unaffected paste doesn't change at all.

**Where it runs (all on the web, at paste or submit of pasted text):**

- `classifyAddInput()` in `apps/web/src/lib/add-input.ts` returns `cleanLink(url)` for a link. This covers the add box and the add form's Link field (through `pastedLink()`), so the cleaned link is what fills the field, what unfurl reads, and what is saved.
- The edit form's Link field gets an `onLinkInput` that, on a paste only, swaps in the cleaned link (`setValue('url', …, { shouldDirty: true })`). It still never reads the page (D117).
- Typing in the Link field is never cleaned.

**Copy:** nothing new on the form. If the privacy page talks about links, the builder checks whether it needs a line; it shouldn't need one.

## Tests

- `links.spec.ts`: one example per rule; variants kept (Amazon `th`/`psc`, eBay `var`, Shopify `variant`, Etsy `variation0`); look-alike hosts (`notamazon.com`, `amazon.com.evil.test`) get only the global rules; a link with nothing to remove comes back exactly as given. Fast-check properties: cleaning twice gives the same result as cleaning once; the host, path (apart from Amazon `/ref=`) and fragment never change; no parameter that isn't on a list is ever removed.
- `add-input.spec.ts`: the add box and pasted shared text come out cleaned.
- E2E: paste a tracking-laden link into the add box, then check that the Link field and the saved item show the cleaned link.

## Settled while building

- The final lists are in `packages/contracts/src/links.ts`, each name with why it is tracking.
- `si` is removed only on `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be` and `open.spotify.com`.
- Amazon, eBay and Etsy rules apply only to the hosts `retailers.ts` routes (`amazon.com`, `ebay.com`, `etsy.com` and their `www.`). Other Amazon countries get only the global rules, so their `tag=` stays.
- The add box cleans what it is given whether typed or pasted, since it reads links through `classifyAddInput`. Typing in either Link field is never cleaned.
- `/privacy` is unchanged: it describes what leaves Hanker, and cleaning only reduces that.
