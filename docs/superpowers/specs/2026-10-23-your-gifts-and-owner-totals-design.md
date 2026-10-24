# Your Gifts and Owner Totals — Design

- **Date:** 2026-10-23
- **Status:** Draft, pending Ted's review
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md): §2 Spoilers (owners see totals, never names), §4 (a `claim_links` table), §5 and §5.1 (new fields and endpoints, a changed projection table), §7 (a **Your gifts** page, signed-in states of the claim sheet and the manage page). D33 and D40 are amended. The plan assigns decision numbers from D75.
- **Origin:** Ted, in conversation on 2026-10-23, from suggestion #3 of that day's feature review ("What you're getting"), widened from a browser-only page to one kept on the account. Mockups in `.superpowers/brainstorm/557350-1792792425/content/` locally: `gifts-layout.html` (option A, cards, chosen) and `claim-states.html` (approved as drawn). Everything marked _Ted_ he decided; everything marked _Claude's call_ he saw in a playback or the mockups and didn't object to, or is flagged as open.

## 1. Intent

Most of Hanker's gifters are owners too: family members who made an account to share their own list, and who buy for each other. Today a gifter's claims live only in the browser that made them (D45) and behind manage links scattered across text threads. Someone buying for five people has no shopping list.

So a signed-in gifter's claims go on **Your gifts**, a page on their account that works on any device they sign in on. They use it in three modes (_Ted_):

1. **Remembering** what they committed to buy.
2. **Buying:** they've set time aside and work through it, ticking off what they've bought.
3. **Changing their mind:** raising or lowering a quantity, or letting a claim go.

Claiming without an account stays exactly as it is.

Alongside it, and shipped first, the spoiler setting changes meaning: **an owner never learns who is getting what.** With the setting on, an owner sees only how many of each item are claimed (_Ted_). Linking claims to accounts makes "who" more knowable than ever, so the rule that the owner never sees it has to be absolute before Your gifts exists.

**Success looks like:** Grandma, signed in on her tablet, opens Your gifts in December, sees everything she promised across four grandchildren's lists, taps through to each shop, and ticks each one off. Meanwhile Sam's editor says "3 of 5 claimed" on the card packs and never says by whom.

## 2. Goals, non-goals, anti-goals

### Goals

1. **Part 1, owner totals.** An owner with the setting on sees, per item, how many are claimed out of how many they want, and nothing about who. With it off, they see nothing, as today.
2. **Part 2, Your gifts.** A verified, signed-in gifter's claims appear on Your gifts, grouped by the person they're for, with what's needed to buy each one: photo, title, price, quantity, the owner's note, and the shop link.
3. From Your gifts, a gifter can tick **Bought**, change the name or quantity, or let a claim go, without the manage link.
4. A claim made signed out, for example inside WhatsApp's built-in browser, joins Your gifts when its manage link is opened signed in.
5. `/privacy` describes the new data in the same release that starts storing it (as for Plans 8 and 9).

### Non-goals

- **Changing anonymous claiming.** No account is ever needed to claim, and the three-tap flow, the manage link and `hanker:claims` (D45) stay as they are.
- **Showing the manage link on Your gifts.** Only its hash is stored (§4), so it can't be shown. The claim sheet shows it once, as today.
- **Moving a claim between accounts,** or sharing Your gifts with a partner.
- **Showing Bought to anyone else,** including other gifters and owners who opted in.
- **Notifications or emails** of any kind (spec §1 non-goals, D20).
- **Budgets, totals, sorting or filters** on Your gifts.
- **Linking claims from unverified accounts.** Their claims are ordinary anonymous claims.
- **A browser-only Your gifts page** for gifters without an account (suggestion #3's first form). Dropped in favour of this one.

### Anti-goals (a failure even if it works)

- **An owner learning anything new.** No endpoint an owner can call reveals a claimer's name, a link, an account, or a Bought tick. This includes the owner's own share page, signed in.
- **A gift freed by accident.** Deleting an account, unlinking or a failed link must never delete a claim or change a quantity, since the item would show as free while it sits wrapped in a cupboard.
- **A slower or busier claim sheet** for anyone, signed in or not.
- **A page that changes data just by being opened.** Link previews, prefetches and scanners open pages too, so a manage link is linked by a request the page sends after it loads, never during the server render.

## 3. What we know (evidence, 2026-10-23)

- `projectWishlist` (`apps/api/src/claims/projection.ts`) is the only place claim data joins an item. Today an opted-in owner gets `remaining` and the full `claims[]`, names included.
- The editor recomputes `remaining` from `claims[]` after an item edit (spec §7, Plan 4b), so dropping `claims[]` for owners needs a total in its place.
- `ClaimSchema` is `{id, claimerName, quantity}`; claims have `created_at` and `updated_at` columns.
- `GET /claims/:manageToken` already returns everything a gift card needs: the item, the list's title, the owner's display name, `remaining` and the share URL.
- Account deletion deletes the `users` row and relies on `ON DELETE CASCADE` (`apps/api/src/auth/account.service.ts`). Today every foreign key cascades (spec §4).
- Sign-up opened 2026-10-19. Opted-in owners exist (Ted turned it on in testing); how many is unknown (§9).

## 4. Constraints

- Every existing rule in `AGENTS.md` holds: the claim lock order (an item row `FOR UPDATE`, never the wishlist's), `REPEATABLE READ, READ ONLY` for reads that return claims, problem+json with stable codes, explicit `@Inject`, ESM imports, and expand-then-contract migrations that work alongside the deployed API.
- Free to run: no new services.
- Logs and Sentry never carry a claimer name, a manage token, or which account holds which claim.

## 5. What was decided

### 5.1 Part 1: owners see totals, never names (_Ted_)

- The setting (`showClaimsToOwner`, unchanged in storage) now means "show how many are claimed".
  - **Off** (default): no claim data at all, as today.
  - **On:** each item carries `remaining` and a new `claimed` (the sum of its claims' quantities). `claims[]` is never sent to an owner, on `GET /wishlist` or on `GET /shared` as the owner.
- **Example (_Ted_):** Sam wants 5 packs of cards; Mom claims 2 and Grandma claims 1. Sam sees "3 of 5 claimed". Nothing else.
- **Gifters are unchanged:** they still see each other's names and quantities, so they can coordinate (spec §2). _Claude's reading, not contradicted._
- **An owner who opens their own link signed out** is still a guest and sees names (spec §2's accepted limit). Unchanged.
- **Over-claiming (D19):** when an owner lowers a quantity below what's claimed, `claimed` is reported as it is ("3 of 2 claimed") and `remaining` stays 0. _Claude's call._ The copy may soften it; the numbers stay true.

**What changes for people today:**

| Where | Today | After |
|---|---|---|
| Editor claim line | "Aunt Sue is getting this", "Sam ×1, Priya ×1 · 1 left" | "None claimed yet", "3 of 5 claimed", "All 5 claimed" |
| Owner's view of `/s` | names when opted in | the same totals |
| `/settings` toggle | shows who's getting what | **"Show how many are claimed"**, with a confirmation that says names are never shown |
| Gifter lines (D40), on `/s`, the claim sheet, `/c` | "Sam can see who's getting what" | "Sam can see how many are claimed, but never who's getting them" |

Owners who had opted in lose names on their next load. That's intended (_Ted_).

### 5.2 Part 2: who gets a Your gifts list (_Ted_)

- Any signed-in user with a verified email. In practice they're owners of their own lists (_Ted_: the main case).
- **A claim made while signed in and verified** goes on the claimer's Your gifts at once. They still get the manage link, as today (_Claude's call_: one model for every claim, and the link is how a claim is handed to someone else).
- **Opening a manage link while signed in** adds that claim to Your gifts if it isn't on anyone's yet (_Ted_). It's done by a request the page sends once loaded (§2 anti-goals). The page then says "Added to **Your gifts**", with **Not mine**, which takes it off again and leaves the claim alone (_Claude's call_, approved in the mockup). Not mine also answers how to take a claim off Your gifts without cancelling it.
- **First list wins** (_Ted_). A claim on someone's Your gifts stays there. Anyone else who opens its manage link signed in sees "This claim is on someone else's gifts in Hanker, so it won't appear on yours. You can still change or cancel it here." The account isn't named. The link keeps all its powers.
- **The owner of the list** opening a manage link for a claim on their own list, while signed in, sees no claim data at all (_Ted_: hide the name; _Claude's call_: hide everything, since with the setting off even "someone claimed 2" says more than the owner may know). The page says "This link is for a claim on your own list, so Hanker keeps it hidden from you", with a link to the editor. Nothing is linked and nothing is saved to `hanker:claims`. The link can't change or cancel the claim from the owner's session. Signed out, the owner is a guest, as on `/s` (spec §2's accepted limit).
- **Unverified accounts** claim as anonymous gifters; nothing is linked, and the sheet doesn't mention Your gifts (_Claude's call_, matching the owner pages' gate).

### 5.3 The name on a signed-in claim (_Ted_)

The claim sheet prefills the name from the account's display name, and the gifter can change it ("Grandma"). Each claim keeps the name it was made with; renaming the account later changes no claim. On Your gifts, the name is editable per claim.

### 5.4 Bought (_Ted_)

- A per-claim tick, private to the account whose list the claim is on (_Ted_). It's never in `GET /shared`, `GET /claims` or `GET /wishlist`, for anyone.
- Ticking needs no confirmation and saves at once. It's separate from Change (mockup 4).
- Bought doesn't lock anything: a bought claim can still be changed or let go.

### 5.5 Account deletion (_Ted_)

Deleting an account deletes its links and Bought ticks. **The claims survive** as ordinary anonymous claims, with their names, quantities and manage links intact, so no item is freed by accident.

### 5.6 Claims that disappear (_Claude's call_)

A linked claim can vanish without its gifter acting: the owner deletes the item, the list or their account, or someone cancels it through its manage link. Your gifts keeps a note in its place until the gifter taps **Clear**, or for 30 days:

- the owner deleted the item, list or account: "Sam took this off their list. Your claim is gone.";
- it was cancelled through its manage link: "This claim was cancelled through its link."

Letting a claim go *from Your gifts*, or cancelling it on `/c` while signed in as its gifter, leaves no note. The note keeps the item's title and the owner's display name as Your gifts last showed them (§5.8); that copy of the owner's text is why notes expire.

### 5.7 The Your gifts page (_Ted_: mockup A; details _Claude's call_)

- A **Your gifts** tab in the signed-in header, between **Your list** and **Settings**. The route is the builder's (`/gifts` suggested).
- A heading, then a line like "7 things for 3 people · 2 bought".
- **Groups** per list, headed by the owner's display name with an **Open list** link to the current share URL. Groups are ordered by your earliest claim on them; within a group, cards follow the owner's order.
- **A card** shows the photo or idea tile, title, price, "you're getting N", the owner's note when there is one, and:
  - **Shop ↗** (terracotta, the one action) when the item has a link, opening with `rel="noopener noreferrer"`;
  - the **Bought** tick (sage when on, with a sage-washed card);
  - **Change**, which opens the card in place: name, quantity stepper (capped at remaining plus current, with the `/c` hint line), **Let it go** (with a confirmation, as on `/c`), Close and Save.
- A removed note (§5.6) is a dashed card with the title, the reason and **Clear**.
- **Empty state:** says claims made while signed in appear here, and that a manage link opened here adds its claim.
- The page sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, like `/s` and `/c`.
- On a `409` from Change, the stepper resets to the new maximum and says why, as on `/c`.

### 5.8 Data (_Claude's design; needs Ted's OK, since it's a schema change_)

A new table rather than columns on `claims`, so the claim itself stays exactly what it is today, and deleting an account can't touch it:

```sql
claim_links (
  id                  uuid PRIMARY KEY,                                   -- v7
  claim_id            uuid REFERENCES claims ON DELETE SET NULL,          -- null once the claim is gone (§5.6)
  user_id             uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  bought_at           timestamptz,                                        -- §5.4
  cancelled_at        timestamptz,                                        -- set when someone else cancels through the link (§5.6)
  gone_at             timestamptz,                                        -- when the note started; set by the daily cron for cascades
  item_title          text NOT NULL,                                      -- as Your gifts last showed it
  owner_display_name  text NOT NULL,                                      -- likewise
  created_at, updated_at
);
CREATE UNIQUE INDEX ON claim_links (claim_id);                            -- first list wins (§5.2)
CREATE INDEX ON claim_links (user_id);
```

- **The one foreign key that doesn't cascade.** `claim_id … ON DELETE SET NULL` is the exception to spec §4's "all foreign keys cascade": it's what lets a removed note survive its claim. `user_id` cascades, so account deletion removes links and ticks (§5.5).
- **Telling the reasons apart.** A cascade (item, list or owner deleted) leaves `claim_id` null and `cancelled_at` null, which reads as "removed". `DELETE /claims/:manageToken` by anyone other than the linked gifter sets `cancelled_at` and `gone_at` in the same transaction before deleting the claim; by the linked gifter, or from Your gifts, it deletes the link row too.
- **Aging the notes.** A foreign key's `SET NULL` can't stamp a time, so the daily cron (spec §10) first sets `gone_at = now()` on notes that have none, then deletes notes whose `gone_at` is more than 30 days old. A cascaded note therefore lives 30 to 31 days. No trigger is needed.
- **The snapshot** (`item_title`, `owner_display_name`) is written at link time. After `GET /me/gifts` has read (its read stays `READ ONLY`), it updates the snapshots that differ from what it just showed, in a separate statement. That write is best-effort: a failure is logged and the page is still served. So a note shows what the gifter last saw.
- **"First list wins"** is the unique index: two accounts linking at once means one insert wins and the other reads back the winner.

### 5.9 API (_Claude's design, within Ted's decisions; the builder may rename_)

**Part 1:**

- The `/claims/:manageToken` routes refuse the list's own signed-in owner (`403 OWN_LIST_CLAIM`, a new code; see the Part 2 table for its rules). It belongs to Part 1 because it closes today's one way for a signed-in owner to read a name: a manage link a gifter forwards to them.
- `ItemSchema` and `SharedItemSchema` gain an optional `claimed: number`. `projectWishlist`'s table becomes:

| Viewer | `remaining` | `claimed` | `claims[]` |
|---|---|---|---|
| guest | included | omitted | included |
| owner, setting off | **omitted** | **omitted** | **omitted** |
| owner, setting on | included | included | **omitted** |

**Part 2** (all session routes need a verified email, as the owner routes do):

| Method & path | Result |
|---|---|
| `POST /shared/:shareToken/items/:itemId/claims` | Unchanged for guests. With a verified, non-owner session, the claim is linked in the same transaction, and the `201` adds `onYourGifts: true` |
| `GET /shared/:shareToken` | Adds `viewer: {displayName}` when a verified, non-owner session is present, so the sheet can prefill and say "This goes on Your gifts". Nothing about other claims' links |
| `GET /claims/:manageToken` | Resolves the session through the never-refusing guard. **When the session owns the claim's list** (verified or not, as on `/shared`), answers `403 OWN_LIST_CLAIM` with no claim data (Part 1, §5.2). For a verified session that doesn't own the list, adds `link: 'none' \| 'yours' \| 'someone-else'`. Absent for guests |
| `PATCH` and `DELETE /claims/:manageToken` | With a session that owns the claim's list, `403 OWN_LIST_CLAIM`, checked after the claim is found by its token's hash and before anything is changed or returned, since a `PATCH` answer carries the name and a `409` carries `remaining` (D43's reasoning) |
| `POST /claims/:manageToken/link` | Links the claim to the session if unlinked: `200 {link: 'yours'}`, or `{link: 'someone-else'}`. `403 OWNER_CANNOT_CLAIM` for the list's owner; `403 EMAIL_NOT_VERIFIED` |
| `DELETE /claims/:manageToken/link` | **Not mine**: removes the session's own link. `204`; a no-op if it isn't theirs |
| `GET /me/gifts` | The session's links: live claims with the `GET /claims` item fields, `remaining`, the list's title, owner display name and share URL, the claim's name and quantity, and `bought`; and removed notes with their title, owner name and reason. Read in one `REPEATABLE READ, READ ONLY` transaction |
| `PATCH /me/gifts/:linkId` | `{claimerName?, quantity?, bought?}`, at least one. Name and quantity follow `PATCH /claims`' transaction and rules (§6.3: lock the item row, re-read the claim), including `409 CLAIM_EXCEEDS_REMAINING {remaining}` and its rate limits |
| `DELETE /me/gifts/:linkId` | On a live claim, **Let it go**: deletes the claim and its link. On a note, **Clear**. `204` |

- A link ID that isn't the session's is `404`, like any other unknown ID.
- Linking never takes a lock beyond what a claim write already takes. It inserts one row, and doesn't change `remaining`.
- Rate limits: `POST …/link` and `PATCH`/`DELETE /me/gifts/*` count against the claim buckets (per IP, per list), like `PATCH /claims`. `GET /me/gifts` needs none.
- Nothing about links, ticks or notes is ever added to `GET /wishlist` or to the owner's `GET /shared`.

### 5.10 Web (_Ted_: the mockups; structure _Claude's call_)

- **Claim sheet** (mockup 1): with `viewer`, the name is prefilled from `displayName` (the gifter's own `hanker:claimerName` loses to it while signed in), and one hint line reads "This goes on **Your gifts**". After a `201` with `onYourGifts`, the done state adds a link to Your gifts beside the manage link. The sheet still mints the token and writes `hanker:claims` first (D42, D45).
- **Manage page** (mockups 2 and 3): once loaded, a client island sends `POST …/link` when `link` is `'none'`, then shows "Added to **Your gifts**" with **Not mine**, or the someone-else notice. Neither shows for guests or the owner.
- **Your gifts** follows the share page's pattern: a Server Component with client islands that write through `browserApi` and then `router.refresh()`. TanStack Query isn't used.
- Sentences live in a copy module (e.g. `lib/gifts-copy.ts`), errors in `lib/messages.ts`.

### 5.11 Privacy and terms (_Claude's draft for Ted to check_)

`/privacy` gains, in the release that ships Part 2:

- when you claim while signed in, or open a claim's link while signed in, the claim is linked to your account so it appears on Your gifts;
- Bought ticks are stored and seen only by you;
- when a claim disappears, its item's title and its owner's name are kept on your Your gifts for up to 30 days;
- deleting your account deletes these links, ticks and notes; your claims stay, so the people you're buying for aren't affected.

Part 1 changes no data that's collected, only what owners are shown. `/privacy` is checked for wording that promises owners can see names.

### 5.12 Spec changes

- §2 Spoilers: owners see totals only (D75); §2 Claims: claims can be linked to an account; §2 Actors: a gifter may be signed in.
- §4: `claim_links`, and the note that it holds the one non-cascading foreign key.
- §5 and §5.1: the new fields, endpoints and projection table.
- §7: the Your gifts route and page; the signed-in claim sheet and manage page; the new D40 copy.
- §13: D75 onward (§10 below).

## 6. Order of work (_Claude's proposal; the plan may refine it_)

Two stacks, Part 1 first (_Ted_).

**Part 1, owner totals:**

1. API: add `claimed` beside today's fields (expand).
2. Web: the editor, the owner's `/s` view and the settings toggle read `claimed` and stop reading owner `claims[]`; the new D40 lines; the cache recomputes `remaining` from `claimed` after edits.
3. API: stop sending `claims[]` to owners (contract), with the projection test table and integration tests asserting `claims` is absent for an opted-in owner on both endpoints.
4. API and web: `403 OWN_LIST_CLAIM` on the `/claims/:manageToken` routes for the list's signed-in owner, and the `/c` page's hidden view for them (D82).
5. Docs: the spec amendments for Part 1.

**Part 2, Your gifts:**

1. Migration and API: `claim_links`, linking on claim, `GET /claims` `link`, link and unlink, `/me/gifts`, the `DELETE /claims` reasons, account deletion, the cron purge.
2. Web: the Your gifts page and tab.
3. Web: the signed-in claim sheet and manage page.
4. Docs: `/privacy` (same release as step 1 reaching production, or step 1 ships dark until it lands), the spec, the README's "What it does".
5. E2E: claim signed in → it's on Your gifts → tick Bought → change quantity; a manage link opened signed in joins Your gifts, and a second account sees the someone-else notice; the owner sees "3 of 5 claimed" and no names.

## 7. Testing (beyond the usual)

- **The projection table**, exhaustively, including `claims` absent for an opted-in owner.
- **No owner leak:** integration tests that `GET /wishlist` and the owner's `GET /shared` never contain a claimer name, `claimed` for a non-opted-in owner, a link, or a Bought tick, with linked and bought claims on the list.
- **An owner holding a manage link:** a signed-in owner gets `403 OWN_LIST_CLAIM` on `GET`, `PATCH` and `DELETE /claims/:manageToken` with no claim field in the body, whatever the setting; a `PATCH` or `DELETE` from them changes nothing; signed out, they get the guest view.
- **Bought is private:** a ticked claim's `GET /shared` and `GET /claims` responses are identical before and after the tick.
- **First list wins** under concurrency: two accounts link one claim at once; exactly one wins.
- **Account deletion** keeps every claim and its quantity and removes links, ticks and notes.
- **Removed notes:** item deletion, list or owner deletion, and cancellation through the link by someone else each leave the right note; letting go from Your gifts leaves none; the purge drops notes after 30 days (with the `Clock` fake).
- **No write on render:** the `/c` server render never links; only the client's request does.

## 8. Left to the builder

- Route and endpoint names, and the response shapes' exact field names.
- Copy beyond the sentences quoted here and in the mockups.
- How the claim sheet learns `viewer` (a field on `GET /shared`, as above, or a separate call), as long as the anonymous sheet is no slower.
- Whether `hideCachedClaims()` needs to strip `claimed` as well as `remaining` (it should: both are claim data an owner turned off).
- Whether Part 1 needs a separate expand step or the web can tolerate both shapes in one layer.

## 9. Risks

- **Opted-in owners are surprised** to lose names. Before Part 1 merges, Ted can check how many there are (a read-only count of `show_claims_to_owner = true`). The new toggle copy says names are never shown.
- **Shared devices.** A family tablet signed in as one person links every manage link opened on it. **Not mine** undoes it, and links never change a claim.
- **In-app browsers** (WhatsApp, Messenger, Instagram) don't carry the session. Opening the manage link in a real browser joins the claim (§5.2). Claims made there and never opened elsewhere stay off Your gifts.
- **The snapshot copies an owner's text** (an item title, their display name) into another person's data. It's bounded by the 30-day purge and named on `/privacy`.
- **Part 2 makes "who claimed" knowable to the operator** (which account), where before it was only a typed name. The owner never sees it (§2 anti-goals); it's named on `/privacy`.

## 10. Decisions

| # | Decision | Alternatives rejected |
|---|---|---|
| D75 | An owner never sees claimer names. With the setting on, they see how many of each item are claimed (`claimed`, `remaining`); amends D33 and D40 (Ted, 2026-10-23) | Names when opted in (D33 as built); a third setting state |
| D76 | A verified, signed-in gifter's claims are linked to their account in `claim_links`, and appear on Your gifts; claiming without an account is unchanged (Ted, 2026-10-23) | Requiring an account to claim; a browser-only page over `hanker:claims` |
| D77 | Opening a manage link while signed in links an unlinked claim, by a request the page sends after it loads; the first list wins, and **Not mine** unlinks (Ted, 2026-10-23; Not mine Claude's, approved in the mockup) | Moving the claim to the newest opener; showing it on both lists; linking during the server render |
| D78 | Bought is a private per-claim tick, never sent to anyone but its gifter (Ted, 2026-10-23) | Showing "has bought this" to other gifters |
| D79 | Deleting an account deletes its links, ticks and notes; its claims survive as anonymous claims (Ted, 2026-10-23) | Deleting the claims with the account, which frees items silently |
| D80 | A linked claim that disappears leaves a note on Your gifts until cleared, for at most 30 days, through `claim_id … ON DELETE SET NULL` (Claude's call, 2026-10-23) | Silently dropping it; keeping notes forever |
| D81 | A signed-in claim's name is prefilled from the display name and editable, and kept per claim (Ted, 2026-10-23) | Always the account's display name |
| D82 | A signed-in owner who opens a manage link for a claim on their own list gets no claim data, and can't change or cancel it from that session (`403 OWN_LIST_CLAIM`); signed out, they're a guest (Ted: hide the name; Claude: hide everything, 2026-10-23) | Hiding only the name, which still tells an owner with the setting off that something is claimed; leaving `/c` as the capability holder's view |
