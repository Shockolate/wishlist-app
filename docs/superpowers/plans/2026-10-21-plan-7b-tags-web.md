# Plan 7b — Tags Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web side of item tags:

- on the share page, a row of filter pills (one price pill, then the tags) that narrows the cards, with live counts and "Clear filters";
- in the editor, a tag field in the item form;
- in the editor, a tag-first **Tags** sheet for ticking items and renaming or deleting tags.

**Architecture:**

- **Pure logic in `lib/`.** Price reading, filtering, counts, labels, suggestions and the cache edits are pure functions in `apps/web/src/lib/` and `packages/contracts`, unit-tested with Vitest. The web app has no DOM test setup, so components are proven by Playwright.
- **The share page.** One client island, `ShareFilterList`, takes the cards the server rendered and shows only the ones that match. It is used for both the gifter's and the owner's view.
- **The editor.** Every tag change is a mutation in `lib/list-mutations.ts`, in the one list scope, on the one TanStack cache.

**Tech Stack:** Next.js 16, React 19, TanStack Query 5, react-hook-form 7, Zod 4, Tailwind 4, Vitest, Playwright. **No new dependencies.**

**Spec:** [docs/superpowers/specs/2026-10-21-item-tags-and-filters-design.md](../specs/2026-10-21-item-tags-and-filters-design.md) (approved 2026-10-21): §3 (Price filter, Filtering), §4, §7, §8 (web and E2E rows). The API it calls is [Plan 7a](2026-10-21-plan-7a-tags-api.md), merged as `7efe5e9`. The main spec's §5 describes the routes.

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) still applies:

- **Toolchain and versions:** Node 24, pnpm 12.10.1, exact pins, no new dependencies.
- **Web app conventions:** bundler resolution in the web app (no `.js` suffix), `import type` for types.
- **Writes and copy:** account and editor writes go through `browserApi`. Error copy lives in `lib/messages.ts`, field-validation copy in `lib/form-errors.ts`, and sentences built from claim or filter numbers in `lib/share-copy.ts`.
- **Editor state:** every list change is a mutation from `lib/list-mutations.ts`, in `LIST_SCOPE`, used through `useListMutations()`.
- **Theme:** UI pieces sit on the theme tokens in `globals.css`. **Terracotta (`--primary`) never carries text and never marks a filter.**
- **Commits:** behavior changes are written test-first. Every commit ends with `Co-Authored-By:` naming the model that wrote it (`<model>` below).

**Keys.** Tag clean-up only collapses whitespace and trims. A leading `#` is kept, so "#books" and "books" are two tags (D59). Match typed text to a tag with `tagKey()` from `packages/contracts`.

**Dark until merged; then live.** Merging this stack turns the feature on for every owner and gifter. No environment, secret or Vercel setting changes.

**Values fixed by this plan (from design §3–§4):**

| Thing | Value |
|---|---|
| Readable price | After `trim()`: `^([A-Za-z]*\p{Sc})(\d{1,3}(?:,\d{3})+\|\d+)(?:\.\d+)?$` with the `u` flag. `currency` is group 1 as written; `amount` is the number with commas removed |
| Readable examples | `$24.99`, `£30.00`, `€12.50`, `CA$20.00`, `¥1,200`, `$1,234` |
| Unreadable examples | `about £30`, `$20–30`, `varies`, `30`, `30 USD`, `CHF 1,234.50`, `$ 24.99`, `$1,2345`, `$.99`, `-$5`, `''` |
| Dollar-scale currencies | `$`, `US$`, `CA$`, `A$`, `NZ$`, `£`, `€` (no others get a price pill) |
| List currency | The prefix with the most readable prices; a tie goes to the tied prefix that appears first in list order |
| Bands | `under-25` [0, 25), `25-50` [25, 50), `50-100` [50, 100), `100-plus` [100, ∞) |
| Band labels | `Under $25`, `$25–50`, `$50–100`, `$100+` (the list's prefix; an en dash) |
| Joined label | Neighbouring selected bands merge into one run. A run from `under-25` up to `k` reads `Under $<k's upper>`. A run from `k` to `100-plus` reads `$<k's lower>+`. All four read `Any listed price`. Any other run reads `$<lower>–<upper>`. Runs are joined with ` · ` |
| Price pill, nothing selected | `Any price` with `ChevronDownIcon`, outlined (`border-input`, transparent) |
| Pill colours | Off: `bg-placeholder` with a warm border and `text-foreground`. On: `bg-foreground` with `text-background`. Count: `text-xs tabular-nums`, `text-muted-foreground` off and a lighter warm tone on. Full-round; at least 40px tall with a 44px hit area |
| Chip accessible name | `"<name>, <n> item(s)"`, e.g. `Kitchen gadgets, 4 items`, `Garden, 1 item` |
| Row label | `role="group"`, `aria-label="Filter the list"` |
| Shown line | `"<shown> of <total> items"` (polite live region), with a `Clear filters` link-button beside it |
| No match | `Nothing on the list matches these filters.` with a `Clear filters` button |
| Tag chip order | The number of the list's items carrying the tag, descending; ties by `name.localeCompare` |
| Owner Tags sheet order | Alphabetical (`localeCompare`) |
| Suggestions | At most 6. Tags whose `tagKey` starts with the typed key come first, then ones containing it, each group alphabetical. Tags already chosen are left out |
| Error copy (`messages.ts`) | `TAG_NAME_TAKEN`: `You already have a tag called that.`; `TAG_LIMIT_REACHED`: `Your list has 50 tags, the most it can hold.`; `ITEM_TAG_LIMIT_REACHED`: `An item can have at most 10 tags.` |
| Delete confirm | Title `Remove “<name>” from <n> item(s)?`, or `Delete “<name>”?` when n is 0. Body `The items stay on your list.` Buttons `Delete tag` and `Cancel` |
| Item form field | Label `Tags`, hint `Gifters can filter your list by these.`, placed after Note |

## Rulings this plan makes on gaps in the design

1. **The Tags view is a bottom sheet,** on `components/ui/sheet.tsx`, opened by a **Tags** button beside the share actions. It has two panes: all tags, and one tag. The one-tag pane has an `All tags` back button. Every tick saves at once, so the browser's Back leaving `/list` loses nothing. Design §4 left sheet versus route open.
2. **Hidden, not unmounted.** Filtered-out cards get the `hidden` attribute, so a card's client state (an open claim strip, focus targets) survives filtering.
3. **The price menu is hand-rolled.** No Radix popover is installed, so it's a disclosure: a button with `aria-expanded` and `aria-controls`, and a panel holding an `Any price` button and four native checkboxes with their counts. Escape, a click outside and the pill all close it, and focus returns to the pill.
4. **Ticks, unticks and deletes are optimistic,** like reorder and delete today. Create and rename wait for the API, like add and save.
5. **The edit form sends `tags` only when the tag field is dirty** (design §6). The add form sends `tags` only when non-empty.
6. **A deleted tag in an open form disappears.** A chip whose `{ id }` isn't in the cache's `tags` is left out of the field and of the body.
7. **Typing an 11th tag** is refused in the field with `An item can have at most 10 tags.` and never sent.
8. **The editor's opt-out keeps tags.** `hideCachedClaims()` / `stripClaims` must leave `tags` and `tagIds` alone, with a test.
9. **Decisions D61–D63** are logged by Task 7:
   - **D61:** filtering reads prices from `priceText`, for dollar-scale currencies only.
   - **D62:** the filter row: charcoal active pills, tags AND, bands OR, live counts.
   - **D63:** the Tags view is a tag-first bottom sheet.

## Review Focus

1. **A gifter claims an item while filters are on.** The claim strip and the `router.refresh()` that follows keep the same filters and the same cards shown, and the counts don't change, since claimed items still count. Task 2.
2. **A list whose prices are messy:** "about £30", "varies", blank, or a few `¥` among many `$`. The price pill appears only for a dollar-scale majority. Choosing a band hides every item without a readable price in that currency, and the counts agree with what's shown. Task 1.
3. **The owner's item form is open while they tick or delete a tag in the Tags sheet.** Saving the form without touching tags sends no `tags`, so the ticks survive. A deleted tag's chip disappears from the form. Tasks 4 and 5.
4. **Keyboard-only or screen-reader use.** Chips are reachable by Tab and report `aria-pressed`. The shown line is announced. The price menu closes on Escape and gives focus back. In the tag field, the arrow keys move through suggestions and Enter picks one. axe finds nothing. Tasks 2 and 5.
5. **Phone width with many or long tags.** The row scrolls sideways inside itself while the page never does. A 30-character tag fits on its chip. Task 2.

## Stacks and order

One new stack. Task 3 is a ⏸ checkpoint with Ted and has no layer.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-7b` | 0 |
| `web/share-filters` | 1, 2 |
| — | 3 ⏸ mockups of the tag field and the Tags sheet; Ted approves before Task 4 |
| `web/tag-cache` | 4 |
| `web/tag-field` | 5 |
| `web/tags-sheet` | 6, 7 |

Task 8 is the ⏸ checkpoint: the final review, Ted's approval of the first submit, his merge, and verifying production.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/price.ts` (new), `price.spec.ts` | `parsePrice`, `DOLLAR_SCALE` |
| `apps/web/src/lib/share-filters.ts` (new), `.spec.ts` | Filter state, matching, counts, bands, labels, chip order, list currency |
| `apps/web/src/lib/share-copy.ts`, `.spec.ts` | `tagChipLabel`, `shownLine` |
| `apps/web/src/components/share/share-filter-list.tsx` (new) | The row, the price menu, the filtered `<ol>` |
| `apps/web/src/components/share/share-page.tsx` | Uses `ShareFilterList` in both branches |
| `apps/web/src/lib/list-cache.ts`, `.spec.ts` | `mergeTags`, `setItemTag`, `renameTag`, `removeTag` |
| `apps/web/src/lib/list-mutations.ts`, `.spec.ts` | `ItemWriteResponseSchema` on item writes; five tag mutations |
| `apps/web/src/lib/tag-input.ts` (new), `.spec.ts` | `suggestTags`, `addTypedTag`, `shownTags`, `itemBody` |
| `apps/web/src/lib/add-input.ts` | `ItemFormValues.tags` |
| `apps/web/src/components/list/tag-field.tsx` (new), `item-fields.tsx`, `add-form.tsx`, `item-edit-form.tsx` | The tag field |
| `apps/web/src/components/list/tags-sheet.tsx` (new), `list-editor.tsx` | The Tags sheet |
| `apps/web/src/lib/tag-copy.ts` (new), `.spec.ts` | Delete-confirm copy |
| `apps/web/src/lib/messages.ts`, `.spec.ts` | Three error messages |
| `apps/web/src/app/privacy/page.tsx` | "tags" among what a list keeps |
| `e2e/tests/local/share-filters.spec.ts`, `tags.spec.ts` (new) | E2E |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build
pnpm --filter @wishlist/web exec vitest run <file>
pnpm test:e2e <file>          # Docker; see docs/development.md
```

The full gate, run at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
pnpm test:e2e
```

---

### Task 0: Start the stack

- [ ] `gh stack init docs/plan-7b`. In the roadmap, link row 7b's name to this plan. Commit this plan with it (`docs: plan 7b for the tags web`).

### Task 1: Prices and filter logic

**Files:**

- Create: `packages/contracts/src/price.ts`, `price.spec.ts` (export it from `index.ts`)
- Create: `apps/web/src/lib/share-filters.ts`, `share-filters.spec.ts`
- Modify: `apps/web/src/lib/share-copy.ts`, `share-copy.spec.ts`

**Interfaces (Produces):**

```ts
// contracts/price.ts
export interface ParsedPrice { currency: string; amount: number }
export function parsePrice(text: string | null): ParsedPrice | null;
export const DOLLAR_SCALE: readonly string[];          // the 7 prefixes in the values table
// web/lib/share-filters.ts
export type BandId = 'under-25' | '25-50' | '50-100' | '100-plus';
export const BANDS: readonly { id: BandId; min: number; max: number | null }[];
export interface FilterItem { id: string; tagIds?: string[]; priceText: string | null }
export interface Filters { tagIds: readonly string[]; bands: readonly BandId[] }
export const NO_FILTERS: Filters;
export function listCurrency(items: readonly FilterItem[]): string | null;     // null unless dollar-scale
export function matches(item: FilterItem, f: Filters, currency: string | null): boolean;
export function tagCount(items: readonly FilterItem[], f: Filters, currency: string | null, tagId: string): number;
export function bandCount(items: readonly FilterItem[], f: Filters, currency: string | null, band: BandId | 'any'): number;
export function orderTags<T extends { id: string; name: string }>(tags: readonly T[], items: readonly FilterItem[]): T[];
export function bandLabel(band: BandId, currency: string): string;
export function joinedBandLabel(bands: readonly BandId[], currency: string): string; // '' when none
// web/lib/share-copy.ts
export function tagChipLabel(name: string, count: number): string;
export function shownLine(shown: number, total: number): string;
```

- [ ] **Step 1: Write the failing tests.**
  - **`parsePrice`:**
    - Every readable example gives the right `{ currency, amount }`: `$24.99` → `{ '$', 24.99 }`, `CA$20.00` → `{ 'CA$', 20 }`, `¥1,200` → `{ '¥', 1200 }`.
    - Every unreadable example, and `null`, gives `null`.
    - `DOLLAR_SCALE` equals the table's list.
  - **`listCurrency`:**
    - The majority prefix wins.
    - A 2–2 tie goes to the prefix seen first in list order.
    - A `¥` majority, or a list with no readable prices, gives `null`.
  - **`matches`:**
    - Tags combine with AND: `['a', 'b']` needs both.
    - Bands combine with OR: `25-50` plus `100-plus` takes $30 and $120 but not $60.
    - With a band on, `about £30` and a `¥` price on a `$` list are hidden.
    - Edges: $25.00 is in `25-50`, $50.00 is in `50-100`, and $0 is in `under-25`.
  - **`tagCount`:** for an unselected tag, it is the count with that tag added; for a selected tag, it equals the number shown. **RF2:** on a mixed list, a band count equals `items.filter(matches)` with that band added.
  - **`bandCount('any')`:** counts the tag matches, readable price or not.
  - **`orderTags`:** most-carried first, and an equal count goes by `localeCompare`. The order doesn't change when filters change, since it takes the whole list.
  - **`joinedBandLabel`, for `$`:**
    - `[]` → `''`
    - `['25-50']` → `$25–50`
    - `['25-50', '50-100']` → `$25–100`
    - `['under-25', '25-50']` → `Under $50`
    - `['50-100', '100-plus']` → `$50+`
    - all four → `Any listed price`
    - `['under-25', '100-plus']` → `Under $25 · $100+`
    - The input order doesn't matter.
  - **`tagChipLabel`:** `('Garden', 1)` → `Garden, 1 item` and `('Kitchen gadgets', 4)` → `Kitchen gadgets, 4 items`. **`shownLine`:** `(3, 26)` → `3 of 26 items`.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/contracts test` and `pnpm --filter @wishlist/web exec vitest run src/lib/share-filters.spec.ts src/lib/share-copy.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Interfaces and the values table. `price.ts` imports only from the standard library. Each band's `max` is exclusive.
- [ ] **Step 4:** Rerun Step 2's commands. Expected: PASS.
- [ ] **Step 5:** Run `gh stack add web/share-filters` (the controller does this before dispatching), then commit `feat(web): read prices and filter a shared list`.

### Task 2: The share page's filter row

**Files:**

- Create: `apps/web/src/components/share/share-filter-list.tsx`, `e2e/tests/local/share-filters.spec.ts`
- Modify: `apps/web/src/components/share/share-page.tsx`

**Interfaces:**

- Consumes: everything Task 1 produces; `SharedWishlistResponse.tags` and `SharedItem.tagIds`, both optional and treated as `[]` when absent.
- Produces:

```tsx
export function ShareFilterList(props: {
  label: string;                                  // the <ol>'s aria-label, as today
  tags: readonly Tag[];
  items: readonly FilterItem[];                   // same order as cards
  cards: readonly { id: string; node: ReactNode }[];
}): JSX.Element;
```

`SharePage` renders `<ShareFilterList>` in place of each `<ol>`: in the owner's branch directly, and in the gifter's branch inside `ShareClaimsProvider`. Its filter state lives in `useState<Filters>`. Until the component has mounted, nothing but the `<ol>` renders, so the page is readable without JavaScript.

- [ ] **Step 1: Write the failing E2E tests** in `share-filters.spec.ts`. Seed through `addItemViaApi` with `tags: [{ name }]` and a `priceText`.
  - **Two tags and a band:**
    1. Ada's list has 6 items tagged across Kitchen, Christmas and Books, priced from $12 to $140, plus one "varies".
    2. A guest taps `Kitchen, n items`, then `Christmas, …`, then opens `Any price` and ticks `$25–50`.
    3. Only the matching cards are visible, and the line reads `<k> of 7 items`.
    4. `Clear filters` shows all 7 again and hides the line.
  - **RF1:**
    1. With `Kitchen` on, claim a visible item through its sheet.
    2. After the refresh, `Kitchen` is still pressed.
    3. The same cards show and the count is unchanged.
  - **RF4:**
    - Tab reaches the price pill, then each chip; Space toggles one, and it reports `aria-pressed="true"`.
    - Escape closes the price menu and focus is back on the pill.
    - `expectAccessible` passes with the menu open and again with it closed.
  - **RF5:** at `PHONE`, with 12 tags of 30 characters, `expectNoSidewaysScroll` passes, and the row's `scrollWidth` is greater than its `clientWidth`.
  - **No JavaScript:** in a context with `javaScriptEnabled: false`, every card shows and there is no `Filter the list` group.
  - **Owner's view:** Ada on her own link sees the same row.
  - **Currency:**
    - A list priced only in `¥` shows tag chips but no price pill.
    - A list with no tags and no prices has no row.
- [ ] **Step 2:** Run `pnpm test:e2e share-filters`. Expected: FAIL.
- [ ] **Step 3:** Implement to the values table and design §4:
  - **Row:** horizontal scroll, bleeding to the column edges on phones, with the scrollbar hidden. It sits directly below the intro line.
  - **Chips:** `<button aria-pressed>`, using the pill styles from the values table.
  - **Zero counts:** a chip or band with count 0 that isn't selected is disabled and dimmed (`opacity-50`), and keeps its place.
  - **Filtered-out cards:** they get `hidden` (ruling 2).
  - **Price menu:** as ruling 3. It shows only when `listCurrency` isn't null and some item has a readable price.
- [ ] **Step 4:** Rerun Step 2's command, plus `claim` and `pages`. Expected: PASS.
- [ ] **Step 5:** Run the full gate. Commit `feat(web): filter a shared list by tags and price`.

### Task 3: ⏸ Mockups of the tag field and the Tags sheet

Done by the controller with Ted. It's not a subagent task, and nothing is committed.

- [ ] Using the brainstorming visual companion, show at phone width:
  - the item form with the tag field: chips, typing, suggestions, the 11th-tag error;
  - the Tags sheet's two panes, with the delete confirmation.

  Use the values table's copy and ruling 1's layout.
- [ ] **Stop for Ted's approval.** Record any change he asks for as a ruling in the ledger and carry it into Tasks 5–6.

### Task 4: Tags in the editor's cache and mutations

**Files:**

- Modify: `apps/web/src/lib/list-cache.ts`, `list-cache.spec.ts`, `list-mutations.ts`, `list-mutations.spec.ts`, `messages.ts`, `messages.spec.ts`

**Interfaces (Produces):**

```ts
// list-cache.ts
export function mergeTags(list: WishlistResponse, tags: readonly Tag[]): WishlistResponse;   // add or rename by id
export function setItemTag(list: WishlistResponse, itemId: string, tagId: string, on: boolean): WishlistResponse;
export function renameTag(list: WishlistResponse, tag: Tag): WishlistResponse;
export function removeTag(list: WishlistResponse, tagId: string): WishlistResponse;        // from tags and every tagIds
// list-mutations.ts — added to listMutations()' return
createTag: MutationOptions<Tag, unknown, string>;                       // POST /wishlist/tags {name}
renameTagTo: MutationOptions<Tag, unknown, { id: string; name: string }>;
deleteTag: MutationOptions<undefined, unknown, string>;
tick: MutationOptions<undefined, unknown, { tagId: string; itemId: string }>;
untick: MutationOptions<undefined, unknown, { tagId: string; itemId: string }>;
```

- **Item writes:** `create` and `update` parse with `ItemWriteResponseSchema`. They `mergeTags` the response's `tags`, then append or replace the item without its `tags` key.
- **Optimistic changes:** `tick` and `untick` call `setItemTag` in `onMutate`, after `holdRefetches`; `deleteTag` calls `removeTag` the same way.
- **Waiting changes:** `createTag` and `renameTagTo` call `mergeTags` / `renameTag` in `onSuccess`.
- **Every mutation:** `scope: LIST_SCOPE`, with the shared `onError` and `onSettled`.
- **Bodiless `PUT`s and `DELETE`s:** send through `api.put` / `api.delete` with `NoContentSchema`, as `move` does.

- [ ] **Step 1: Write the failing tests.**
  - **`list-cache.spec.ts`:**
    - each helper on a list with and without `tags`;
    - `removeTag` clears the id from every item;
    - `setItemTag` doesn't add the same id twice;
    - **ruling 8:** `stripClaims` keeps `tags` and `tagIds`.
  - **`list-mutations.spec.ts`,** in the file's style with a real `QueryClient` and a fake `fetch`:
    - a create whose answer carries a new tag adds it to the list's `tags`;
    - a tick shows at once and sends `PUT /wishlist/tags/<t>/items/<i>`;
    - a failed tick refetches once the queue drains;
    - a tick queued behind a save goes second;
    - `deleteTag` removes the tag before its request runs.
  - **`messages.spec.ts`:** each new code gives the table's copy.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/web exec vitest run src/lib`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Interfaces.
- [ ] **Step 4:** Rerun Step 2's command. Expected: PASS.
- [ ] **Step 5:** Run `gh stack add web/tag-cache` (the controller does this before dispatching), then the full gate. Commit `feat(web): keep tags in the editor's cache`.

### Task 5: The tag field

**Files:**

- Create: `apps/web/src/lib/tag-input.ts`, `tag-input.spec.ts`, `apps/web/src/components/list/tag-field.tsx`, `e2e/tests/local/tags.spec.ts`
- Modify: `apps/web/src/lib/add-input.ts` (replace `tags?: undefined` and its comment), `add-input.spec.ts`, `item-fields.tsx`, `add-form.tsx`, `item-edit-form.tsx`

**Interfaces:**

```ts
// add-input.ts
ItemFormValues.tags: ItemTagRef[]                    // formValuesOf: tagIds → [{ id }]; prefill: []
// tag-input.ts
export function suggestTags(all: readonly Tag[], typed: string, chosen: readonly ItemTagRef[]): Tag[];
export function addTypedTag(chosen: readonly ItemTagRef[], typed: string, all: readonly Tag[]):
  { tags: ItemTagRef[] } | { error: string };      // existing key → { id }; else { name: cleaned }
export function shownTags(chosen: readonly ItemTagRef[], all: readonly Tag[]): { ref: ItemTagRef; name: string }[];
export function itemBody<T extends { tags: ItemTagRef[] }>(values: T, tagsChanged: boolean): Omit<T, 'tags'> | T;
```

- **`addTypedTag`:**
  1. It validates with `TagNameSchema.safeParse(typed, { error: formErrorMap })`, and an invalid name returns its message.
  2. It matches existing tags with `tagKey`.
  3. A tag already chosen is a no-op.
  4. An 11th tag returns `An item can have at most 10 tags.` (ruling 7).
- **`shownTags`:** it drops an `{ id }` not in `all` (ruling 6) and sorts by name with `localeCompare`.
- **`itemBody`:** with `tagsChanged` false it drops `tags` (ruling 5). The edit form passes `Boolean(form.formState.dirtyFields.tags)`, and the add form passes `values.tags.length > 0`.
- **`TagField`:** a react-hook-form `Controller` on `tags`, built as a combobox:
  - an `<input role="combobox" aria-expanded aria-controls aria-activedescendant>` with a `role="listbox"` of `suggestTags`;
  - ArrowUp and ArrowDown move through the suggestions; Enter or a comma adds the highlighted one or the typed text; Escape closes the list;
  - Backspace in an empty input focuses the last chip's remove button (`aria-label="Remove <name>"`);
  - it reads the list's tags from the `WISHLIST_KEY` cache.

- [ ] **Step 1: Write the failing tests.**
  - **Unit tests in `tag-input.spec.ts`:**
    - `suggestTags`: the prefix group before the contains group, at most 6, chosen ones left out, and `#books` only for `#b`, not for `b`.
    - `addTypedTag`: `' kitchen '` with `Kitchen` existing → `{ id }`; `'#Kitchen'` → `{ name: '#Kitchen' }`; a 31-character name and an 11th tag → their errors.
    - `shownTags` drops a deleted id.
    - `itemBody` keeps or drops `tags`.
    - `formValuesOf` maps `tagIds`.
  - **E2E in `tags.spec.ts`:**
    - **Add form:** Ada adds an item, types `Kitchen`, Enter, then `Christmas`, Enter, and saves. Her share link shows chips `Kitchen, 1 item` and `Christmas, 1 item`.
    - **Edit form:** she opens the item, types `kit`, picks `Kitchen` from the suggestions with ArrowDown and Enter (a duplicate is a no-op), removes `Christmas` by its remove button, and saves. The share link shows only `Kitchen`.
    - **RF3:** with the edit form open on another item, a tick made through the API (`PUT`) survives saving the form with a changed title. The network body has no `tags` key.
    - **RF4:** `expectAccessible` passes with the suggestions open.
- [ ] **Step 2:** Run the unit file and `pnpm test:e2e tags`. Expected: FAIL.
- [ ] **Step 3:** Implement. The field goes after Note with the label and hint from the values table. Its errors show through `Field` like the other fields.
- [ ] **Step 4:** Rerun Step 2's commands, plus `add-item` and `edit-item`. Expected: PASS.
- [ ] **Step 5:** Run `gh stack add web/tag-field` (controller), then the full gate. Commit `feat(web): tag an item in its form`.

### Task 6: The Tags sheet

**Files:**

- Create: `apps/web/src/components/list/tags-sheet.tsx`, `apps/web/src/lib/tag-copy.ts`, `tag-copy.spec.ts`
- Modify: `apps/web/src/components/list/list-editor.tsx`, `e2e/tests/local/tags.spec.ts`

**Interfaces:**

- Consumes: Task 4's five mutations, `useListMutation` (failures go to `useListStatus().fail`), and `ui/sheet.tsx` and `ui/alert-dialog.tsx`.
- Produces:

```ts
// tag-copy.ts
export function deleteTagTitle(name: string, count: number): string;
```

**What the sheet does (ruling 1):**

- **Opening it:** a `Tags` button appears once the list has an item, beside `ShareActions`.
- **All-tags pane:** the title `Tags`; each tag as a button reading `<name>` and `<n> item(s)`; and `New tag`.
- **One-tag pane:**
  - the tag's name as the title, its count, `Rename`, `Delete`, and every item in list order as a checkbox labelled with its title;
  - ticking calls `tick` and unticking calls `untick`;
  - `All tags` goes back.
- **New tag:** an inline name field. Submitting calls `createTag`, then opens that tag's pane. Entering an existing name opens that tag, because the API answers `200` with it.
- **Rename:** inline as well. `TAG_NAME_TAKEN` shows its message on the field and keeps the old name.
- **Delete:** confirms with `deleteTagTitle`, then calls `deleteTag` and goes back to all tags.
- **Announcements:** the status line announces `Tagged “<item>”.`, `Untagged “<item>”.` and `Deleted “<tag>”.`.

- [ ] **Step 1: Write the failing tests.**
  - **`tag-copy.spec.ts`:**
    - `('Kitchen', 3)` → `Remove “Kitchen” from 3 items?`
    - `('Kitchen', 1)` → `Remove “Kitchen” from 1 item?`
    - `('Kitchen', 0)` → `Delete “Kitchen”?`
  - **E2E in `tags.spec.ts`:**
    - **Batch tagging:**
      1. Ada has 4 untagged items. She opens `Tags`, taps `New tag`, types `Kitchen` and saves.
      2. She ticks 3 items, goes `All tags`, and sees `Kitchen` with `3 items`.
      3. On her share link, `Kitchen, 3 items` shows.
    - **Rename:** renaming to `Cooking` shows on the share link. Renaming another tag to `cooking` shows `You already have a tag called that.`
    - **Delete:**
      1. The confirm reads `Remove “Cooking” from 3 items?`.
      2. `Delete tag` removes it, and the share link has no chip for it.
      3. The items still show.
    - **RF3:**
      1. With an item's edit form open, Ada opens `Tags` and deletes a tag that item carries.
      2. She closes the sheet: the chip is gone from the form.
      3. Saving succeeds without bringing the tag back.
    - **Access:** `expectAccessible` passes on both panes, and the keyboard alone can open the sheet, tick an item, and close it with Escape.
- [ ] **Step 2:** Run the unit file and `pnpm test:e2e tags`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun Step 2's commands, plus `list`, `reorder` and `owner-claims`. Expected: PASS.
- [ ] **Step 5:** Run `gh stack add web/tags-sheet` (controller), then the full gate. Commit `feat(web): tag many items from the Tags sheet`.

### Task 7: Docs and privacy

**Files:**

- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§7 Routes and owner editor, a "Share filters (Plan 7b)" bullet block, and §13), `AGENTS.md` (a Web bullet), `apps/web/src/app/privacy/page.tsx`, `docs/superpowers/plans/2026-10-07-roadmap.md` (row 7b's status)

- [ ] **Step 1: Main spec.**
  - Describe the share page's filter row, the tag field and the Tags sheet as built, following design §4 and this plan's rulings.
  - Log D61–D63 (ruling 9) as `(Ted, 2026-10-21)`, each with its rejected alternative:
    - **D61:** rejected a stored numeric price.
    - **D62:** rejected terracotta active pills.
    - **D63:** rejected per-item batch selection.
- [ ] **Step 2: AGENTS.md.** One Web sub-bullet:

  > **Tags (Plan 7b):** the share page filters in one client island, `ShareFilterList`. Its logic is in `lib/share-filters.ts` and `parsePrice` in contracts. Filtered cards are `hidden`, never unmounted. Item forms send `tags` only when the tag field changed. Tag changes are mutations in `lib/list-mutations.ts`.

- [ ] **Step 3: Privacy page.** Add "tags" to the list of what a list keeps: "its title, items, links, prices, photo addresses, notes and tags".
- [ ] **Step 4:** Leave row 7b at "Planned" until the checkpoint. Run `pnpm format:check` and the web E2E `legal` test. Commit `docs: the tags web in the spec, AGENTS.md and the privacy page`.

### Task 8: ⏸ Checkpoint — review, submit, merge, verify

- [ ] **Step 1:** Final whole-branch review against the design and this plan. Fix findings in their owning layers, then `gh stack rebase --upstack`.
- [ ] **Step 2: Ted approves the first submit** (`gh stack submit --open`).
- [ ] **Step 3:** Give each PR a Conventional Commit title and a summary body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4:** Every layer's CI and preview pass. Optional, for Ted: on the top preview, tag a few items and filter the share link on a phone.
- [ ] **Step 5: Ted merges.** The executor never merges.
- [ ] **Step 6: Verify production, read-only.**
  - The deploy run passes every job.
  - `/api/health` reports the merge SHA.
  - The landing page and an unknown share link respond as before.
- [ ] **Step 7:** A follow-up PR sets roadmap row 7b to "Done".
