# Item Tags and Share-Page Filters — Design

- **Date:** 2026-10-21
- **Status:** Approved by Ted, 2026-10-21
- **Author:** Ted Armstrong (with Claude)
- **Amends:** [`2026-10-07-wishlist-app-design.md`](2026-10-07-wishlist-app-design.md): §2 Items gains tags, §4 gains `tags` and `item_tags`, §5 gains the tag endpoints and new response fields, §7 gains the share page's filter row, the item form's tag field and the editor's Tags view. The plan assigns decision numbers from D58.
- **Origin:** Ted's request on 2026-10-21, refined in conversation the same day with mockups (charcoal active pills, a single price pill with a menu, a tag-first batch view). Everything marked _Ted_ below he decided; everything marked _Claude's call_ he saw in a playback and didn't object to.

## 1. Intent

Each owner has exactly one list (D4), so that one list carries everything: Christmas ideas, birthday ideas, kitchen things, books. Once it passes a couple of dozen items, a gifter looking for "something for the kitchen" or "a Christmas present around $40" has to read the whole thing.

Tags let the owner say what each item is or what it's for, in their own words. The share page turns those tags, plus a price filter, into a row of pills a gifter can combine to narrow the list. The cards themselves stay exactly as they are.

**Success looks like:** a gifter opens a 30-item list, taps _Kitchen_ and _$25–50_, and sees only the three items that fit, without the list looking any busier than it does today.

## 2. Goals, non-goals, anti-goals

### Goals

1. The owner can add, change and remove free-form tags on each item, in the item form (adding and editing).
2. The owner can tag many items at once from a tag-first **Tags** view, and rename or delete a tag across the whole list there.
3. On the share page, a gifter can filter by any combination of tags (AND) and price bands (OR among bands), see live counts, and clear everything in one tap.

### Non-goals

- **Price as a tag.** Price is its own field and its own filter (_Ted_). Nothing looks for price-shaped tags; an owner who types `#under-30` just gets a tag called "under-30".
- **A stored numeric price.** The filter reads the number out of the existing `priceText` (§5). The main spec's non-goal "prices are display strings" still holds: the display string is unchanged, and the parsed number is used only for filtering, in the browser.
- **Tags on cards or editor rows.** Neither the share cards nor the editor's rows show tags.
- **Filtering in the owner's editor.** `/list` gets no chip row (_Claude's call_, to keep scope to gifter filtering plus owner tagging).
- **Remembering filters.** Filters last for the visit. They aren't put in the URL or in storage.
- **Tags on the manage page** (`/c/[manageToken]`).
- **Sorting, search, or tag colours.**

### Anti-goals (a failure even if it works)

- **Visual noise on the cards.** The cards are the product; tags must not leak onto them (_Ted_).
- **Pills that look like buttons.** Terracotta means "act" (Claim it). Active pills are charcoal so a filter never reads as an action (_Ted_).
- **A row that jumps around as you tap.** Chips keep their place; a chip that would show nothing is dimmed, not removed.
- **Silently wrong price results.** An item whose price can't be read with confidence is hidden while a price band is on, rather than guessed into a band (_Ted_).

## 3. Product rules

### Tags (§2 Items)

- A tag belongs to one list. An item has 0–10 tags. A list has at most 50 tags (_Claude's call_).
- **A name is shown exactly as the owner typed it**, after clean-up: "Kitchen gadgets" stays "Kitchen gadgets" (_Ted_). Tags aren't hashtags, but a `#` the owner types is kept, leading or not: "#books" stays "#books" (_Ted_, 2026-10-21, changed before merge).
- **Clean-up:** trim, and collapse runs of whitespace to one space. Nothing else changes, so cleaning a cleaned name changes nothing. Then the visible-text rules apply, as for titles and prices (D35, D41/D44): control and format characters are refused (bar the two joiners), and a name that draws nothing is refused. 1–30 characters, counted in UTF-16 code units (_Claude's call_).
- **Identity is case-insensitive.** "kitchen", "Kitchen" and " KITCHEN " are the same tag; "#Kitchen" is another one. The key is the cleaned name, lowercased (`toLowerCase()`, no locale). The first spelling saved is the one shown; renaming changes it (_Claude's call_).
- **A tag can exist with no items.** The owner creates it in the Tags view, then ticks items. An empty tag stays in the owner's Tags view and is never sent to gifters.
- **Deleting a tag** removes it from every item, after a confirmation ("Remove Kitchen from 3 items?"). It never deletes items. Deleting an item leaves its tags in place, possibly empty.
- **Renaming to a name the list already uses** (by key) is refused with `409 TAG_NAME_TAKEN`; tags are never silently merged (_Claude's call_). Renaming to a different spelling of the same key ("kitchen" → "Kitchen") is allowed.

### Price filter (§2, new)

- **Readable price** (_Claude's call_, with Ted's agreement to parse rather than store): `priceText` is readable when, after trimming, it is a currency prefix followed by a number and nothing else. The prefix is optional letters followed by exactly one currency symbol (`\p{Sc}`), as `Intl.NumberFormat('en-US')` writes it: `$24.99`, `£30.00`, `€12.50`, `CA$20.00`, `¥1,200`. The number has optional comma thousands separators and an optional decimal part. Everything else is unreadable: `about £30`, `$20–30`, `varies`, `30`, `30 USD`, blank. The parser lives in `packages/contracts` beside `PriceTextSchema`, returning `{ currency, amount } | null`, where `currency` is the prefix as written.
- **The list's currency** is the prefix used by the most readable prices on the list. A tie goes to whichever of the tied prefixes appears first in list order. Items priced in any other currency count as unreadable for filtering.
- **Only dollar-scale currencies get a price filter** (_Ted_, 2026-10-21, after the builder check): the price pill appears only when the list's currency is one of `$`, `US$`, `CA$`, `A$`, `NZ$`, `£` or `€`. The bands are fixed amounts, so on a yen, won or rupee list nearly everything would land in "100+", a misleading filter. Such lists, and lists whose prices have no currency symbol (`CHF 1,234.50`), get no price pill; tag chips work as usual. Scaling bands per currency is out of scope.
- **Bands** (_Claude's call_): Under 25, 25–50, 50–100, 100+, labelled with the list's prefix ("Under $25", "$25–50"). Each band includes its lower bound and excludes its upper one, so $25.00 is in 25–50 and $50.00 is in 50–100.
- **Bands are multi-select** (_Ted_). Selected bands combine with OR. The pill's label joins neighbouring bands ("$25–100") and separates the others with a middle dot ("Under $25 · $100+"). Non-adjacent selections are allowed.
- **While any band is on, items without a readable price in the list's currency are hidden** (_Ted_).

### Filtering on the share page

- **Combination:** an item is shown when it has **every** selected tag **and**, if any band is selected, its price falls in **one** of the selected bands.
- **Tag counts:** each tag chip shows how many items would be shown with that chip on, given the other selections. So a selected chip shows the current number shown (_Ted_ agreed to live counts). Note: the first mockup drew a selected chip with a count larger than the shown total; the rule here supersedes it.
- **Band counts** (in the price menu): each band shows how many items match the selected tags and fall in that band. "Any price" shows how many match the selected tags, readable price or not.
- **A count of 0** dims and disables an unselected chip or band. It stays in its place (_Claude's call_).
- **Order:** tag chips are ordered by how many of the list's items carry them (descending), ties by name with one `Intl.Collator('en')`, so the server render and the browser agree. The order is computed from the whole list, not the filtered view, so it never reshuffles while filtering (_Claude's call_).
- **"N of M items" and "Clear filters"** appear below the row as soon as any chip or band is on (_Ted_). "Clear filters" turns everything off. If nothing matches (which the disabled chips should prevent, but a claim refresh could cause), the list area says so, with a Clear filters link.
- **Claims are unaffected.** Fully claimed items still show and still count, as today. Filtering survives claiming an item, including the `router.refresh()` after a claim.
- **The owner on their own share link** gets the same row.
- **When the row appears:** the price pill appears when at least one item has a readable price and the list's currency is on the dollar-scale list above; tag chips appear for tags on at least one item. With neither, there's no row at all.

## 4. What people see

### Share page (`/s/[shareToken]`): the filter row

This follows the approved mockup (option A, "charcoal when active"), drawn on the existing share page.

- **Placement:** a single horizontally scrollable row directly below the title and the intro line, above the first card, inside the page's 680px column. It bleeds to the column's edges on phones (scroll, no wrap). The scrollbar is hidden; the row must still be reachable and scrollable by keyboard.
- **Order in the row:** the price pill first, then the tag chips.
- **Styling (_Ted_):** off, a parchment pill (`--placeholder`, `#efe6d8`, with a slightly darker warm border). On, espresso fill (`--foreground`) with sand text (`--background`). Never terracotta. The count is a small, muted, tabular number after the name (`Kitchen 4`); on an active pill it's a lighter warm grey. The price pill is outlined (transparent, `--input` border) while it reads "Any price", and fills like any active pill once a band is chosen. Pills are full-round, at least 40px tall, with 44px hit areas (WCAG 2.2 target size).
- **Price pill:** reads "Any price ▾" when no band is selected and otherwise shows the joined band label. It opens a small menu (option B of the price mockup) titled "Price": "Any price" (clears the bands), then the four bands, each a toggle with its count. The menu stays open while toggling, and closes on Escape, an outside tap or the pill.
- **Accessibility:** chips are toggle buttons (`aria-pressed`), named like "Kitchen gadgets, 4 items". The row is a labelled group ("Filter the list"). The "N of M items" line is a polite live region. The price menu is a disclosure or menu with each band as a checkbox-style option (`menuitemcheckbox` or equivalent), and focus returns to the pill when it closes.
- **Without JavaScript** the page stays readable, as it is today (§7): the row is in the server HTML (so nothing shifts when JavaScript loads) and is hidden by CSS under `@media (scripting: none)`, and every item shows.
- **Reduced motion:** no transitions, as everywhere.

### Item form: the tag field

- `ItemFields` (shared by the add and edit forms) gains a **Tags** field after Note. It shows the item's tags as removable chips (each with a labelled remove button) followed by a text input.
- Typing suggests the list's existing tags that start with or contain the text (case-insensitive), excluding ones already on the item. Enter or a comma adds the typed text or the highlighted suggestion; Backspace in an empty input focuses the last chip's remove button rather than deleting silently. Accessible as a combobox with a listbox of suggestions (WCAG 2.2 AA).
- A typed name that matches an existing tag's key becomes that tag (shown in its existing spelling). A new name becomes a new tag when the item is saved.
- Field errors (too long, invisible characters, more than 10) follow the existing field-error pattern (`form-errors.ts`, `showFieldErrors`).

### Editor (`/list`): the Tags view

This follows the approved batch mockup (option B, "pick a tag, then its items").

- A **Tags** link near the top of the editor, shown once the list has an item. It opens a view listing every tag on the list, with its item count, alphabetically (_Claude's call_: alphabetical for finding, unlike the gifter's most-used order), plus **New tag**.
- **Tapping a tag** shows its name, its count, **Rename** and **Delete**, and every item on the list in list order, each with a checkbox. Ticking puts the tag on that item; unticking takes it off. Each tick is saved on its own, at once.
- **New tag** asks for a name, creates the tag, and opens it on its item checklist. Entering a name the list already has opens that tag instead.
- **Rename** edits the name in place; `409 TAG_NAME_TAKEN` shows "You already have a tag called that." (copy in `messages.ts`). **Delete** confirms with the count, as above.
- The mockup draws this as a bottom sheet over the editor, like the claim sheet. Whether it's a Radix Dialog sheet or its own route (`/list/tags`) is the builder's call; it must work with Back, the keyboard and a screen reader, and it must use the editor's one TanStack Query cache and mutation queue.

## 5. Data model (§4)

Approved by Ted, 2026-10-21.

```
tags
  id          uuid primary key
  wishlist_id uuid not null references wishlists(id) on delete cascade
  name        text not null            -- as shown
  name_key    text not null            -- cleaned, lowercased
  created_at, updated_at               -- the shared timestamps()
  unique (wishlist_id, name_key)

item_tags
  item_id uuid not null references items(id) on delete cascade
  tag_id  uuid not null references tags(id)  on delete cascade
  primary key (item_id, tag_id)
  index on (tag_id)
```

- **Why tables, not a `text[]` on `items`:** rename is one row; a tag can exist with no items; and the unique `(wishlist_id, name_key)` enforces case-insensitive identity in the database.
- **The migration only adds tables**, so it runs safely alongside the API that's already deployed (expand/contract). It must pass squawk.
- An item and its tag must belong to the same list. The API guarantees this (both looked up through the session's list); a composite foreign key is not required.

## 6. API (§5)

Approved by Ted, 2026-10-21. Tags are referenced by **id**; names travel only when creating, renaming, or saving an item.

### Reads

- `GET /wishlist` gains `tags: [{ id, name }]` (every tag on the list, including empty ones) and each item gains `tagIds: uuid[]`.
- `GET /shared/:shareToken` gains `tags: [{ id, name }]` with **only tags on at least one item**, and each item gains `tagIds`.
- Both are read inside the existing single `REPEATABLE READ, READ ONLY` transaction, so tags always agree with the items beside them.
- `GET /claims/:manageToken`'s `item` does **not** carry `tagIds` (the manage page doesn't use them; omit them in the contract as `remaining` and `claims` are omitted today).
- These are fields added to existing responses, so the contracts declare them **optional** (as for `showClaimsToOwner`, §5), and the web treats absent as empty.

### Item writes

- `POST /wishlist/items` and `PATCH /wishlist/items/:id` accept `tags?: Array<{ id: uuid } | { name: string }>` (at most 10 entries). An existing tag is sent **by id**; only a tag the owner typed new is sent by name, validated as in §3 (_Ted_, 2026-10-21, after the builder check). On `PATCH`, `tags` replaces the item's set; absent leaves it alone.
- **Why ids:** an edit form left open while the owner renames or deletes a tag in the Tags view (in another tab, or in the same one, since the form is inline) must not recreate the deleted tag or fork the renamed one when saved. With names only, it would.
- Inside the existing wishlist-row lock, the server resolves the entries: an id that isn't one of this list's tags (deleted meanwhile, or from another list) is **dropped silently**, not an error; a name is found by key or created, enforcing the 50-tag cap (`422 TAG_LIMIT_REACHED`). Entries that resolve to the same tag collapse to one.
- The web form tracks tags by id and sends `tags` only when the owner changed the set, so a save that didn't touch tags never undoes ticks made in the Tags view. A save that did change them still replaces the whole set; that's accepted.
- Item write responses carry `tagIds`, plus `tags: [{ id, name }]` for that item's tags, so the editor's cache can learn tags the save created without a refetch (_Claude's call_).

### Tag endpoints

All require a session and a verified email, derive the list from the session, and lock the owner's `wishlists` row `FOR UPDATE` first (§5's rule; lock order users → wishlists → items is kept). A tag or item id from another list is `404 NOT_FOUND`, the same as an unknown one.

| Method & path | Body | Result |
|---|---|---|
| `POST /wishlist/tags` | `{ name }` | `201 { id, name }`; if the key already exists, `200` with the existing tag. `422 TAG_LIMIT_REACHED` at 50 |
| `PATCH /wishlist/tags/:id` | `{ name }` | `200 { id, name }`, or `409 TAG_NAME_TAKEN` |
| `DELETE /wishlist/tags/:id` | none | `204` (cascades `item_tags`) |
| `PUT /wishlist/tags/:id/items/:itemId` | none | `204`, idempotent. `422 ITEM_TAG_LIMIT_REACHED` when the item already has 10 others |
| `DELETE /wishlist/tags/:id/items/:itemId` | none | `204`, idempotent |

- New error codes (`TAG_NAME_TAKEN`, `TAG_LIMIT_REACHED`, `ITEM_TAG_LIMIT_REACHED`) go in `packages/contracts`, with copy in `apps/web/src/lib/messages.ts`.
- Bodies validate per parameter with `ZodValidationPipe` (`400 VALIDATION_FAILED`). Problem `detail` never echoes the submitted name; logs never contain it.
- Bodiless `PUT`/`DELETE` still send the JSON content type the CSRF guard requires (Plan 4b carry).
- No new token-bearing routes, so `redactTokens` is unchanged.

## 7. Web structure

- **Share page:** the filter row and the filtered list are one client island, so filtering never touches the server render or the claim flow. The owner's own view doesn't render `ShareClaimsProvider` (`share-page.tsx`), so the island is rendered in both branches (as the provider's children for a gifter, bare for the owner) and the owner gets the same row. The cards (`ItemCardBody`) are unchanged. Filtering logic (combination, counts, band joining, the list's currency) is pure functions in `apps/web/src/lib/`, unit-tested; any copy built from counts goes in `lib/share-copy.ts`.
- **Editor:** every tag change (tick, untick, create, rename, delete, and item saves carrying tags) is a mutation in `lib/list-mutations.ts`, run through `useListMutations()` in the one scope, so changes reach the API in order. Ticks update the cache at once (like reorder and delete); a failure marks the list stale and it's refetched when the queue drains, as today.
- **Hiding cached claims** (`hideCachedClaims()`) must keep working with the new fields; tags aren't claim data and aren't stripped.

## 8. Testing

- **Contracts (unit):** the tag name schema (clean-up, `#`, length, visible text, blank), key derivation, and the price parser, with a table of readable and unreadable examples drawn from §3.
- **API (integration, test-first):** create/find-or-create, rename (including case-only and `409`), delete cascade, tick/untick idempotence, both caps, cross-list ids → `404`, item create/update with `tags`, `GET /shared` omitting empty tags, `GET /claims` omitting `tagIds`, and that an account deletion still cascades cleanly. State-changing requests go through `test/support/client.ts`.
- **Web (unit):** filter combination, counts, zero-dimming, band label joining, majority currency and its tie-break, ordering stability.
- **E2E (Playwright):** a gifter filters by two tags and a band, sees "N of M items", clears; an owner adds tags in the item form and tags several items from the Tags view, then sees the chips on their share link.

## 9. Delivery

Two stacked plans, as the repo has done for each feature (_Claude's call_):

- **Plan 7a, tags API:** contracts (tag schemas, error codes, response fields), the migration, the endpoints, integration tests. Ships dark: no web change, and the optional fields are ignored by today's web.
- **Plan 7b, tags web:** the price parser and filter logic, the share-page row, the item form's tag field, the Tags view, E2E, and the main spec and roadmap updates (decisions from D58: tags as tables referenced by id; prices parsed from text for filtering; plain-label tags; charcoal active pills; multi-select bands).

Mockups were approved in conversation for the filter row's active tone, the price pill's menu and the tag-first batch view. Plan 7b starts with a mockup of the item form's tag field and the Tags view at phone width, and **stops for Ted's approval** before any form or Tags view work, as Plans 3b and 4b did (_Claude's call_).

## 10. Left to the builder

- The exact regex for readable prices, as long as it accepts and refuses the §3 examples.
- Sheet vs route for the Tags view (§4).
- Component structure, the suggestion-matching details, and how the price menu is built (Radix or hand-rolled), within the accessibility requirements above.
- Exact copy beyond what's quoted here, in the existing voice.
