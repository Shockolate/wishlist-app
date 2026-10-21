# Plan 7a — Tags API (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API behind item tags. It covers:

- the `tags` and `item_tags` tables;
- tags in `GET /wishlist` and `GET /shared`;
- tags on item create and update, by id for existing tags and by name for new ones;
- the tag-first endpoints the editor's Tags view will use: create, rename, delete, tick and untick.

It ships dark. No web code uses any of it until Plan 7b.

**Architecture:**

- **Contracts:** a new `packages/contracts/src/tags.ts` holds the tag name rule, the key, the limits and the tag schemas. `wishlist.ts` imports it, never the reverse, so `ItemSchema` and the item requests can use it.
- **API:** a `TagsService` and `TagsController` in `apps/api/src/wishlist/`, plus `tag-queries.ts`, which holds the reads and the item-tag resolution that `ItemsService` shares.
- **Locking:** every tag write takes the owner's wishlist row lock first, as every list change does today. That serializes the 50-tag cap and the find-or-create by key.
- **Reads:** tags are read inside the existing `SNAPSHOT` transactions.

**Amended before merge (Ted, 2026-10-21):** a leading `#` is now kept as typed, so it is part of the key and "#books" and "books" are two tags. Where this plan says clean-up drops one leading `#`, design §3 and the code win.

**Tech Stack:** NestJS 12, Drizzle with `pg`, Zod 4, Vitest, Testcontainers. **No new dependencies.**

**Spec:**

- [docs/superpowers/specs/2026-10-21-item-tags-and-filters-design.md](../specs/2026-10-21-item-tags-and-filters-design.md) (approved 2026-10-21): §3 Tags, §5, §6 and §8 (API and contracts rows).
- It amends [the main spec](../specs/2026-10-07-wishlist-app-design.md), which Task 6 updates for what this plan ships.
- This plan builds on the owner API from [Plan 3a](2026-10-12-plan-3a-owner-api.md) and the share read from [Plan 4a](2026-10-14-plan-4a-claims-api.md).

## Global Constraints

**Carried over.** Everything in [AGENTS.md](../../../AGENTS.md) still applies. In particular:

- **Toolchain:** Node `>=24.15`, pnpm `12.10.1`, ESM. Relative imports in `api` and `contracts` end in `.js`. `import type` for types.
- **Dependencies:** exact version pins. **No new dependencies.**
- **Nest DI:** an explicit `@Inject(…)` on every constructor parameter, classes included.
- **Errors:** every error is problem+json with a stable `code`. A `detail` never echoes what the caller sent, and so never contains a tag name. Logs never contain a tag name either.
- **Tests:** state-changing test requests go through `test/support/client.ts`. Behavior changes are written test-first.
- **Migrations:** this one only adds tables (expand). It must pass `squawk-cli@2.67.0` with `.squawk.toml`.
- **Commits:** every commit ends with `Co-Authored-By:` naming the model that actually wrote it. Replace `<model>` in the commit steps, e.g. `Claude Opus 5.5 <noreply@anthropic.com>`.

**Dark.** No file under `apps/web` changes. The web must still typecheck, build and pass its tests with the new contracts. Every new response field is optional, so that holds. No environment variable, secret or Vercel setting changes.

**Lock order.** The order stays users → wishlists → items:

- Every tag write, and every item write that carries `tags`, locks the owner's `wishlists` row with `lockOwnWishlist` before touching `tags` or `item_tags`.
- Nothing here locks an `items` row. Inserting into `item_tags` takes a `FOR KEY SHARE` lock on the item through its foreign key, so it waits behind a claim's `FOR UPDATE`. A claim never locks the wishlist, so the two can't deadlock (Review Focus 4).

**Reads.** `GET /wishlist` and `GET /shared` read tags inside their existing `db.transaction(…, SNAPSHOT)`.

**Values fixed by this plan (from design §3, §6):**

| Thing | Value |
|---|---|
| Tag name clean-up | Collapse every whitespace run (`/\s+/gu`) to one space, trim, drop one leading `#`, trim again |
| Tag name rule | After clean-up: 1–30 UTF-16 units, and `visibleOnly` (D35, D41/D44) with `VISIBLE_ONLY_MESSAGE` |
| Tag key | `tagKey(name) = cleanTagName(name).toLowerCase()` (no locale) |
| Limits | `MAX_TAGS_PER_ITEM = 10`, `MAX_TAGS_PER_LIST = 50` |
| Item `tags` entry | `{ id: uuid }` or `{ name: TagName }`, each a strict object; at most 10 entries |
| Tag order in responses | `name_key` ascending, then `id`. An item's `tagIds` are in the same order |
| New error codes | `TAG_NAME_TAKEN` (409), `TAG_LIMIT_REACHED` (422), `ITEM_TAG_LIMIT_REACHED` (422) |
| Details (never echo input) | `'That tag no longer exists.'` (404 `NOT_FOUND`), `'You already have a tag with that name.'`, `'A list holds at most 50 tags.'`, `'An item holds at most 10 tags.'` |
| Migration | `0004_tags.sql`, the `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '30s'` lines first, as in every migration |
| Cache | Every new route sends `Cache-Control: no-store`, as the item routes do |

## Rulings this plan makes on gaps in the design

1. **Item write responses** use a new `ItemWriteResponseSchema = ItemSchema.extend({ tags: z.array(TagSchema).optional() })`. The API always sends both `tagIds` and `tags` on a create or an update, including when they are empty. `ItemSchema` itself gains only `tagIds`, so `GET /wishlist` doesn't repeat tag names per item.
2. **`GET /claims/:manageToken`'s item** omits `tagIds` in the contract, and its query never selects them. The existing key-list test in `claims.spec.ts` must keep passing unchanged.
3. **A failed item write rolls back entirely.** On an item create that hits `TAG_LIMIT_REACHED`, no item is created.
4. **`PATCH` with `tags: []`** clears the item's tags. A `PATCH` without `tags` leaves them alone, and the response still carries the current `tagIds` and `tags`.
5. **Tick and untick 404s.** `PUT` and `DELETE /wishlist/tags/:id/items/:itemId` answer `404 NOT_FOUND` when the tag or the item isn't on the session's list, or when either id is malformed. The tag is checked first. Untick on an existing pair that isn't linked answers `204`.
6. **`POST /wishlist/tags` on an existing key** returns `200` with the tag as stored. It is not renamed to the new spelling. The controller sets the status with `@Res({ passthrough: true })`, as `session.controller.ts` does.
7. **Spec amendments.** The design (§9) says 7b updates the main spec. This plan updates §2, §4 and §5 for what it ships and logs D58–D60. 7b logs the web decisions from D61.

## Review Focus

These are the input classes most likely to bite a real person, most likely first. Each has a test in the task named.

1. **A stale edit form is saved after its tag was deleted or renamed in the Tags view.** A deleted tag's id is dropped. The tag isn't recreated, and no copy of a renamed tag is made. Task 4.
2. **The owner retypes an existing tag differently** ("  #KITCHEN ", "kitchen  ", "Kitchen\tgadgets"). It joins the existing tag, which keeps its spelling. No duplicate is made, no `409`. Tasks 1 and 4.
3. **One save names the same tag twice,** once by id and once by name, or by two spellings. The item gets one link. Task 4.
4. **The owner ticks an item in the Tags view while a gifter is claiming it.** The tick waits for the claim's row lock and then lands: `204`, never a deadlock or a 500. Task 5.
5. **The owner deletes the account, or an item, that has tags.** Everything cascades with no foreign-key error, and a later tick on the deleted item is a `404`. Tasks 2 and 5.

## Stacks and order

One new stack. Each layer is one reviewable concern, and there are five, well under Neon's preview cap.

| Layer (branch) | Tasks |
|---|---|
| `docs/plan-7a` | the design doc, this plan, the roadmap rows (Task 0) |
| `api/tags-model` | 1, 2 |
| `api/tags-reads` | 3 |
| `api/item-tags` | 4 |
| `api/tag-endpoints` | 5, 6 |

Task 7 is a ⏸ checkpoint for the final review, Ted's approval of the first submit, his merge, and verifying production.

Each layer's first task starts with `gh stack add <branch>`, except Task 0, which runs `gh stack init docs/plan-7a`. Nothing is pushed before Task 7.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/tags.ts` (new) | `cleanTagName`, `tagKey`, `TagNameSchema`, limits, `TagSchema`, `ItemTagRefSchema`, tag request schemas |
| `packages/contracts/src/tags.spec.ts` (new) | Name rule and key tests |
| `packages/contracts/src/wishlist.ts` | `tagIds` on `ItemSchema`; `tags` on item requests and on `WishlistResponseSchema`; `ItemWriteResponseSchema` |
| `packages/contracts/src/claims.ts` | `tags` on `SharedWishlistResponseSchema`; `ClaimDetailsResponseSchema` omits `tagIds` |
| `packages/contracts/src/error-codes.ts`, `index.ts` | The three codes; export `tags.js` |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/0004_tags.sql` | The tables |
| `apps/api/src/wishlist/tag-queries.ts` (new) | `readTags`, `readTagIdsByItem`, `resolveTagRefs`, `setItemTags`, `itemTags` |
| `apps/api/src/wishlist/tags.service.ts`, `tags.controller.ts` (new) | The five tag routes |
| `apps/api/src/wishlist/wishlist-errors.ts` | `tagNotFound`, `tagNameTaken`, `tagLimitReached`, `itemTagLimitReached` |
| `apps/api/src/wishlist/items.service.ts`, `items.controller.ts` | `tags` on create and update; write responses |
| `apps/api/src/wishlist/wishlist.service.ts`, `claims/shared-list.service.ts` | Tags in the two reads |
| `apps/api/src/wishlist/wishlist.module.ts` | Registers the tag controller and service |
| `apps/api/test/support/lists.ts` | `seedTag`, `linkTag` |
| `apps/api/test/tags-schema.int-spec.ts`, `tags.int-spec.ts`, `item-tags.int-spec.ts` (new) | Integration tests |
| `apps/api/test/wishlist.int-spec.ts`, `shared.int-spec.ts`, `manage-claims.int-spec.ts` | Read assertions |

## How to run things

```bash
source ~/.nvm/nvm.sh && nvm use                                            # Node 24
pnpm --filter @wishlist/contracts test                                     # contracts unit tests
pnpm --filter @wishlist/contracts build                                    # before API tests, after a contracts change
pnpm --filter @wishlist/api exec vitest run --project integration <name>   # one integration file (Docker)
```

The full gate, run at the end of every layer:

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm --filter @wishlist/api test:integration
```

---

### Task 0: Start the stack with the design and this plan

**Files:**

- Add: `docs/superpowers/specs/2026-10-21-item-tags-and-filters-design.md`, this plan
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (two rows after 6)

- [ ] **Step 1:** `gh stack init docs/plan-7a`.
- [ ] **Step 2:** Add the roadmap rows:
  - **7a** | Tags API | design §3, §5, §6 | `tags`/`item_tags`; tags in both reads; tags on item writes by id or name; the five tag routes. Ships dark | Planned
  - **7b** | Tags web | design §3, §4, §7 | price parser; the share page's filter row; the item form's tag field; the Tags view; E2E | Planned
- [ ] **Step 3:** `pnpm format:check` passes. Commit `docs: design and plan 7a for item tags`.

### Task 1: The tag contracts

**Files:**

- Create: `packages/contracts/src/tags.ts`, `packages/contracts/src/tags.spec.ts`
- Modify: `packages/contracts/src/wishlist.ts`, `claims.ts`, `error-codes.ts`, `index.ts`, `wishlist.spec.ts`, `claims.spec.ts`

**Interfaces (Produces):**

```ts
// tags.ts
export const MAX_TAGS_PER_ITEM = 10;
export const MAX_TAGS_PER_LIST = 50;
export function cleanTagName(raw: string): string;
export function tagKey(raw: string): string;             // cleanTagName(raw).toLowerCase()
export const TagNameSchema: z.ZodType<string, string>;   // cleans, then 1–30 + visibleOnly
export const TagSchema = z.object({ id: z.uuid(), name: z.string() });
export type Tag = z.infer<typeof TagSchema>;
export const ItemTagRefSchema;  // z.union([z.strictObject({ id: z.uuid() }), z.strictObject({ name: TagNameSchema })])
export type ItemTagRef = z.infer<typeof ItemTagRefSchema>;
export const ItemTagsSchema;    // z.array(ItemTagRefSchema).max(MAX_TAGS_PER_ITEM)
export const CreateTagRequestSchema = z.object({ name: TagNameSchema });
export const RenameTagRequestSchema = CreateTagRequestSchema;
export type CreateTagRequest, RenameTagRequest;
// wishlist.ts
ItemSchema gains        tagIds: z.array(z.uuid()).optional()
Create/UpdateItemRequestSchema gain  tags: ItemTagsSchema.optional()
WishlistResponseSchema gains  tags: z.array(TagSchema).optional()
export const ItemWriteResponseSchema = ItemSchema.extend({ tags: z.array(TagSchema).optional() });
export type ItemWriteResponse;
// claims.ts
SharedWishlistResponseSchema gains  tags: z.array(TagSchema).optional()
ClaimDetailsResponseSchema.item = SharedItemSchema.omit({ remaining: true, claims: true, tagIds: true })
// error-codes.ts
TAG_NAME_TAKEN, TAG_LIMIT_REACHED, ITEM_TAG_LIMIT_REACHED (each with a one-line doc comment, as the others have)
```

- [ ] **Step 1: Write the failing tests** in `tags.spec.ts`:
  - `cleanTagName`: `'  #Kitchen  '` → `'Kitchen'`, `'Kitchen\t \ngadgets'` → `'Kitchen gadgets'`, `'# books'` → `'books'`, `'##x'` → `'#x'` (only one `#` dropped), `'C#'` → `'C#'`.
  - `tagKey('  #KITCHEN ')` equals `tagKey('kitchen')`, which is `'kitchen'`.
  - `TagNameSchema.parse(' #Kitchen gadgets ')` → `'Kitchen gadgets'`. It keeps `'🎄 Christmas'`, a ZWJ emoji sequence `'👩‍🍳'`, and Persian with U+200C.
  - `TagNameSchema` refuses with exactly one issue each:
    - `'#'` and `'   '` (empty after clean-up);
    - `'a'.repeat(31)`;
    - `'a‮b'` (`VISIBLE_ONLY_MESSAGE`);
    - `'ㅤ'` (blank letter).
  - It accepts `'a'.repeat(30)`.
  - `ItemTagsSchema` accepts `[{ id: UUID }, { name: 'Books' }]`. It refuses `[{ id: UUID, name: 'x' }]` (strict), `[{ id: 'nope' }]`, and 11 entries.
- [ ] **Step 2: Add to `wishlist.spec.ts` and `claims.spec.ts`:**
  - `UpdateItemRequestSchema.parse({ tags: [] })` → `{ tags: [] }`, and `.parse({})` has no `tags` key.
  - `ItemSchema` parses an item without `tagIds`.
  - `ClaimDetailsResponseSchema` strips a `tagIds` sent on `item`. The existing key-list test stays as is and still passes.
- [ ] **Step 3:** Run `pnpm --filter @wishlist/contracts test`. Expected: FAIL, because `tags.js` doesn't exist.
- [ ] **Step 4: Implement as in Interfaces.**
  - `TagNameSchema` is `z.string().transform(cleanTagName).pipe(z.string().min(1).max(30).refine(visibleOnly, VISIBLE_ONLY_MESSAGE))`. That way a whitespace-only or `#`-only name fails `min(1)` once and doesn't also fail the visibility check.
  - `tags.ts` imports only `zod` and `./text.js`.
- [ ] **Step 5:** Run `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`. Expected: PASS. Then `pnpm --filter @wishlist/web typecheck`: PASS, which proves the web is unaffected.

### Task 2: The tables

**Files:**

- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0004_tags.sql` (generated), `apps/api/test/tags-schema.int-spec.ts`
- Modify: `apps/api/test/support/lists.ts` (`truncateAll` already finds every public table, so it needs no change)

**Interfaces (Produces):**

- `tags` (`id`, `wishlistId`, `name`, `nameKey`, `...timestamps()`), with `unique('tags_wishlist_id_name_key_unique').on(t.wishlistId, t.nameKey)`.
- `itemTags` (`itemId`, `tagId`), with `primaryKey({ columns: [t.itemId, t.tagId] })` and `index('item_tags_tag_id_idx').on(t.tagId)`.
- Both foreign keys use `onDelete: 'cascade'`. Each table gets a doc comment in the file's style, citing design §5.
- Test helpers:
  - `seedTag(db, email, name): Promise<string>` inserts with `name_key = lower(name)`;
  - `linkTag(db, itemId, tagId): Promise<void>`.

- [ ] **Step 1: Write `tags-schema.int-spec.ts`,** in the style of `items-schema.int-spec.ts`:
  - a second tag with the same `(wishlist_id, name_key)` is rejected (`/tags_wishlist_id_name_key_unique/`), while the same key on another list is accepted;
  - a duplicate `(item_id, tag_id)` is rejected;
  - deleting an item removes its `item_tags` rows and keeps the tag;
  - deleting a tag removes its `item_tags` rows and keeps the item;
  - deleting the user leaves 0 rows in `tags` and `item_tags` (Review Focus 5).
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run --project integration tags-schema`. Expected: FAIL, because the tables don't exist yet.
- [ ] **Step 3:** Add the tables, run `pnpm --filter @wishlist/api db:generate --name tags`, and prepend the two `SET LOCAL` lines.
  - Review the SQL. Expect two `CREATE TABLE`s, three FK `ALTER TABLE`s, the unique constraint, the composite primary key and one index.
  - Run `npx --yes squawk-cli@2.67.0 apps/api/drizzle/0004_tags.sql`. Expected: no violations, as for `0003_claims.sql`. Report the output.
- [ ] **Step 4:** Rerun Step 2's command. Expected: PASS.
- [ ] **Step 5:** `gh stack add api/tags-model` first if you haven't. Run the full gate. Commit `feat(api): add the tags and item_tags tables and their contracts`.

### Task 3: Tags in the two reads

**Files:**

- Create: `apps/api/src/wishlist/tag-queries.ts`
- Modify: `apps/api/src/wishlist/wishlist.service.ts`, `apps/api/src/claims/shared-list.service.ts`
- Test: `apps/api/test/wishlist.int-spec.ts`, `shared.int-spec.ts`, `manage-claims.int-spec.ts`

**Interfaces (Produces):**

```ts
export function readTags(tx: Transaction, wishlistId: string, opts: { usedOnly: boolean }): Promise<Tag[]>;
export function readTagIdsByItem(tx: Transaction, wishlistId: string): Promise<Map<string, string[]>>;
```

Both order by `name_key`, then `id`. `usedOnly` keeps only tags with at least one `item_tags` row, via `exists`. Each service adds `tagIds: map.get(row.id) ?? []` to its rows **before** `projectWishlist`, and `tags` to its envelope.

- [ ] **Step 1: Write the failing tests:**
  - `GET /wishlist` returns every tag (seed "Kitchen" on an item, plus an empty "Garden") as `tags: [{id, name:'Garden'}, {id, name:'Kitchen'}]`. The tagged item has `tagIds: [kitchenId]` and an untagged item has `tagIds: []`.
  - `GET /shared/:token`, as a guest and as the owner, returns `tags` without "Garden", with the same `tagIds`.
  - `GET /claims/:manageToken`'s `item` has no `tagIds` key.
- [ ] **Step 2:** Run the three files. Expected: FAIL on the new tests only.
- [ ] **Step 3:** Implement as in Interfaces.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS.
- [ ] **Step 5:** `gh stack add api/tags-reads`. Run the full gate. Commit `feat(api): return tags with the owner's list and the share read`.

### Task 4: Tags on item create and update

**Files:**

- Modify: `apps/api/src/wishlist/tag-queries.ts`, `items.service.ts`, `items.controller.ts`, `wishlist-errors.ts`
- Create: `apps/api/test/item-tags.int-spec.ts`

**Interfaces:**

- Consumes: `ItemTagRef`, `tagKey`, `MAX_TAGS_PER_LIST` and `ItemWriteResponse` from Task 1; `readTags` from Task 3.
- Produces:

```ts
// tag-queries.ts. Each must run inside a transaction that holds lockOwnWishlist.
export function resolveTagRefs(tx: Transaction, wishlistId: string, refs: ItemTagRef[], now: Date): Promise<string[]>;
export function setItemTags(tx: Transaction, itemId: string, tagIds: string[]): Promise<void>;
export function itemTags(tx: Transaction, itemId: string): Promise<Tag[]>;
// wishlist-errors.ts
export const tagLimitReached: () => AppError;      // 422 TAG_LIMIT_REACHED
// ItemsService.create/update now return Promise<ItemWriteResponse>
```

**How `resolveTagRefs` works:**

1. Load the list's tags once.
2. Walk the refs in order:
   - an `id` that's on the list is kept; any other `id` is **dropped silently** (design §6);
   - a `name` is matched by `tagKey` against the loaded tags plus those created in this call, and otherwise inserted with `newId()`;
   - an insert that would take the list past `MAX_TAGS_PER_LIST` throws `tagLimitReached()`.
3. Return the ids, deduplicated, in first-seen order.

`setItemTags` deletes the item's rows, then inserts the new set. Both statements are skipped when `tagIds` is empty, except the delete.

- **Create:** resolve and set after inserting the item.
- **Update:** do the same only when `input.tags !== undefined`.
- **Response:** both read `itemTags` and respond with `{ ...item, tagIds, tags }`.

- [ ] **Step 1: Write `item-tags.int-spec.ts`** (each test is one `it`):
  - Create with `tags: [{ name: 'Kitchen' }]` → `201`, `tags: [{ id, name: 'Kitchen' }]`, and `tagIds: [id]`. `GET /wishlist` now lists the tag.
  - Create without `tags` → `tagIds: []`, `tags: []`.
  - **RF2:** with "Kitchen" existing, create with `{ name: '  #KITCHEN ' }`. The response uses the existing id with name `'Kitchen'`, and the `tags` table holds 1 row.
  - **RF3:** `tags: [{ id: kitchenId }, { name: 'kitchen' }, { name: 'Kitchen ' }]` makes one link.
  - **RF1:** with "Kitchen" deleted straight from the database, `PATCH` with `tags: [{ id: deletedId }, { name: 'Books' }]` → `200`, and the item's tags are just "Books". The `tags` table has no "Kitchen".
  - **RF1:** with "Kitchen" renamed to "Cooking" in the database, `PATCH` with `tags: [{ id: kitchenId }]` keeps the item on that id, named "Cooking". The `tags` table still has 1 row.
  - An id from **another user's list** is dropped. The item doesn't gain it, and the other list is unchanged.
  - `PATCH { title: 'New' }` leaves tags alone and the response still carries them. `PATCH { tags: [] }` clears them.
  - With 50 tags seeded, create with `tags: [{ name: 'New' }]` → `422 TAG_LIMIT_REACHED`, and the item count is unchanged (ruling 3). Using an existing tag by id still works.
  - Eleven entries → `400 VALIDATION_FAILED`.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run --project integration item-tags`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Interfaces. Change the controller's return types to `ItemWriteResponse`.
- [ ] **Step 4:** Rerun Step 2, then `items` and `reorder`. Expected: PASS. The existing item tests keep passing; where a strict `toEqual` on a created item now fails only because of `tagIds` and `tags`, add those fields to the expected value. Don't weaken the assertion.
- [ ] **Step 5:** `gh stack add api/item-tags`. Run the full gate. Commit `feat(api): save an item's tags by id or by name`.

### Task 5: The tag endpoints

**Files:**

- Create: `apps/api/src/wishlist/tags.service.ts`, `tags.controller.ts`, `apps/api/test/tags.int-spec.ts`
- Modify: `apps/api/src/wishlist/wishlist-errors.ts`, `wishlist.module.ts`

**Interfaces:**

- Consumes: `lockOwnWishlist`, `tagKey`, `MAX_TAGS_PER_ITEM`, `MAX_TAGS_PER_LIST`, `tagLimitReached`, `itemNotFound`.
- Produces:

```ts
// wishlist-errors.ts
export const tagNotFound: () => AppError;          // 404 NOT_FOUND
export const tagNameTaken: () => AppError;         // 409 TAG_NAME_TAKEN
export const itemTagLimitReached: () => AppError;  // 422 ITEM_TAG_LIMIT_REACHED
// TagsService
create(ownerId: string, name: string): Promise<{ tag: Tag; created: boolean }>;
rename(ownerId: string, tagId: string, name: string): Promise<Tag>;
delete(ownerId: string, tagId: string): Promise<void>;
tick(ownerId: string, tagId: string, itemId: string): Promise<void>;
untick(ownerId: string, tagId: string, itemId: string): Promise<void>;
```

**Routes** live in `@Controller('wishlist/tags')` with `@UseGuards(SessionGuard, VerifiedGuard)`:

| Route | Body | Answers |
|---|---|---|
| `POST /` | `CreateTagRequestSchema` | `201`, or `200` for an existing key (ruling 6) |
| `PATCH /:id` | `RenameTagRequestSchema` | `200` |
| `DELETE /:id` | none | `204` |
| `PUT /:id/items/:itemId` | none | `204` |
| `DELETE /:id/items/:itemId` | none | `204` |

**Service rules:**

- Each method is one transaction that starts with `lockOwnWishlist`.
- A malformed uuid is refused before the database is asked, using `ItemIdSchema`'s pattern.
- Rename conflicts only when another tag on the list has the same key. A case-only rename of the tag itself updates `name` and `name_key`.
- Tick:
  1. Check the tag, then the item (ruling 5).
  2. If the pair is already linked, return.
  3. If the item already has `MAX_TAGS_PER_ITEM` links, throw `itemTagLimitReached()`.
  4. Insert with `onConflictDoNothing()`.

- [ ] **Step 1: Write `tags.int-spec.ts`:**
  - **Create:** `POST { name: ' #Kitchen ' }` → `201 { id, name: 'Kitchen' }`. Again with `'kitchen'` → `200` with the same id and name `'Kitchen'`. With 50 tags → `422 TAG_LIMIT_REACHED`.
  - **Rename:** `'Cooking'` → `200`, and `GET /wishlist` shows it. `'kitchen'` → `'Kitchen'` is allowed. Renaming to an existing other tag's key → `409 TAG_NAME_TAKEN`, and the problem's `detail` doesn't contain the sent name.
  - **Delete:** `204`. The item keeps existing, and its `tagIds` no longer contain the tag. A second delete → `404`.
  - **Tick / untick:**
    - `PUT` → `204`, and a second `PUT` → `204` with one row.
    - `DELETE` → `204`, and a second `DELETE` → `204`.
    - An 11th tag on one item → `422 ITEM_TAG_LIMIT_REACHED`.
  - **404s:** another user's tag or item, an unknown id, and a malformed id (`'nope'`) each give `404 NOT_FOUND` on all five routes where they apply. **RF5:** a tick on an item deleted a moment earlier → `404`.
  - **Auth:** no session → `401`; an unverified user → `403 EMAIL_NOT_VERIFIED`; a request without `Origin` → `403 FORBIDDEN_ORIGIN` (one route each is enough).
  - **RF4:**
    1. A separate `pg` client begins a transaction and runs `select … from items where id = $1 for update`.
    2. Start `PUT /wishlist/tags/:id/items/:itemId` without awaiting it.
    3. Wait with `untilBlockedBy(db.pool, holderPid, 1, put)` from `support/locks.ts`.
    4. Commit the holder.
    5. Expect `204` and one `item_tags` row.
- [ ] **Step 2:** Run `pnpm --filter @wishlist/api exec vitest run --project integration tags`. Expected: FAIL.
- [ ] **Step 3:** Implement and register `TagsController` and `TagsService` in `WishlistModule`.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS.
- [ ] **Step 5:** `gh stack add api/tag-endpoints`. Run the full gate. Commit `feat(api): add the tag endpoints`.

### Task 6: The docs

**Files:**

- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md` (§2 Items, §4, §5 Owner endpoints, §13)
- Modify: `AGENTS.md` (Conventions), `docs/superpowers/plans/2026-10-07-roadmap.md` (row 7a status)

- [ ] **Step 1: Main spec.**
  - **§2 Items:** add a `tags` row to the field table: "0–10 per item, by the tag rule in the tags design §3".
  - **§4:** the two tables.
  - **§5:** the five routes, plus the new fields on `GET /wishlist`, `GET /shared` and item writes, marked optional (expand/contract).
  - **§13:** log three decisions, each as `(Ted, 2026-10-21)` with its rejected alternative:
    - **D58:** tags are rows in `tags`/`item_tags`, referenced by id. Rejected: a `text[]` on `items`.
    - **D59:** tag names are shown as typed, matched case-insensitively with one leading `#` dropped, and limited to 30 characters, 10 per item and 50 per list. Rejected: hashtag-style slugs.
    - **D60:** item saves send existing tags by id and new ones by name, and a stale id is dropped. Rejected: names only, which recreates deleted tags.
  - Link the tags design from the spec's header.
- [ ] **Step 2: AGENTS.md.** Add one Conventions bullet:

  > **Tags (Plan 7a):** a tag belongs to one list and is referenced by id. Its key is `tagKey()` from `packages/contracts`, unique per list. Every tag write, and every item write carrying `tags`, takes the wishlist row lock first. Item saves send `{ id }` for existing tags and `{ name }` for new ones, and an id that isn't on the list is dropped, never recreated.

- [ ] **Step 3:** Change the roadmap's 7a status to "Done" only in the checkpoint's last step. For now leave it "Planned". Run `pnpm format:check`. Commit `docs: the tags API in the spec and AGENTS.md`.

### Task 7: ⏸ Checkpoint — review, submit, merge, verify

Nothing here is automatic. Each step waits for Ted where it says so.

- [ ] **Step 1: Final whole-branch review** of the stack from `main` against the design and this plan. Fix what it finds in the owning layer, then `gh stack rebase --upstack`.
- [ ] **Step 2: Ted approves the first submit.** It's a new stack, so ask before `gh stack submit --open`.
- [ ] **Step 3:** Give each PR a Conventional Commit title and a summary body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` (`gh pr edit <n> --title … --body-file …`).
- [ ] **Step 4:** Every layer's CI, migration lint and preview pass.
- [ ] **Step 5: Ted merges** (`gh stack merge <top PR> --squash`). The executor never merges.
- [ ] **Step 6: Verify production, read-only:**
  - The deploy run passes every job.
  - `GET https://hanker.dev/api/health` reports the merge SHA and `migrationsApplied: 5`.
  - `POST https://hanker.dev/api/wishlist/tags` with no session answers `401`.
  - An existing share link still renders on `hanker.dev`.
- [ ] **Step 7:** A follow-up PR sets the roadmap's 7a row to "Done". Then Plan 7b starts with its mockups.
