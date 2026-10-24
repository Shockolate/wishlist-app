# Plan 10b — Your Gifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a verified, signed-in gifter's claims appear on **Your gifts**, a page on their account. It is grouped by the person each gift is for, with a private **Bought** tick, Change and Let it go, and notes for claims that disappeared. Claiming without an account is unchanged.

**Architecture:**

- **Data:** a new `claim_links` table (approved by Ted, design §5.8). It links a claim to the account whose list it's on, and holds the Bought tick and the snapshot a removed note needs. `claim_id … ON DELETE SET NULL` turns a deleted claim into a note; `user_id` cascades, so account deletion removes links and ticks but never claims.
- **API:**
  - A claim made by a verified, non-owner session is linked in the same transaction.
  - `GET /claims` says whose list a claim is on, and `POST`/`DELETE /claims/:token/link` link and unlink it.
  - `DELETE /claims` leaves a "cancelled" note for the linked gifter.
  - `/me/gifts` reads and changes your gifts, and the daily cron ages and purges notes.
  - `GET /shared` tells the sheet who is signed in.
- **Web:**
  - The **Your gifts** tab and page (mockup A, cards).
  - The claim sheet prefills the name and says where the claim goes.
  - The manage page links the claim once loaded, with **Not mine**, or says it's on someone else's gifts.
  - `/privacy` describes the new data.

**Tech Stack:** NestJS 12, Drizzle, Zod 4, Vitest, Testcontainers, Playwright, Next.js App Router, Radix. **No new dependencies.**

**Spec:** [`docs/superpowers/specs/2026-10-23-your-gifts-and-owner-totals-design.md`](../specs/2026-10-23-your-gifts-and-owner-totals-design.md), Part 2: §5.2–§5.12 and D76–D81. Part 1 shipped as Plan 10a (main `3ad4af5`), so D75 and D82 hold here. Section numbers (§) are the design's unless marked "main spec". The mockups are `gifts-layout.html` (A) and `claim-states.html` in `.superpowers/brainstorm/557350-1792792425/content/` in the main checkout.

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) applies. In particular:

- ESM; relative imports in `api` and `contracts` end in `.js`; `import type` for types; `@Inject(…)` on every constructor parameter.
- Claim writes lock only the item row (`FOR UPDATE`); reads that return claims run in one `REPEATABLE READ, READ ONLY` transaction (`SNAPSHOT`).
- Problem `detail` never echoes input. Logs and Sentry never carry a claimer name, a manage token, a link ID or which account holds which claim.
- Migrations: edit `schema.ts`, then `pnpm --filter @wishlist/api db:generate --name claim_links`, and review the SQL. Expand-only.
- Test-first. Unit `*.spec.ts` never touch Docker. State-changing integration requests go through `test/support/client.ts`.
- Commits end with `Co-Authored-By: <the model that wrote it> <noreply@anthropic.com>`.
- **Every stack layer passes CI on its own (CONTRIBUTING; the Plan 10a lesson).** Every change here is additive: new optional response fields, new routes, new pages. No layer may change what an existing E2E asserts unless it updates that E2E itself.

**The privacy rule (design §2 anti-goals, D75, D82):**

- No owner response, meaning `GET /wishlist`, the owner's `GET /shared` and the owner's `/claims/*` (already `403`), ever carries a link, a Bought tick, a note, or whether a claim is linked.
- Gifters see nothing about other gifters' links or ticks. `GET /shared` adds only `viewer` (the viewer's own display name).
- Account deletion, unlinking or a failed link never deletes a claim or changes a quantity.
- Opening a page changes nothing. `/c` links only by the request its client island sends after load.

**Values:**

| Thing | Value |
|---|---|
| Table | `claim_links (id uuid pk, claim_id uuid null → claims ON DELETE SET NULL, user_id uuid not null → users ON DELETE CASCADE, bought_at timestamptz null, cancelled_at timestamptz null, gone_at timestamptz null, item_title text not null, owner_display_name text not null, created_at, updated_at)`; `UNIQUE (claim_id)`; index `(user_id)` |
| Who gets links | A session whose user is `emailVerified` and isn't the list's owner |
| `GET /shared` | adds `viewer?: { displayName: string }` for that session only |
| `POST …/claims` `201` | adds `onYourGifts?: boolean`: `true` when the claim's link is the session's |
| `GET /claims/:token` | adds `link?: 'none' \| 'yours' \| 'someone-else'` for that session only (owners already get `403 OWN_LIST_CLAIM`) |
| `POST /claims/:token/link` | `SessionGuard` + `VerifiedGuard`, body `{}`; `200 { link: 'yours' \| 'someone-else' }`; the list's owner → `403 OWN_LIST_CLAIM`; unknown → `404 NOT_FOUND` |
| `DELETE /claims/:token/link` | same guards; `204`; removes the session's own link only, a no-op otherwise |
| `GET /me/gifts` | `SessionGuard` + `VerifiedGuard`; `{ gifts: Gift[], gone: GoneGift[] }` |
| `PATCH /me/gifts/:linkId` | `{ claimerName?, quantity?, bought? }`, at least one; answers the `Gift` |
| `DELETE /me/gifts/:linkId` | `204`; a live claim is let go (claim and link deleted, no note); a note is cleared |
| Rate limits | `POST`/`DELETE …/link` and `PATCH`/`DELETE /me/gifts/*` count against `CLAIMS_PER_IP` and `CLAIMS_PER_LIST`, like `PATCH /claims`. `GET /me/gifts` is not limited |
| Note life | 30 days from `gone_at`. The daily cron first sets `gone_at = now()` on notes without one (cascades can't stamp it), then deletes notes older than 30 days |
| Cron result | `CleanupResult` gains `giftNotes: number` (notes deleted) |
| Route | `/gifts` (signed in), `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` |

**Contract shapes** (`packages/contracts/src/gifts.ts`, new; exported from `index.ts`):

```ts
GiftSchema = z.object({
  linkId: z.uuid(),
  claim: ClaimSchema,                       // the gifter's own claim: id, claimerName, quantity
  item: ClaimDetailsResponseSchema.shape.item,
  remaining: z.number().int().min(0),
  wishlistTitle: z.string(),
  ownerDisplayName: z.string(),
  shareUrl: z.url(),
  bought: z.boolean(),
});
GoneGiftSchema = z.object({
  linkId: z.uuid(),
  itemTitle: z.string(),
  ownerDisplayName: z.string(),
  reason: z.enum(['removed', 'cancelled']),
});
GiftsResponseSchema = z.object({ gifts: z.array(GiftSchema), gone: z.array(GoneGiftSchema) });
UpdateGiftRequestSchema = UpdateClaimRequestSchema's fields plus bought?: z.boolean(), refined to at least one.
ClaimLinkResponseSchema = z.object({ link: z.enum(['yours', 'someone-else']) });
```

**Copy** (curly apostrophes; in `apps/web/src/lib/gifts-copy.ts` unless noted):

| Where | Text |
|---|---|
| Tab and heading | `Your gifts` |
| Summary | `7 things for 3 people · 2 bought`, with singulars `1 thing`, `1 person`; leave out `· 0 bought` |
| Group link | `Open list` |
| Card line | `$165.00 · you’re getting 1`; without a price, `You’re getting 1` |
| Card actions | `Shop` (with the external-link icon, `rel="noopener noreferrer"`), checkbox `Bought`, `Change` |
| Change form | labels `Your name, as other gifters see it`, `How many`; hint is `manageHint` from `share-copy.ts`; buttons `Let it go`, `Close`, `Save` |
| Let it go dialog | title `Let this go?`, text `Someone else can get this for ${owner} instead.`; buttons `Keep it`, `Let it go` |
| Note, removed | `${owner} took this off their list. Your claim is gone.` |
| Note, cancelled | `This claim was cancelled through its link.` |
| Note button | `Clear` |
| Empty | `Nothing here yet. Claims you make while signed in appear here, and so does a claim whose link you open while signed in.` |
| Unverified | the editor's confirm-email notice, with `to start your list` read as `to see your gifts` |
| Sheet hint (signed in) | `This goes on Your gifts.` |
| Sheet done | link `See Your gifts` → `/gifts` |
| `/c`, just linked | `Added to Your gifts.` + button `Not mine`; after it: `Taken off Your gifts.` |
| `/c`, someone else's | `This claim is on someone else’s gifts in Hanker, so it won’t appear on yours. You can still change or cancel it here.` |
| `/privacy`, new section `If you’re signed in when you claim` | the four bullets of design §5.11 |

## Rulings this plan makes on gaps in the design

1. **Owner on `POST …/link`** answers `403 OWN_LIST_CLAIM`, not the design's `OWNER_CANNOT_CLAIM`. D82 made every owner `/claims/*` call that code.
2. **Order of `/me/gifts`:** groups follow each list's earliest `claim_links.created_at`, and items within a group follow `items.position`. Notes come after, newest first. The server orders; the web keeps that order.
3. **Snapshot refresh:** after `GET /me/gifts` reads (in `SNAPSHOT`), one separate `UPDATE … FROM (VALUES …)` sets `item_title`/`owner_display_name` where they differ. If it fails, the failure is logged without values and the response is still sent (§5.8).
4. **`DELETE /claims/:token`** runs in one transaction. Where the claim has a link that isn't the session's, it sets `cancelled_at = gone_at = now()` on that link, then deletes the claim (the FK nulls `claim_id`). Where the link is the session's, the link is deleted first. A guest is "not the session's".
5. **Replaying a token (D42) while signed in** links the existing claim if it's unlinked, and `onYourGifts` reports whether it ended up on this session's list.
6. **`PATCH /me/gifts/:linkId` with name or quantity** reuses `ClaimsService.update`'s transaction body. Extract `private applyClaimChange(tx, claimId, itemId, input): Promise<Claim>` and call it from both. `bought` only sets `bought_at` (`now()` or null) on the link, and never touches the claim.
7. **`/c` with `link === 'yours'`** shows nothing extra; only a fresh link shows the notice.
8. **The claim sheet's name:** with `viewer`, `displayName` wins over `hanker:claimerName`. Without it, nothing changes.
9. **`/gifts` writes** go through `browserApi` and then `router.refresh()`, like `/s` and `/c` (no TanStack Query). A `404` on a gift (gone meanwhile) refreshes the page.

## Review Focus

1. **Two accounts open the same manage link at once:** exactly one links it, and the other is told `someone-else`. Test: Task 3 (concurrent integration).
2. **Shared family tablet:** Grandma's tablet is signed in as Mum, and Grandma opens her own manage link. It joins Mum's gifts; **Not mine** takes it off, and Grandma's own account can then link it. Test: Task 3 (integration) and Task 8 (E2E).
3. **The owner deletes the item while the gifter has Your gifts open,** then the gifter ticks Bought or saves: a `404`, the page refreshes, and the card turns into a removed note. Test: Task 4 (integration `404`) and Task 7 (E2E).
4. **Raising a quantity on Your gifts past what's left** (someone else claimed meanwhile): `409` with `remaining`, and the stepper resets and says why. Test: Task 4 and Task 7.
5. **The owner deletes their account:** each gifter's claims on that list become removed notes that still name the owner and the item, and the gifter's own account and other gifts are untouched. Test: Task 5.

## Stacks and order

One new stack. Nothing is pushed before Task 10.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-10b` | 0 |
| `api/claim-links` | 1, 2, 3 |
| `api/gifts` | 4, 5 |
| `web/gifts-page` | 6, 7 |
| `web/signed-in-claims` | 8 |
| `docs/your-gifts` | 9 |

Each layer's first task starts with `gh stack add <branch>`; Task 0 runs `gh stack init docs/plan-10b`. The stack merges as a whole (`gh stack merge`), so `/privacy` ships in the same release that starts storing links.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/gifts.ts` (new) + `.spec.ts`, `claims.ts`, `cron.ts`, `index.ts` | Shapes above |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/0006_claim_links.sql` | The table |
| `apps/api/src/claims/claims.service.ts`, `claims.controller.ts`, `shared-list.service.ts`, `links.ts` (new: link queries) | Linking, reasons, viewer |
| `apps/api/src/gifts/gifts.service.ts`, `gifts.controller.ts`, `gifts.module.ts` (new), `app.module.ts` | `/me/gifts` |
| `apps/api/src/ops/cleanup.service.ts` | Note aging and purge |
| `apps/api/test/claim-links.int-spec.ts`, `gifts.int-spec.ts` (new), `manage-claims`, `shared`, `cron`, `account` int-specs | Integration |
| `apps/web/src/app/(account)/gifts/page.tsx`, `components/gifts/*` (new), `lib/gifts-copy.ts` + `.spec.ts`, `lib/gifts.server.ts` (new) | The page |
| `apps/web/src/components/account-header.tsx`, `lib/auth-routing.ts` + spec, `next.config.ts` + spec | Tab, redirect, headers |
| `apps/web/src/components/share/claim-sheet.tsx`, `claim-done.tsx`, `components/manage/manage-claim.tsx`, `components/manage/claim-link.tsx` (new) | Signed-in claims |
| `e2e/tests/local/gifts.spec.ts` (new), `e2e/support/*` | E2E |
| `apps/web/src/app/privacy/page.tsx`, README, main spec, `AGENTS.md`, design, roadmap | Docs |

## How to run things

As Plan 10a: `pnpm --filter @wishlist/contracts build` after contract changes; `pnpm --filter @wishlist/api exec vitest run src/<dir>`; `pnpm --filter @wishlist/api test:integration` (whole suite, about 80 s); `pnpm --filter @wishlist/web exec vitest run src`; the full gate at the end of every layer is `pnpm format:check`, then `API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`, then integration. Run all of `pnpm test:e2e` at the end of every layer. **In a worktree** `scripts/e2e.sh` can't start compose while the main checkout's Postgres holds port 54329. Run its steps by hand with `COMPOSE_PROJECT_NAME=wishlist-app`, and never stop or remove containers.

---

### Task 0: Start the stack

- [ ] **Step 1:** `gh stack init docs/plan-10b` (the branch already holds this plan's commit).
- [ ] **Step 2:** Roadmap row 10b becomes `| 10b | [Your gifts](2026-10-23-plan-10b-your-gifts.md) | [design 2026-10-23](../specs/2026-10-23-your-gifts-and-owner-totals-design.md) §5.2–§5.12, D76–D81 | A signed-in gifter's claims across lists on Your gifts, a private Bought tick, manage links that join the list, notes for claims that disappear | Planned |`.
- [ ] **Step 3:** `pnpm format:check`; commit `docs: plan 10b, your gifts`.

### Task 1: The `claim_links` table and contracts

**Files:** `schema.ts`, the generated migration, `packages/contracts/src/gifts.ts` + spec, `claims.ts`, `cron.ts`, `index.ts`; test `apps/api/test/claim-links.int-spec.ts`.

**Interfaces:**
- Produces: `claimLinks` Drizzle table (the Values row; constraint names `claim_links_claim_id_unique`, index `claim_links_user_id_idx`); the contract shapes above; `SharedWishlistResponseSchema.viewer?`, `CreateClaimResponseSchema.onYourGifts?`, `ClaimDetailsResponseSchema.link?`; `CleanupResultSchema.giftNotes`.

- [ ] **Step 1: `gh stack add api/claim-links`.**
- [ ] **Step 2: Failing tests.**
  - Contracts spec: `UpdateGiftRequestSchema` refuses `{}` and accepts `{ bought: true }`; `GoneGiftSchema` refuses reason `'other'`.
  - `claim-links.int-spec.ts`, against the migrated schema with raw SQL:
    - `deleting a claim keeps its link with claim_id null`;
    - `deleting the user deletes their links and leaves the claim and its quantity`;
    - `a claim can be linked once` (a second insert with the same `claim_id` violates `claim_links_claim_id_unique`);
    - `many notes may have a null claim_id`.
- [ ] **Step 3: Run** both; expect FAIL.
- [ ] **Step 4: Implement** the table (doc comment: why this FK sets null, D80) and generate `0006_claim_links`. Review the SQL: `ON DELETE set null` on `claim_id`, `cascade` on `user_id`. Then add the contracts. Fix the cron integration test's expected object for `giftNotes: 0` (Task 5 makes it count).
- [ ] **Step 5: Run** the contracts tests, then integration; expect PASS. Commit `feat(api): the claim_links table for Your gifts (D76, D80)`.

### Task 2: Signed-in claims are linked; `GET /claims` and `GET /shared` say so

**Files:** `claims.service.ts`, `shared-list.service.ts`, `claims/links.ts` (new), `manage-claims.int-spec.ts`, `shared.int-spec.ts`, `claims.int-spec.ts`.

**Interfaces:**
- Consumes: `claimLinks` (Task 1).
- Produces: in `claims/links.ts`:
  - `linkStateOf(tx, claimId: string, userId: string): Promise<'none' | 'yours' | 'someone-else'>`;
  - `insertLink(tx, { claimId, userId, itemTitle, ownerDisplayName, now }): Promise<boolean>` (`ON CONFLICT (claim_id) DO NOTHING`; true when inserted);
  - `canLink(user: SessionUser, ownerId: string): boolean` (verified and not the owner).
  - `ClaimsService.create`'s and `.details`' `viewerId` and `SharedListService.get`'s `viewerId` become `viewer: SessionUser | null`, and the controllers pass `auth?.user ?? null`. The owner checks compare `viewer?.id`.

- [ ] **Step 1: Failing integration tests:**
  - `links a claim made by a verified, signed-in gifter, and says so` (`onYourGifts: true`; one `claim_links` row with the item's title and the owner's display name);
  - `does not link a guest's or an unverified account's claim` (no row; `onYourGifts` absent);
  - `a replayed token links the existing claim once (D42)`;
  - `GET /claims tells a verified gifter whose list it is on` (`none`, `yours`, `someone-else`; absent for a guest);
  - `GET /shared gives a verified non-owner their display name, and nobody else` (absent for guests, unverified users and the owner);
  - `nothing about links reaches the owner` (opted in, with a linked and ticked claim: owner `GET /wishlist` and `GET /shared` JSON contain no `link`, `bought`, `onYourGifts`, `viewer` or link id).
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.** Link inside the claim transaction after the insert, or after the replay lookup (ruling 5). Select the item title and the owner's display name in the same statements the transaction already runs, joining `users`. `details` adds `link` only when `canLink(viewer, ownerId)`, and runs after the D82 refusal. `SharedListService.get` takes the `SessionUser` and adds `viewer` under the same rule.
- [ ] **Step 4: Run** integration; expect PASS. Commit `feat(api): link a signed-in gifter's claims to their account (D76)`.

### Task 3: Link and unlink through the manage link; cancellations leave a note

**Files:** `claims.controller.ts`, `claims.service.ts`, `claims/links.ts`, `manage-claims.int-spec.ts`.

**Interfaces:**
- Produces: `ClaimsService.link(manageToken, user: SessionUser, ip): Promise<ClaimLinkResponse>`, `.unlink(manageToken, user, ip): Promise<void>`; `cancel(manageToken, viewer: SessionUser | null)` per ruling 4.

- [ ] **Step 1: Failing integration tests:**
  - `POST …/link links an unlinked claim, and answers someone-else when it isn't`;
  - `two accounts linking one claim at once: exactly one wins` (Review Focus 1: `Promise.all`; one `yours`, one `someone-else`, one row);
  - `refuses the owner (403 OWN_LIST_CLAIM), an unverified user (403 EMAIL_NOT_VERIFIED) and a guest (401)`;
  - `DELETE …/link removes only the session's own link, and the claim stays` (Review Focus 2: then a second account links it);
  - `cancelling through the link leaves the linked gifter a cancelled note`: as a guest, `cancelled_at` and `gone_at` are set and `claim_id` is null;
  - `the linked gifter cancelling on /c leaves no note`;
  - `link and unlink count against the claim limits`: fill `CLAIMS_PER_LIST` and expect `429`.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.** The two routes live in a new `ClaimLinksController` (`@Controller('claims/:manageToken/link')`, `@UseGuards(SessionGuard, VerifiedGuard)`, registered in `ClaimsModule`). That way they don't stack on `ClaimsController`'s class-level `OptionalSessionGuard`, which would resolve the session twice. Order: malformed `404`, IP limit, find by hash `404`, owner `403`, list limit, then write.
- [ ] **Step 4: Run** integration and the full gate (Global Constraints); then all of `pnpm test:e2e`. Commit `feat(api): link a claim by its manage link, and note cancellations (D77, D80)`.

### Task 4: `/me/gifts`

**Files:** `apps/api/src/gifts/*` (new), `app.module.ts`, `claims.service.ts` (ruling 6), `apps/api/test/gifts.int-spec.ts` (new).

**Interfaces:**
- Consumes: `ClaimsService.applyClaimChange` (ruling 6), `claimLinks`.
- Produces: `GiftsService.list(user): Promise<GiftsResponse>`, `.change(user, linkId, input: UpdateGiftRequest, ip): Promise<Gift>`, `.remove(user, linkId, ip): Promise<void>`; `GiftsController` at `me/gifts` with `SessionGuard, VerifiedGuard`.

- [ ] **Step 1: `gh stack add api/gifts`.**
- [ ] **Step 2: Failing tests** in `gifts.int-spec.ts`:
  - `lists my gifts grouped by list, in the order I first claimed from each, then by the owner's order` (ruling 2);
  - `ticks and unticks Bought, and nothing else changes` (`GET /shared` and `GET /claims` JSON identical before and after);
  - `changes a gift's name and quantity, and refuses more than is left with 409 and remaining` (Review Focus 4);
  - `answers 404 for a link that isn't mine, and for a gift whose item was deleted meanwhile` (Review Focus 3);
  - `letting a gift go deletes the claim and leaves no note; clearing a note deletes it`;
  - `shows a removed note with the title and owner name I last saw` (rename the item and the owner, read, then delete the item: the note has the renamed values; ruling 3);
  - `refuses an unverified user (403) and a guest (401)`.
- [ ] **Step 3: Run**; expect FAIL.
- [ ] **Step 4: Implement** per the Values table and rulings 2, 3 and 6. `change` with `bought` and nothing else needs no item lock. Map a gone claim to `404 NOT_FOUND` (`claimNotFound()`).
- [ ] **Step 5: Run** integration; expect PASS. Commit `feat(api): GET, PATCH and DELETE /me/gifts (D76, D78)`.

### Task 5: Notes age out; account deletion keeps claims

**Files:** `cleanup.service.ts`, `cron.int-spec.ts`, `account.int-spec.ts`.

- [ ] **Step 1: Failing tests:**
  - cron: `stamps gone_at on new notes, and deletes notes older than 30 days` (with the `Clock` fake: day 0 a cascade note gets stamped and `giftNotes: 0`; day 31 it's deleted and `giftNotes: 1`; a live link is never touched);
  - account: `deleting a gifter's account keeps their claims and quantities, and removes their links` (Review Focus 5's first half);
  - account: `deleting an owner's account leaves each gifter a removed note naming the owner and the item`.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** (two statements in `runDaily`, after the existing ones). **Step 4: Run** integration, the full gate and all E2E. Commit `feat(api): gift notes last 30 days (D79, D80)`.

### Task 6: The Your gifts page

**Files:** `app/(account)/gifts/page.tsx`, `components/gifts/gift-card.tsx`, `gone-note.tsx`, `gifts-list.tsx` (new), `lib/gifts-copy.ts` + spec, `lib/gifts.server.ts`, `account-header.tsx`, `lib/auth-routing.ts` + spec, `next.config.ts` + spec, `e2e/tests/local/gifts.spec.ts`.

**Interfaces:**
- Consumes: `GiftsResponse`, `Gift`, `GoneGift` (contracts).
- Produces:
  - `loadGifts(returnTo: string): Promise<GiftsResponse>` (server);
  - `summaryLine(gifts: readonly Gift[]): string`, `giftLine(gift: Gift): string`, `goneLine(note: GoneGift): string` (pure);
  - `AccountHeader current: 'list' | 'gifts' | 'settings'`.

- [ ] **Step 1: `gh stack add web/gifts-page`.**
- [ ] **Step 2: Failing tests:**
  - `gifts-copy.spec.ts`: the copy table's summary, card and note lines, singulars and the `0 bought` omission;
  - `auth-routing.spec.ts`: `/gifts` redirects a signed-out visitor to `/login?next=%2Fgifts`;
  - `next.config.spec.ts`: `/gifts` gets no-referrer and noindex;
  - E2E `gifts.spec.ts`: `a signed-in gifter's claims appear on Your gifts, grouped by person, and Bought is ticked privately`. Two owners' lists; the gifter claims on both while signed in; `/gifts` shows two groups in claim order with the card lines; tick Bought, reload, still ticked; a guest's `/s` shows nothing new; axe passes.
- [ ] **Step 3: Run**; expect FAIL. **Step 4: Implement** per mockup A, the copy table and ruling 9. The tab sits between `Your list` and `Settings`. An unverified user gets the confirm-email notice. Removed notes are dashed cards. **Step 5: Run** web unit tests and the E2E; expect PASS. Commit `feat(web): the Your gifts page (D76, D78)`.

### Task 7: Change and Let it go on Your gifts

**Files:** `components/gifts/change-gift-form.tsx` (new), `gift-card.tsx`, `gifts.spec.ts`.

- [ ] **Step 1: Failing E2E:**
  - `Change opens the card in place, saves a new name and quantity, and a 409 resets the stepper` (Review Focus 4: a second gifter takes the rest via `claimViaApi` before Save);
  - `Let it go asks first, then the card leaves and the item is free on the share page`;
  - `a gift whose item was deleted meanwhile becomes a removed note when touched, and Clear removes it` (Review Focus 3).
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement**, reusing `QuantityStepper`, `manageHint` and the Radix alert dialog the way `/c`'s `CancelClaim` does. **Step 4: Run** the E2E, the full gate and all E2E. Commit `feat(web): change or let go of a gift from Your gifts (D76)`.

### Task 8: The claim sheet and the manage page, signed in

**Files:** `claim-sheet.tsx`, `claim-done.tsx`, `share-claims.tsx` (passes `viewer`), `manage-claim.tsx`, `components/manage/claim-link.tsx` (new), `gifts.spec.ts`.

- [ ] **Step 1: `gh stack add web/signed-in-claims`.**
- [ ] **Step 2: Failing E2E:**
  - `signed in, the sheet prefills my display name, says where the claim goes, and links to Your gifts after`;
  - `opening my manage link signed in adds the claim, and Not mine takes it off` (Review Focus 2: two signed-in contexts; after Not mine, the second account's `/c` adds it);
  - `a manage link already on someone else's gifts says so, and still changes the claim`;
  - `a guest's sheet and /c are unchanged` (no hint, no notice; the existing claim and manage specs still pass).
- [ ] **Step 3: Run**; expect FAIL. **Step 4: Implement** per rulings 7 and 8 and mockups 1–3. `ClaimLink` is a client island that posts `/claims/<token>/link` once on mount (a ref guards React's double effect) when `details.link === 'none'`. **Step 5: Run** all E2E and the full gate. Commit `feat(web): signed-in claims join Your gifts (D77, D81)`.

### Task 9: Docs

**Files:** `app/privacy/page.tsx`, `README.md`, main spec, `AGENTS.md`, design header, roadmap.

- [ ] **Step 1: `gh stack add docs/your-gifts`.**
- [ ] **Step 2:** Add `/privacy`'s new section (copy table). The README's "What it does" gains a **Your gifts** bullet.
- [ ] **Step 3: Main spec:**
  - §2 Actors (a gifter may be signed in) and Claims (links, Bought, notes);
  - §4 `claim_links`, noting its non-cascading FK as the one exception to "all foreign keys cascade";
  - §5 the endpoints and fields;
  - §7 `/gifts` and the signed-in sheet and `/c`;
  - §8 the tests;
  - §13 D76–D81 from the design.
- [ ] **Step 4:** In `AGENTS.md`, a **Your gifts (Plan 10b)** bullet: who gets links, the privacy rule, the notes' 30 days, and "opening a page changes nothing". In the design header, Part 2 is Plan 10b.
- [ ] **Step 5:** `pnpm format:check`; commit `docs: your gifts in privacy, README, the spec and AGENTS.md`.

### Task 10: ⏸ Checkpoint: review, submit, merge, verify

- [ ] **Step 1:** Whole-branch review. Fix findings in the owning layer, then `gh stack rebase --upstack`.
- [ ] **Step 2: Ted approves the first submit.** Then `gh stack submit --open`, and set each PR's Conventional Commit title and summary body.
- [ ] **Step 3:** Every layer's CI passes on its own.
- [ ] **Step 4: Ted merges the whole stack** (`gh stack merge <top>`); never part of it.
- [ ] **Step 5:** Check production only if Ted asks. Then a follow-up PR sets roadmap row 10b to Done.
