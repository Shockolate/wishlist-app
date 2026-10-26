# Share Link Previews — Design

- **Date:** 2026-10-26
- **Status:** Approved by Ted, 2026-10-26. The builder check's questions were answered by Ted the same day (§8). Plan 12 implements it (D90–D92).
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-21-site-trust-basics-design.md`](2026-10-21-site-trust-basics-design.md) §2's anti-goal "A link preview that leaks something" and §4.5's share-page rules, with D56; and [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md) §6.8's rule that the server never fetches an item's image. The plan assigns decision numbers from the next free one (D90 at the time of writing).
- **Origin:** Ted, in conversation on 2026-10-26. The layout mockups (option A, chosen) and its fallbacks are in `.superpowers/brainstorm/` locally.

## 1. Intent

When Ted pastes his share link into a family group chat, the preview shows the list's title, the line "Pick a gift so nobody doubles up." and Hanker's tagline image. It looks the same for every list. Nothing in it says *this* list is worth opening.

The preview should look like the list it opens: whose it is, roughly how big it is, and a glimpse of what's on it, as photos of a few items. A family member scrolling the chat should recognise it as Sam's list before tapping.

Plan 6 deliberately kept everything but the title out of the preview (its anti-goal "A link preview that leaks something"). This design reverses that on purpose, for the item count and a few item photos, and keeps the part of that rule that still matters: nothing about claims.

## 2. Goals, non-goals and anti-goals

### Goals

- A share link's preview image shows the list's title, the number of items, and photos of up to four items.
- The text under the image names the owner and the count.
- The preview degrades gracefully: fewer photos, no photos, an empty list, or a photo that won't load still give a good-looking preview.
- It works in iMessage, Slack and Discord, the apps Ted's family and friends use.

### Non-goals

- Changing the preview of any page other than `/s/[shareToken]`. The site default (D56's static image) stays for every other page, including `/c/[manageToken]`.
- AI-chosen emoji or illustrations. Ted considered them on 2026-10-26 and chose photos. A fixed icon in empty grid spots may be worth revisiting if many lists turn out to be mostly ideas.
- Letting the owner choose which items appear, or turn the preview off.
- Keeping previews current. Chat apps fetch a preview once, usually when the link is first pasted, and keep it. A list edited later doesn't change a preview already posted, and Hanker can't make it.

### Anti-goals

These would make it a failure even if it technically works:

- **A preview that hints at claims.** No "5 left", no "3 claimed", nothing that differs because something was claimed. The owner pastes their own link too and sees the same preview, so it would spoil the surprise. The count is items on the list, never remaining or claimed.
- **A preview that fails or hangs.** If photos can't be fetched in time, the preview still appears, with fewer photos or none. A broken image is worse than today's static one.
- **A photo fetch the owner can aim at Hanker's own network.** The owner can type any https `imageUrl`. Hanker fetching it is server-side request forgery unless it goes through the same address checks as unfurl (§6.8).
- **A share token reaching anywhere it doesn't already go.** See §5.3.

## 3. What the preview shows

### 3.1 The image (layout A)

1200×630, on the cream background (`--background`), in the same type as today's static image:

- **Left:** the gift tag and "Hanker" wordmark at the top (as on `hanker-preview.png`). At the bottom, the list's title in Instrument Serif, large, and under it "N things on the list" in Geist, in `--muted-foreground`.
- **Right:** a square photo grid, about 500px a side at full size, with small gaps and rounded corners. Photos are cropped to fill their tiles (cover), never stretched.

### 3.2 Which photos

The first four items, in the list's own order (`position`), that have an `imageUrl` whose photo arrives in time and in a usable format. An item whose photo fails is skipped, and the next item with a photo is tried, until four photos or the time budget runs out. Items without a photo still count toward N.

### 3.3 Fallbacks

| Photos that arrived | Grid |
|---|---|
| 4 | 2×2 |
| 3 | One tall tile on the left, two stacked on the right |
| 2 | Two tiles side by side |
| 1 | One tile filling the square |
| 0 | No grid. The title is set larger and takes the width |

An empty list shows "Nothing on the list yet" in place of the count, with no grid.

### 3.4 The text under the image

- **Title (`og:title`, `<title>`):** the list's title, as today.
- **Title in the picture:** the same title, minus any character that Instrument Serif and Geist can't draw, such as emoji and non-Latin scripts. `next/og` would otherwise fetch a fallback font or emoji set from a CDN while drawing, and the picture makes no outbound request except to the API. `og:title` keeps the full title.
- **Description:** "12 things on Sam’s list. Pick a gift so nobody doubles up." "1 thing" for one. An empty list: "Nothing on Sam’s list yet." The name is `ownerDisplayName` with `’s` appended, always (so "James’s"). *(Wording is Claude's call; Ted can change it.)*
- **Image alt (`og:image:alt`):** "Sam’s wishlist: 12 things on the list" (the title, then the count line). *(Claude's call.)*

N counts items, not quantities. An item with quantity 3 is one thing.

## 4. Constraints

Everything in [AGENTS.md](../../../AGENTS.md) applies: exact pins, platform APIs over new dependencies, test-first behaviour changes, the nonce CSP, theme tokens, and the personal-data rules for logs and Sentry.

## 5. How it gets made

### 5.1 Fetching photos (decided by Ted, 2026-10-26)

Hanker's server downloads item photos to build the image. This reverses §6.8's "the server never fetches it" for this one purpose. Every photo fetch obeys §6.8's rules as unfurl does: https only on every hop (the first URL and each redirect; a refused hop is `INVALID_URL`), port 443 only (`PUBLIC_HTTPS`), no userinfo, the c-ares resolver, the address allowlist, connecting to the vetted IP, at most 3 redirect hops each re-checked, and the `Hanker/1.0` User-Agent. The existing code for this lives in the API (`apps/api/src/unfurl/address-policy.ts`, `dns.ts`, `page-fetcher.ts`); the web app has no such guard, so **no photo is fetched from the web app directly**.

Limits *(Claude's calls)*:

- Accept `image/jpeg`, `image/png` and `image/webp`. The web app converts each to what `next/og` draws (§5.2). Anything else is skipped.
- At most 2 MB per photo, counted as it streams, and skipped if larger.
- Each photo travels in its own response, never several in one: a Vercel Function's response body is capped at 4.5 MB, and four photos of up to 2 MB each could exceed it.
- A total budget of 3 seconds for all photos, fetched in parallel. Chat apps give up on slow previews within a few seconds.
- No photo or composed image is stored in the database, in Blob storage or on disk.
- Logs carry at most the photo's hostname and a failure reason, never the URL (as §6.8).

### 5.2 Where the image is built (decided by Ted, 2026-10-26)

The web app builds the image with Next's built-in `next/og` (`ImageResponse`), in the site's own fonts. It picks the candidate items from `GET /shared/:shareToken/preview`, a response with no claim fields (§5.4), and gets each photo from a new API endpoint on the share token and item, which fetches it under §5.1's rules and enforces the limits. One photo per request (§5.1).

**Image optimisation (decided by Ted, 2026-10-26):** the web app uses `sharp` to shrink each photo to its tile size before drawing, and to re-encode the finished image as a JPEG. `sharp` is already in the lockfile as Next's optional dependency (0.35.5 at the time of writing); it becomes a direct, exactly pinned dependency of `apps/web`, at the version Next resolves. *(Claude's call:)* the finished JPEG should be at most 300 KB, which keeps it well inside every chat app's limits, WhatsApp's reported one included. The builder picks the quality setting that meets it on a four-photo list and records the sizes measured.

### 5.3 The image's URL and the share token (decided by Ted, 2026-10-26)

The page's `og:image` has to point at something that knows which list to draw. D56 kept the token out of every metadata URL (`og:url`, canonical), and `site-metadata.spec.ts` checks it, exempting only image URLs because the image was static.

The image lives under the share page, at `/s/<shareToken>/preview.jpg`. It is a route handler, not Next's `opengraph-image` file convention, which the first draft named. A file-convention image overrides the page's `openGraph.images`, has a static alt text unless `generateImageMetadata` adds an ID segment to the URL, and is awkward to answer with a JPEG. A route handler lets `shareMetadata` own the URL, the dynamic alt text and the type, and lets a unit test see them (Plan 12 ruling 1). The chat app fetching the image already fetched the page at that token, so the token reaches no new party. The image route then needs everything the share page has: `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` (today `next.config.ts` lists only the exact path `/s/:shareToken`), the `robots.txt` disallow, Sentry's `redactTokens` (already covers the segment after `/s/`), and a `404` for an unknown or rotated token.

The rejected alternative was a URL that doesn't carry the token (for example one keyed by a hash of it), which needs a lookup column and a migration. `site-metadata.spec.ts`'s check that no metadata URL carries the token keeps its exemption for image URLs, with a comment saying why.

### 5.4 Claims never reach the image

- The image route reads the list from `GET /shared/:shareToken/preview`, not `GET /shared`. That response carries only the title, the owner's name, the item count and up to 8 photo item IDs in list order, with no claim fields at all, so the guarantee holds by construction and not by the web remembering to ignore fields. The route also calls the API **without** forwarding the visitor's cookie.
- `generateMetadata` on the share page keeps forwarding the cookie (it shares `loadSharedList` with the page), and uses only the title, the owner's name and the item count from it, which are the same for every viewer.
- Tests assert that the preview's inputs ignore `remaining`, `claimed` and `claims[]`: the same list with and without claims produces the same metadata and the same chosen photos.

### 5.5 Load and caching *(Claude's calls)*

Each uncached image request can trigger up to four outbound fetches, from a URL anyone with the link can hit.

- Photo fetching is rate-limited **per list**, plus one overall limit, in the claim limits' style (§6.6), with its own buckets. When a limit is hit, the image is drawn without photos rather than failing.
- **No per-IP limit** *(Claude's call, from the builder check)*. Two reasons. If the web app builds the image, the API sees the web function's own address on every call, not the visitor's, because Vercel's edge overwrites `x-real-ip`. And the visitors are mostly chat apps' crawlers, a few shared addresses serving every user of those apps, so a per-IP limit would strip photos from everyone's previews at busy times.
- **The photo endpoint's order of answers.** A malformed item ID is refused before any query, so it is `404 PHOTO_UNAVAILABLE` even when the token is also dead. A well-formed item ID on a dead or rotated link is `404 SHARE_LINK_NOT_FOUND`. Every other failure is `404 PHOTO_UNAVAILABLE`: an item that isn't on this list, an item without a photo, a failed fetch. A photo is counted against the limits only once the item is known to have one.
- The composed image may be cached at Vercel's CDN for up to 10 minutes (`s-maxage`). Accepted: for up to 10 minutes after the link is rotated, the old image URL still returns the old preview. It shows only the title, count and photos, to someone who already had the link.

### 5.6 Failure

Any failure in getting photos (timeouts, refused addresses, bad formats, rate limits, the API being slow) gives the image with the photos that did arrive, or none. A failure to load the list itself gives the same `404` or error as the share page. Failures are reported through the existing reporting paths without URLs, tokens or item text.

## 6. Etsy and other shops

An Etsy item's `imageUrl` was saved from the one prefill D69 allows. D69 treats a saved item as the owner's own entry, and the share page already shows its photo indefinitely, so drawing it in the preview is on the same footing. What's new is that the chat app keeps a copy of the composed image for as long as it likes. Ted accepted that risk on 2026-10-26, so Etsy items are treated like any other.

Amazon's and other shops' image hosts may refuse a server fetch or answer slowly. That is a skipped photo, never an error (§5.6).

## 7. Pages and docs that change with it

- `apps/web/src/lib/site-metadata.ts`: `shareMetadata` takes the title, owner name and item count; the description and alt text as §3.4. Its tests change with it.
- The new image route, and its headers in `next.config.ts` (§5.3).
- `/privacy`: today it says Hanker's server visits a shop page when you paste a link. It must also say that Hanker's server fetches up to four of a list's item photos to draw the share link's preview, keeps none of them, and that chat apps that show the preview keep their own copy. *(Claude's call: the privacy page must stay true.)*
- The site-trust spec's §4.5 and anti-goal, D56, and §6.8's "Images" bullet are amended to point here.

## 8. Decisions taken in review

Ted, 2026-10-26, answering the builder check:

1. **Chat apps:** iMessage, Slack and Discord must work. The image is still optimised to a JPEG (§5.2), which keeps WhatsApp working too.
2. **Where the image is built:** the web app, with photos from a new API endpoint (§5.2).
3. **The token in the image URL:** yes, under `/s/<shareToken>/` (§5.3).
4. **Etsy photos cached by chat apps:** accepted (§6).

## 9. Left to the builder

- The exact type sizes, gaps and corner radii, matched to `hanker-preview.png` and the mockups.
- Loading Instrument Serif and Geist into `ImageResponse` (it needs font files, not `next/font`).
- Whether Twitter-card metadata needs its own `images` or inherits Open Graph's.
- The rate-limit numbers.
- How the photo endpoint's response is shaped and validated in `packages/contracts`.

## 10. Verification

- Unit tests: photo selection and skipping, the fallback grids, the copy (singular, plural, empty, possessive), and that claim fields never affect the output.
- Integration tests: the photo fetch refuses private addresses, follows at most 3 hops, honours the size cap and the time budget, and an unknown or rotated token is `404`.
- Before merge *(Claude's call, from the builder check)*: chat apps can't reach a PR preview, because web previews sit behind Vercel Authentication, and D56 fixes `metadataBase` to `https://hanker.dev`, so a preview's `og:image` would point at production anyway. So the composed image is checked locally instead: the image route's JPEG, opened and looked at, for 4, 3, 2, 1 and 0 photos and an empty list, with its byte size checked against §5.2's 300 KB; and an E2E test asserts the share page's `og:image` answers `200` with an image and the expected description. No protection setting changes.
- Right after the production deploy, with a **throwaway list** (never a real list's link in a third-party tool): an iMessage to yourself, Slack and Discord. A broken preview is rolled back with Vercel's instant rollback while the fix is made.
