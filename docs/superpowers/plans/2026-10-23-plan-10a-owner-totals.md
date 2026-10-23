# Plan 10a — Owner Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an owner never sees who is getting what. With the setting on, they see only how many of each item are claimed ("3 of 5 claimed"), and a signed-in owner who opens a manage link for a claim on their own list sees nothing about it.

**Architecture:**

- **Contracts:** an optional `claimed` on items; a new `OWN_LIST_CLAIM` error code.
- **API:** `projectWishlist` gives an opted-in owner `remaining` and `claimed`, never `claims[]`. `GET`, `PATCH` and `DELETE /claims/:manageToken` resolve the session and refuse the list's own owner with `403 OWN_LIST_CLAIM`, carrying no claim data.
- **Web:** the editor, the owner's view of `/s`, the settings card and the gifter lines (D40) say "how many are claimed"; `/c` shows the owner a hidden-claim page; `/privacy` and the README match.

**Tech Stack:** NestJS 12, Drizzle, Zod 4, Vitest, Playwright, Next.js, TanStack Query. **No new dependencies, no migration.**

**Spec:** [`docs/superpowers/specs/2026-10-23-your-gifts-and-owner-totals-design.md`](../specs/2026-10-23-your-gifts-and-owner-totals-design.md) (approved 2026-10-23), Part 1 only: §5.1, the Part 1 rows of §5.9, D75 and D82. Part 2 (Your gifts) is Plan 10b, written after this one merges (roadmap rule). Section numbers (§) are the design's unless marked "main spec".

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) applies. In particular:

- ESM; relative imports in `api` and `contracts` end in `.js`; `import type` for types.
- `@Inject(…)` on every constructor parameter, classes included.
- Unit tests (`*.spec.ts`) never touch Docker. Behavior changes are test-first.
- State-changing integration requests go through `test/support/client.ts`.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that actually wrote it).

**The rule (D75, D82):**

- No response to a session that owns the list ever carries a claimer name, a claim ID or `claims[]`. That covers `GET /wishlist`, `GET /shared/:token` as the owner, and the `/claims/:manageToken` routes.
- An owner with the setting off still gets no claim data at all: no `remaining`, no `claimed` (main spec §5.1, unchanged).
- Gifters (guests, and anyone signed in who isn't the owner) see exactly what they see today.
- Signed out, an owner is a guest (main spec §2's accepted limit). Unchanged.

**Values fixed by the design or ruled here:**

| Thing | Value |
|---|---|
| New item field | `claimed?: number` (int, ≥ 0): the sum of the item's claims' quantities, unclamped (§5.1, D19) |
| Projection | guest `{remaining, claims}`; owner off `{}`; owner on `{remaining, claimed}` |
| New error | `OWN_LIST_CLAIM`, `403`, detail `Claims on your own list are hidden from you.` |
| Order on `/claims/:manageToken` | malformed token → `404`; per-IP limit (PATCH only, as today); find the claim by hash → `404`; **owner check → `403`**; list limit (PATCH only); transaction. The owner check comes before the list's limit, so a `429` can't tell an owner gifters have been busy (D43) |
| Owner identity | the session's user owns the claim's list, verified or not, as on `/shared` (Plan 4a rule 5) |

**Copy** (curly apostrophes; module named in each row):

| Where | Text |
|---|---|
| Owner claim line, none (`lib/editor-claims.ts`) | `None claimed yet` |
| Owner claim line, some | `3 of 5 claimed` (`${claimed} of ${quantity} claimed`) |
| Owner claim line, exactly all | `All 5 claimed`; for a quantity of 1, `Claimed` |
| Owner claim line, over (D19) | `3 of 2 claimed` (same template as "some") |
| Switch label (`components/account/claims-card.tsx`) | `Show how many are claimed` |
| Card text, on | `You can see how many of each item are claimed, on your list and on your share page, but never who claimed them. Gifters are told you can see the counts.` |
| Card text, off | unchanged |
| Dialog title | `See how many are claimed?` |
| Dialog text | `Your list and your share page will show how many of each item are claimed. You’ll never see who claimed them. Gifters will see a note that you can see the counts. You can turn this off again, but you can’t unsee what you’ve seen.` |
| Dialog buttons | unchanged: `Keep it a surprise`, `Show me` |
| Saved, on / off | `You’ll see how many are claimed.` / `Claims are hidden from you again.` |
| `ownerSeesLine`, on (`lib/share-copy.ts`) | `${owner} can see how many are claimed, but never who’s getting them.` |
| `ownerSeesLine`, off | unchanged |
| `OwnerNote`, on (`components/share/owner-note.tsx`) | `You’ve chosen to see how many are claimed, but never by whom.` |
| `/c` for the owner (new `components/manage/own-list-claim.tsx`) | heading `Your claim`, then `This link is for a claim on your own list, so Hanker keeps it hidden from you.` and a link `Back to your list` → `/list` |
| `messages.ts` entry | `[ErrorCode.OWN_LIST_CLAIM]: 'Claims on your own list are hidden from you.'` |
| `/privacy`, "If you claim a gift" | replace `The list’s owner sees it only if they’ve turned that on.` with `The list’s owner never sees it. If they’ve turned it on, they see only how many have been claimed.` |

## Rulings this plan makes on gaps in the design

1. **One API layer, not three.** The design (§6) proposed expand, web, contract. Here the API both adds `claimed` and stops sending owners `claims[]` in one layer below the web layer. In production the API deploys before the web (main spec §10), so for at most one deploy the old web meets the new API: it gets no owner `claims[]`, so `editorClaimLine` returns null and the owner briefly sees no claim lines. That fails closed (nothing leaks), and the old schema ignores the unknown `claimed`. Accepted.
2. **The owner check reads the owner in the same lookup** that finds the claim, so no extra query for guests: the `details` select already joins `wishlists`; `update` and `cancel` gain the join. `cancel` becomes select-then-delete when a session is present; a guest's cancel stays one `DELETE`.
3. **`/claims` controller** takes `@UseGuards(OptionalSessionGuard)` and passes `auth?.user.id ?? null` to `details`, `update` and `cancel`, as `SharedController` does.
4. **`loadClaim`** returns `{ kind: 'own-list' }` on `403 OWN_LIST_CLAIM` and `{ kind: 'claim', details }` otherwise; `/c` renders `OwnListClaim` for the first. That view saves nothing to `hanker:claims`.
5. **The owner's view of `/s`** stops using `CardStatus` and renders `ownerClaimLine` (below): the `taken` kind as the sage strip `CardStatus` uses today, the others as its muted line, nothing when null.
6. **The README** line "and you never see who is getting what" stays true. Its "Surprises stay safe" bullet gains: `Owners who opt in see only how many are claimed, never by whom.`

## Review Focus

1. **An owner hits a 429 instead of a 403** when gifters have used up the list's claim limit: the owner must still get `403 OWN_LIST_CLAIM`, so the limit tells them nothing (D43). Test: Task 2.
2. **An unverified owner** opens a forwarded manage link: still refused, as the owner is on `/shared` (Plan 4a rule 5). Test: Task 2.
3. **A claim whose item quantity was lowered below what's claimed** (D19): the owner sees `3 of 2 claimed` and `remaining: 0`, never a negative. Test: Task 1 (projection) and Task 3 (copy).
4. **An owner edits an item's quantity with the setting on:** the row keeps its claim line and recomputes it from `claimed`, with no refetch (Plan 4b rule 13's behavior, carried over). Test: Task 3 (cache) and Task 3's E2E.
5. **Turning the setting off strips `claimed` too**, including from a list fetch already in flight (the existing spoiler-guarantee E2E). Test: Task 3.

## Stacks and order

One new stack. Nothing is pushed before Task 6.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-10a` | 0 |
| `api/owner-totals` | 1, 2 |
| `web/owner-totals` | 3, 4 |
| `docs/owner-totals` | 5 |

Each layer's first task starts with `gh stack add <branch>`; Task 0 runs `gh stack init docs/plan-10a`.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/wishlist.ts`, `error-codes.ts` | `claimed`; `OWN_LIST_CLAIM` |
| `apps/api/src/claims/projection.ts` + `.spec.ts` | The new table |
| `apps/api/src/claims/claims.controller.ts`, `claims.service.ts`, `claims-errors.ts` | The owner refusal |
| `apps/api/test/shared.int-spec.ts`, `wishlist.int-spec.ts`, `manage-claims.int-spec.ts` | Integration tests |
| `apps/web/src/lib/editor-claims.ts` + `.spec.ts`, `lib/list-cache.ts` + `.spec.ts` | Owner line; cache |
| `apps/web/src/components/share/share-page.tsx`, `owner-note.tsx`, `lib/share-copy.ts` + `.spec.ts` | Owner's `/s`; D40 lines |
| `apps/web/src/components/account/claims-card.tsx` | Settings copy |
| `apps/web/src/lib/shared-list.server.ts`, `app/c/[manageToken]/page.tsx`, `components/manage/own-list-claim.tsx` (new), `lib/messages.ts` | `/c` for the owner |
| `apps/web/src/app/privacy/page.tsx`, `README.md` | Same-release text |
| `e2e/tests/local/owner-claims.spec.ts`, `manage.spec.ts` | E2E |
| Main spec, `AGENTS.md`, roadmap | Docs |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/api exec vitest run src/claims
pnpm --filter @wishlist/api test:integration          # Docker
pnpm --filter @wishlist/web exec vitest run src
pnpm test:e2e -- owner-claims manage                  # Docker
```

The full gate, at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
```

`pnpm test:e2e` (all of it) also runs at the end of `web/owner-totals`.

---

### Task 0: Start the stack

**Files:** Create this plan; modify `docs/superpowers/plans/2026-10-07-roadmap.md`.

- [ ] **Step 1:** `gh stack init docs/plan-10a`.
- [ ] **Step 2:** Add two roadmap rows after 9: `10a | [Owner totals](2026-10-23-plan-10a-owner-totals.md) | [design 2026-10-23](../specs/2026-10-23-your-gifts-and-owner-totals-design.md) §5.1, D75, D82 | Owners see how many are claimed, never who; a signed-in owner can't read a claim on their own list through its manage link | Planned` and `10b | Your gifts | same design, §5.2–§5.11 | A signed-in gifter's claims across lists, Bought ticks, manage links that join the list | Not yet written`.
- [ ] **Step 3:** `pnpm format:check`, then commit the plan, the design and the roadmap: `docs: plan 10a, owner totals, and the your-gifts design`.

### Task 1: Owners get totals, never claims

**Files:** Modify `packages/contracts/src/wishlist.ts`, `apps/api/src/claims/projection.ts`, `apps/api/src/claims/projection.spec.ts`, `apps/api/test/shared.int-spec.ts`, `apps/api/test/wishlist.int-spec.ts`.

**Interfaces:**
- Produces: `ITEM_CLAIM_FIELDS.claimed: z.number().int().min(0).optional()` (so `Item` and `SharedItem` both carry `claimed?: number`); `ProjectedItem<T> = T & { remaining?: number; claimed?: number; claims?: Claim[] }`. `projectWishlist`'s signature is unchanged, so `wishlist.service.ts` and `shared-list.service.ts` need no change.

- [ ] **Step 1: `gh stack add api/owner-totals`.**
- [ ] **Step 2: Write the failing projection tests.** Split today's `it.each` (which gives a guest and an opted-in owner the same thing):
  - `shows a guest what is left and who is getting what`: `projectWishlist(ITEMS, CLAIMS, GUEST)` equals `WITH_CLAIMS`, and no item has `claimed`.
  - `shows an owner who opted in how many are claimed and what is left, and never who (D75)`: equals `[{...KETTLE, remaining: 1, claimed: 2}, {...SOCKS, remaining: 1, claimed: 0}, {...LAMP, remaining: 0, claimed: 2}]`, and `JSON.stringify` of the result contains neither `Sue` nor `c1`.
  - The existing opted-out test also asserts `'claimed' in item` is false for every item.
- [ ] **Step 3: Write the failing integration tests.**
  - `shared.int-spec.ts`, `shows the owner the claims once they opt in` becomes `shows the owner who opted in how many are claimed, and never who (D75)`: as the signed-in owner, `items[0]` has `remaining: 1, claimed: 2`, no `claims` key, and `JSON.stringify(body)` contains neither `Sue` nor `Sam`, nor either seeded claim's `id`.
  - `wishlist.int-spec.ts`'s opted-in assertions change the same way on `GET /wishlist`.
  - Add, in `shared.int-spec.ts`: `still gives a guest every claim’s name when the owner opted in` (guest view of the same list has `claims` names `['Sue', 'Sam']` and no `claimed`).
- [ ] **Step 4: Run** `pnpm --filter @wishlist/api exec vitest run src/claims/projection.spec.ts` and `pnpm --filter @wishlist/api test:integration -- shared wishlist`. Expected: the opted-in cases FAIL (they get `claims`).
- [ ] **Step 5: Implement.** Add `claimed` to `ITEM_CLAIM_FIELDS` (doc comment: "the owner's total, sent instead of `claims` (D75)"). In `projectWishlist`, compute `claimed` per item as today, then return `{...item, remaining, claimed}` for an owner viewer and `{...item, remaining, claims: own}` for a guest. Update the function's doc comment to the new table. Rebuild contracts.
- [ ] **Step 6: Run** the projection tests and `pnpm --filter @wishlist/api test:integration`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(api): owners who opt in see claim totals, never names (D75)`.

### Task 2: A signed-in owner can't read their own list's claims through a manage link

**Files:** Modify `packages/contracts/src/error-codes.ts`, `apps/api/src/claims/claims-errors.ts`, `claims.controller.ts`, `claims.service.ts`, `apps/api/test/manage-claims.int-spec.ts`.

**Interfaces:**
- Produces: `ErrorCode.OWN_LIST_CLAIM = 'OWN_LIST_CLAIM'` (doc: "403: the list's signed-in owner opened a claim's manage link (D82)"); `ownListClaim(): AppError`; `ClaimsService.details(manageToken: string, viewerId: string | null)`, `.update(manageToken, input, ip, viewerId: string | null)`, `.cancel(manageToken, viewerId: string | null)`.

- [ ] **Step 1: Write the failing integration tests** in a new `describe('a claim on the owner’s own list (D82)')`, seeding Ada's verified list with Sue's claim (`seedClaim`) and logging in as Ada:
  - `GET` → `403`, code `OWN_LIST_CLAIM`, and `JSON.stringify(res.body)` contains neither `Sue` nor the claim's `id` nor `remaining`.
  - `PATCH {quantity: 1}` → `403 OWN_LIST_CLAIM`; the claim row's name and quantity are unchanged.
  - `DELETE` → `403 OWN_LIST_CLAIM`; the claim still exists.
  - `refuses the owner before the list’s limit, so a 429 says nothing (D43)`: fill `claimsListKey(wishlistId)` with `fillBucket` (`test/support/rate-limits.ts`), then the owner's `PATCH` is `403`, not `429`.
  - `refuses an owner whose email is unconfirmed too`: `signUp` (not verified) plus `logIn`, then `GET` → `403`.
  - `treats anyone else who is signed in as the claimer, as before`: Bob, signed in, gets `200` on `GET` with Sue's name.
  - `still answers 404 for an unknown token, signed in as the owner`.
- [ ] **Step 2: Run** `pnpm --filter @wishlist/api test:integration -- manage-claims`. Expected: the owner cases FAIL (they get `200`/`204`).
- [ ] **Step 3: Implement** per Global Constraints' order and rulings 2–3. `details` selects `ownerId: wishlists.ownerId` and throws `ownListClaim()` when it equals `viewerId`, before `claimedTotal`. `update` joins `wishlists` in its first lookup and checks before `claimsListKey`. `cancel`, when `viewerId` is non-null, first selects the claim's list owner (404 if none, 403 if the viewer), then deletes.
- [ ] **Step 4: Run** the integration suite. Expected: PASS, including every existing `manage-claims` test.
- [ ] **Step 5: Run** the full gate. Commit `feat(api): hide a claim on the owner's own list from its manage link (D82)`.

### Task 3: The owner's screens say how many are claimed

**Files:** Modify `apps/web/src/lib/editor-claims.ts` + `.spec.ts`, `lib/list-cache.ts` + `.spec.ts`, `components/list/item-row.tsx`, `components/share/share-page.tsx`, `owner-note.tsx`, `lib/share-copy.ts` + `.spec.ts`, `components/account/claims-card.tsx`, `e2e/tests/local/owner-claims.spec.ts`.

**Interfaces:**
- Consumes: `Item.claimed?: number` (Task 1).
- Produces: `ownerClaimLine({ quantity, claimed }: { quantity: number; claimed?: number }): EditorClaimLine | null` in `lib/editor-claims.ts`, replacing `editorClaimLine`; null when `claimed` is undefined. `EditorClaimLine` keeps `kind: 'none' | 'some' | 'taken'` (`taken` when `claimed >= quantity`).

- [ ] **Step 1: `gh stack add web/owner-totals`.**
- [ ] **Step 2: Write the failing unit tests.**
  - `editor-claims.spec.ts`: `says nothing unless the owner has opted in` (`claimed` undefined → null); `0 of 3` → `{text: 'None claimed yet', kind: 'none'}`; `2 of 5` → `'2 of 5 claimed'`, `some`; `5 of 5` → `'All 5 claimed'`, `taken`; `1 of 1` → `'Claimed'`, `taken`; `3 of 2` → `'3 of 2 claimed'`, `taken`.
  - `list-cache.spec.ts`: `keeps an item’s claimed total across an edit, and recomputes what is left` (existing `claimed: 2`, write answer with quantity 5 → `claimed: 2, remaining: 3`); `gives a new item 0 claimed and all of it left` on an opted-in list; `strips every claim field, and the setting, when the owner opts out` also asserts no `claimed`. Remove the `claims`-based variants these replace.
  - `share-copy.spec.ts`: `ownerSeesLine('Sam', true)` equals the new "on" line; the "off" line is unchanged.
- [ ] **Step 3: Run** `pnpm --filter @wishlist/web exec vitest run src/lib`. Expected: the new cases FAIL.
- [ ] **Step 4: Implement** `ownerClaimLine` and use it in `item-row.tsx`; switch `appendItem`, `replaceItem` and `withoutClaims` to `claimed` (an opted-in item may still arrive with `claims` from an old API only during ruling 1's window, so don't read it); ruling 5 in `share-page.tsx`; the copy table's rows for `ownerSeesLine`, `OwnerNote` and `ClaimsCard`. Delete code that only served owner `claims[]` (e.g. the editor's `joinNames` import) if nothing else uses it.
- [ ] **Step 5: Run** the web unit tests. Expected: PASS.
- [ ] **Step 6: Update the E2E** in `owner-claims.spec.ts`: the toggle and dialog are found by the new names; `with claims on, the owner sees them…` becomes `with claims on, the owner sees how many are claimed on /list and on their link, never who, and gifters are told (D75, D40)`. Two gifters claim 2 and 1 of a quantity-5 item via `claimViaApi`; the `/list` row reads `3 of 5 claimed`; the owner's `/s` card reads the same; neither page's text contains either gifter's name; a guest context's `/s` shows the new `ownerSeesLine`. The edit test (Review Focus 4) changes the quantity to 6 and expects `3 of 6 claimed` without a reload. The off and in-flight tests keep their assertions, now also that no `claimed` text appears.
- [ ] **Step 7: Run** `pnpm test:e2e -- owner-claims`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(web): the owner's list, share page and setting show claim totals (D75)`.

### Task 4: `/c` for the owner, and the same-release text

**Files:** Modify `apps/web/src/lib/shared-list.server.ts`, `app/c/[manageToken]/page.tsx`, `lib/messages.ts` (the copy table's entry), `app/privacy/page.tsx`, `README.md`, `e2e/tests/local/manage.spec.ts`; create `components/manage/own-list-claim.tsx`.

**Interfaces:**
- Consumes: `ErrorCode.OWN_LIST_CLAIM` (Task 2).
- Produces: `loadClaim(manageToken: string): Promise<{ kind: 'claim'; details: ClaimDetailsResponse } | { kind: 'own-list' }>`; `OwnListClaim(): JSX.Element`.

- [ ] **Step 1: Write the failing E2E** in `manage.spec.ts`: `the owner opening a claim’s link on their own list sees it’s hidden, and nothing about it (D82)`. A verified owner adds an item; a guest claims it as `Sue` via `claimViaApi`; the owner's page opens `/c/<token>`: the copy table's sentence and `Back to your list` are visible, `Sue` isn't on the page, there's no Cancel or Save, `localStorage['hanker:claims']` is unset, and the page passes `expectAccessible`. A second context, signed out, opens the same link and sees `Sue`'s claim as today.
- [ ] **Step 2: Run** `pnpm test:e2e -- manage`. Expected: FAIL (the owner gets the error page).
- [ ] **Step 3: Implement** ruling 4, `OwnListClaim` in the `/c` page's layout (heading as `ManageClaim`'s), the `/privacy` sentence, and ruling 6's README bullet.
- [ ] **Step 4: Run** `pnpm test:e2e` (all of it) and the full gate. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a claim on your own list stays hidden on its manage page (D82)`.

### Task 5: Docs

**Files:** Modify `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`, `AGENTS.md`, the design (`Status`).

- [ ] **Step 1: `gh stack add docs/owner-totals`.**
- [ ] **Step 2: Main spec.** §1 success criterion 4 gains "and an owner never sees who claimed what (D75)". §2 Spoilers: the "If `showClaimsToOwner = true`" bullet becomes the owner-totals rule, plus D82's manage-link rule. §5 `GET /claims` row: `403 OWN_LIST_CLAIM` for the list's owner. §5.1: the new table. §7 claim-lines bullet: the new copy. §13: D75 and D82 rows copied from the design. The header's **Amended by** gains the design.
- [ ] **Step 3: AGENTS.md** Claims bullet: "for an owner who hasn't opted in, `remaining` and `claims` are absent, not empty" becomes "an owner gets no `claims[]` ever; one who hasn't opted in gets no `remaining` or `claimed` either, absent, not empty (D75). The `/claims/:manageToken` routes refuse the list's signed-in owner with `403 OWN_LIST_CLAIM` (D82)."
- [ ] **Step 4:** Design header: `Status: Approved by Ted, 2026-10-23. Part 1 is Plan 10a.` `pnpm format:check`. Commit `docs: owner totals in the spec and AGENTS.md`.

### Task 6: ⏸ Checkpoint — review, submit, merge, verify

Each step waits for Ted where it says so.

- [ ] **Step 1: Whole-branch review** of the stack against the design's Part 1 and this plan. Fix findings in the owning layer, then `gh stack rebase --upstack`.
- [ ] **Step 2: Ted approves the first submit** (new stack). Then `gh stack submit --open`; each PR gets a Conventional Commit title and a summary body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 3:** Every layer's CI and preview pass.
- [ ] **Step 4 (optional, Ted's call): count opted-in owners** before merging, read-only: `select count(*) from wishlists where show_claims_to_owner` (design §9). They lose names on their next load.
- [ ] **Step 5: Ted merges.** The executor never merges.
- [ ] **Step 6: Verify production**, only if Ted asks (he prefers to be asked before prod checks): the deploy passes and `/api/health` reports the merge SHA; Sentry shows no new issues within the hour.
- [ ] **Step 7:** A follow-up PR sets the roadmap's row 10a to "Done". Then Plan 10b is written against the merged code.
