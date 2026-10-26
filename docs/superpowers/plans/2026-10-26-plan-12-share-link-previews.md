# Plan 12 — Share Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a share link's preview in iMessage, Slack and Discord shows the list's title, how many things are on it and photos of up to four items, instead of Hanker's tagline.

**Architecture:**

- **Contracts:** `SharePreviewResponseSchema`, the preview constants and `PHOTO_UNAVAILABLE`.
- **API:** `PageFetcher.fetchImage` reuses unfurl's hop loop (address policy, vetted-IP connect, redirects, deadline, byte caps), https only. A `PhotoFetcher` port wraps it, with a fake. Two new routes on `SharedController`: `GET /shared/:shareToken/preview` (title, owner name, item count, candidate item IDs: structurally no claim data) and `GET /shared/:shareToken/photos/:itemId` (one photo's bytes, rate-limited per list and overall).
- **Web:** a route handler at `/s/[shareToken]/preview.jpg` reads the preview without the visitor's cookie, fetches candidate photos in parallel within 3 seconds, draws layout A with `next/og` and re-encodes it as a JPEG of at most 300 KB with `sharp`. `shareMetadata` points `og:image` and `twitter:image` at it, with the new description and alt text. `/privacy` says so.
- **Docs:** the main spec, the site-trust spec, the decision log (D90–D92), the roadmap and AGENTS.md.

**Tech Stack:** NestJS 12, undici, Zod 4, Vitest, Playwright, Next.js 16.4 (`next/og`), `sharp` 0.35.5 (new direct dependency of `apps/web`, already in the lockfile through Next).

**Spec:** [`docs/superpowers/specs/2026-10-26-share-link-previews-design.md`](../specs/2026-10-26-share-link-previews-design.md) (approved 2026-10-26). Section numbers (§) are the design's unless marked "main spec".

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) applies. In particular:

- ESM; relative imports in `api` and `contracts` end in `.js`; `import type` for types. `@Inject(…)` on every constructor parameter.
- Exact pins. The one new dependency is `sharp`, pinned to exactly the version in `pnpm-lock.yaml` (0.35.5 at the time of writing).
- Unit tests (`*.spec.ts`) never touch the network or Docker. Behaviour changes are test-first.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that actually wrote it).

**Privacy and safety (§2 anti-goals, §5):**

- Nothing about claims reaches the preview. The preview endpoint's response has no claim fields at all, and the web's preview route never forwards the visitor's cookie.
- Every photo is fetched by the API under main spec §6.8's rules, https on port 443 only. The web app never fetches a photo URL itself.
- Logs and error reports never carry a photo URL, an item title, a share token or a list title. A photo failure logs at most the host and the reason, as unfurl does.
- No photo or composed image is stored anywhere (database, Blob, disk).
- The image render makes no outbound request except to the API (Review Focus 2).

**Values fixed by the design or ruled here:**

| Thing | Value |
|---|---|
| Preview route (API) | `GET /api/shared/:shareToken/preview` → `200 SharePreviewResponse`, `404 SHARE_LINK_NOT_FOUND`; `Cache-Control: no-store` |
| Photo route (API) | `GET /api/shared/:shareToken/photos/:itemId` → `200` image bytes, `404 SHARE_LINK_NOT_FOUND`, `404 PHOTO_UNAVAILABLE`, `429 RATE_LIMITED`; `Cache-Control: no-store` |
| Image route (web) | `GET /s/:shareToken/preview.jpg` → `200 image/jpeg`, `404` for a dead link; `Cache-Control: public, max-age=0, s-maxage=600` |
| Candidates | `PREVIEW_CANDIDATES = 8` items with an `imageUrl`, in `position` order |
| Photos drawn | `PREVIEW_PHOTOS = 4` |
| Photo types | `PREVIEW_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']` |
| Photo size cap | `PREVIEW_PHOTO_MAX_BYTES = 2_097_152`, raw and decoded |
| API photo deadline | `PHOTO_FETCH_TIMEOUT_MS = 2_500` |
| Web photo budget | `PHOTO_BUDGET_MS = 3_000`, all photos in parallel |
| Rate limits | `PREVIEW_PHOTOS_PER_LIST = { limit: 120, windowSeconds: 3600 }`, key `rateLimitKey('preview-photos:list', wishlistId)`; `PREVIEW_PHOTOS_OVERALL = { limit: 3000, windowSeconds: 3600 }`, key `rateLimitKey('preview-photos:all', 'all')`. No per-IP limit (§5.5) |
| Image | 1200×630 JPEG, at most `PREVIEW_MAX_BYTES = 307_200` |
| Photo pixel limit | `sharp` `limitInputPixels: 40_000_000` |

**Copy** (curly apostrophes; in `apps/web/src/lib/share-preview.ts`; `N` is the item count, never quantities):

| Where | N = 0 | N = 1 | N ≥ 2 |
|---|---|---|---|
| Count line (image) | `Nothing on the list yet` | `1 thing on the list` | `12 things on the list` |
| `description` | `Nothing on Sam’s list yet.` | `1 thing on Sam’s list. Pick a gift so nobody doubles up.` | `12 things on Sam’s list. Pick a gift so nobody doubles up.` |
| Image alt | `Sam’s wishlist: Nothing on the list yet` | `Sam’s wishlist: 1 thing on the list` | `Sam’s wishlist: 12 things on the list` |

`Sam` is `ownerDisplayName`, always followed by `’s`. `Sam’s wishlist` is the list's own title. The alt text is the title, `: `, then the count line.

## Rulings this plan makes on gaps in the design

1. **The image is a route handler at `/s/[shareToken]/preview.jpg`, not Next's `opengraph-image` file convention.** The design (§5.3) named the convention for its location under the share page. That location is kept. But a file-convention image overrides the page's `openGraph.images`, its alt text is static unless `generateImageMetadata` adds an ID segment to the URL, and it's awkward to answer with a JPEG. A route handler lets `shareMetadata` own the URL, the dynamic alt text and the type, and lets the unit test see them. Task 7 amends §5.3.
2. **The preview's data comes from a new `GET /shared/:shareToken/preview`, not `GET /shared`.** A guest's `GET /shared` carries `claims[]` with claimer names. The preview endpoint carries no claim field at all, so §2's anti-goal holds by construction, not by the web remembering to ignore fields.
3. **Candidates and order.** The API returns up to 8 item IDs with an `imageUrl`, in `position` order. The web requests all of them at once and draws the first 4 that arrive within 3 seconds, **in list order** (not arrival order). That is §3.2's "skip and try the next", without a second round trip.
4. **Every photo failure is `404 PHOTO_UNAVAILABLE`.** That covers an item that isn't on this list, an item without a photo, a malformed item ID, and a fetch that failed. A 5xx would be reported to Sentry on every slow shop, and the web treats any non-`200` the same way. The share token is still checked first, so a dead link is `404 SHARE_LINK_NOT_FOUND`.
5. **Order of checks on the photo route:** the token's shape, then the list and item by one query, then the per-list limit, then the overall limit, then the fetch. A missing photo never counts against a limit. A malformed item ID is refused before any query, the way `ClaimsService.create` refuses one.
6. **Tile sizes.** Each photo is shrunk to a 502×502 cover crop (the one-photo tile) as a JPEG at quality 85. The layout crops further with `objectFit: 'cover'`. Layout: 64px padding, a 502px square grid on the right, 12px gaps, 16px corner radius.
7. **The title's size steps down with its length** (`titleSizeFor`): up to 20 UTF-16 units 72px, up to 40 56px, longer 44px clamped to 3 lines with an ellipsis. With no grid, each step is 1.25× and rounded. Names and titles never overflow the image.
8. **Fonts** are static TTFs committed under `apps/web/assets/fonts/`: `InstrumentSerif-Regular.ttf` (google/fonts, `ofl/instrumentserif`) and `Geist-Regular.ttf` (a **static** instance from vercel/geist-font; `next/og` can't use a variable font). Add `OFL.txt` and a `README.md` naming each file's source URL. They're read with `readFile(join(process.cwd(), 'assets/fonts/…'))`, and `next.config.ts` adds `outputFileTracingIncludes: { '/s/[shareToken]/preview.jpg': ['./assets/fonts/*.ttf', './src/app/icon.svg'] }` so they ship to Vercel.
9. **The gift tag** in the image is `apps/web/src/app/icon.svg`, read the same way and drawn as an `<img>` data URI.
10. **The image route's own failures.** A dead link is `404`. If the preview endpoint fails any other way, the route throws, so the request gets Next's error response and is reported by `onRequestError`. A chat app then shows no image, as it would have without one. Photo failures never fail the route (§5.6).

## Review Focus

These are the inputs most likely to bite that the design doesn't spell out. Each line's test lives in the task named.

1. **Long or unusual titles and names.** A 200-character title or a 50-character owner name must not overflow or push the grid off the image (Task 4: `titleSizeFor`; Task 5: renders a 200-character title without throwing).
2. **Emoji and non-Latin text** in the title (`🎂 Sam’s birthday`, `فهرست آرزو`). The render must still return a JPEG, even if some glyphs are missing, and must make **no request** to a CDN for emoji or fallback fonts (Task 5: global `fetch` stubbed to throw; render succeeds and the stub is never called).
3. **A photo that claims to be an image but isn't,** or one with huge dimensions in few bytes (a 20000×20000 PNG). It's skipped, never a crash or a long decode (Task 5: `preparePhoto` returns `null` for both).
4. **A photo request that hangs.** The image still answers within the budget, drawn with whatever arrived (Task 6: the loader with a fetch that never resolves returns `[]` once a short budget passes).
5. **Another list's item through this list's token.** `GET /shared/<A's token>/photos/<B's item>` must not fetch B's photo (Task 3: `404 PHOTO_UNAVAILABLE`, fetcher not called).

## Layers

The spec commit is already on `docs/share-link-previews-spec`, off `main` 16aba71. That is the bottom layer. Stack the rest on it with `gh stack`. Each layer gets a Conventional Commit PR title and a summary body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The first `gh stack submit --open` needs Ted's approval.

| Layer | Tasks | PR title |
|---|---|---|
| 0 | (done) | `docs(spec): design personal share link previews` |
| 1 | 1–3 | `feat(api): share preview data and guarded photo fetches` |
| 2 | 4–6 | `feat(web): draw share link previews with item photos` |
| 3 | 7 | `docs: share link previews in the spec, decision log and roadmap` |

Layer 1 ships dark: nothing calls the new routes until layer 2.

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/share-preview.ts`, `packages/contracts/src/share-preview.spec.ts`
- Modify: `packages/contracts/src/error-codes.ts`, `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `SharePreviewResponseSchema`, `type SharePreviewResponse = { title: string; ownerDisplayName: string; itemCount: number; photoItemIds: string[] }`; `PREVIEW_CANDIDATES = 8`, `PREVIEW_PHOTOS = 4`, `PREVIEW_PHOTO_TYPES` (`as const`), `type PreviewPhotoType`, `PREVIEW_PHOTO_MAX_BYTES = 2_097_152`; `ErrorCode.PHOTO_UNAVAILABLE`.

- [ ] **Step 1: Write the failing tests** in `share-preview.spec.ts`:
  - `parses a preview`: `{ title: 'Sam’s wishlist', ownerDisplayName: 'Sam', itemCount: 12, photoItemIds: [<uuid>] }` round-trips.
  - `refuses any extra field, so claim data can't ride along`: the same object plus `claims: []` fails (`.strict()`).
  - `refuses more than PREVIEW_CANDIDATES ids, a negative count and a non-uuid id`.
  - `PHOTO_UNAVAILABLE is a stable code`: `expect(ErrorCode.PHOTO_UNAVAILABLE).toBe('PHOTO_UNAVAILABLE')`.
- [ ] **Step 2: Run** `pnpm --filter @wishlist/contracts test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the schema and constants, and add `PHOTO_UNAVAILABLE` to `ErrorCode` with the comment `/** 404: a share preview photo that can't be had: no such item on this list, no photo, or the shop wouldn't give it (Plan 12). */`. Export from `index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): share preview schema and photo error code`.

### Task 2: `PageFetcher.fetchImage`

**Files:**
- Modify: `apps/api/src/unfurl/page-fetcher.ts`, `apps/api/src/unfurl/address-policy.ts`
- Test: `apps/api/src/unfurl/page-fetcher.spec.ts`, `apps/api/src/unfurl/address-policy.spec.ts`

**Interfaces:**
- Consumes: `PREVIEW_PHOTO_TYPES`, `type PreviewPhotoType` (Task 1).
- Produces: `PUBLIC_HTTPS: AddressPolicy` (public addresses on port 443 only); `type PhotoFailureReason = UnfurlFailureReason | 'NOT_IMAGE'`; `type FetchedPhoto = { ok: true; bytes: Buffer; contentType: PreviewPhotoType } | { ok: false; reason: PhotoFailureReason; host?: string }`; `PageFetcher.fetchImage(rawUrl: string): Promise<FetchedPhoto>`.

`fetchImage` runs the same private `hops` loop as `fetch`. `hops` gains a `headers` parameter, so `fetch` keeps `accept: text/html` and `fetchImage` sends `accept: image/jpeg, image/png, image/webp` with the same User-Agent. The answer step requires a `200` (else `BLOCKED_BY_SITE`) and a media type in `PREVIEW_PHOTO_TYPES` (else `NOT_IMAGE`). It reads with `readCapped` at `maxBytes`, and a truncated body is `TOO_LARGE`, because half an image is useless. The internal `FetchFailure` reason widens to `PhotoFailureReason`. `fetch` and `resolve` never produce `NOT_IMAGE` and keep their public types.

- [ ] **Step 1: Write the failing tests** with the spec's existing `FIXTURE` policy and local server:
  - `fetchImage returns a jpeg's bytes and type`: the fixture serves 3 bytes as `image/jpeg; charset=binary` → `{ ok: true, contentType: 'image/jpeg', bytes }` equal to them.
  - `fetchImage refuses a page that isn't an image`: `text/html` → `{ ok: false, reason: 'NOT_IMAGE' }`; `image/svg+xml` → `NOT_IMAGE`.
  - `fetchImage refuses an image over maxBytes`: `maxBytes: 10`, 11 bytes served → `TOO_LARGE`.
  - `fetchImage follows a redirect and re-vets it`: a 302 to a host the policy refuses → `DISALLOWED_ADDRESS`.
  - `fetchImage asks for images`: the server records `accept` as `image/jpeg, image/png, image/webp`.
  - In `address-policy.spec.ts`: `PUBLIC_HTTPS allows a public address on 443 only`: `8.8.8.8` on 443 true, on 80 false; `127.0.0.1` on 443 false.
- [ ] **Step 2: Run** `pnpm --filter @wishlist/api exec vitest run src/unfurl`. Expected: the new tests FAIL; the old ones pass.
- [ ] **Step 3: Implement** `PUBLIC_HTTPS`, the `headers` parameter and `fetchImage`.
- [ ] **Step 4: Run** the same command. Expected: PASS, including every existing `fetch` and `resolve` test unchanged.
- [ ] **Step 5: Commit** `feat(api): fetch images under unfurl's address rules`.

### Task 3: Preview and photo endpoints

**Files:**
- Create: `apps/api/src/unfurl/photo-fetcher.ts`, `apps/api/src/claims/share-preview.service.ts`, `apps/api/test/share-preview.int-spec.ts`
- Modify: `apps/api/src/claims/shared.controller.ts`, `apps/api/src/claims/claims.module.ts`, `apps/api/src/claims/claims-errors.ts`, `apps/api/src/claims/rate-limits.ts`, `apps/api/src/testing/fakes.ts`, `apps/api/test/support/auth-app.ts`, `apps/api/test/support/lists.ts`

**Interfaces:**
- Consumes: Task 1's schema and constants; `PageFetcher.fetchImage`, `PUBLIC_HTTPS`, `FetchedPhoto` (Task 2).
- Produces:
  - `PHOTO_FETCHER` (symbol), `interface PhotoFetcher { fetch(url: string): Promise<FetchedPhoto> }`, and `HttpPhotoFetcher`, built with `new PageFetcher({ policy: PUBLIC_HTTPS, timeoutMs: PHOTO_FETCH_TIMEOUT_MS, maxBytes: PREVIEW_PHOTO_MAX_BYTES, maxRawBytes: PREVIEW_PHOTO_MAX_BYTES })`.
  - `FakePhotoFetcher` (`next: FetchedPhoto`, `urls: string[]`), exposed on the test app as `t.photos`.
  - `SharePreviewService.preview(shareToken: string): Promise<SharePreviewResponse>` and `.photo(shareToken: string, itemId: string): Promise<{ bytes: Buffer; contentType: PreviewPhotoType }>`.
  - `photoUnavailable(): AppError`, which is `404 PHOTO_UNAVAILABLE` with detail `'This photo is not available.'`.
  - `seedItem(db, email, title, quantity = 1, imageUrl: string | null = null)`.

The preview reads the list, its owner's name, its item count and the first `PREVIEW_CANDIDATES` items with a non-null `image_url` ordered by `position`, in one `SNAPSHOT` transaction, like `SharedListService.get`. It reads no claims. The photo route answers with a `StreamableFile` of the bytes, `type` set to the fetched type, and `Cache-Control: no-store`. A failed fetch logs `preview photo skipped` with `host` and `reason` only, then throws `photoUnavailable()`.

- [ ] **Step 1: Write the failing integration tests** in `share-preview.int-spec.ts` (Ada's list as in `shared.int-spec.ts`, with photo URLs like `https://img.example/1.jpg`):
  - `previews the title, owner, count and photo candidates in list order`: 10 items, 9 with a photo → `itemCount: 10` and the first 8 photo items' IDs in position order. `no-store`.
  - `previews the same with claims, for a guest and for an owner who sees claims`: claim two items, set `showClaimsToOwner`; the guest's and the owner's responses are `toEqual` the claim-free one, and `JSON.stringify(body)` doesn't contain `claim` or `remaining`.
  - `an empty list previews with no candidates`: `{ itemCount: 0, photoItemIds: [] }`.
  - `a malformed, unknown or rotated token is 404 SHARE_LINK_NOT_FOUND` (both routes).
  - `returns a photo's bytes and type`: `t.photos.next = { ok: true, bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' }` → `200`, `content-type` starts with `image/png`, body bytes `[1, 2, 3]`, `no-store`; `t.photos.urls` is `[that item's imageUrl]`.
  - `an item without a photo, a malformed item id and a failed fetch are 404 PHOTO_UNAVAILABLE`. The first two never call the fetcher.
  - **Review Focus 5:** `another list's item through this token is 404 PHOTO_UNAVAILABLE and nothing is fetched`.
  - `the list's limit stops fetching`: `fillBucket(db, rateLimitKey('preview-photos:list', listId), 120)` → `429 RATE_LIMITED`, fetcher not called.
  - `the overall limit stops fetching`: the same with the overall key at 3000.
  - `a missing photo doesn't count against the list`: 3 requests for an item without a photo, then the counter row for the list key is absent.
- [ ] **Step 2: Run** `pnpm --filter @wishlist/api test:integration -- share-preview` (Docker). Expected: FAIL, the routes are `404 NOT_FOUND`.
- [ ] **Step 3: Implement** the port, fake and test-app override, `seedItem`'s parameter, the rate-limit constants and keys, the service, the controller methods and the module provider (`{ provide: PHOTO_FETCHER, useFactory: () => new HttpPhotoFetcher() }`).
- [ ] **Step 4: Run** the integration test again, then `pnpm --filter @wishlist/api test` and `pnpm --filter @wishlist/api typecheck`. Expected: PASS.
- [ ] **Step 5: Run** the full CI set from AGENTS.md ("Verify before you say it's done") through `pnpm test:integration`. Expected: all green. This closes layer 1.
- [ ] **Step 6: Commit** `feat(api): share preview and preview photo endpoints`.

### Task 4: Preview copy and layout rules

**Files:**
- Create: `apps/web/src/lib/share-preview.ts`, `apps/web/src/lib/share-preview.spec.ts`

**Interfaces:**
- Produces: `countLine(itemCount: number): string`; `previewDescription(ownerDisplayName: string, itemCount: number): string`; `previewAlt(title: string, itemCount: number): string`; `titleSizeFor(title: string, hasGrid: boolean): { fontSize: number; lineClamp: number }`; `type Tile = { photo: number; column: 1 | 2; row: 1 | 2; columnSpan: 1 | 2; rowSpan: 1 | 2 }` and `tilesFor(photoCount: number): Tile[]` (index into the photos array; CSS-grid placement on a 2×2 grid).

- [ ] **Step 1: Write the failing tests**:
  - The Copy table above, exactly, for N = 0, 1 and 12, and `previewDescription('James', 3)` → `3 things on James’s list. Pick a gift so nobody doubles up.`
  - `tilesFor(4)`: four 1×1 tiles in reading order. `tilesFor(3)`: photo 0 at column 1 spanning 2 rows, photos 1 and 2 stacked in column 2. `tilesFor(2)`: two tiles each spanning 2 rows. `tilesFor(1)`: one tile spanning 2×2. `tilesFor(0)`: `[]`. `tilesFor(7)` equals `tilesFor(4)`.
  - **Review Focus 1:** `titleSizeFor` returns 72, 56 and 44 at 20, 40 and 41 units with a grid, and `lineClamp: 3`; without a grid, 90, 70 and 55; a 200-character title gets the smallest size.
- [ ] **Step 2: Run** `pnpm --filter @wishlist/web exec vitest run src/lib/share-preview.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** `SHARE_DESCRIPTION` stays in `site-metadata.ts` and is imported for the second sentence.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): copy and layout rules for share previews`.

### Task 5: Drawing the image

**Files:**
- Create: `apps/web/src/lib/share-preview-image.tsx`, `apps/web/src/lib/share-preview-image.spec.ts`, `apps/web/assets/fonts/InstrumentSerif-Regular.ttf`, `apps/web/assets/fonts/Geist-Regular.ttf`, `apps/web/assets/fonts/OFL.txt`, `apps/web/assets/fonts/README.md`
- Modify: `apps/web/package.json` (`"sharp": "0.35.5"`), `pnpm-lock.yaml`, `apps/web/next.config.ts` (`outputFileTracingIncludes`, ruling 8), `apps/web/vitest.config.ts` only if needed (below)

**Interfaces:**
- Consumes: Task 4's functions.
- Produces: `PREVIEW_SIZE = { width: 1200, height: 630 }`, `PREVIEW_MAX_BYTES = 307_200`; `preparePhoto(bytes: Uint8Array): Promise<Buffer | null>` (a 502×502 cover-cropped JPEG, or `null` if `sharp` can't decode it or it's over `limitInputPixels: 40_000_000`); `renderSharePreview(input: { title: string; itemCount: number; photos: Buffer[] }): Promise<Buffer>` (JPEG bytes; `photos` are `preparePhoto` outputs, at most 4 used).

`renderSharePreview` draws layout A (§3.1, rulings 6–9) with `new ImageResponse(<…/>, { ...PREVIEW_SIZE, fonts })`, then `sharp(png).jpeg({ quality: 80, mozjpeg: true })`. If a four-photo render is over `PREVIEW_MAX_BYTES`, lower the quality until it fits, and record the measured sizes in the layer 2 PR body. Colours come from `globals.css`'s tokens as literals: `#fbf9f5` background, `#1f1a17` ink, `#5c554e` count line. Photos go in as `data:image/jpeg;base64,…`.

- [ ] **Step 1: Add `sharp`** at the lockfile's exact version: `pnpm --filter @wishlist/web add sharp@0.35.5 --save-exact`. Check `pnpm install` doesn't need a new `allowBuilds` entry. `sharp` 0.35 ships prebuilt `@img/*` binaries. If pnpm reports an ignored build script, add `sharp: false` under `allowBuilds` with a comment saying the prebuilt binaries need none. Add the fonts (ruling 8): confirm `Geist-Regular.ttf` is static with `fc-query` (no `variable: True`).
- [ ] **Step 2: Write the failing tests** (fixture photos made in the test with `sharp({ create: { width: 800, height: 800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg()`, so they compress like real photos):
  - `draws a 1200×630 JPEG under 300 KB with four photos`: `sharp(out).metadata()` → `format: 'jpeg'`, `width: 1200`, `height: 630`; `out.length <= PREVIEW_MAX_BYTES`.
  - `draws with 3, 2, 1 and 0 photos and an empty list`: each a 1200×630 JPEG.
  - **Review Focus 1:** `draws a 200-character title` without throwing.
  - **Review Focus 2:** `draws emoji and Persian titles without asking the network`: `vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network') }))`; `🎂 Sam’s birthday` and `فهرست آرزو` each return a JPEG, and the stub was never called. If `next/og` reaches for an emoji or font CDN, pass `ImageResponse` an option that stops it (`loadAdditionalAsset` answering nothing, or what Next 16.4's `ImageResponse` offers); missing glyphs are acceptable.
  - **Review Focus 3:** `preparePhoto` returns `null` for `Buffer.from('not an image')`, and for a 20000×20000 PNG made with `sharp({ create: … }).png()`; a 800×800 JPEG becomes a 502×502 JPEG.
- [ ] **Step 3: Run** `pnpm --filter @wishlist/web exec vitest run src/lib/share-preview-image.spec.ts`. Expected: FAIL, module not found. If it fails instead on `React is not defined`, add `esbuild: { jsx: 'automatic' }` to `vitest.config.ts`. If `next/og` can't load under Vitest at all, stop and report: the size and network checks depend on this test.
- [ ] **Step 4: Implement** `preparePhoto` and `renderSharePreview`.
- [ ] **Step 5: Run** the same command. Expected: PASS. Write the four-photo output to the scratchpad and look at it against the layout-A mockup (`.superpowers/brainstorm/*/content/layout-a-fallbacks.html`).
- [ ] **Step 6: Commit** `feat(web): draw share previews as optimised JPEGs`.

### Task 6: The preview route, metadata and privacy page

**Files:**
- Create: `apps/web/src/app/s/[shareToken]/preview.jpg/route.ts`, `apps/web/src/lib/share-preview.server.ts`, `apps/web/src/lib/share-preview.server.spec.ts`
- Modify: `apps/web/src/lib/site-metadata.ts`, `apps/web/src/lib/site-metadata.spec.ts`, `apps/web/src/app/s/[shareToken]/page.tsx`, `apps/web/next.config.ts`, `apps/web/next.config.spec.ts`, `apps/web/src/app/privacy/page.tsx`, `e2e/tests/local/previews.spec.ts`, `e2e/tests/local/legal.spec.ts` (if it pins privacy copy)

**Interfaces:**
- Consumes: `SharePreviewResponseSchema`, `PREVIEW_PHOTOS` (Task 1); Task 4's copy; `preparePhoto`, `renderSharePreview`, `PREVIEW_SIZE` (Task 5).
- Produces:
  - `loadPreview(shareToken: string): Promise<SharePreviewResponse>`: `notFound()` on a malformed token or an API `404`/`400`, as `loadSharedList` does, but through `createApiClient({ baseUrl: API_ORIGIN, headers: {} })`, **never** `serverApi()`, so no cookie is forwarded.
  - `PHOTO_BUDGET_MS = 3_000`.
  - `loadPreviewPhotos(shareToken: string, itemIds: string[], options?: { budgetMs?: number; fetchFn?: typeof fetch }): Promise<Buffer[]>`: requests every ID at once from `${API_ORIGIN}/api/shared/<token>/photos/<id>` under one `AbortSignal.timeout(budgetMs ?? PHOTO_BUDGET_MS)`, prepares each with `preparePhoto`, and returns the first `PREVIEW_PHOTOS` successes **in `itemIds` order**. A non-`200`, an abort or `null` from `preparePhoto` skips that ID.
  - `shareMetadata(list: { title: string; ownerDisplayName: string; itemCount: number }, shareToken: string): Metadata`.

The route's `GET` calls `loadPreview`, then `loadPreviewPhotos`, then `renderSharePreview`. It answers with `Content-Type: image/jpeg` and `Cache-Control: public, max-age=0, s-maxage=600`, and sets `export const dynamic = 'force-dynamic'`. `shareMetadata` gives `title`, `description: previewDescription(…)`, `openGraph` (as today, with the new description and `images: [{ url: \`/s/${shareToken}/preview.jpg\`, width: 1200, height: 630, type: 'image/jpeg', alt: previewAlt(…) }]`) and `twitter: { card: 'summary_large_image', images: [same] }`. The page's `generateMetadata` passes `{ title, ownerDisplayName, itemCount: list.items.length }` from `loadSharedList`, whose item count is the same for every viewer.

- [ ] **Step 1: Write the failing unit tests**:
  - `share-preview.server.spec.ts`: `loadPreviewPhotos` with a fake `fetchFn` keeps list order when the second ID answers first; skips a `404` and an undecodable body and takes the fifth candidate instead; never returns more than 4. **Review Focus 4:** with a `fetchFn` that never resolves and `budgetMs: 50`, it resolves `[]` in under 1 second.
  - `site-metadata.spec.ts`: replace the share-page test. `shareMetadata({ title: 'Sam’s wishlist', ownerDisplayName: 'Sam', itemCount: 12 }, TOKEN)` → `description` is `12 things on Sam’s list. Pick a gift so nobody doubles up.`, `openGraph.images` and `twitter.images` are `[{ url: '/s/<TOKEN>/preview.jpg', width: 1200, height: 630, type: 'image/jpeg', alt: 'Sam’s wishlist: 12 things on the list' }]`, `twitter.card` is `summary_large_image`. Keep the `url`/`alternates` test: the token may appear only under `.images.` (add a comment: §5.3, the image URL carries the token on purpose).
  - `next.config.spec.ts`: `/s/:shareToken/preview.jpg` gets `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.
- [ ] **Step 2: Write the failing E2E tests** in `previews.spec.ts`. Replace `a share link previews the list title and one line…` with:
  - `a share link previews the title, count and its own image, with no item named`: one item → `og:description` is `1 thing on Ada’s list. Pick a gift so nobody doubles up.`; `og:image` is `https://hanker.dev/s/<token>/preview.jpg`; no `og:url`; the item's title appears in no head value; the token appears only in the `og:image` and `twitter:image` values.
  - `the preview image is a 1200×630 JPEG under 300 KB, with the share page's headers`: `GET /s/<token>/preview.jpg` (the path, locally) → `200`, `image/jpeg`, body ≤ 307200 bytes, JPEG SOF dimensions 1200×630 (read from the bytes with a small helper in `e2e/support/jpeg.ts`), `referrer-policy: no-referrer`, `x-robots-tag: noindex`.
  - `a photo the API won't fetch still gives a preview`: an item with `imageUrl: 'https://127.0.0.1/x.jpg'` (refused by the address policy) → the image is still `200 image/jpeg`.
  - `a claim doesn't change the preview`: the description before and after `claimViaApi` is identical.
  - `a dead link's image is 404`: after rotating the link, the old token's `preview.jpg` is `404`.
- [ ] **Step 3: Run** `pnpm --filter @wishlist/web test` (FAIL), and `pnpm test:e2e -- previews` (FAIL).
- [ ] **Step 4: Implement** the loader, the route, `shareMetadata`, the page, the headers entry, and the `/privacy` sentence. Put it after the paragraph on pasting shop links: `When you share your list’s link, Hanker’s server fetches up to four of your items’ photos from the shops to draw the link’s preview picture, and keeps none of them. Apps that show the preview, like Messages, Slack or Discord, keep their own copy.` Update `legal.spec.ts` if it pins that section.
- [ ] **Step 5: Run** the full CI set from AGENTS.md, `pnpm test:integration` and `pnpm test:e2e`. Expected: all green.
- [ ] **Step 6: Check by hand** (§10): run `pnpm dev`, make a list with 4 items whose `imageUrl`s are real public photos, and open `/s/<token>/preview.jpg`. Do the same with 3, 2, 1 and 0 photos and an empty list. Record each size in the PR body.
- [ ] **Step 7: Commit** `feat(web): share links preview their own title, count and photos`.

### Task 7: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§6.8 "Images" bullet; §6.9 "Retailer images" note; §13 decision log), `docs/superpowers/specs/2026-10-21-site-trust-basics-design.md` (the anti-goal and §4.5), `docs/superpowers/specs/2026-10-26-share-link-previews-design.md` (§5.3, ruling 1), `docs/superpowers/plans/2026-10-07-roadmap.md`, `AGENTS.md`

- [ ] **Step 1: Amend the specs.** §6.8: the server never fetches an item's image, **except** to draw a share link's preview, under these same rules, https only (share previews design §5.1, D91). Site-trust §2 and §4.5: a note at each saying share pages now preview the count and photos (share previews design, D90), and D56 still governs every other page. Share previews §5.3: the route is `/s/<shareToken>/preview.jpg`, a route handler, for ruling 1's reasons.
- [ ] **Step 2: Add D90–D92** to the main spec's log:
  - D90: share link previews show the item count and up to four item photos, never claim data (Ted, 2026-10-26). Rejected: the Plan 6 rule of title only; AI-chosen emoji.
  - D91: Hanker's server fetches item photos for previews, through the API under §6.8 with https only, with no per-IP limit. Rejected: fetching from the web app; hotlinking a single photo as `og:image`.
  - D92: the preview is a JPEG of at most 300 KB made with `sharp`, at `/s/<shareToken>/preview.jpg`, with the token in its URL (Ted, 2026-10-26). Rejected: `next/og`'s PNG; a token-free URL with a lookup column.
- [ ] **Step 3: Add the roadmap row** `| 12 | [Share link previews](2026-10-26-plan-12-share-link-previews.md) | [design 2026-10-26](../specs/2026-10-26-share-link-previews-design.md), D90–D92 | Share links preview the list's title, item count and a collage of up to four item photos, drawn by the web app from photos the API fetches under §6.8 | Done |` once layers 1–2 are merged.
- [ ] **Step 4: Add an AGENTS.md convention bullet**, after Your gifts: **Share previews (Plan 12):** `/s/[shareToken]/preview.jpg` draws the preview from `GET /shared/:shareToken/preview` and `…/photos/:itemId`, never `GET /shared`, and never forwards the cookie. Photos are fetched only by the API, through `PageFetcher.fetchImage` (§6.8, https only). Nothing about claims reaches a preview. The image is a JPEG of at most 300 KB.
- [ ] **Step 5: Run** `pnpm format:check`. Expected: PASS.
- [ ] **Step 6: Commit** `docs: share link previews in the spec, decision log and roadmap`.

## After merge

- With Ted: right after the production deploy, paste a **throwaway** list's link into an iMessage to yourself, Slack and Discord (§10). A broken preview gets Vercel's instant rollback.
- Update the Plan 12 memory and close out the stack.
