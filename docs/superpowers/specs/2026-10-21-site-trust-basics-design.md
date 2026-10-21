# Site Trust Basics — Design

- **Date:** 2026-10-21
- **Status:** Approved by Ted, 2026-10-21
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md): §7 gains `/privacy` and `/terms`, §6.9 gains `Permissions-Policy`. The plan assigns decision numbers from D54.
- **Origin:** an audit of hanker.dev on 2026-10-21 against common practice for a live site. It found no footer, contact, privacy policy, terms, favicon, link-preview metadata, `security.txt` or `Permissions-Policy`. Ted decided everything below in conversation that day.

## 1. Intent

Two kinds of stranger land on Hanker, and today neither can tell who runs it or how to reach them:

1. **Someone researching Ted**, who clicked from his resume or his GitHub. Hanker doubles as a portfolio piece, so a missing basic reflects on how he builds. They should find the source easily, and see a site that has the details a careful engineer would put in.
2. **Real users.** Sign-up has been open since 2026-10-19. Owners give Hanker their email address and a password. Gifters, often family who opened a link from a text message, give it their name. Both deserve a plain statement of what happens to that data and someone to contact.

The legal bar is low. Ted is in Portland, Maine, USA, so no postal address or imprint is needed. Hanker sends only transactional email, so CAN-SPAM's address rule doesn't apply. It doesn't target the EU, so GDPR most likely doesn't apply either. A privacy policy is best practice here, not a strict requirement. The one real exposure is children: COPPA applies once a site knows it has a user under 13. So the terms and the privacy page both say Hanker is for people 13 and older. That covers gifters as well as account holders, because kids open family share links and type a name Hanker stores. None of this is legal advice. It is the reading the design rests on.

## 2. Goals, non-goals, anti-goals

### Goals

- A footer on every page that links to the source, the privacy page, the terms and a contact address.
- A short privacy page and a short terms page, in plain language, every claim true of the code that is deployed.
- A favicon, and link previews for hanker.dev and for share links.
- `/.well-known/security.txt` and a `Permissions-Policy` header.
- Step-by-step instructions for every manual step, in the plan and in `docs/deployment.md` and `docs/operations.md`, so Ted can do them without reconstructing anything.

### Non-goals

- Ted's name in the footer. Anyone curious finds him through the source link.
- A postal address, an imprint, a cookie banner, or GDPR machinery such as a data-request process.
- A sitemap. The five public pages are all linked from the landing page and the footer, so it would tell crawlers nothing.
- A contact form, an about page, data export, analytics.
- Changing any product behavior, data model or API.

### Anti-goals

These would make it a failure even if it technically works:

- **A privacy page that says something untrue.** That is worse than having none. Each claim is checked against the code (§4.2).
- **A footer that advertises an address that bounces.** Nothing showing `hello@hanker.dev` reaches production before the forwarding is proven (§5).
- **A footer that gets in a gifter's way** on a share page or claim page.
- **A link preview that leaks something.** A share link's preview shows the list's title and nothing else from the list. Previews are fetched by whatever app displays them, sometimes on that app's servers.
- **A new third party or tracker.** The cost stays $0 and no new service sees user data.
- **Legal copy that reads like boilerplate.** It should sound like the rest of Hanker.

## 3. Constraints

- Everything in [AGENTS.md](../../../AGENTS.md) applies: exact pins, a preference for platform APIs over new dependencies, test-first behavior changes, the nonce CSP from `proxy.ts`, theme tokens from `globals.css`, and terracotta (`primary`) never carrying text.
- People see **Hanker**. Code and file names say `wishlist` where they already do.
- The token pages (`/s/*`, `/c/*`, `/verify-email`, `/reset-password/confirm`) keep `Referrer-Policy: no-referrer` and `noindex`. No new metadata on them may contain a token or claim data.
- Links on pages that carry a token must not leak it. The footer's links go to the same origin or to GitHub, and the existing `no-referrer` policy already covers them.
- `/privacy` and `/terms` are indexable. `robots.ts` must not disallow them.

## 4. What was decided

### 4.1 Footer

- **Text, in this order:** `Source on GitHub · Privacy · Terms · hello@hanker.dev`. These are four links separated by middle dots. Option A from the mockups.
  - **Source on GitHub** goes to `https://github.com/Shockolate/wishlist-app`.
  - **Privacy** goes to `/privacy`.
  - **Terms** goes to `/terms`.
  - **hello@hanker.dev** is a `mailto:` link.
- **Look:** one quiet line in `muted-foreground` text, with a top border, wrapping naturally on a phone. Links keep the 44px minimum tap height the rest of the site uses.
- **Where:** every page, including the landing page, the auth pages, `/list`, `/settings`, the share and claim pages and the 404s. It is a `<footer>` landmark.

### 4.2 Privacy page (`/privacy`)

Plain language with short headings, ideally one screen or two on a phone, and a "Last updated" date. It names **Ted Armstrong**, the name on his resume and GitHub, not his legal name, in Portland, Maine, with `hello@hanker.dev`.

The content, as agreed. The builder writes the final wording within it:

- **Who runs Hanker:** Ted Armstrong, Portland, Maine. Contact is hello@hanker.dev.
- **Owners:** Hanker stores your email, display name, a hashed password (never the password itself) and your list. When you paste a shop link, Hanker's server fetches that page to fill in the title, price and photo.
- **Gifters:** Hanker stores the name you type and how many you're getting. Your claim link is kept in your browser's storage. Anyone else with the share link sees your name next to the item, so nobody doubles up. The owner sees it only if they've turned that on (main spec §2).
- **What Hanker never does:** no ads, no analytics, no tracking, no selling data.
- **Cookies and storage:** one session cookie to keep you logged in, and the claim links and the name a gifter last claimed with in browser storage. Hanker shows no cookie banner because it needs none.
- **Services that handle data:**
  - Vercel (hosting)
  - Neon (database)
  - Resend (email)
  - Cloudflare (the sign-up check, and encrypted backups in R2)
  - GitHub (the nightly backup runs on GitHub Actions, which encrypts the dump before it leaves the runner. *Claude's call:* the reviewer noted the data passes through it, so it's listed. The plan confirms the wording against `scripts/backup.sh`.)
  - Sentry (error reports, with tokens and email addresses removed)
  - Have I Been Pwned (receives a 5-character fragment of a password's hash, never the password)
- **Item photos** load straight from the shop's site, so that shop can see the visitor's IP address.
- **How long things are kept:**
  - Deleting your account removes it, your list and its claims right away.
  - Encrypted backups keep a copy for up to 30 days.
  - Unverified accounts are deleted after 7 days.
  - Rate limiting stores only a hash of an IP address or email, deleted within two days by the daily cleanup (amended after the final review to match `cleanup.service.ts`).
- **Age:** Hanker is for people 13 and older, owners and gifters alike. If you think a child under 13 has given Hanker information, email hello@hanker.dev and it will be deleted.
- **Changes:** the "Last updated" date changes when the page does.

**Every claim is verified before it ships.** The plan lists each claim next to the code, setting or dashboard that proves it. Known sources:

- `apps/api/src/db/schema.ts` for what's stored.
- `apps/api/src/rate-limit/keys.ts` for hashed keys.
- `apps/api/src/security/breached-passwords.ts` for the HIBP range query.
- The daily cron for the 7-day purge.
- The R2 lifecycle rule in `docs/deployment.md` for 30-day backups.
- `scrubEvent` and spec §9 for Sentry.
- `claim-records.ts` (`hanker:claims`) for browser storage.

The plan must check three things the code alone can't prove, and say in the page what it finds:

- **Whether Turnstile sets cookies or storage of its own.** Check in a browser's devtools on the sign-up page.
- **Whether Sentry stores the reporting browser's IP address.** This is the project setting "Prevent Storing of IP Addresses". If it's off, it's a manual step to turn it on (§5).
- **What Vercel and Resend keep in their request and email logs, and for how long.** The page states that hosting logs include IP addresses for a short time, if that's what the plan finds.

If any claim turns out false, the page changes to match the code, not the other way round, unless Ted decides otherwise.

### 4.3 Terms page (`/terms`)

Even shorter than the privacy page, plain language, with a "Last updated" date:

- Hanker is a free personal project, provided as-is, with no guarantee it stays up or keeps data forever. Backups exist, but it isn't a vault.
- Hanker is for people 13 and older. That covers everyone, gifters included, not only account holders (Ted's ruling, 2026-10-21).
- Don't use it for anything illegal, abusive or spammy. Ted can remove content or accounts that do.
- Hanker isn't responsible for the shops you link to, or what anyone buys.
- You own what you put on your list, and give Hanker only the right to store it and show it to people with your link.
- The terms can change, and the "Last updated" date shows when.
- Maine law applies. Contact is hello@hanker.dev.

### 4.4 Favicon

Option C from the mockups: **a terracotta gift tag with a dark-ink outline and a cream hole, tilted about 20°, with no letter**, on a transparent background. It is drawn in `primary` (`#ff5a4d`) and `foreground` (`#1e1b18`), with the hole in `background` (`#faf7f2`). It must stay legible at 16px in both light and dark browser tabs. It ships as an SVG icon plus the raster fallbacks browsers and iOS still ask for (a `favicon.ico` and an Apple touch icon).

### 4.5 Link previews

- **The image** is option C from the mockups, type only. On the cream background, a small gift tag (§4.4) sits beside the "Hanker" wordmark, with the tagline "One list. One link. No doubled-up gifts." large below it in Instrument Serif, in dark ink. It is 1200×630 and has no photos.
- **Every page** gets Open Graph and Twitter-card metadata with that image (`summary_large_image`). The default title is "Hanker" and the default description is the existing tagline.
- **Share pages (`/s/[shareToken]`):**
  - The title is the list's own title, as today.
  - The description is exactly **"Pick a gift so nobody doubles up."**
  - The image is the same one.
  - Nothing else from the list appears: no items, photos or claim counts. The description doesn't vary with `ownerSeesClaims`, because a line like "they won't see who's getting what" would be false for owners who opted in.
  - `og:url` and any canonical URL must not contain the token. Omit them on token pages.
- **Claim pages (`/c/[manageToken]`) and the auth token pages** use the site defaults only.

### 4.6 `security.txt`

`/.well-known/security.txt` follows RFC 9116:

- `Contact:` GitHub's private vulnerability reporting URL, the same one `SECURITY.md` uses, first.
- `Contact: mailto:hello@hanker.dev` second.
- `Expires:` at most a year out.
- `Preferred-Languages: en`.
- `Canonical: https://hanker.dev/.well-known/security.txt`.
- `Policy:` a link to `SECURITY.md` on GitHub.

`docs/operations.md`'s Recurring table gains a yearly row to renew `Expires`. The proxy must serve the file untouched, with no redirect.

### 4.7 `Permissions-Policy`

The web app sends a `Permissions-Policy` header that turns off the powerful browser features Hanker never uses, such as camera, microphone, geolocation, payment and USB. It must leave **clipboard writing and Web Share** working on the same origin, because "Copy share link", the manage link copy and the phone share sheet use them (`share-actions.tsx`, `share-link-card.tsx`, `manage-claim.tsx`, `claim-done.tsx`). It also must not break the Turnstile iframe. The builder chooses the exact list and adds a test like the existing header tests in `next.config.spec.ts`.

## 5. Manual steps

Ted does these himself. Each is a cloud change, and AGENTS.md requires approval for those. **The plan must include each one as numbered, click-by-click instructions, with how to check it worked**, and the same instructions must land in `docs/deployment.md`, with any recurring check in `docs/operations.md`.

1. **Forward `hello@hanker.dev` to Ted's inbox with Cloudflare Email Routing** (free; hanker.dev's DNS is already at Cloudflare).
   - Enable Email Routing on the zone, add and verify the destination address, and create the custom address `hello@`.
   - Accept the MX and SPF records Cloudflare adds at the apex.
   - Confirm this leaves Resend's records on `mail.hanker.dev` and `send.mail.hanker.dev`, and `_dmarc`, untouched.
   - **Check:** an email sent from an outside account to hello@hanker.dev arrives, and a verification email from `no-reply@mail.hanker.dev` still arrives after the change.
   - **This step gates the footer:** nothing that shows `hello@hanker.dev` merges to `main` until the check passes.
2. **Reply as `hello@hanker.dev` through Resend** (Ted's ruling, 2026-10-21; $0, because Resend's free plan allows three verified domains).
   - Verify the apex `hanker.dev` in Resend as a second domain next to `mail.hanker.dev`, and add the DKIM record (`resend._domainkey.hanker.dev`) and the `send.hanker.dev` MX and SPF records Resend shows, all DNS only.
   - Confirm they sit alongside Email Routing's apex MX and SPF, not instead of them.
   - Create a new Resend API key, limited to sending and to `hanker.dev`. It is separate from production's key, so revoking it never touches the app, and it lives only in Gmail, never in the repo or Vercel.
   - In Gmail → Settings → Accounts → "Send mail as", add `hello@hanker.dev` through Resend's SMTP server, with that key as the password. Take the host, port and username from Resend's SMTP docs at the time.
   - **Check:** a reply from Gmail as hello@hanker.dev reaches an outside account and passes DKIM and DMARC (look at "Show original"), and doesn't reveal Ted's personal address anywhere in its headers.
   - **Note** in `docs/deployment.md` that these replies share Resend's free 100-a-day cap with Hanker's own emails. `docs/operations.md`'s yearly rotation row gains the Gmail SMTP key.
3. **Sentry: stop storing IP addresses**, if §4.2's check finds the setting off. Turn on "Prevent Storing of IP Addresses" in both Sentry projects. **Check** with a test event as `docs/deployment.md` → Sentry → Check it works describes.
4. **After the deploy, check what only a browser or a third-party tool can show:**
   - The favicon in light and dark tabs and on an iPhone home screen.
   - The link preview in LinkedIn's Post Inspector and in an iMessage to yourself, for both hanker.dev and a share link.
   - `Permissions-Policy` in a header scanner.
   - `security.txt` in a validator.
   - Copy share link and the share sheet still work on a phone.

## 6. Left to the builder

- Component structure, and where the footer is mounted. The root layout or the page shells are both fine, as long as §4.1's "every page" holds, and the builder decides whether `error.tsx` gets it.
- How the preview image and icons are produced: a static file or Next's built-in image generation, and how `metadataBase` resolves on previews versus production.
- The final wording of the privacy and terms pages, within §4.2 and §4.3.
- The exact `Permissions-Policy` list (§4.7).
- Tests: unit tests for headers, metadata and robots, and whether the E2E golden path asserts the footer.
- How the work splits into stacked PRs, keeping the email-forwarding gate in §5. Then the spec amendments, the decision numbers, and a roadmap row.
