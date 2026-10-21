# Plan 6 — Site trust basics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone who lands on hanker.dev can see where the source is, read what happens to their data, and reach a person. The site also has a favicon, link previews, `security.txt` and a `Permissions-Policy`.

**Architecture:**

- **Pure modules, tested in Node.** `apps/web/src/lib/site.ts` holds the site's fixed facts: origin, contact address, source URL, tagline. `apps/web/src/lib/site-metadata.ts` builds the root and share-page `Metadata` from them. The web app's unit tests run without a DOM, so anything worth a unit test lives there or in `next.config.ts`.
- **Static assets, committed.** The icons and the 1200×630 preview image are generated once with a throwaway Playwright script and committed. The source SVG is committed as `app/icon.svg`. Nothing is generated at build time and nothing new is installed.
- **Pages and footer** are Server Components. `SiteFooter` is mounted once in the root layout, so every page gets it, the 404s and `error.tsx` included. `/privacy` and `/terms` share a small `LegalPage` frame.
- **Ted's cloud steps** (email forwarding, reply-as through Resend, Sentry's IP setting) are written into `docs/deployment.md` as the stack's second layer, so he can do them while the code is in review. They gate the merge (Task 9).

**Tech Stack:** Next.js 16.4 App Router (Metadata API, `public/`, `app/icon.svg` file convention), Vitest, Playwright 1.63 with axe, Cloudflare Email Routing, Resend SMTP, Gmail "Send mail as".

**Spec:** [docs/superpowers/specs/2026-10-21-site-trust-basics-design.md](../specs/2026-10-21-site-trust-basics-design.md), approved by Ted on 2026-10-21. It amends the [main spec](../specs/2026-10-07-wishlist-app-design.md) §6.9 and §7, which Task 1 edits. Read both.

## Global Constraints

- Everything in [AGENTS.md](../../../AGENTS.md) applies:
  - Node 24 and pnpm 12.10.1.
  - The web app uses bundler resolution and the `@/` alias, and `import type` for type-only imports.
  - Exact pins. **No new dependencies in any package.**
- Behavior changes are written test-first. Web unit tests are `*.spec.ts` under `apps/web/src` or at `apps/web/*.spec.ts`. UI is tested in `e2e/tests/local` (and `e2e/tests/smoke` for production-safe, read-only checks).
- Every commit ends with `Co-Authored-By:` naming the model that actually wrote it. Replace `<model>` below.
- **Copy, verbatim from the spec:**
  - The footer reads `Source on GitHub · Privacy · Terms · hello@hanker.dev`.
  - The share-page preview description is `Pick a gift so nobody doubles up.`
  - The tagline is `One list. One link. No doubled-up gifts.`
- **Names:** people see **Hanker**, and the operator is **Ted Armstrong**, Portland, Maine. Never Ted's legal name, and never his personal email address.
- **Contact:** `hello@hanker.dev`. **Source:** `https://github.com/Shockolate/wishlist-app`.
- **Colors:** terracotta `#ff5a4d` (`primary`) never carries text. Ink is `#1e1b18`, cream is `#faf7f2`, and muted text is `muted-foreground` (`#5c554e`).
- **Token pages** (`/s/*`, `/c/*`, `/verify-email`, `/reset-password/confirm`) keep `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. No metadata anywhere sets `og:url` or a canonical URL, so no token can reach one.
- `/privacy` and `/terms` stay indexable.
- **Nothing in Tasks 1–8 creates a cloud resource, changes DNS, or reads or sets a secret.** Those steps are Ted's, in `docs/deployment.md` (Task 2).

## Review Focus

These are the failure modes most likely to hurt someone that the spec implies but no happy-path test catches. Each has a pinned test in the task named.

1. **A share link's preview leaks the token or list contents.** A child segment's `openGraph` replaces the parent's whole object, and a careless spread could carry a URL. Pinned in Task 5: `shareMetadata` has no `url` at any depth, and an E2E test reads every `<meta>` on a real share page and finds the token in none, with no item title present.
2. **The share page loses its preview image.** The same object replacement silently drops `images`. Pinned in Task 5: a unit test that `shareMetadata(…).openGraph.images` equals the root's, and the E2E test asserts `og:image` on `/s/…`.
3. **`Permissions-Policy` breaks copy, share or Turnstile.** Pinned in Task 3: a unit test that the header never names `clipboard-write`, `clipboard-read` or `web-share`. The existing sign-up E2E tests still pass Turnstile with the header on.
4. **The footer breaks a phone layout or accessibility on some page.** Pinned in Tasks 6 and 7: `/privacy` and `/terms` join `pages.spec.ts`'s axe-and-phone loop, which already runs every other page with the footer present, and `footer.spec.ts` checks it on a share page and a 404.
5. **`security.txt` silently expires.** An expired file is invalid by RFC 9116. Pinned in Task 3: a unit test fails CI once `Expires` is in the past or more than a year away. A yearly row in `docs/operations.md` renews it first.

---

## Layers

Branches for `gh stack`, one reviewable concern each:

| Layer | Branch                     | Tasks   |
| ----- | -------------------------- | ------- |
| 1     | `docs/plan-6`              | Task 1  |
| 2     | `docs/contact-email`       | Task 2  |
| 3     | `web/headers-security-txt` | Task 3  |
| 4     | `web/icons-previews`       | Tasks 4, 5 |
| 5     | `web/legal-pages`          | Tasks 6, 7 |
| 6     | `web/footer`               | Task 8  |

Task 9 is the merge gate and go-live checkpoint. The first `gh stack submit --open` needs Ted's approval (AGENTS.md).

---

### Task 1: Spec amendments, roadmap row, and the plan

**Files:**

- Add: `docs/superpowers/specs/2026-10-21-site-trust-basics-design.md` (already written, uncommitted)
- Add: `docs/superpowers/plans/2026-10-21-plan-6-site-trust-basics.md` (this file)
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§6.9, §7's route table, the decisions table)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md`

- [ ] **Step 1: Amend the main spec.**
  - In §6.9's "Other headers" bullet, add: `` `Permissions-Policy` turns off camera, microphone, geolocation and the other features Hanker never uses, leaving clipboard and Web Share on (Plan 6). ``
  - Add two rows to §7's route table, after `/`:
    - `` | `/privacy`, `/terms` | Server, static | Plain-language legal pages (Plan 6, D54). Indexable | ``
  - Add these to the decisions table:
    - **D54:** a footer on every page (source, privacy, terms, `hello@hanker.dev`) and short privacy and terms pages that name Ted Armstrong. US-based, so no postal address, imprint or cookie banner. Rejected: Ted's name in the footer, a sitemap.
    - **D55:** Hanker is for people 13 and older, gifters included.
    - **D56:** link previews come from one static image in `public/`, with `metadataBase` fixed to `https://hanker.dev` and no `og:url` anywhere. Rejected: build-time image generation, and per-page `og:url`.
    - **D57:** `hello@hanker.dev` is received through Cloudflare Email Routing and answered through Resend SMTP from Gmail, with its own sending-only key. Rejected: forward-only, which exposes Ted's personal address in replies, and sending as `hello@mail.hanker.dev`.
- [ ] **Step 2: Add the roadmap row** after 5b: `| 6 | [Site trust basics](2026-10-21-plan-6-site-trust-basics.md) | [design 2026-10-21](../specs/2026-10-21-site-trust-basics-design.md), §6.9, §7 | Footer; privacy and terms pages; favicon; link previews; security.txt; Permissions-Policy; hello@hanker.dev forwarding and reply-as (D54–D57) | Planned |`
- [ ] **Step 3: Verify.** Run `pnpm format:check`. Expected: `All matched files use Prettier code style!`
- [ ] **Step 4: Commit.** Use `git commit -m "docs: plan 6, site trust basics"` with the trailer.

---

### Task 2: The contact-email runbook

**Files:**

- Modify: `docs/deployment.md`: a new `## Contact email` section after `## Domain and DNS`, and one row added to that section's DNS table.
- Modify: `docs/operations.md`: two rows in `## Recurring`.

Docs only. Ted follows this section himself (Task 9), so it is exact copy.

- [ ] **Step 1: Add a row to the `## Domain and DNS` table** for the records Steps A and B add:
  - The **Record** cell: `` `hanker.dev` MX and SPF `TXT` (Email Routing); Resend's records for `hanker.dev`: MX and SPF `TXT` on `send.hanker.dev`, DKIM `TXT` on `resend._domainkey.hanker.dev` ``
  - The **Value** cell: `The records Cloudflare → Email Routing and Resend → Domains show`
  - The **Proxy** cell: `DNS only`
- [ ] **Step 2: Write `## Contact email`** with exactly this content:

```markdown
## Contact email

`hello@hanker.dev` is the address on the footer, the privacy and terms pages and `security.txt` (D57). Mail to it is forwarded to Ted's inbox by Cloudflare Email Routing, and Ted replies as `hello@hanker.dev` from Gmail through Resend's SMTP server, so his personal address never shows. Nothing showing the address may merge before Steps A and B pass their checks.

### A. Receive: Cloudflare Email Routing

1. Cloudflare dashboard → the `hanker.dev` zone → **Email** → **Email Routing** → **Get started** (or **Enable Email Routing**).
2. **Destination addresses** → **Add destination address** → your personal address. Open the verification email Cloudflare sends and click its link. The address shows **Verified**.
3. **Routing rules** → **Custom addresses** → **Create address**. Custom address `hello`, action **Send to an email**, destination the address from step 2. **Save**.
4. When Cloudflare offers to add its DNS records, choose **Add records and enable**. It adds MX records and an SPF `TXT` record at the apex `hanker.dev`. The apex had neither before, so nothing is replaced.
5. In **DNS** → **Records**, confirm Resend's existing records on `send.mail.hanker.dev` and `resend._domainkey.mail.hanker.dev`, and `_dmarc.hanker.dev`, are unchanged.

**Check:** from an account that isn't yours (or a phone's other mail app), send a message to `hello@hanker.dev`. It arrives in your inbox. Then trigger a password reset for your own Hanker account at https://hanker.dev/reset-password: the email from `no-reply@mail.hanker.dev` still arrives.

### B. Reply as hello@: Resend SMTP and Gmail

The free plan allows three verified domains; this uses the second. These replies share the free plan's 100-a-day cap with Hanker's own emails.

1. Resend → **Domains** → **Add domain** → `hanker.dev`, in the same region as `mail.hanker.dev`.
2. Add each record Resend shows (MX and SPF `TXT` on `send.hanker.dev`, DKIM `TXT` on `resend._domainkey.hanker.dev`) in Cloudflare → **DNS** → **Records**, **DNS only**. They sit next to Email Routing's apex records; don't edit those. Back in Resend, **Verify DNS Records**. The domain shows **Verified**.
3. Resend → **API Keys** → **Create API Key**. Name `gmail-send-as`, permission **Sending access**, domain `hanker.dev`. Copy the key straight into step 5; don't save it anywhere else. It is not the production key, so revoking it never touches the app.
4. Look up the current SMTP host, port and username in Resend's SMTP documentation (at the time of writing: host `smtp.resend.com`, port `465` with SSL, username `resend`).
5. Gmail → gear → **See all settings** → **Accounts and Import** → **Send mail as** → **Add another email address**. Name `Hanker`, address `hello@hanker.dev`, **Next step**. Enter the SMTP server, port and username from step 4 and the key from step 3 as the password, choose **Secured connection using SSL**, **Add Account**. Gmail sends a confirmation to `hello@hanker.dev`; it arrives through Step A. Click its link.
6. Still under **Send mail as**, choose **Reply from the same address the message was sent to**.

**Check:** reply, from Gmail, to the test message from Step A's check. In the outside account, the reply is from `Hanker <hello@hanker.dev>`. Its **Show original** (or the equivalent) shows `DKIM: PASS` for `hanker.dev` and `DMARC: PASS`, and your personal address appears nowhere in the headers.

### C. Sentry: don't store IP addresses

Sentry → **Settings** → the organization → **Security & Privacy** → turn on **Prevent Storing of IP Addresses**. This covers both projects. **Check:** send a test event as [Sentry → Check it works](#check-it-works) describes; the event's **User** section shows no IP address.
```

- [ ] **Step 3: Add two rows** to `docs/operations.md` → `## Recurring`, after the existing yearly rows:
  - `| Yearly | Renew \`Expires\` in \`apps/web/public/.well-known/security.txt\` (CI fails once it lapses) | The file; [Contact email](deployment.md#contact-email) |`
  - `| Yearly | Rotate the \`gmail-send-as\` Resend key: create a new one, update Gmail's "Send mail as" password, revoke the old one | [Contact email → B](deployment.md#b-reply-as-hello-resend-smtp-and-gmail) |`
- [ ] **Step 4: Verify.** Run `pnpm format:check`. Expected: it passes, and the two anchors resolve in a Markdown preview.
- [ ] **Step 5: Commit.** Use `git commit -m "docs: runbook for hello@hanker.dev"` with the trailer.

---

### Task 3: `Permissions-Policy` and `security.txt`

**Files:**

- Modify: `apps/web/next.config.ts` (the `/:path*` header rule)
- Modify: `apps/web/next.config.spec.ts`
- Create: `apps/web/public/.well-known/security.txt`
- Create: `apps/web/security-txt.spec.ts`
- Modify: `e2e/tests/smoke/smoke.spec.ts`

**Interfaces:**

- Produces: the response header `Permissions-Policy` on every web response, and `GET /.well-known/security.txt`.

- [ ] **Step 1: Write the failing header test** in `next.config.spec.ts`, named `'turns off the browser features Hanker never uses, but not clipboard or share (Plan 6)'`. It loads the config, finds the rule with `source === '/:path*'`, and asserts:

```ts
expect(rule?.headers).toContainEqual({
  key: 'Permissions-Policy',
  value:
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()',
});
const value = rule?.headers.find((h) => h.key === 'Permissions-Policy')?.value ?? '';
for (const kept of ['clipboard-write', 'clipboard-read', 'web-share']) {
  expect(value).not.toContain(kept);
}
```

- [ ] **Step 2: Write the failing file test** in `apps/web/security-txt.spec.ts`. Read `public/.well-known/security.txt` with `node:fs` (path from `import.meta.url`) and assert, in a test named `'security.txt is valid RFC 9116 and has not lapsed (Plan 6)'`:
  - The lines include, in this order, `Contact: https://github.com/Shockolate/wishlist-app/security/advisories/new` then `Contact: mailto:hello@hanker.dev`.
  - It contains `Preferred-Languages: en`, `Canonical: https://hanker.dev/.well-known/security.txt` and `Policy: https://github.com/Shockolate/wishlist-app/blob/main/SECURITY.md`.
  - Exactly one `Expires:` line, whose value parses as an ISO 8601 date with `Date.parse`, is after `Date.now()`, and is at most 366 days after `Date.now()`.
- [ ] **Step 3: Run both and see them fail.** Run `pnpm --filter @wishlist/web exec vitest run next.config.spec.ts security-txt.spec.ts`. Expected: the header test fails on the missing `Permissions-Policy`, and the file test fails with `ENOENT`.
- [ ] **Step 4: Implement.**
  - Add `{ key: 'Permissions-Policy', value: <the exact value above> }` as the third header of the `/:path*` rule. Put a one-line comment on it saying clipboard and Web Share are left on because "Copy share link" and the share sheet use them.
  - Write `security.txt` with the six fields from Step 2. Set `Expires` to `2027-10-01T00:00:00.000Z`. Add a leading comment line: `# Hanker's security contact. Renew Expires yearly (docs/operations.md).`
  - Don't touch `proxy.ts`. Its matcher runs on this path, but it only adds a CSP header, which is harmless on a text file. The proxy redirects only `/list`, `/settings` and a signed-in `/`.
- [ ] **Step 5: Run them again.** Expected: PASS.
- [ ] **Step 6: Add two smoke tests** to `e2e/tests/smoke/smoke.spec.ts`. Both are read-only, so they're safe against production.
  - `'security.txt is served as text (RFC 9116)'`: `request.get('/.well-known/security.txt')` answers 200, its `content-type` starts with `text/plain`, and the body contains `Contact: mailto:hello@hanker.dev`.
  - `'pages send Permissions-Policy'`: `request.get('/')` has a `permissions-policy` header containing `camera=()`.
- [ ] **Step 7: Verify.** Run the full check from AGENTS.md:
  - `pnpm format:check`
  - `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
  - `pnpm test:e2e`, which runs the sign-up and Turnstile specs with the new header on.

  Expected: all green. The smoke file runs against the PR's preview in CI. Check that the two new tests pass there before asking for review.
- [ ] **Step 8: Commit.** Use `git commit -m "feat(web): send Permissions-Policy and publish security.txt"` with the trailer.

---

### Task 4: The favicon set and the preview image

**Files:**

- Create: `apps/web/src/app/icon.svg`
- Create: `apps/web/src/app/favicon.ico` (32×32)
- Create: `apps/web/src/app/apple-icon.png` (180×180)
- Create: `apps/web/public/hanker-preview.png` (1200×630)

**Interfaces:**

- Produces: `/hanker-preview.png`, which Task 5 references by that path, at 1200×630.

Assets only. The generator is throwaway and stays in the session scratchpad, never in the repo.

- [ ] **Step 1: Write `icon.svg`.** Use `viewBox="0 0 32 32"`, transparent background, the tag from the spec §4.4:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M4 9 L11 3 H27 a2 2 0 0 1 2 2 V27 a2 2 0 0 1 -2 2 H11 L4 23 Z" transform="rotate(-20 16 16)" fill="#ff5a4d" stroke="#1e1b18" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="11" cy="17.5" r="2.2" fill="#faf7f2" stroke="#1e1b18" stroke-width="1.6"/>
</svg>
```

  At 32px, check that the tilted path isn't clipped at the corners. Adjust the path, not the colors, if it is.
- [ ] **Step 2: Render the rasters** with a scratchpad Node script using `@playwright/test`'s `chromium`, already installed for `e2e`. Run it from `e2e/` so it resolves:
  - **`apple-icon.png`:** the SVG centered on a solid `#faf7f2` square at 180×180 with about 12% padding. iOS doesn't honor transparency.
  - **A 32×32 transparent PNG of the SVG.** Wrap it into `favicon.ico` as a single PNG-payload ICO entry: a 6-byte `ICONDIR` (0, 1, 1) plus one 16-byte `ICONDIRENTRY` (32, 32, 0, 0, 1, 32, size, offset 22), then the PNG bytes.
  - **`hanker-preview.png` at 1200×630:** option C from the spec §4.5. Load Instrument Serif from Google Fonts in the scratch HTML and wait for `document.fonts.ready` before the screenshot. Layout, scaled from the approved mockup:
    - background `#faf7f2`, padding about 108px on every side;
    - a top row with a 44px tag and "Hanker" in Instrument Serif at about 40px, in `#1e1b18`;
    - below it, "One list. One link. No doubled-up gifts." in Instrument Serif at about 88px, line-height 1, max width about 80%, in `#1e1b18`.
- [ ] **Step 3: Check the output.** Open each file. Use the `Read` tool on the PNGs, or `file` for dimensions. Expected: `apple-icon.png` is 180×180, `hanker-preview.png` is 1200×630 with the serif font actually rendered (not a Georgia fallback), and `favicon.ico` is reported as `MS Windows icon resource … 32x32`.
- [ ] **Step 4: Verify the build serves them.** Run `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm --filter @wishlist/web build`, then `next start`. Then `curl -sI` each of `/favicon.ico`, `/icon.svg`, `/apple-icon.png` and `/hanker-preview.png`. Expected: each answers `200`. The landing page's HTML has `<link rel="icon" href="/favicon.ico…">`, `<link rel="icon" href="/icon.svg…" type="image/svg+xml">` and `<link rel="apple-touch-icon" href="/apple-icon.png…">`.
- [ ] **Step 5: Commit.** Use `git commit -m "feat(web): add the gift-tag favicon and the link-preview image"` with the trailer.

---

### Task 5: Site facts and preview metadata

**Files:**

- Create: `apps/web/src/lib/site.ts`
- Create: `apps/web/src/lib/site-metadata.ts`
- Create: `apps/web/src/lib/site-metadata.spec.ts`
- Modify: `apps/web/src/app/layout.tsx` (`metadata` becomes `rootMetadata`)
- Modify: `apps/web/src/app/s/[shareToken]/page.tsx` (`generateMetadata` returns `shareMetadata(list.title)`)
- Create: `e2e/tests/local/previews.spec.ts`

**Interfaces:**

- Consumes: `/hanker-preview.png` (Task 4).
- Produces, in `site.ts`:
  - `SITE_ORIGIN = 'https://hanker.dev'`
  - `CONTACT_EMAIL = 'hello@hanker.dev'`
  - `SOURCE_URL = 'https://github.com/Shockolate/wishlist-app'`
  - `TAGLINE = 'One list. One link. No doubled-up gifts.'`

  All are `as const` strings. Tasks 6–8 import `CONTACT_EMAIL` and `SOURCE_URL`.
- Produces, in `site-metadata.ts`:
  - `SHARE_DESCRIPTION = 'Pick a gift so nobody doubles up.'`
  - `PREVIEW_IMAGE`, an object with `url: '/hanker-preview.png'`, `width: 1200`, `height: 630` and `alt: 'Hanker: One list. One link. No doubled-up gifts.'`
  - `rootMetadata: Metadata`
  - `shareMetadata(listTitle: string): Metadata`

- [ ] **Step 1: Write the failing unit tests** in `site-metadata.spec.ts`:
  - `'the root metadata resolves against hanker.dev and previews with the tag image'`:
    - `rootMetadata.metadataBase?.href` is `'https://hanker.dev/'`.
    - `rootMetadata.title` equals `{ default: 'Hanker', template: '%s | Hanker' }`.
    - `rootMetadata.description` is `TAGLINE`.
    - `rootMetadata.openGraph` matches `{ type: 'website', siteName: 'Hanker', title: 'Hanker', description: TAGLINE, images: [PREVIEW_IMAGE] }`.
    - `rootMetadata.twitter` matches `{ card: 'summary_large_image' }`.
  - `'a share page previews its title and one fixed line, nothing else from the list'`, for `shareMetadata('Sam’s wishlist')`:
    - `title` is `'Sam’s wishlist'`.
    - `description` is `SHARE_DESCRIPTION`.
    - `openGraph` matches `{ title: 'Sam’s wishlist', description: SHARE_DESCRIPTION, images: [PREVIEW_IMAGE], siteName: 'Hanker', type: 'website' }`.
  - `'no metadata names a URL for the page, so a token can never reach one'`: a recursive walk of `rootMetadata` and `shareMetadata('x')` finds no key named `url` except inside `PREVIEW_IMAGE`, and no `alternates` key.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm --filter @wishlist/web exec vitest run src/lib/site-metadata.spec.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `site.ts` and `site-metadata.ts`.** `shareMetadata` builds its `openGraph` from scratch from the same pieces as the root, not by spreading the root's `openGraph`. A child segment's `openGraph` replaces the parent's whole object, which is why it must restate `images`. Say so in a one-line comment.
- [ ] **Step 4: Wire it in.**
  - `layout.tsx` exports `metadata = rootMetadata`.
  - The share page's `generateMetadata` returns `shareMetadata(list.title)`. Keep its existing doc comment, and add "and one fixed line".
  - The landing page's `<h1>` keeps its literal text. Using `TAGLINE` there is fine, but optional.
- [ ] **Step 5: Run the unit tests.** Expected: PASS.
- [ ] **Step 6: Write `e2e/tests/local/previews.spec.ts`.** It needs `verifiedOwner`, `addItemViaApi` and `shareTokenOf` from `e2e/support`, and a guest context.
  - `'the landing page previews as Hanker with the tag image'`:
    - `meta[property="og:title"]` is `Hanker`.
    - `og:image` is `https://hanker.dev/hanker-preview.png`.
    - `twitter:card` is `summary_large_image`.
    - There's no `meta[property="og:url"]` and no `link[rel="canonical"]`.
  - `'a share link previews the list title and one line, with no token or item in any meta tag'`:
    - The owner adds an item titled `Enamel stovetop kettle` and reads the list title from `GET /api/wishlist`. A guest opens `/s/<token>`.
    - `og:title` equals the list title.
    - `og:description` is `Pick a gift so nobody doubles up.`
    - `og:image` is present.
    - Neither the token nor `Enamel stovetop kettle` appears in the `content` of any `<meta>` or the `href` of any `<link>` in `<head>`.
    - There's no `og:url`.
  - `'a claim page previews only the site defaults'`: claim with `claimViaApi`, then open its `manageUrl` path as the guest. `og:title` is `Hanker`, and the manage token appears in no `<meta>` content.
- [ ] **Step 7: Run it.** Run `pnpm test:e2e previews.spec.ts`. Expected: PASS. If the share page's `og:image` is missing, the share metadata is spreading instead of restating. Fix that, not the test.
- [ ] **Step 8: Verify.** Run the full check from AGENTS.md: `format:check`, then `turbo run lint typecheck test build`, then `test:e2e`. Expected: all green, including `landing.spec.ts`'s `toHaveTitle('Hanker')`.
- [ ] **Step 9: Commit.** Use `git commit -m "feat(web): link previews for the site and share links"` with the trailer.

---

### Task 6: Check the privacy page's claims that code can't prove

**Files:** none in the repo. The findings go into the Task 7 copy, and into the layer's PR body as a table: claim, source, finding.

Every other claim in the Task 7 copy was checked against the code on 2026-10-21. The sources:

- **What's stored:** `schema.ts`.
- **Hashed rate-limit keys:** `rate-limit/keys.ts`.
- **The HIBP 5-character prefix:** `security/breached-passwords.ts`.
- **Hashed manage tokens:** `claims.manage_token_hash`.
- **Gifters see each other's names:** spec §2.
- **Photos hotlinked:** `item-photo.tsx` and `card-photo.tsx`, with the no-proxy rule.
- **Backups encrypted on the runner before upload:** `scripts/backup.sh`, which pipes `pg_dump` into `age`.
- **30-day R2 lifecycle:** `deployment.md`.
- **7-day unverified purge and immediate deletes:** spec §5 and the daily cron, `DELETE /me` cascades, `DELETE /claims/:manageToken`.

Re-check them if the code changed after that date.

- [ ] **Step 1: Turnstile's storage.** With a scratch Playwright script, open `https://hanker.dev/signup` (read-only: don't submit) and wait for the widget's token. Then record `context.cookies()` for all URLs, including `challenges.cloudflare.com`, and the page's `localStorage` and `sessionStorage` keys.
  - The finding decides `{TURNSTILE_SENTENCE}` in Task 7.
  - If Cloudflare set nothing, it's an empty string.
  - Otherwise use: `The sign-up check from Cloudflare may store a short-lived value in your browser while it runs.`
- [ ] **Step 2: Sentry's IP setting.** Check the organization's "Prevent Storing of IP Addresses", through the Sentry MCP tools if connected, otherwise by asking Ted.
  - If it's off, ask Ted to do `docs/deployment.md` → Contact email → C. The copy assumes it's on, and Task 9 re-checks it.
- [ ] **Step 3: Vercel's and Resend's log retention.**
  - **Vercel:** find the team's plan with the Vercel MCP `get_team` tool for team `shockolate`, then that plan's runtime-log retention in Vercel's docs. That fills `{VERCEL_RETENTION}`, for example `an hour`.
  - **Resend:** find the plan's data retention on Resend's pricing page for the free plan. That fills `{RESEND_RETENTION}`, for example `for a day`.
  - Record the URLs in the PR body.
- [ ] **Step 4: If any finding contradicts the Task 7 copy,** change the copy to match reality and say so in the PR body. If the contradiction changes what Hanker promises, rather than a number, stop and ask Ted.

---

### Task 7: `/privacy` and `/terms`

**Files:**

- Create: `apps/web/src/components/legal-page.tsx`
- Create: `apps/web/src/app/privacy/page.tsx`
- Create: `apps/web/src/app/terms/page.tsx`
- Create: `apps/web/src/app/robots.spec.ts`
- Modify: `e2e/tests/local/pages.spec.ts` (two paths in the loop)
- Create: `e2e/tests/local/legal.spec.ts`

**Interfaces:**

- Consumes: `CONTACT_EMAIL` (Task 5), and Task 6's three findings.
- Produces: `LegalPage({ title: string, updated: string /* ISO date */, children: ReactNode })`. It renders `SiteHeader action="none"`, a `<main>` at `max-w-[680px]` with the site's page padding, an `<h1>` in `font-display`, and `Last updated <time dateTime={updated}>` with the date formatted as `October 21, 2026` via `Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })`. Under it, `<h2>` sections take the site's heading scale and body text is `text-lg leading-relaxed`.

- [ ] **Step 1: Write the failing tests.**
  - **`robots.spec.ts`**, named `'the legal pages stay indexable (Plan 6)'`: `robots().rules` disallows exactly `['/verify-email', '/reset-password', '/list', '/settings', '/s/', '/c/']`, and no entry is a prefix of `/privacy` or `/terms`. It should pass today, and it pins the constraint.
  - **`pages.spec.ts`:** add `'/privacy'` and `'/terms'` to the path loop.
  - **`legal.spec.ts`:**
    - `'/privacy names who runs Hanker and how to reach them'`: the page's title is `Privacy | Hanker`, the `<h1>` is `Privacy`, the text contains `Ted Armstrong` and `Portland, Maine`, and a link named `hello@hanker.dev` has `href` `mailto:hello@hanker.dev`.
    - `'/terms says who may use Hanker'`: the title is `Terms | Hanker`, and the text contains `13 and older` and `Maine law`.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm test:e2e legal.spec.ts pages.spec.ts`. Expected: both legal paths 404.
- [ ] **Step 3: Write the two pages.** Each exports `metadata = { title: 'Privacy' }` or `{ title: 'Terms' }`, uses `LegalPage` with `updated="2026-10-21"` (change it to the day the layer merges, if later), and has exactly the copy below. `CONTACT_EMAIL` renders as a `mailto:` link, and "Settings" links to `/settings`. Fill the three `{…}` placeholders from Task 6, and leave nothing in braces.

**`/privacy`**, under the title **Privacy**:

> Hanker is a small wishlist site run by Ted Armstrong in Portland, Maine, USA. This page says what Hanker keeps about you, who else handles it, and for how long. Questions go to hello@hanker.dev.
>
> **If you make a list**
> Hanker keeps your email address, your display name, your password as a one-way hash (never the password itself), and your list: its title, items, links, prices, photo addresses and notes. When you paste a shop link, Hanker's server visits that page to fill in the title, price and photo, so the shop sees a visit from Hanker, not from you.
>
> **If you claim a gift**
> Hanker keeps the name you type and how many you're getting. Anyone with the list's link sees your name next to the item, so nobody doubles up. The list's owner sees it only if they've turned that on. Your browser keeps your claim link so you can change or cancel your claim later; Hanker keeps only a scrambled copy of it.
>
> **What Hanker doesn't do**
> No ads, no analytics, no tracking. Your information is never sold or shared for marketing.
>
> **Cookies and storage**
> One cookie, which keeps you logged in. Claim links stay in your browser's own storage. {TURNSTILE_SENTENCE} Nothing else, which is why there's no cookie banner.
>
> **Who else handles your information**
> Hanker runs on a few services, and each sees only what it needs:
>
> - Vercel hosts the site. Its logs record requests, including IP addresses, and keep them {VERCEL_RETENTION}.
> - Neon stores the database.
> - Resend sends Hanker's emails, so it sees your email address and the message, and keeps a record {RESEND_RETENTION}.
> - Cloudflare checks that sign-ups come from a person, which means it sees your IP address and browser details. It also stores Hanker's encrypted backups.
> - GitHub runs the nightly backup, which is encrypted before it leaves GitHub's machine.
> - Sentry receives error reports, with the secret parts of links, email addresses and IP addresses removed.
> - Have I Been Pwned checks new passwords against known leaks. It receives the first five characters of a scrambled copy of your password, never the password.
>
> **Photos on lists**
> Item photos load straight from the shop's website, so that shop can see the IP address of whoever views the list.
>
> **How long it's kept**
>
> - Delete your account in Settings, and your account, your list and every claim on it are removed straight away.
> - Cancel a claim from your claim link, and it's removed straight away.
> - Encrypted backups keep a copy for up to 30 days, and then it's gone.
> - Accounts whose email is never confirmed are deleted after 7 days.
> - To slow down abuse, Hanker counts requests using a scrambled fragment of your IP address or email, and clears each count when its time window ends.
>
> **Children**
> Hanker is for people 13 and older, whether you make a list or claim a gift. If you think a child under 13 has given Hanker information, email hello@hanker.dev and it will be deleted.
>
> **Changes**
> If this page changes, the date at the top changes too. The [terms](/terms) cover the rest.

**`/terms`**, under the title **Terms**:

> Hanker is a free wishlist site that Ted Armstrong runs as a personal project. Using it means agreeing to these terms.
>
> **Provided as-is**
> Hanker is free and comes with no guarantee. It may be down, change or close. Backups exist, but don't keep the only copy of anything important here. As far as the law allows, Ted isn't liable for any loss from using Hanker.
>
> **Who can use it**
> Hanker is for people 13 and older, whether you make a list or claim a gift.
>
> **Be decent**
> Don't use Hanker for anything illegal, abusive or spammy, or to get at other people's lists or information. Ted can remove content or accounts that break these terms.
>
> **Your list is yours**
> You own what you put on your list. You give Hanker only the right to store it and show it to anyone with your link.
>
> **Shops and gifts**
> Hanker links to shops it doesn't run. It isn't responsible for them, their prices, or anything anyone buys.
>
> **Changes**
> These terms may change, and the date at the top shows when. The [privacy page](/privacy) says what Hanker keeps about you.
>
> **The legal bits**
> Maine law applies. Questions go to hello@hanker.dev.

- [ ] **Step 4: Run the tests.** Run `pnpm test:e2e legal.spec.ts pages.spec.ts` and `pnpm --filter @wishlist/web exec vitest run src/app/robots.spec.ts`. Expected: PASS, with no axe violations and no phone overflow on either page.
- [ ] **Step 5: Verify.** Run the full check from AGENTS.md. Expected: all green.
- [ ] **Step 6: Commit.** Use `git commit -m "feat(web): add the privacy and terms pages"` with the trailer. The PR body carries Task 6's findings table.

---

### Task 8: The footer

**Files:**

- Create: `apps/web/src/components/site-footer.tsx`
- Modify: `apps/web/src/app/layout.tsx` (mount it)
- Create: `e2e/tests/local/footer.spec.ts`

**Interfaces:**

- Consumes: `CONTACT_EMAIL` and `SOURCE_URL` (Task 5), and the `/privacy` and `/terms` routes (Task 7).
- Produces: `SiteFooter()`, with no props.

- [ ] **Step 1: Write the failing E2E tests** in `footer.spec.ts`, using a helper `expectFooter(page)`. The helper asserts that `page.getByRole('contentinfo')` holds exactly four links, in this order:
  1. name `Source on GitHub`, href `https://github.com/Shockolate/wishlist-app`
  2. name `Privacy`, href `/privacy`
  3. name `Terms`, href `/terms`
  4. name `hello@hanker.dev`, href `mailto:hello@hanker.dev`

  It also asserts that the contentinfo's text doesn't contain `Ted`. Tests:
  - `'the footer is on the landing page, the login page and a 404'`: run `expectFooter` on `/`, `/login` and `/no-such-page`.
  - `'a gifter sees the footer on a share page, below the list'`: `verifiedOwner`, add one item, open `/s/<token>` in a guest context, run `expectFooter`, and check the footer's bounding box `y` is greater than the `<main>`'s.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm test:e2e footer.spec.ts`. Expected: FAIL, because there's no contentinfo.
- [ ] **Step 3: Implement `SiteFooter`.**
  - It's a `<footer>` with a top `border-t` in a soft border color, in the same `max-w-[1200px] px-4 sm:px-7` frame as `SiteHeader`.
  - The text is `text-[15px] text-muted-foreground`, and the links are `text-foreground underline inline-flex min-h-11 items-center`.
  - Put a decorative ` · ` between links in `aria-hidden` spans, with `flex flex-wrap gap-x-…` so it wraps on a phone.
  - The GitHub link is a plain `<a>`, with no `target="_blank"`, to match the site's other links.
  - Doc comment: `/** Every page's footer: the source, the legal pages and the contact address (Plan 6, D54). */`
- [ ] **Step 4: Mount it in `layout.tsx`.** The `<body>` becomes `flex min-h-dvh flex-col`, with `{children}` wrapped in `<div className="flex-1">` and `<SiteFooter />` after it, so the footer sits at the bottom of short pages. Then check by eye at 390px and at 1280px that `/list`'s editor, the share page's claim sheet and the settings dialogs still render as before. The sheet and dialogs are Radix portals, so they're unaffected.
- [ ] **Step 5: Run the tests.** Run `pnpm test:e2e footer.spec.ts pages.spec.ts`. Expected: PASS. `pages.spec.ts` now covers axe and phone fit for every page, with the footer present.
- [ ] **Step 6: Verify.** Run the full check from AGENTS.md, including all of `pnpm test:e2e`. Expected: all green.
- [ ] **Step 7: Commit.** Use `git commit -m "feat(web): add the site footer"` with the trailer.

---

### Task 9: Merge gate and go-live checkpoint (Ted)

- [ ] **Step 1: Before the stack merges,** Ted completes `docs/deployment.md` → Contact email → A and B, and their checks pass. Then he does C, confirming Sentry doesn't store IP addresses, since Task 6 couldn't read the setting and `/privacy` relies on it. Layers 3, 5 and 6 publish `hello@hanker.dev`, and none merges before then.
- [ ] **Step 2: After the deploy:**
  - **Favicon:** the tag shows in a light and a dark browser tab, and on an iPhone, Share → Add to Home Screen shows the cream-backed tag.
  - **Link previews:** paste `https://hanker.dev` into LinkedIn's Post Inspector (https://www.linkedin.com/post-inspector/). It shows the type-only image and "Hanker". Text yourself `https://hanker.dev` and one of your share links. The share link's preview shows your list title and "Pick a gift so nobody doubles up."
  - **Headers:** `curl -sI https://hanker.dev/ | grep -i permissions-policy` shows the header, and https://securityheaders.com/?q=hanker.dev lists it.
  - **`security.txt`:** run https://internet.nl's website test on `hanker.dev`. Under **Security options**, its security.txt row reports the file valid. (securitytxt.org only generates files; it has no validator.)
  - **On a phone,** "Copy share link" in `/list` and the share sheet after a claim both still work.
  - **The footer's** `hello@hanker.dev` link opens a mail draft, and a message sent from it arrives.
- [ ] **Step 3: Mark the roadmap.** Set the roadmap row to `Done` in a small follow-up PR, as with earlier plans.
