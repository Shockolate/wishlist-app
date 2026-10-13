# Plan 3b — Owner web UI (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner's half of Hanker in the browser:
- a `/list` editor, laid out as compact rows edited in place (D37);
- a link-first add box that prefills from unfurl;
- reordering by drag and by buttons;
- settings for the list's name and its share link;
- a confirmation dialog for deleting the account;
- the Plan 2b fixes that belong to these pages (D38).

It all ships dark: nobody can sign up in production until the end of Plan 4 (D31).

**Architecture:**
- **`/list` is a Server Component.** It calls `GET /wishlist` server to server and seeds a TanStack Query cache, and a client `ListEditor` takes over from there.
- **Every list change is a TanStack mutation in one scope**, so changes reach the API one at a time, in order:
  - a move and a delete update the cache at once;
  - an add and an edit wait for the API;
  - any failure refetches the list, which is the rollback.
- **The mutation definitions are plain option objects in `lib/list-mutations.ts`**, so node-only Vitest can test the queue with a real `QueryClient`, without React.
- **Pure helpers live in `lib/`** and are unit tested: the add box's link detection, the unfurl failure copy, and the cache operations. Playwright covers the pages.

**Tech Stack:**
- **New, exact, in `apps/web` only:**
  - `@tanstack/react-query@5.104.1`
  - `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` and `@dnd-kit/utilities@3.2.2`
  - `@radix-ui/react-alert-dialog@1.1.24`
- **As before:** Next.js 16.4, React 19.3, Tailwind 4.3, react-hook-form with the shared Zod schemas, Vitest and Playwright.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §2 Items, §5 Owner endpoints, §7 (Routes, Typed client, Owner editor, Reordering, UI and accessibility), §8 and §9. It was amended for this plan in `b6dda1d` (D37, D38).

The API it calls is [Plan 3a](2026-10-12-plan-3a-owner-api.md). The pages it extends are [Plan 2b](2026-10-10-plan-2b-auth-web.md)'s.

The mockups Ted chose from are on a canvas: https://claude.ai/artifact/6JbNzewTnt2fqvhPdn9vr8. The executor builds layout A: the frames "A · The list as rows", "A · Editing in place", "First visit", "Adding from a link" and "A page we couldn't read". The share-page frame is Plan 4's.

## Global Constraints

**Carried over from earlier plans.** Everything in [AGENTS.md](../../../AGENTS.md) applies:
- **Toolchain:** Node `>=24.15`, pnpm `12.10.1`, TypeScript `6.0.3`, ESLint `9.39.5`, React `19.3.0`, Next `16.4.0`, Tailwind `4.3.3`, Zod `4.6.5`, react-hook-form `7.89.0` and `@hookform/resolvers` `5.9.1`.
- **Exact version pins.**
- **Calling the API:** browser calls go through `browserApi` (the `/api` rewrite), and Server Components use `serverApi()`. Never Server Actions. Every response is validated against its `@wishlist/contracts` schema.
- **Copy:** error copy lives in `apps/web/src/lib/messages.ts`, and field-validation copy in `apps/web/src/lib/form-errors.ts`. People see **Hanker**.
- **UI pieces** are hand-copied shadcn/ui style into `apps/web/src/components/ui`, on the tokens in `globals.css`.
- **Terracotta** (`primary`) never carries text: text on it is espresso.
- **Accessibility:**
  - every touch target is at least 44 px (`min-h-11`, `size-11`);
  - focus is always visible;
  - WCAG 2.2 AA.

**New dependencies.** Exactly the five above, in `apps/web`, exact. Nothing else:
- no toast library;
- no `@dnd-kit/modifiers`;
- no jsdom or Testing Library.

Before installing, check with `npm view <pkg>@<version> time` that each is at least 3 days old, the repo's Renovate `minimumReleaseAge`. They all were on 2026-10-13.

**No API or contracts changes.** If a task seems to need one, stop and ask.

**React lint rules.** `eslint-plugin-react-hooks` 7.1.1 enforces the React Compiler rules:
- Never call `setState` synchronously inside `useEffect`.
- Never read `ref.current` during render.
- Use `useWatch`, not `watch()`, from react-hook-form.
- Read browser capabilities, such as `navigator.share`, with `useSyncExternalStore`.

**Inputs have no `maxLength`.** It silently cuts a paste; the schema's message says what's wrong instead (3a carry).

**Photos are plain `<img>`, never `next/image`.** The image optimizer would fetch any owner-supplied URL through our server, which spec §2 rules out. Each `<img>` carries `alt=""` and `referrerPolicy="no-referrer"`. It's deliberately not `loading="lazy"`: rule 10's check for a photo that failed before hydration reads `complete`, which isn't dependable for a deferred lazy image.

**Dark.** No environment variable, secret or Vercel setting changes. Sign-up stays closed (D31).

**Tests:**
- **Unit tests** are node-only Vitest, in `apps/web/src/**/*.spec.ts`.
- **E2E tests** are Playwright, in `e2e/tests/local`.
- Behaviour changes are written test-first.
- **Running E2E locally:** `pnpm test:e2e -- <file>` runs one file. It needs Docker; if it's down, run `systemctl --user start docker-desktop`. Integration tests are unchanged, but the gate still runs them.

**Values fixed by this plan:**

| Thing | Value |
|---|---|
| Query key | `WISHLIST_KEY = ['wishlist']` |
| Mutation scope | `LIST_SCOPE = { id: 'wishlist' }` |
| Query defaults | `staleTime: Infinity` for the list; queries retry once; mutations never retry (spec §9) |
| Focus refetch | `'always'` when `queryClient.isMutating() === 0`, otherwise `false` |
| Quantity stepper | 1–99 |
| Add box | label "Add to your list", placeholder "Paste a link or type an idea", button "Add" (while unfurling: "Reading the page…") |
| Login after a lost session | `/login?next=%2Flist` from the editor, `/login?next=%2Fsettings` from settings |
| E2E unfurl target | `https://hanker-e2e.invalid/…`. `.invalid` is reserved (RFC 2606), so unfurl answers `DNS_FAILED` fast and no test depends on a real shop |

## Rulings this plan makes on gaps in the spec

The spec says what must happen but not every how. These are the plan's decisions; the executor records each in the ledger as it lands.

1. **One query.**
   - The list is `useQuery({ queryKey: WISHLIST_KEY })`, seeded with `initialData` from the server render and kept with `staleTime: Infinity`, so mounting never refetches.
   - It refetches when the window regains focus, but only while no change is pending (the focus-refetch value above).
   - It also refetches after a failed change.
   - A successful change never refetches. A refetch landing between queued changes would briefly show the server's older order.
2. **The mutation queue.**
   - Every list change (`create`, `update`, `remove`, `move`) carries `scope: LIST_SCOPE`.
   - TanStack runs a scoped mutation's `onMutate` straight away and its `mutationFn` only when the scope is free. This was checked in `@tanstack/query-core@5.104.1`'s `mutation.ts`: `execute()` awaits `onMutate`, then `retryer.start()`, which waits on `mutationCache.canRun`. Its `finally` calls `runNext`, so a failure releases the queue.
   - `move` and `remove` update the cache in `onMutate`, after `cancelQueries`.
   - `create` appends the API's response in `onSuccess`, and `update` replaces the item with it.
3. **A reorder sends the order the cache holds when its request runs** (spec §7): `orderOf(client.getQueryData(WISHLIST_KEY))` inside `mutationFn`. A move queued behind an add therefore includes the new item.
4. **Failures.** Every change's `onError` refetches the list, except after `400 VALIDATION_FAILED` (the form shows field errors) and `401 UNAUTHENTICATED` (the page navigates away). The UI then says why:

   | Error | What the person sees |
   |---|---|
   | `401` | A full navigation (`window.location.replace`) to the login URL above |
   | `400 VALIDATION_FAILED` on a form | Field errors, from `fieldErrors()` |
   | `404` on an item | "That item was already removed, so we’ve reloaded your list." |
   | `409 ORDER_CONFLICT` | "Your list changed on another device, so we’ve reloaded it." |
   | `422 LIST_FULL` | "Your list is full: 200 items is the most it can hold." |
   | Anything else | `errorMessage()`, as today |

5. **What the add box decides** (`classifyAddInput`). The text is trimmed first, then:
   - **Empty:** a field error, "Paste a link or type an idea."
   - **It contains an `http://` or `https://` token** (any case, up to whitespace): that's a link. The rest of the text, with whitespace collapsed, is a title hint used when unfurl finds no title. A phone's share sheet sends "Product name https://…".
   - **It's one token** matching `^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$` (case-insensitive): a link, with `https://` added. `Mr.Smith` reads as a link; spec §7 accepts that cost.
   - **It's one token starting `<scheme>://`** for any other scheme: a field error, "Links must start with http:// or https://".
   - **Anything else:** an idea, titled with the text.

   A link over 2048 characters gets "Use 2048 characters or fewer." An idea is checked with `ItemTitleSchema` and `formErrorMap` before it's sent.
6. **Unfurl:**
   - The form opens with the link kept, whatever happens. `prefill()` fills it: the unfurl's title, else the title hint, else empty, and its photo and price.
   - One sentence above the form says why it's empty, from `unfurlMessage()`:

     | Reason | Message |
     |---|---|
     | `BLOCKED_BY_SITE` | "That shop didn’t let us read the page, so fill in the details yourself." |
     | `DNS_FAILED` | "We couldn’t find that site. Check the link, or fill in the details yourself." |
     | `TIMEOUT`, `UNREACHABLE` | "We couldn’t reach that page, so fill in the details yourself." |
     | `NOT_HTML`, `TOO_LARGE`, `NO_METADATA`, `TOO_MANY_REDIRECTS` | "We couldn’t find the details on that page, so fill them in yourself." |
     | `INVALID_URL`, `DISALLOWED_ADDRESS` | "That link doesn’t go to a public web page." |
     | `429 RATE_LIMITED` | "You’ve added a lot of links this hour, so fill in the details yourself." |
     | Any other unfurl error, such as offline | "We couldn’t read that page, so fill in the details yourself." |

   - A successful prefill says "Filled in from <host>. Check it, then add it."
7. **One form schema.**
   - The add and edit forms both validate with `CreateItemRequestSchema` and `formErrorMap`.
   - Text inputs hold strings, and the schema turns `''` into `null`.
   - A save sends all six fields: `POST` for an add, `PATCH` for an edit. A `PATCH` with every field is a valid `UpdateItemRequest`, and sending `null` clears a field (3a carry: clearing `url` and `imageUrl` is tested end to end).
   - Quantity is a stepper, 1–99, sent as a number (D37).
8. **Rows (D37):**
   - One row is open at a time.
   - Tapping another row while the open form has unsaved changes keeps it open and says "Save or cancel the item you’re editing first."
   - After Save or Cancel, focus returns to the row's title button.
   - After a delete, focus goes to the next row's title button, else the previous one's, else the add box.
   - An open row's drag handle is hidden.
9. **Sharing from `/list`** appears only when the list has an item:
   - **Copy share link** writes `shareUrl` with `navigator.clipboard.writeText` and announces "Link copied." If writing fails, it announces "Copy this link: <url>".
   - **Share** renders only when `navigator.share` exists. It calls `navigator.share({ title, url })`; an `AbortError` (the person closed the sheet) is ignored, and any other error falls back to copying.
10. **Photos:**
    - An item with `imageUrl` shows it, at 56 px, `object-cover`.
    - If the image fails, the item shows a photo placeholder tile instead. The failure is caught by `onError`, and also by a callback ref that sees `complete && naturalWidth === 0` when it attaches, for an image that failed before hydration.
    - An idea (`url === null`) with no photo shows a dashed idea tile.
    - Other items with no photo show the placeholder tile.
11. **The status line.**
    - `ListStatusProvider` holds one message.
    - Confirmations ("Added …", "Saved …", "Deleted …", "Moved … to position 2 of 5.", "Link copied.") render inside an always-mounted `role="status"` region. Errors render as an error `Notice`, which has `role="alert"`.
    - Each message carries a counter in its React key, so a repeated message is announced again.
12. **Reordering** (spec §7):
    - Only the handle drags: it carries dnd-kit's listeners and `touch-action: none`, and nothing else on the row does.
    - The sensors are `PointerSensor`, with an 8 px activation distance, and `KeyboardSensor` with `sortableKeyboardCoordinates`.
    - dnd-kit's announcements are rewritten in Hanker's words (Task 5).
    - The up and down buttons move an item by one place. If the pressed button becomes disabled at the top or bottom, focus moves to the other one.
13. **Settings:**
    - **List name** (`PATCH /wishlist {title}`): "Save list name"; on success, "List name saved".
    - **Share link:** shows the link, a Copy button, and "Get a new link". That asks in an alert dialog: "Get a new share link?" / "Your old link stops working right away. Anyone you sent it to will need the new one." The confirm button is "Get a new link".
    - **Delete account:** becomes a button that opens an alert dialog holding the password field (D38).
    - Both list cards render only for a verified owner, because `GET /wishlist` refuses anyone else.
14. **The router cache after a lost session** (D38). The login page reloads itself when it was reached by a client-side navigation, which is when the router's in-memory cache still holds signed-in pages for Back to restore.
    - **Detecting it:** a client navigation is when `performance.getEntriesByType('navigation')[0].name`, the URL the document loaded at, isn't the current `/login` URL.
    - **When it applies:** only when the URL has `next`. Both `requireMe` and the proxy add `next` when they send someone to log in.
15. **E2E accounts:**
    - **A verified owner** is made by a helper: sign up through the API, read the verification email from Mailpit, `POST /api/auth/verify-email`, and log in through the API.
    - **Items** are seeded with `POST /api/wishlist/items` through `page.request`, which shares the page's cookies.
    - **Clipboard:** tests grant Chromium `clipboard-read` and `clipboard-write`.

## Review Focus

The input classes and failure modes the spec implies but doesn't test, most likely to bite a person first. Each has a test in the task named.

1. **A link shared from a phone app arrives wrapped in text**, as "Garmin Approach CT10 https://a.co/d/xyz", often with a trailing newline. The box treats it as a link, and the text becomes the title if unfurl finds none. Task 3: unit and E2E.
2. **Moves made while an add is still in flight, and rapid repeated moves.** Every request carries the whole current order: no 409, and the final order survives a reload. Task 1 (the queue, with a real `QueryClient`) and Task 5 (E2E).
3. **A photo URL that 404s or is blocked** shows the placeholder tile, never a broken-image icon, including when it fails before hydration. Task 2: E2E.
4. **An item deleted on another device is then edited here.** The person sees "That item was already removed…", and the list reloads without it. Task 4: E2E.
5. **A long unbroken title, such as a pasted SKU or a 200-character word, at 390 px.** It wraps, and the page never scrolls sideways. Task 2: E2E.

## Stacks and order

One stack, `owner-web`, one layer per reviewable concern. Seven layers stay under Neon's preview cap of 8:

| Layer (branch) | Tasks |
|---|---|
| `web/editor-foundations` | 1 |
| `web/list-view` | 2 |
| `web/add-item` | 3 |
| `web/edit-item` | 4 |
| `web/reorder` | 5 |
| `web/list-settings` | 6 |
| `web/finish-3b` | 7 |

Then Task 8 is a ⏸ checkpoint. Ted tries the editor on a phone and with a screen reader, merges, and production is verified (still dark).

Every task ends with the same gate before its commit:

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm test:e2e            # every E2E file: this plan changes pages earlier specs visit
```

Each task's commit body says why, and ends with the `Co-Authored-By:` trailer of the model that actually wrote it. Each task submits its layer with `gh stack submit --open`, and gives the new PR its commit's title (`gh pr edit <n> --title "…"`).

---
### Task 1: The list's cache and its mutation queue

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (add `@tanstack/react-query@5.104.1`)
- Create: `apps/web/src/lib/list-cache.ts`, `apps/web/src/lib/list-cache.spec.ts`
- Create: `apps/web/src/lib/list-mutations.ts`, `apps/web/src/lib/list-mutations.spec.ts`
- Create: `apps/web/src/components/query-provider.tsx`
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.spec.ts`

**Interfaces:**
- **Consumes:**
  - from `@wishlist/contracts`: `Item`, `WishlistResponse`, `CreateItemRequest`, `UpdateItemRequest`, `ItemSchema` and `ErrorCode`;
  - from `lib/api-client`: `createApiClient`, `ApiClient` and `NoContentSchema`;
  - from `lib/messages`: `hasCode` and `errorMessage`.
- **Produces:**
  - `lib/list-cache`:
    - `WISHLIST_KEY`;
    - `orderOf(list: WishlistResponse | undefined): string[]`;
    - `moveItem(list, id, toIndex)`, `removeItem(list, id)`, `appendItem(list, item)` and `replaceItem(list, item)`, each returning a `WishlistResponse`.
  - `lib/list-mutations`:
    - `LIST_SCOPE`;
    - `interface Move { id: string; toIndex: number }`;
    - `interface ItemEdit { id: string; body: UpdateItemRequest }`;
    - `refetchesAfter(error: unknown): boolean`;
    - `listMutations(client: QueryClient, api: ApiClient): { create, update, remove, move }`. The options are typed `MutationOptions<Item, unknown, CreateItemRequest>`, `<Item, unknown, ItemEdit>`, `<undefined, unknown, string>` and `<undefined, unknown, Move>`.
  - `components/query-provider`: `QueryProvider({ children })`.
  - `lib/messages`:
    - `ITEM_GONE`;
    - `listErrorMessage(error: unknown): string`;
    - new `ERROR_MESSAGES` entries for `ORDER_CONFLICT`, `LIST_FULL` and `EMAIL_NOT_VERIFIED`.

- [ ] **Step 1: Start the stack, from an up-to-date main**

```bash
git switch main && git pull --ff-only
gh stack init web/editor-foundations
```

- [ ] **Step 2: Add TanStack Query, exact**

```bash
npm view @tanstack/react-query@5.104.1 time.modified   # released 2026-10-02: past the 3-day minimum
pnpm --filter @wishlist/web add --save-exact @tanstack/react-query@5.104.1
grep '"@tanstack/react-query"' apps/web/package.json   # expect "5.104.1", no ^ or ~
```

- [ ] **Step 3: Write the failing cache tests**

Create `apps/web/src/lib/list-cache.spec.ts`:

```ts
import type { Item, WishlistResponse } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { appendItem, moveItem, orderOf, removeItem, replaceItem } from './list-cache';

const item = (n: number, extra: Partial<Item> = {}): Item => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Item ${String(n)}`,
  url: null,
  imageUrl: null,
  priceText: null,
  note: null,
  quantity: 1,
  position: n,
  ...extra,
});
const list = (...items: Item[]): WishlistResponse => ({
  title: 'Ada’s wishlist',
  shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
  items,
});
const ids = (l: WishlistResponse) => l.items.map((i) => i.title);

describe('list cache operations (Plan 3b rule 2)', () => {
  it('reads the order as item IDs, and an empty order from no list', () => {
    expect(orderOf(list(item(1), item(2)))).toEqual([item(1).id, item(2).id]);
    expect(orderOf(undefined)).toEqual([]);
  });

  it('moves an item up and down, and renumbers positions 0…n−1 as the API does', () => {
    const moved = moveItem(list(item(1), item(2), item(3)), item(3).id, 0);
    expect(ids(moved)).toEqual(['Item 3', 'Item 1', 'Item 2']);
    expect(moved.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(ids(moveItem(list(item(1), item(2), item(3)), item(1).id, 2))).toEqual([
      'Item 2',
      'Item 3',
      'Item 1',
    ]);
  });

  it('clamps a move past either end, and ignores an unknown ID', () => {
    const l = list(item(1), item(2));
    expect(ids(moveItem(l, item(1).id, 9))).toEqual(['Item 2', 'Item 1']);
    expect(ids(moveItem(l, item(2).id, -3))).toEqual(['Item 2', 'Item 1']);
    expect(moveItem(l, item(7).id, 0)).toBe(l);
  });

  it('removes, appends and replaces items without mutating the list it was given', () => {
    const l = list(item(1), item(2));
    expect(ids(removeItem(l, item(1).id))).toEqual(['Item 2']);
    expect(ids(appendItem(l, item(3)))).toEqual(['Item 1', 'Item 2', 'Item 3']);
    expect(ids(appendItem(l, item(2)))).toEqual(['Item 1', 'Item 2']);
    expect(replaceItem(l, item(2, { title: 'Kettle' })).items[1]?.title).toBe('Kettle');
    expect(ids(l)).toEqual(['Item 1', 'Item 2']);
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/list-cache.spec.ts`
Expected: FAIL, because `./list-cache` doesn't exist.

- [ ] **Step 4: Write the cache operations**

Create `apps/web/src/lib/list-cache.ts`:

```ts
import type { Item, WishlistResponse } from '@wishlist/contracts';

/** The editor's one query: the owner's list, as `GET /wishlist` returns it (Plan 3b rule 1). */
export const WISHLIST_KEY = ['wishlist'] as const;

/** The item IDs in list order: a reorder's body. */
export function orderOf(list: WishlistResponse | undefined): string[] {
  return list ? list.items.map((item) => item.id) : [];
}

/**
 * The list with `id` moved to `toIndex`, clamped to the list's ends, and positions renumbered
 * 0…n−1 as the API does. An unknown ID leaves the list as it was.
 */
export function moveItem(list: WishlistResponse, id: string, toIndex: number): WishlistResponse {
  const from = list.items.findIndex((item) => item.id === id);
  const moving = list.items[from];
  if (!moving) return list;
  const to = Math.max(0, Math.min(toIndex, list.items.length - 1));
  const items = list.items.filter((item) => item.id !== id);
  items.splice(to, 0, moving);
  return { ...list, items: items.map((item, position) => ({ ...item, position })) };
}

export function removeItem(list: WishlistResponse, id: string): WishlistResponse {
  return { ...list, items: list.items.filter((item) => item.id !== id) };
}

/** Appends `item`, once: an item already in the list stays where it is. */
export function appendItem(list: WishlistResponse, item: Item): WishlistResponse {
  if (list.items.some((existing) => existing.id === item.id)) return list;
  return { ...list, items: [...list.items, item] };
}

export function replaceItem(list: WishlistResponse, item: Item): WishlistResponse {
  return {
    ...list,
    items: list.items.map((existing) => (existing.id === item.id ? item : existing)),
  };
}
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/list-cache.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing message tests**

In `apps/web/src/lib/messages.spec.ts`, add `listErrorMessage` and `ITEM_GONE` to the `./messages` import, and append:

```ts
describe('listErrorMessage (Plan 3b rule 4)', () => {
  it('says a missing item was already removed', () => {
    expect(listErrorMessage(apiError(ErrorCode.NOT_FOUND, { status: 404 }))).toBe(ITEM_GONE);
    expect(ITEM_GONE).toBe('That item was already removed, so we’ve reloaded your list.');
  });

  it('explains a stale order and a full list', () => {
    expect(listErrorMessage(apiError(ErrorCode.ORDER_CONFLICT, { status: 409 }))).toBe(
      'Your list changed on another device, so we’ve reloaded it.',
    );
    expect(listErrorMessage(apiError(ErrorCode.LIST_FULL, { status: 422 }))).toBe(
      'Your list is full: 200 items is the most it can hold.',
    );
  });

  it('falls back to errorMessage for everything else', () => {
    expect(listErrorMessage(new TypeError('Failed to fetch'))).toBe(
      "We couldn't reach Hanker. Check your connection and try again.",
    );
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/messages.spec.ts`
Expected: FAIL, because `listErrorMessage` isn't exported.

- [ ] **Step 6: Add the list's error copy**

In `apps/web/src/lib/messages.ts`, add these three entries to `ERROR_MESSAGES`, after `FORBIDDEN_ORIGIN`:

```ts
  [ErrorCode.ORDER_CONFLICT]: 'Your list changed on another device, so we’ve reloaded it.',
  [ErrorCode.LIST_FULL]: 'Your list is full: 200 items is the most it can hold.',
  [ErrorCode.EMAIL_NOT_VERIFIED]: 'Confirm your email first, then try again.',
```

Then add after `hasCode`:

```ts
/** A change to an item that another device already deleted (a 404 on an item route). */
export const ITEM_GONE = 'That item was already removed, so we’ve reloaded your list.';

/** errorMessage for the list editor, where a 404 can only mean the item is gone (Plan 3b rule 4). */
export function listErrorMessage(error: unknown): string {
  return hasCode(error, ErrorCode.NOT_FOUND) ? ITEM_GONE : errorMessage(error);
}
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/messages.spec.ts`
Expected: PASS. The table test now also covers the three new codes.

- [ ] **Step 7: Write the failing queue tests**

These run TanStack's real `QueryClient` and `MutationObserver` in node, against the real API client with a fake `fetch` that answers only when the test says so. That is how they pin down the ordering behaviour the editor depends on.

Create `apps/web/src/lib/list-mutations.spec.ts`:

```ts
import { MutationObserver, QueryClient, type MutationOptions } from '@tanstack/react-query';
import { ErrorCode, type Item, type WishlistResponse } from '@wishlist/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api-client';
import { orderOf, WISHLIST_KEY } from './list-cache';
import { listMutations } from './list-mutations';

const item = (n: number, extra: Partial<Item> = {}): Item => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Item ${String(n)}`,
  url: null,
  imageUrl: null,
  priceText: null,
  note: null,
  quantity: 1,
  position: n,
  ...extra,
});

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, code, requestId: 'r' }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

/** A list in a real QueryClient, and an API whose every request waits for `answer(n, …)`. */
function setup(...items: Item[]) {
  const client = new QueryClient();
  const list: WishlistResponse = {
    title: 'Ada’s wishlist',
    shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
    items,
  };
  client.setQueryData(WISHLIST_KEY, list);
  const sent: Sent[] = [];
  const answers: ((res: Response) => void)[] = [];
  const api = createApiClient({
    baseUrl: 'http://api.test',
    fetch: (url, init) => {
      sent.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Promise<Response>((resolve) => answers.push(resolve));
    },
  });
  const answer = (n: number, res: Response) => {
    const respond = answers[n];
    if (!respond) throw new Error(`request ${String(n)} hasn't been sent`);
    respond(res);
  };
  const run = <D, V>(options: MutationOptions<D, unknown, V>, variables: V) =>
    new MutationObserver(client, options).mutate(variables);
  const order = () => orderOf(client.getQueryData<WishlistResponse>(WISHLIST_KEY));
  const invalidated = () => client.getQueryState(WISHLIST_KEY)?.isInvalidated ?? false;
  return { client, mutations: listMutations(client, api), sent, answer, run, order, invalidated };
}

describe('the list’s mutation queue (spec §7, Plan 3b rules 2–4)', () => {
  it('shows a move at once, and sends the whole order', async () => {
    const t = setup(item(1), item(2));
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id, item(1).id]));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toEqual({
      method: 'PUT',
      path: '/api/wishlist/items/order',
      body: { itemIds: [item(2).id, item(1).id] },
    });
    t.answer(0, noContent());
    await moving;
    expect(t.invalidated()).toBe(false);
  });

  it('sends a move queued behind an add with the new item in it (Review Focus 2)', async () => {
    const t = setup(item(1), item(2));
    const adding = t.run(t.mutations.create, { title: 'Item 3', quantity: 1 });
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id, item(1).id]));
    // The move waits its turn: only the add has gone out.
    expect(t.sent.map((r) => r.method)).toEqual(['POST']);
    t.answer(0, json(201, item(3)));
    await adding;
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.body).toEqual({ itemIds: [item(2).id, item(1).id, item(3).id] });
    t.answer(1, noContent());
    await moving;
  });

  it('sends every one of several quick moves with the whole list, and the last with the final order', async () => {
    const t = setup(item(1), item(2), item(3));
    const moves = [
      t.run(t.mutations.move, { id: item(1).id, toIndex: 1 }),
      t.run(t.mutations.move, { id: item(1).id, toIndex: 2 }),
      t.run(t.mutations.move, { id: item(3).id, toIndex: 0 }),
    ];
    const final = [item(3).id, item(2).id, item(1).id];
    await vi.waitFor(() => expect(t.order()).toEqual(final));
    for (let n = 0; n < moves.length; n++) {
      await vi.waitFor(() => expect(t.sent).toHaveLength(n + 1));
      // An earlier request may go out before a later move has applied, but never with an item
      // missing: the API answers 409 to anything but the exact set.
      const sentIds = (t.sent[n]?.body as { itemIds: string[] }).itemIds;
      expect([...sentIds].sort()).toEqual([...final].sort());
      t.answer(n, noContent());
    }
    await Promise.all(moves);
    expect(t.sent.at(-1)?.body).toEqual({ itemIds: final });
  });

  it('removes an item at once, and refetches the list when the API says it was gone', async () => {
    const t = setup(item(1), item(2));
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id]));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toMatchObject({
      method: 'DELETE',
      path: `/api/wishlist/items/${item(1).id}`,
    });
    t.answer(0, problem(404, ErrorCode.NOT_FOUND));
    await expect(removing).rejects.toThrow('404 NOT_FOUND');
    expect(t.invalidated()).toBe(true);
  });

  it('refetches after a stale order, and keeps running what was queued behind it', async () => {
    const t = setup(item(1), item(2));
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(409, ErrorCode.ORDER_CONFLICT));
    await expect(moving).rejects.toThrow('409 ORDER_CONFLICT');
    expect(t.invalidated()).toBe(true);
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.method).toBe('DELETE');
    t.answer(1, noContent());
    await removing;
  });

  it('adds the item the API returns, and replaces an edited one with the API’s copy', async () => {
    const t = setup(item(1));
    const adding = t.run(t.mutations.create, { title: 'Item 2', quantity: 2 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toEqual({
      method: 'POST',
      path: '/api/wishlist/items',
      body: { title: 'Item 2', quantity: 2 },
    });
    t.answer(0, json(201, item(2, { quantity: 2 })));
    await adding;
    expect(t.order()).toEqual([item(1).id, item(2).id]);

    const editing = t.run(t.mutations.update, { id: item(1).id, body: { title: 'Kettle' } });
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toMatchObject({ method: 'PATCH', path: `/api/wishlist/items/${item(1).id}` });
    t.answer(1, json(200, item(1, { title: 'Kettle' })));
    await editing;
    const titles = t.client.getQueryData<WishlistResponse>(WISHLIST_KEY)?.items.map((i) => i.title);
    expect(titles).toEqual(['Kettle', 'Item 2']);
  });

  it('leaves the list alone after a validation error, which the form shows', async () => {
    const t = setup(item(1));
    const adding = t.run(t.mutations.create, { title: 'x', quantity: 1 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(400, ErrorCode.VALIDATION_FAILED));
    await expect(adding).rejects.toThrow('400 VALIDATION_FAILED');
    expect(t.invalidated()).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/list-mutations.spec.ts`
Expected: FAIL, because `./list-mutations` doesn't exist.

- [ ] **Step 8: Write the mutations**

Create `apps/web/src/lib/list-mutations.ts`:

```ts
import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  ItemSchema,
  type CreateItemRequest,
  type Item,
  type UpdateItemRequest,
  type WishlistResponse,
} from '@wishlist/contracts';
import { NoContentSchema, type ApiClient } from './api-client';
import { appendItem, moveItem, orderOf, removeItem, replaceItem, WISHLIST_KEY } from './list-cache';
import { hasCode } from './messages';

/** Every list change shares this scope, so changes reach the API one at a time, in order (spec §7). */
export const LIST_SCOPE = { id: 'wishlist' } as const;

export interface Move {
  id: string;
  toIndex: number;
}

export interface ItemEdit {
  id: string;
  body: UpdateItemRequest;
}

/**
 * Whether a failed change refetches the list. The refetch is the rollback: restoring a snapshot
 * would also undo the changes queued after it (spec §7). Not after a form's own validation errors,
 * and not after a lost session, which leaves the page (Plan 3b rule 4).
 */
export function refetchesAfter(error: unknown): boolean {
  return !hasCode(error, ErrorCode.VALIDATION_FAILED) && !hasCode(error, ErrorCode.UNAUTHENTICATED);
}

/**
 * The editor's four changes, as TanStack mutation options (Plan 3b rules 2–4). They're plain objects
 * so a unit test can run them against a real QueryClient, without React. TanStack runs a scoped
 * mutation's onMutate at once and its mutationFn when the scope is free, so a move or a delete shows
 * immediately and its request waits its turn.
 */
export function listMutations(client: QueryClient, api: ApiClient) {
  const change = (edit: (list: WishlistResponse) => WishlistResponse) => {
    client.setQueryData<WishlistResponse>(WISHLIST_KEY, (list) => (list ? edit(list) : list));
  };
  // An optimistic change mustn't be overwritten by a refetch that started before it.
  const holdRefetches = () => client.cancelQueries({ queryKey: WISHLIST_KEY });
  const onError = (error: unknown) => {
    if (refetchesAfter(error)) void client.invalidateQueries({ queryKey: WISHLIST_KEY });
  };

  const create: MutationOptions<Item, unknown, CreateItemRequest> = {
    scope: LIST_SCOPE,
    mutationFn: (body) => api.post('/wishlist/items', body, ItemSchema),
    onSuccess: (item) => change((list) => appendItem(list, item)),
    onError,
  };
  const update: MutationOptions<Item, unknown, ItemEdit> = {
    scope: LIST_SCOPE,
    mutationFn: ({ id, body }) => api.patch(`/wishlist/items/${id}`, body, ItemSchema),
    onSuccess: (item) => change((list) => replaceItem(list, item)),
    onError,
  };
  const remove: MutationOptions<undefined, unknown, string> = {
    scope: LIST_SCOPE,
    mutationFn: (id) => api.delete(`/wishlist/items/${id}`, NoContentSchema),
    onMutate: async (id) => {
      await holdRefetches();
      change((list) => removeItem(list, id));
    },
    onError,
  };
  const move: MutationOptions<undefined, unknown, Move> = {
    scope: LIST_SCOPE,
    // The order the cache holds when this request runs, not when the move was made: a move
    // queued behind an add then includes the new item (spec §7, Plan 3b rule 3).
    mutationFn: () =>
      api.put(
        '/wishlist/items/order',
        { itemIds: orderOf(client.getQueryData<WishlistResponse>(WISHLIST_KEY)) },
        NoContentSchema,
      ),
    onMutate: async ({ id, toIndex }) => {
      await holdRefetches();
      change((list) => moveItem(list, id, toIndex));
    },
    onError,
  };
  return { create, update, remove, move };
}
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/list-mutations.spec.ts`
Expected: PASS (7 tests). If TypeScript rejects an option's shape, read `MutationOptions` in `node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts` (it has `onMutate(variables, context)` and `onError(error, variables, onMutateResult, context)`) and fix the annotation. Don't change the behaviour.

- [ ] **Step 9: The provider**

Create `apps/web/src/components/query-provider.tsx`:

```tsx
'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode } from '@wishlist/contracts';
import { useState, type ReactNode } from 'react';
import { hasCode } from '@/lib/messages';

/**
 * One QueryClient per page load. Queries retry once; writes never retry (spec §9). A refetch that
 * finds the session gone sends the person to log in, by a full navigation, so Back can't restore
 * signed-in pages from the router's cache. Any other failed refetch leaves the list as it was.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (!hasCode(error, ErrorCode.UNAUTHENTICATED)) return;
            const here = window.location.pathname + window.location.search;
            window.location.replace(`/login?next=${encodeURIComponent(here)}`);
          },
        }),
        defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Task 2 mounts it.

- [ ] **Step 10: Gate, commit, submit**

Run the gate from the top of this plan. The E2E suite is unchanged by this task but must stay green.

```bash
git add apps/web pnpm-lock.yaml
git commit -F - <<'EOF'
feat(web): add the list editor's cache and mutation queue

The /list editor keeps the owner's list in one TanStack Query cache and
sends every change through one mutation scope, so changes reach the API
one at a time and in order. A move or a delete shows at once; a reorder
sends the order the cache holds when its request runs, so a move queued
behind an add includes the new item. Any failure but a validation error
or a lost session refetches the list, which is the rollback: restoring
a snapshot would also undo the changes queued after it.

The mutations are plain option objects, tested in node against a real
QueryClient and a fetch that answers when the test says so.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Give the PR the commit's title: `gh pr edit <n> --title "feat(web): add the list editor's cache and mutation queue"`.

---
### Task 2: `/list` shows the list

**Files:**
- Modify: `apps/web/src/app/globals.css` (one token)
- Modify: `apps/web/src/app/(account)/list/page.tsx`
- Create: `apps/web/src/lib/wishlist.server.ts`
- Create: `apps/web/src/lib/item-display.ts`, `apps/web/src/lib/item-display.spec.ts`
- Create in `apps/web/src/components/list/`:
  - `icons.tsx`
  - `list-status.tsx`
  - `list-editor.tsx`
  - `item-list.tsx`
  - `item-row.tsx`
  - `item-photo.tsx`
  - `share-actions.tsx`
- Create: `e2e/support/a11y.ts`, `e2e/support/owner.ts`, `e2e/tests/local/list.spec.ts`
- Modify: `e2e/tests/local/pages.spec.ts`, `e2e/tests/local/golden-path.spec.ts`

**Interfaces:**
- **Consumes:** Task 1's `QueryProvider`, `WISHLIST_KEY` and `listErrorMessage`; `serverApi`, `requireMe`, `AccountHeader`, `Notice` and `Button`.
- **Produces:**
  - `lib/item-display`: `shopName(url: string | null): string | null`.
  - `lib/wishlist.server`: `loadWishlist(returnTo: string): Promise<WishlistResponse>` (Task 6 reuses it).
  - `components/list/icons`: `CopyIcon`, `ShareIcon`, `GripIcon`, `ChevronUpIcon`, `ChevronDownIcon`, `CloseIcon`, `TrashIcon`, `PhotoIcon`, `IdeaIcon`, `MinusIcon` and `PlusIcon`. Each takes no props and renders an `aria-hidden` 20×20 stroke SVG in `currentColor`.
  - `components/list/list-status`:
    - `LIST_LOGIN = '/login?next=%2Flist'`;
    - `ListStatusProvider`;
    - `useListStatus(): { announce(text: string, tone?: 'success' | 'info'): void; fail(error: unknown): void; message }`;
    - `ListStatusLine`.
  - `components/list/list-editor`: `ListEditor({ initial: WishlistResponse })`.
  - `components/list/item-list`: `ItemList({ items: Item[] })`.
  - `components/list/item-row`: `ItemRow({ item: Item })` and `ItemSummary({ item: Item })`.
  - `components/list/item-photo`: `ItemPhoto({ item: Pick<Item, 'url' | 'imageUrl'> })`.
  - `components/list/share-actions`: `ShareActions({ title: string; shareUrl: string })`.
  - E2E `support/owner`:
    - `verifiedOwner(page, baseURL, label): Promise<string>` (the email);
    - `addItemViaApi(request, baseURL, item): Promise<Item>`.
  - E2E `support/a11y`: `expectAccessible(page)`, `expectFitsPhone(page, path)`, `DESKTOP` and `PHONE`.

- [ ] **Step 1: Add the layer**

```bash
gh stack add web/list-view
```

- [ ] **Step 2: Move the accessibility helpers where every spec can use them**

Create `e2e/support/a11y.ts` with `WCAG_22_AA`, `PHONE`, `DESKTOP`, `TURNSTILE_PAGES`, `expectAccessible` and `expectFitsPhone`, moved verbatim from `e2e/tests/local/pages.spec.ts` and exported:
- `export const PHONE`, `export const DESKTOP`;
- `export async function expectAccessible(page: Page)`;
- `export async function expectFitsPhone(page: Page, path: string)`.

`expectFitsPhone` still calls `passTurnstile` from `./turnstile.js`. Then remove those definitions from `pages.spec.ts` and import them:

```ts
import { DESKTOP, expectAccessible, expectFitsPhone } from '../../support/a11y.js';
```

Run: `pnpm --filter @wishlist/e2e typecheck`
Expected: PASS. Nothing else changed.

- [ ] **Step 3: The owner helpers for E2E**

Create `e2e/support/owner.ts`:

```ts
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { CreateItemRequest, Item } from '@wishlist/contracts';
import { logInViaApi, signUpViaApi, uniqueEmail } from './accounts.js';
import { linkPath, waitForEmail } from './mailpit.js';

const VERIFY = 'Confirm your email for Hanker';

/**
 * A new owner with a confirmed email, logged in (Plan 3b rule 15). The session cookie lands in the
 * page's browser context, so page.goto and page.request both act as them.
 */
export async function verifiedOwner(page: Page, baseURL: string, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await signUpViaApi(page.request, baseURL, email);
  const path = linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email');
  const token = new URL(path, baseURL).searchParams.get('token');
  const verified = await page.request.post('/api/auth/verify-email', {
    headers: { origin: baseURL },
    data: { token },
  });
  expect(verified.status()).toBe(204);
  expect(await logInViaApi(page.request, baseURL, email)).toBe(204);
  return email;
}

/** Adds an item through the API, as the editor would. */
export async function addItemViaApi(
  request: APIRequestContext,
  baseURL: string,
  item: Partial<CreateItemRequest> & { title: string },
): Promise<Item> {
  const res = await request.post('/api/wishlist/items', { headers: { origin: baseURL }, data: item });
  if (res.status() !== 201) throw new Error(`add answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as Item;
}
```

- [ ] **Step 4: Write the failing tests**

Create `apps/web/src/lib/item-display.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shopName } from './item-display';

describe('shopName', () => {
  it('names the shop by its host, without www.', () => {
    expect(shopName('https://www.hearthware.example/products/kettle?ref=1')).toBe(
      'hearthware.example',
    );
    expect(shopName('http://trailpost.example/socks')).toBe('trailpost.example');
  });

  it('has nothing to say for an idea or a link it can’t read', () => {
    expect(shopName(null)).toBeNull();
    expect(shopName('not a link')).toBeNull();
  });
});
```

Create `e2e/tests/local/list.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');

test('a new owner sees an empty list, with nothing to share yet', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'empty');
  await page.goto('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Ada’s wishlist' })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy share link' })).toHaveCount(0);
  await expectAccessible(page);
});

test('shows the list in order, with prices, quantities, shops and ideas', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'rows');
  await addItemViaApi(page.request, base, {
    title: 'Enamel stovetop kettle',
    url: 'https://www.hearthware.example/kettle',
    priceText: '$48.00',
  });
  await addItemViaApi(page.request, base, {
    title: 'Merino hiking socks',
    url: 'https://trailpost.example/socks',
    priceText: '$24.00',
    quantity: 3,
  });
  await addItemViaApi(page.request, base, {
    title: 'Pottery class for two',
    note: 'Any studio near Elm Street',
  });
  await page.goto('/list');
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Enamel stovetop kettle');
  await expect(rows.nth(0)).toContainText('$48.00');
  await expect(rows.nth(0)).toContainText('hearthware.example');
  await expect(rows.nth(1)).toContainText('3 wanted');
  await expect(rows.nth(2)).toContainText('An idea: Any studio near Elm Street');
  await expectAccessible(page);
});

test('copies the share link', async ({ page, baseURL, context }) => {
  const base = baseURL ?? '';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, base, 'copy');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();
  const { shareUrl } = (await (await page.request.get('/api/wishlist')).json()) as {
    shareUrl: string;
  };
  // e2e has no DOM lib, so the page's globals are typed by hand.
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(shareUrl);
});

test('a photo that won’t load shows the placeholder tile (Review Focus 3)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'photo');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    imageUrl: 'https://hanker-e2e.invalid/kettle.jpg',
  });
  await page.goto('/list');
  await expect(rowsOf(page).first()).toContainText('Kettle');
  await expect(rowsOf(page).first().locator('img')).toHaveCount(0);
});

test('a long unbroken title wraps on a phone (Review Focus 5)', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'long');
  await addItemViaApi(page.request, base, { title: 'K'.repeat(200), note: 'N'.repeat(400) });
  await expectFitsPhone(page, '/list');
});
```

Run:
```bash
pnpm --filter @wishlist/web exec vitest run src/lib/item-display.spec.ts
pnpm test:e2e -- tests/local/list.spec.ts
```
Expected: both FAIL. `./item-display` doesn't exist, and `/list` still says "Hello, Ada.".

- [ ] **Step 5: `shopName`**

Create `apps/web/src/lib/item-display.ts`:

```ts
/** The shop's name as people say it: the link's host, without "www.". Null for an idea or a bad link. */
export function shopName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/item-display.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: The placeholder token**

In `apps/web/src/app/globals.css`, add to `:root` after `--success-wash`:

```css
  --placeholder: #efe6d8;
```

and to `@theme inline` after `--color-success-wash`:

```css
  --color-placeholder: var(--placeholder);
```

- [ ] **Step 7: The icons**

Create `apps/web/src/components/list/icons.tsx`:

```tsx
import type { ReactNode } from 'react';

/** A decorative 20×20 stroke icon in the text colour; the control around it carries the name. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const CopyIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Icon>
);
export const ShareIcon = () => (
  <Icon>
    <path d="M10 3v10M6.5 6.5 10 3l3.5 3.5M5 10v5.5A1.5 1.5 0 0 0 6.5 17h7a1.5 1.5 0 0 0 1.5-1.5V10" />
  </Icon>
);
export const GripIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="currentColor">
    <circle cx="7" cy="5" r="1.5" />
    <circle cx="13" cy="5" r="1.5" />
    <circle cx="7" cy="10" r="1.5" />
    <circle cx="13" cy="10" r="1.5" />
    <circle cx="7" cy="15" r="1.5" />
    <circle cx="13" cy="15" r="1.5" />
  </svg>
);
export const ChevronUpIcon = () => (
  <Icon>
    <path d="M5 12.5 10 7.5l5 5" />
  </Icon>
);
export const ChevronDownIcon = () => (
  <Icon>
    <path d="M5 7.5l5 5 5-5" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
  </Icon>
);
export const PhotoIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <circle cx="8" cy="8.5" r="1.5" />
    <path d="M3 14l4-4 3 3 2-2 5 5" />
  </Icon>
);
export const IdeaIcon = () => (
  <Icon>
    <path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 17h4" />
  </Icon>
);
export const MinusIcon = () => (
  <Icon>
    <path d="M5 10h10" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M10 5v10M5 10h10" />
  </Icon>
);
```

- [ ] **Step 8: The status line**

Create `apps/web/src/components/list/list-status.tsx`:

```tsx
'use client';

import { ErrorCode } from '@wishlist/contracts';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Notice } from '@/components/ui/notice';
import { hasCode, listErrorMessage } from '@/lib/messages';

export const LIST_LOGIN = '/login?next=%2Flist';

type Tone = 'success' | 'info' | 'error';
interface Message {
  tone: Tone;
  text: string;
  /** Changes with every message, so a repeated one is announced again. */
  id: number;
}
interface ListStatus {
  announce(text: string, tone?: 'success' | 'info'): void;
  fail(error: unknown): void;
  message: Message | null;
}

const ListStatusContext = createContext<ListStatus | null>(null);

/** The editor's one status line (Plan 3b rules 4 and 11). */
export function ListStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const announce = useCallback((text: string, tone: 'success' | 'info' = 'success') => {
    setMessage((last) => ({ tone, text, id: (last?.id ?? 0) + 1 }));
  }, []);
  const fail = useCallback((error: unknown) => {
    if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
      // A full navigation, so Back can't restore the list from the router's cache.
      window.location.replace(LIST_LOGIN);
      return;
    }
    setMessage((last) => ({ tone: 'error', text: listErrorMessage(error), id: (last?.id ?? 0) + 1 }));
  }, []);
  const value = useMemo(() => ({ announce, fail, message }), [announce, fail, message]);
  return <ListStatusContext value={value}>{children}</ListStatusContext>;
}

export function useListStatus(): ListStatus {
  const status = use(ListStatusContext);
  if (!status) throw new Error('useListStatus is only for components inside ListStatusProvider');
  return status;
}

/**
 * Confirmations are read politely, from a region that is always mounted so its new content is
 * announced. Errors interrupt: an error Notice is role="alert".
 */
export function ListStatusLine() {
  const { message } = useListStatus();
  return (
    <>
      <div role="status">
        {message && message.tone !== 'error' ? (
          <Notice key={message.id} tone={message.tone} announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {message?.tone === 'error' ? (
        <Notice key={message.id} tone="error" className="mt-4">
          {message.text}
        </Notice>
      ) : null}
    </>
  );
}
```

- [ ] **Step 9: The photo**

Create `apps/web/src/components/list/item-photo.tsx`:

```tsx
'use client';

import type { Item } from '@wishlist/contracts';
import { useCallback, useState } from 'react';
import { IdeaIcon, PhotoIcon } from './icons';

const TILE = 'flex size-14 shrink-0 items-center justify-center rounded-[10px]';

/** The item's photo, or a tile when there's none or it won't load (Plan 3b rule 10). */
export function ItemPhoto({ item }: { item: Pick<Item, 'url' | 'imageUrl'> }) {
  // The URL that failed, so a changed photo link gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const src = item.imageUrl;
  // An image that failed before hydration never fires onError; catch it as the element attaches.
  const catchEarlyFailure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(img.getAttribute('src'));
  }, []);

  if (src && src !== failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- photos come from any https host; next/image would fetch them through our server, which spec §2 rules out.
      <img
        ref={catchEarlyFailure}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`${TILE} bg-placeholder object-cover`}
      />
    );
  }
  if (item.url === null) {
    return (
      <div className={`${TILE} border-[1.5px] border-dashed border-input text-muted-foreground`}>
        <IdeaIcon />
      </div>
    );
  }
  return (
    <div className={`${TILE} bg-placeholder text-input`}>
      <PhotoIcon />
    </div>
  );
}
```

- [ ] **Step 10: The row and the list**

Create `apps/web/src/components/list/item-row.tsx`:

```tsx
import type { Item } from '@wishlist/contracts';
import { shopName } from '@/lib/item-display';
import { ItemPhoto } from './item-photo';

/** One row of the list (D37). Task 4 opens it in place; Task 5 adds the handle and the arrows. */
export function ItemRow({ item }: { item: Item }) {
  return (
    <li className="flex items-center gap-1.5 border-t border-foreground/15 py-2.5 pr-1 pl-2.5 first:border-t-0">
      <ItemPhoto item={item} />
      <div className="min-w-0 flex-1 px-1.5">
        <ItemSummary item={item} />
      </div>
    </li>
  );
}

/** The title and its details: price, how many, the shop, or what the idea is. */
export function ItemSummary({ item }: { item: Item }) {
  const shop = shopName(item.url);
  return (
    <>
      <span className="block text-base leading-snug font-semibold [overflow-wrap:anywhere]">
        {item.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
        {item.priceText ? <span className="text-foreground">{item.priceText}</span> : null}
        {item.quantity > 1 ? (
          <span className="rounded-full border border-border px-2 text-[13px] text-foreground">
            {item.quantity} wanted
          </span>
        ) : null}
        {shop ? <span className="[overflow-wrap:anywhere]">{shop}</span> : null}
        {item.url === null ? (
          <span className="block w-full truncate">
            {item.note ? `An idea: ${item.note}` : 'An idea'}
          </span>
        ) : null}
      </span>
    </>
  );
}
```

Create `apps/web/src/components/list/item-list.tsx`:

```tsx
import type { Item } from '@wishlist/contracts';
import { ItemRow } from './item-row';

export function ItemList({ items }: { items: Item[] }) {
  return (
    <ol
      aria-label="Your items, most wanted first"
      className="mt-5 overflow-hidden rounded-card border border-border bg-card"
    >
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </ol>
  );
}
```

- [ ] **Step 11: Sharing from the list**

Create `apps/web/src/components/list/share-actions.tsx`:

```tsx
'use client';

import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { CopyIcon, ShareIcon } from './icons';
import { useListStatus } from './list-status';

const nothingToWatch = () => () => undefined;

/** Whether this browser can open the system share sheet. False while rendering on the server. */
function useCanShare(): boolean {
  return useSyncExternalStore(
    nothingToWatch,
    () => typeof navigator.share === 'function',
    () => false,
  );
}

/** Copy share link, and Share where the Web Share API exists (Plan 3b rule 9). */
export function ShareActions({ title, shareUrl }: { title: string; shareUrl: string }) {
  const { announce } = useListStatus();
  const canShare = useCanShare();

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      announce('Link copied.');
    } catch {
      announce(`Copy this link: ${shareUrl}`, 'info');
    }
  }

  async function share() {
    try {
      await navigator.share({ title, url: shareUrl });
    } catch (error) {
      // Closing the share sheet rejects with AbortError: the person chose not to share.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copy();
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="compact" onClick={() => void copy()}>
        <CopyIcon />
        Copy share link
      </Button>
      {canShare ? (
        <Button variant="secondary" size="compact" onClick={() => void share()}>
          <ShareIcon />
          Share
        </Button>
      ) : null}
      <p className="basis-full text-[13px] text-muted-foreground">
        Anyone with the link can see your list.
      </p>
    </div>
  );
}
```

- [ ] **Step 12: The editor**

Create `apps/web/src/components/list/list-editor.tsx`:

```tsx
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WishlistResponseSchema, type WishlistResponse } from '@wishlist/contracts';
import { browserApi } from '@/lib/browser-api';
import { WISHLIST_KEY } from '@/lib/list-cache';
import { ItemList } from './item-list';
import { ListStatusLine, ListStatusProvider } from './list-status';
import { ShareActions } from './share-actions';

/** The owner's list (spec §7 Owner editor, D37). The server render seeds the cache. */
export function ListEditor({ initial }: { initial: WishlistResponse }) {
  return (
    <ListStatusProvider>
      <Editor initial={initial} />
    </ListStatusProvider>
  );
}

function Editor({ initial }: { initial: WishlistResponse }) {
  const client = useQueryClient();
  const { data: list } = useQuery({
    queryKey: WISHLIST_KEY,
    queryFn: () => browserApi.get('/wishlist', WishlistResponseSchema),
    initialData: initial,
    staleTime: Infinity,
    // Back on the tab, refetch, but only while nothing is waiting to be sent (Plan 3b rule 1).
    refetchOnWindowFocus: () => (client.isMutating() === 0 ? 'always' : false),
  });
  const hasItems = list.items.length > 0;

  return (
    <>
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none [overflow-wrap:anywhere]">
        {list.title}
      </h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
        {hasItems
          ? 'Gifters see your list in this order, so put what you’d love most at the top.'
          : 'Add the things you’d love. When you’re ready, send one link to family and friends.'}
      </p>
      {hasItems ? <ShareActions title={list.title} shareUrl={list.shareUrl} /> : null}
      <ListStatusLine />
      {hasItems ? <ItemList items={list.items} /> : <EmptyList />}
    </>
  );
}

function EmptyList() {
  return (
    <div className="mt-7 rounded-card border-[1.5px] border-dashed border-input px-5 py-7 text-center">
      <p className="font-display text-3xl leading-tight">Nothing here yet</p>
      <p className="mx-auto mt-2.5 max-w-[290px] text-[15px] text-muted-foreground">
        Copy a link from any shop and paste it above, or type an idea, like “a pottery class”.
      </p>
    </div>
  );
}
```

- [ ] **Step 13: The page**

Create `apps/web/src/lib/wishlist.server.ts`:

```ts
import 'server-only';
import { WishlistResponseSchema, type WishlistResponse } from '@wishlist/contracts';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * The owner's list, server to server. Call it only after requireMe has seen a verified email, since
 * the API refuses anyone else. A session lost in between goes to login, as requireMe would.
 */
export async function loadWishlist(returnTo: string): Promise<WishlistResponse> {
  try {
    return await (await serverApi()).get('/wishlist', WishlistResponseSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}
```

Replace `apps/web/src/app/(account)/list/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountHeader } from '@/components/account-header';
import { ListEditor } from '@/components/list/list-editor';
import { QueryProvider } from '@/components/query-provider';
import { Notice } from '@/components/ui/notice';
import { requireMe } from '@/lib/require-me';
import { loadWishlist } from '@/lib/wishlist.server';

export const metadata: Metadata = { title: 'Your list' };

const MAIN = 'mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7';

/** The owner's list (spec §7). An unconfirmed email gets the notice instead: the API would refuse. */
export default async function ListPage() {
  const me = await requireMe('/list');
  if (!me.emailVerified) {
    return (
      <>
        <AccountHeader current="list" />
        <main className={MAIN}>
          <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">
            Hello, {me.displayName}.
          </h1>
          {/* We can't know the email was delivered, so this doesn't claim it was (D38). */}
          <Notice tone="info" className="mt-6">
            Confirm your email to start your list. If there’s no email from Hanker at{' '}
            <strong>{me.email}</strong>,{' '}
            <Link href="/verify-email" className="underline">
              send a new link
            </Link>
            .
          </Notice>
        </main>
      </>
    );
  }
  const list = await loadWishlist('/list');
  return (
    <>
      <AccountHeader current="list" />
      <main className={MAIN}>
        <QueryProvider>
          <ListEditor initial={list} />
        </QueryProvider>
      </main>
    </>
  );
}
```

- [ ] **Step 14: Bring the golden path up to date**

A verified owner now lands on their list, whose heading is the list's title. In `e2e/tests/local/golden-path.spec.ts`:
- **First login:** replace the `Hello, Ada.` heading assertion with
  ```ts
  await expect(page.getByRole('heading', { level: 1, name: 'Ada’s wishlist' })).toBeVisible();
  ```
- **After the password reset:** replace the `Hello, Ada Lovelace.` assertion the same way. The list keeps its title when the owner renames themselves, because the title is set once, at sign-up (spec §2).

Leave `account.spec.ts` alone. Its owner is unverified, and still sees "Hello, Ada." and the notice.

- [ ] **Step 15: Run the tests**

```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e -- tests/local/list.spec.ts tests/local/golden-path.spec.ts tests/local/account.spec.ts tests/local/pages.spec.ts
```

Expected: PASS.
- If `expectAccessible` reports a contrast failure, fix the colour on its token in `globals.css`, never in the component.
- If the photo test sees an `img`, check `catchEarlyFailure` runs: React calls a callback ref when the element attaches.

- [ ] **Step 16: Gate, commit, submit**

Run the gate from the top of this plan.

```bash
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): show the owner's list on /list

A verified owner's /list now renders their list, as compact rows (D37):
a photo or a tile, the title, the price, how many they want and the
shop, with ideas marked as ideas. The server fetches the list and seeds
the editor's query cache, so a phone shows the list in the first HTML.
Copy share link, and Share where the browser has a share sheet, appear
once the list has an item. A photo that fails to load, even before the
page hydrates, falls back to a tile instead of a broken image.

An unconfirmed owner still gets the notice, which no longer claims an
email was sent, since we can't know it arrived (D38).

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `feat(web): show the owner's list on /list`.

---
### Task 3: Adding: the link-first box

**Files:**
- Create: `apps/web/src/lib/add-input.ts`, `apps/web/src/lib/add-input.spec.ts`
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.spec.ts`
- Modify: `apps/web/src/lib/form-errors.ts`, `apps/web/src/lib/form-errors.spec.ts`
- Create: `apps/web/src/components/ui/textarea.tsx`
- Create in `apps/web/src/components/list/`:
  - `use-list-mutations.ts`
  - `quantity-stepper.tsx`
  - `item-fields.tsx`
  - `add-form.tsx`
  - `add-item.tsx`
- Modify: `apps/web/src/components/list/list-editor.tsx`
- Create: `e2e/tests/local/add-item.spec.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `listMutations` (`create`);
  - Task 2's `useListStatus`, `ItemPhoto` and the icons;
  - `UnfurlResponseSchema`, `ItemTitleSchema`, `CreateItemRequestSchema` and `UnfurlResponse` from contracts;
  - `Field`, `Input`, `Button` and `formErrorMap`.
- **Produces:**
  - `lib/add-input`:
    - `type AddInput`;
    - `classifyAddInput(raw: string): AddInput`;
    - `interface ItemFormValues { title: string; url: string; imageUrl: string; priceText: string; note: string; quantity: number }`;
    - `prefill(url, titleHint, response): ItemFormValues`;
    - `formValuesOf(item: Item): ItemFormValues` (Task 4 uses it).
  - `lib/messages`:
    - `ADD_BOX_EMPTY`, `OTHER_SCHEME_LINK` and `LINK_TOO_LONG`;
    - `UNFURL_MESSAGES`, `UNFURL_RATE_LIMITED` and `UNFURL_FAILED`;
    - `prefillMessage(outcome, url): string`.
  - `components/ui/textarea`: `Textarea`.
  - `components/list/use-list-mutations`: `useListMutations()`.
  - `components/list/quantity-stepper`: `QuantityStepper({ id, value, onChange })`.
  - `components/list/item-fields`:
    - `type ItemForm`;
    - `ItemFields({ form, idPrefix })`;
    - `showFieldErrors(form, error): boolean`.
  - `components/list/add-form`: `AddForm`.
  - `components/list/add-item`: `AddItem`.

- [ ] **Step 1: Add the layer**

```bash
gh stack add web/add-item
```

- [ ] **Step 2: Write the failing unit tests**

Create `apps/web/src/lib/add-input.spec.ts`:

```ts
import type { Item } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { classifyAddInput, formValuesOf, prefill } from './add-input';

describe('classifyAddInput (Plan 3b rule 5)', () => {
  it('asks for something when the box is empty', () => {
    expect(classifyAddInput('')).toEqual({ kind: 'empty' });
    expect(classifyAddInput(' \t ')).toEqual({ kind: 'empty' });
  });

  it.each([
    ['https://shop.example/kettle', 'https://shop.example/kettle'],
    ['  https://shop.example/kettle  ', 'https://shop.example/kettle'],
    ['HTTPS://Shop.example/K', 'HTTPS://Shop.example/K'],
    ['http://shop.example', 'http://shop.example'],
  ])('reads %j as a link', (text, url) => {
    expect(classifyAddInput(text)).toEqual({ kind: 'link', url, titleHint: null });
  });

  it('finds the link in text a phone app shared, and keeps the rest as a title hint (Review Focus 1)', () => {
    expect(classifyAddInput('Garmin Approach CT10 https://a.co/d/xyz')).toEqual({
      kind: 'link',
      url: 'https://a.co/d/xyz',
      titleHint: 'Garmin Approach CT10',
    });
    expect(classifyAddInput('Look at this:\nhttps://a.co/d/xyz\n  Garmin  ')).toEqual({
      kind: 'link',
      url: 'https://a.co/d/xyz',
      titleHint: 'Look at this: Garmin',
    });
    // A text input drops the newline between the title and the link when it's pasted.
    expect(classifyAddInput('Garmin CT10https://a.co/d/xyz')).toMatchObject({
      url: 'https://a.co/d/xyz',
      titleHint: 'Garmin CT10',
    });
  });

  it.each([
    ['etsy.com/listing/123', 'https://etsy.com/listing/123'],
    ['www.shop.example', 'https://www.shop.example'],
    ['shop.example:8080/x?y=1', 'https://shop.example:8080/x?y=1'],
    ['Mr.Smith', 'https://Mr.Smith'],
  ])('adds https:// to %j, which looks like a shop address', (text, url) => {
    expect(classifyAddInput(text)).toEqual({ kind: 'link', url, titleHint: null });
  });

  it('refuses a link with another scheme', () => {
    expect(classifyAddInput('ftp://files.example/kettle')).toEqual({ kind: 'other-scheme' });
  });

  it.each(['a pottery class', 'e.g. socks', 'v1.2', 'javascript:alert(1)', 'http://'])(
    'reads %j as an idea',
    (text) => {
      expect(classifyAddInput(text)).toEqual({ kind: 'idea', title: text });
    },
  );
});

describe('prefill and formValuesOf (Plan 3b rules 6 and 7)', () => {
  it('fills the form from unfurl, then from the title hint, keeping the link', () => {
    expect(
      prefill('https://shop.example/k', 'Hint', {
        title: 'Kettle',
        imageUrl: 'https://cdn.example/k.jpg',
        priceText: '$40.00',
      }),
    ).toEqual({
      title: 'Kettle',
      url: 'https://shop.example/k',
      imageUrl: 'https://cdn.example/k.jpg',
      priceText: '$40.00',
      note: '',
      quantity: 1,
    });
    expect(
      prefill('https://shop.example/k', 'Hint', { failureReason: 'BLOCKED_BY_SITE' }),
    ).toMatchObject({ title: 'Hint', url: 'https://shop.example/k', imageUrl: '' });
    expect(prefill('https://shop.example/k', null, null).title).toBe('');
  });

  it('turns an item’s nulls into empty fields', () => {
    const item: Item = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Kettle',
      url: null,
      imageUrl: null,
      priceText: '$40',
      note: null,
      quantity: 2,
      position: 0,
    };
    expect(formValuesOf(item)).toEqual({
      title: 'Kettle',
      url: '',
      imageUrl: '',
      priceText: '$40',
      note: '',
      quantity: 2,
    });
  });
});
```

In `apps/web/src/lib/messages.spec.ts`, import `UNFURL_FAILURE_REASONS` and `ErrorCode` from `@wishlist/contracts`, and `prefillMessage`, `UNFURL_MESSAGES`, `UNFURL_RATE_LIMITED` and `UNFURL_FAILED` from `./messages`. Then append:

```ts
describe('prefillMessage (Plan 3b rule 6)', () => {
  it.each(UNFURL_FAILURE_REASONS)('explains %s in a sentence', (reason) => {
    expect(prefillMessage({ response: { failureReason: reason } }, 'https://x.example/')).toBe(
      UNFURL_MESSAGES[reason],
    );
  });

  it('names the shop a prefill came from', () => {
    expect(
      prefillMessage({ response: { title: 'Kettle' } }, 'https://www.hearthware.example/k'),
    ).toBe('Filled in from hearthware.example. Check it, then add it.');
  });

  it('says why when unfurl itself failed', () => {
    const limited = apiError(ErrorCode.RATE_LIMITED, { status: 429 });
    expect(prefillMessage({ error: limited }, 'https://x.example/')).toBe(UNFURL_RATE_LIMITED);
    expect(prefillMessage({ error: new TypeError('offline') }, 'https://x.example/')).toBe(
      UNFURL_FAILED,
    );
  });
});
```

In `apps/web/src/lib/form-errors.spec.ts`, import `QuantitySchema` from `@wishlist/contracts`, and append:

```ts
describe('formErrorMap for numbers', () => {
  it('speaks about a quantity, not characters', () => {
    expect(QuantitySchema.safeParse(0, { error: formErrorMap }).error?.issues[0]?.message).toBe(
      'Choose at least 1.',
    );
    expect(QuantitySchema.safeParse(100, { error: formErrorMap }).error?.issues[0]?.message).toBe(
      'Choose 99 or fewer.',
    );
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib`
Expected: FAIL. `./add-input` doesn't exist, `prefillMessage` isn't exported, and the number messages are still about characters.

- [ ] **Step 3: `add-input.ts`**

Create `apps/web/src/lib/add-input.ts`:

```ts
import type { Item, UnfurlResponse } from '@wishlist/contracts';

/** What the add box was given (spec §7 Owner editor, Plan 3b rule 5). */
export type AddInput =
  | { kind: 'empty' }
  | { kind: 'link'; url: string; titleHint: string | null }
  | { kind: 'other-scheme' }
  | { kind: 'idea'; title: string };

const HTTP_LINK = /https?:\/\/\S+/i;
/** One token shaped like a shop address: `shop.com`, `www.shop.com/x`, `shop.com:8080/x?y`. */
const SHOP_ADDRESS = /^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const OTHER_SCHEME = /^(?!https?:)[a-z][a-z\d+.-]*:\/\//i;

export function classifyAddInput(raw: string): AddInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  // A phone's share sheet sends "Product name https://…": the link is the item, the rest a hint.
  const link = HTTP_LINK.exec(text);
  if (link) {
    const rest = `${text.slice(0, link.index)} ${text.slice(link.index + link[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return { kind: 'link', url: link[0], titleHint: rest || null };
  }
  const oneToken = !/\s/.test(text);
  if (oneToken && SHOP_ADDRESS.test(text)) {
    return { kind: 'link', url: `https://${text}`, titleHint: null };
  }
  if (oneToken && OTHER_SCHEME.test(text)) return { kind: 'other-scheme' };
  return { kind: 'idea', title: text };
}

/** The add and edit forms' values: strings, as inputs hold them; the schema turns '' into null. */
export interface ItemFormValues {
  title: string;
  url: string;
  imageUrl: string;
  priceText: string;
  note: string;
  quantity: number;
}

/** A new item's form, from what unfurl found, else the title hint; the link is always kept. */
export function prefill(
  url: string,
  titleHint: string | null,
  response: UnfurlResponse | null,
): ItemFormValues {
  return {
    title: response?.title ?? titleHint ?? '',
    url,
    imageUrl: response?.imageUrl ?? '',
    priceText: response?.priceText ?? '',
    note: '',
    quantity: 1,
  };
}

/** An existing item's form. */
export function formValuesOf(item: Item): ItemFormValues {
  return {
    title: item.title,
    url: item.url ?? '',
    imageUrl: item.imageUrl ?? '',
    priceText: item.priceText ?? '',
    note: item.note ?? '',
    quantity: item.quantity,
  };
}
```

- [ ] **Step 4: The copy**

In `apps/web/src/lib/messages.ts`, add `type UnfurlFailureReason` and `type UnfurlResponse` to the `@wishlist/contracts` import, import `shopName` from `./item-display`, and append:

```ts
/** The add box (Plan 3b rule 5). */
export const ADD_BOX_EMPTY = 'Paste a link or type an idea.';
export const OTHER_SCHEME_LINK = 'Links must start with http:// or https://';
export const LINK_TOO_LONG = 'Use 2048 characters or fewer.';

const CANT_REACH = 'We couldn’t reach that page, so fill in the details yourself.';
const NO_DETAILS = 'We couldn’t find the details on that page, so fill them in yourself.';
const NOT_PUBLIC = 'That link doesn’t go to a public web page.';

/** Why a prefill came back empty: one sentence per reason, so a new reason needs its own (rule 6). */
export const UNFURL_MESSAGES: Readonly<Record<UnfurlFailureReason, string>> = {
  BLOCKED_BY_SITE: 'That shop didn’t let us read the page, so fill in the details yourself.',
  DNS_FAILED: 'We couldn’t find that site. Check the link, or fill in the details yourself.',
  TIMEOUT: CANT_REACH,
  UNREACHABLE: CANT_REACH,
  NOT_HTML: NO_DETAILS,
  TOO_LARGE: NO_DETAILS,
  NO_METADATA: NO_DETAILS,
  TOO_MANY_REDIRECTS: NO_DETAILS,
  INVALID_URL: NOT_PUBLIC,
  DISALLOWED_ADDRESS: NOT_PUBLIC,
};
export const UNFURL_RATE_LIMITED =
  'You’ve added a lot of links this hour, so fill in the details yourself.';
export const UNFURL_FAILED = 'We couldn’t read that page, so fill in the details yourself.';

/** The sentence above a new item's form: what unfurl found, or why it found nothing. */
export function prefillMessage(
  outcome: { response: UnfurlResponse } | { error: unknown },
  url: string,
): string {
  if ('error' in outcome) {
    return hasCode(outcome.error, ErrorCode.RATE_LIMITED) ? UNFURL_RATE_LIMITED : UNFURL_FAILED;
  }
  const { failureReason } = outcome.response;
  if (failureReason) return UNFURL_MESSAGES[failureReason];
  return `Filled in from ${shopName(url) ?? 'the page'}. Check it, then add it.`;
}
```

In `apps/web/src/lib/form-errors.ts`, make the `too_small` and `too_big` cases speak about numbers when the value is one. Put each `origin` line first in its case:

```ts
    case 'too_small':
      if (issue.origin === 'number') return `Choose at least ${String(issue.minimum)}.`;
      // …the existing lines, unchanged
    case 'too_big':
      if (issue.origin === 'number') return `Choose ${String(issue.maximum)} or fewer.`;
      return `Use ${String(issue.maximum)} characters or fewer.`;
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib`
Expected: PASS.

- [ ] **Step 5: Write the failing E2E test**

Create `e2e/tests/local/add-item.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from '../../support/a11y.js';
import { verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function addThroughTheBox(page: Page, text: string) {
  await page.getByLabel('Add to your list').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test('adds an idea in one step, and is ready for the next', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'idea');
  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class for two');
  await expect(status(page, 'Added “Pottery class for two”.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).toContainText('An idea');
  const box = page.getByLabel('Add to your list');
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
});

test('a link whose site can’t be found opens the form with the link kept (Plan 3b rule 6)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'dns');
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await expect(status(page, 'We couldn’t find that site.')).toBeVisible();
  await expect(page.getByLabel('Link')).toHaveValue('https://hanker-e2e.invalid/kettle');
  await expect(page.getByLabel('Title')).toBeFocused();
  await expectAccessible(page);
  await page.getByLabel('Title').fill('Enamel kettle');
  await page.getByLabel('Price').fill('$48.00');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Enamel kettle”.')).toBeVisible();
  const row = rowsOf(page).first();
  await expect(row).toContainText('$48.00');
  await expect(row).toContainText('2 wanted');
  await expect(row).toContainText('hanker-e2e.invalid');
});

test('text shared from a phone app becomes the title when the page gives none (Review Focus 1)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'shared');
  await page.goto('/list');
  await addThroughTheBox(page, 'Garmin Approach CT10 https://hanker-e2e.invalid/garmin');
  await expect(page.getByLabel('Title')).toHaveValue('Garmin Approach CT10');
  await expect(page.getByLabel('Link')).toHaveValue('https://hanker-e2e.invalid/garmin');
});

test('a shop address without https:// is read as a link', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'bare');
  await page.goto('/list');
  await addThroughTheBox(page, 'hanker-e2e.invalid/socks');
  await expect(page.getByLabel('Link')).toHaveValue('https://hanker-e2e.invalid/socks');
});

test('says why the box can’t take what was typed', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'refused');
  await page.goto('/list');
  await addThroughTheBox(page, '   ');
  await expect(page.getByText('Paste a link or type an idea.')).toBeVisible();
  await addThroughTheBox(page, 'ftp://files.example/kettle');
  await expect(page.getByText('Links must start with http:// or https://')).toBeVisible();
  await addThroughTheBox(page, 'K'.repeat(201));
  await expect(page.getByText('Use 200 characters or fewer.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
});

test('a rate-limited unfurl still opens the form, with the link kept (3a carry)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'limited');
  await page.route('**/api/wishlist/unfurl', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        code: 'RATE_LIMITED',
        requestId: 'e2e',
      }),
    }),
  );
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await expect(status(page, 'You’ve added a lot of links this hour')).toBeVisible();
  await expect(page.getByLabel('Link')).toHaveValue('https://hanker-e2e.invalid/kettle');
});

test('Cancel puts the text back in the box', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'cancel');
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const box = page.getByLabel('Add to your list');
  await expect(box).toHaveValue('https://hanker-e2e.invalid/kettle');
  await expect(box).toBeFocused();
});
```

Run: `pnpm test:e2e tests/local/add-item.spec.ts`
Expected: FAIL, because `/list` has no add box yet.

- [ ] **Step 6: The small pieces**

Create `apps/web/src/components/ui/textarea.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[17px] leading-snug text-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
```

Create `apps/web/src/components/list/use-list-mutations.ts`:

```ts
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { browserApi } from '@/lib/browser-api';
import { listMutations } from '@/lib/list-mutations';

/** The editor's mutation options, bound to this page's QueryClient and the browser API. */
export function useListMutations() {
  const client = useQueryClient();
  return useMemo(() => listMutations(client, browserApi), [client]);
}
```

Create `apps/web/src/components/list/quantity-stepper.tsx`:

```tsx
'use client';

import { MinusIcon, PlusIcon } from './icons';

const MIN = 1;
const MAX = 99;
const STEP =
  'inline-flex size-11 items-center justify-center rounded-control disabled:opacity-30';

/** "How many": 1–99 (spec §2). The number is an <output>, so a change is announced. */
export function QuantityStepper({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[15px] font-semibold">
        How many
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex h-12 items-center rounded-control border-[1.5px] border-input bg-card"
      >
        <button
          type="button"
          aria-label="Fewer"
          disabled={value <= MIN}
          onClick={() => onChange(value - 1)}
          className={STEP}
        >
          <MinusIcon />
        </button>
        <output id={id} className="min-w-6 text-center text-[17px] font-semibold">
          {value}
        </output>
        <button
          type="button"
          aria-label="More"
          disabled={value >= MAX}
          onClick={() => onChange(value + 1)}
          className={STEP}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: The shared fields**

Create `apps/web/src/components/list/item-fields.tsx`:

```tsx
'use client';

import type { CreateItemRequestSchema } from '@wishlist/contracts';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldErrors } from '@/lib/messages';
import { QuantityStepper } from './quantity-stepper';

/** The add and edit forms share one schema (Plan 3b rule 7). */
export type ItemForm = UseFormReturn<
  z.input<typeof CreateItemRequestSchema>,
  unknown,
  z.output<typeof CreateItemRequestSchema>
>;

const ITEM_FIELDS = ['title', 'url', 'imageUrl', 'priceText', 'note', 'quantity'] as const;
type ItemField = (typeof ITEM_FIELDS)[number];
const isItemField = (name: string): name is ItemField =>
  (ITEM_FIELDS as readonly string[]).includes(name);

/** Puts a 400's per-field messages on the form, focusing the first; false when there were none. */
export function showFieldErrors(form: ItemForm, error: unknown): boolean {
  const errors = Object.entries(fieldErrors(error)).filter(([name]) => isItemField(name));
  errors.forEach(([name, message], index) => {
    form.setError(name as ItemField, { message }, { shouldFocus: index === 0 });
  });
  return errors.length > 0;
}

/** Title, link, price, how many, photo link and note. No maxLength: the schema explains limits. */
export function ItemFields({ form, idPrefix }: { form: ItemForm; idPrefix: string }) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const id = (name: ItemField) => `${idPrefix}-${name}`;
  return (
    <div className="flex flex-col gap-3.5">
      <Field id={id('title')} label="Title" error={errors.title?.message}>
        {(props) => <Input {...props} {...register('title')} autoComplete="off" />}
      </Field>
      <Field id={id('url')} label="Link" error={errors.url?.message}>
        {(props) => (
          <Input {...props} {...register('url')} type="url" inputMode="url" autoComplete="off" />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_140px]">
          <Field id={id('priceText')} label="Price" error={errors.priceText?.message}>
            {(props) => <Input {...props} {...register('priceText')} autoComplete="off" />}
          </Field>
        </div>
        <Controller
          control={control}
          name="quantity"
          render={({ field }) => (
            <QuantityStepper id={id('quantity')} value={field.value ?? 1} onChange={field.onChange} />
          )}
        />
      </div>
      <Field id={id('imageUrl')} label="Photo link" error={errors.imageUrl?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('imageUrl')}
            type="url"
            inputMode="url"
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={id('note')}
        label="Note"
        hint="Gifters see this with the item."
        error={errors.note?.message}
      >
        {(props) => <Textarea {...props} {...register('note')} rows={3} />}
      </Field>
    </div>
  );
}
```

- [ ] **Step 8: The add form and the box**

Create `apps/web/src/components/list/add-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreateItemRequestSchema, type Item } from '@wishlist/contracts';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import type { ItemFormValues } from '@/lib/add-input';
import { formErrorMap } from '@/lib/form-errors';
import { ItemFields, showFieldErrors } from './item-fields';
import { ItemPhoto } from './item-photo';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

/** A new item, checked before it's added. It opens prefilled, or empty but for the link (rule 6). */
export function AddForm({
  initial,
  onAdded,
  onCancel,
}: {
  initial: ItemFormValues;
  onAdded: (item: Item) => void;
  onCancel: () => void;
}) {
  const { fail } = useListStatus();
  const create = useMutation(useListMutations().create);
  const form = useForm({
    resolver: zodResolver(CreateItemRequestSchema, { error: formErrorMap }),
    defaultValues: initial,
  });
  const { setFocus, setValue } = form;
  const photo = useWatch({ control: form.control, name: 'imageUrl' });

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      onAdded(await create.mutateAsync(values));
    } catch (error) {
      if (!showFieldErrors(form, error)) fail(error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="New item" className="mt-3.5 flex flex-col gap-3.5">
      {photo ? (
        <div className="flex items-center gap-3">
          <ItemPhoto item={{ url: initial.url, imageUrl: photo }} />
          <Button
            variant="link"
            size="compact"
            onClick={() => setValue('imageUrl', '', { shouldDirty: true })}
          >
            Remove photo
          </Button>
        </div>
      ) : null}
      <ItemFields form={form} idPrefix="add" />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add to list'}
        </Button>
      </div>
    </form>
  );
}
```

Create `apps/web/src/components/list/add-item.tsx`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import {
  ErrorCode,
  ItemTitleSchema,
  UnfurlResponseSchema,
  type Item,
} from '@wishlist/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { classifyAddInput, prefill, type ItemFormValues } from '@/lib/add-input';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import {
  ADD_BOX_EMPTY,
  fieldErrors,
  hasCode,
  LINK_TOO_LONG,
  OTHER_SCHEME_LINK,
  prefillMessage,
} from '@/lib/messages';
import { AddForm } from './add-form';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

type Step =
  | { step: 'box' }
  | { step: 'reading' }
  | { step: 'form'; values: ItemFormValues; message: string };

/** The link-first add box (spec §7 Owner editor, Plan 3b rules 5 and 6). */
export function AddItem() {
  const [text, setText] = useState('');
  const [boxError, setBoxError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ step: 'box' });
  // Bumped to move focus to the box once it has rendered again.
  const [focusBox, setFocusBox] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const { announce, fail } = useListStatus();
  const addIdea = useMutation(useListMutations().create);

  useEffect(() => {
    if (focusBox > 0) box.current?.focus();
  }, [focusBox]);

  function refuse(message: string) {
    setBoxError(message);
    setFocusBox((n) => n + 1);
  }

  function added(item: Item) {
    setText('');
    setStep({ step: 'box' });
    announce(`Added “${item.title}”.`);
    setFocusBox((n) => n + 1);
  }

  function cancel() {
    setStep({ step: 'box' });
    setFocusBox((n) => n + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBoxError(null);
    const input = classifyAddInput(text);
    if (input.kind === 'empty') return refuse(ADD_BOX_EMPTY);
    if (input.kind === 'other-scheme') return refuse(OTHER_SCHEME_LINK);
    if (input.kind === 'idea') {
      const title = ItemTitleSchema.safeParse(input.title, { error: formErrorMap });
      if (!title.success) return refuse(title.error.issues[0]?.message ?? ADD_BOX_EMPTY);
      try {
        added(await addIdea.mutateAsync({ title: title.data, quantity: 1 }));
      } catch (error) {
        const message = fieldErrors(error).title;
        if (message) refuse(message);
        else fail(error);
      }
      return;
    }
    if (input.url.length > 2048) return refuse(LINK_TOO_LONG);
    setStep({ step: 'reading' });
    try {
      const response = await browserApi.post(
        '/wishlist/unfurl',
        { url: input.url },
        UnfurlResponseSchema,
      );
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, response),
        message: prefillMessage({ response }, input.url),
      });
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) return fail(error);
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, null),
        message: prefillMessage({ error }, input.url),
      });
    }
  }

  const reading = step.step === 'reading';
  return (
    // Not a labelled region: the heading already labels the box, and one label should name one thing.
    <section className="mt-5 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id="add-heading" className="text-[15px] font-semibold">
        Add to your list
      </h2>
      {/* Always mounted, so the prefill's sentence is announced when the form opens. */}
      <div role="status">
        {step.step === 'form' ? (
          <p className="mt-1 text-sm text-muted-foreground">{step.message}</p>
        ) : null}
      </div>
      {step.step === 'form' ? (
        <AddForm initial={step.values} onAdded={added} onCancel={cancel} />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-2">
          <div className="flex gap-2">
            <Input
              ref={box}
              id="add-box"
              aria-labelledby="add-heading"
              aria-describedby={boxError ? 'add-box-error' : undefined}
              aria-invalid={boxError ? true : undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste a link or type an idea"
              readOnly={reading}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={reading || addIdea.isPending}>
              {reading ? 'Reading the page…' : 'Add'}
            </Button>
          </div>
          {boxError ? (
            <p id="add-box-error" className="mt-1.5 text-sm font-medium text-destructive">
              {boxError}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
```

In `apps/web/src/components/list/list-editor.tsx`, import `AddItem` from `./add-item`, and render `<AddItem />` between the share actions and the status line:

```tsx
      {hasItems ? <ShareActions title={list.title} shareUrl={list.shareUrl} /> : null}
      <AddItem />
      <ListStatusLine />
```

- [ ] **Step 9: Run the tests**

```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e tests/local/add-item.spec.ts tests/local/list.spec.ts
```

Expected: PASS.
- If `getByLabel('Title')` matches two fields, the add box's label is leaking. The box is labelled by the "Add to your list" heading, and only the form's field is "Title".
- If the `DNS_FAILED` sentence never appears, check that the API process can resolve names at all, for example `getent hosts example.com`. `.invalid` should fail fast with `ENOTFOUND`.

- [ ] **Step 10: Gate, commit, submit**

Run the gate from the top of this plan.

```bash
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): add items from a link or an idea

The add box takes "a link or an idea" (spec §7). A link, or text that
looks like a shop address, is unfurled and opens a form to check before
adding; text a phone's share sheet wraps around a link becomes the title
if the page gives none. Anything else is an idea, added in one step. A
failed or rate-limited unfurl still opens the form with the link kept,
with one sentence per failure reason saying why.

The add form and Task 4's edit form share one set of fields and one
schema, with no maxLength, so a too-long paste gets the schema's
message instead of being cut.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `feat(web): add items from a link or an idea`.

---
### Task 4: Editing and deleting in place

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (add `@radix-ui/react-alert-dialog@1.1.24`)
- Create: `apps/web/src/components/ui/alert-dialog.tsx`
- Modify: `apps/web/src/lib/messages.ts` (`FINISH_EDITING`)
- Modify: `apps/web/src/components/list/use-list-mutations.ts` (`useListMutation`)
- Create: `apps/web/src/components/list/item-edit-form.tsx`
- Modify: `apps/web/src/components/list/item-row.tsx`, `apps/web/src/components/list/item-list.tsx`
- Create: `e2e/tests/local/edit-item.spec.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `listMutations` (`update` and `remove`);
  - Task 3's `ItemFields`, `showFieldErrors`, `formValuesOf` and the `#add-box` input;
  - Task 2's `useListStatus`, `ItemSummary`, `ItemPhoto` and the icons.
- **Produces:**
  - `components/ui/alert-dialog`: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel` and `AlertDialogAction` (Task 6 reuses them).
  - `useListMutation(options, onFailure)`: a `useMutation` whose every failure reaches `onFailure`.
  - `ItemRow({ item, open, onToggle, titleButtonRef, children })`.
  - `ItemEditForm({ item, onDone, onDelete, onDeleteClosed, onDirtyChange })`.

- [ ] **Step 1: Add the layer and Radix's alert dialog**

```bash
gh stack add web/edit-item
npm view @radix-ui/react-alert-dialog@1.1.24 time.modified   # 2026-10-05: past the 3-day minimum
pnpm --filter @wishlist/web add --save-exact @radix-ui/react-alert-dialog@1.1.24
```

1.2.x was published on 2026-10-12, inside Renovate's 3-day window; Renovate will offer it later.

- [ ] **Step 2: Write the failing E2E test**

Create `e2e/tests/local/edit-item.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
/** A row's title button: its name starts with the title (the drag handle's and arrows' don't). */
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}`) });

test('edits an item in place, and the change survives a reload', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'edit');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    priceText: '$40',
    note: 'Blue',
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  const row = rowsOf(page).first();
  await expect(row.getByLabel('Title')).toBeFocused();
  await expectAccessible(page);
  await row.getByLabel('Title').fill('Stovetop kettle');
  await row.getByLabel('Price').fill('$48.00');
  await row.getByRole('button', { name: 'More' }).click();
  await row.getByLabel('Note').fill('Green, please');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Stovetop kettle”.')).toBeVisible();
  await expect(titleButton(page, 'Stovetop kettle')).toBeFocused();
  await expect(titleButton(page, 'Stovetop kettle')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(rowsOf(page).first()).toContainText('$48.00');
  await expect(rowsOf(page).first()).toContainText('2 wanted');
});

test('clearing the link and the photo turns an item into an idea (3a carry)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'clear');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    imageUrl: 'https://hanker-e2e.invalid/kettle.jpg',
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Link').fill('');
  await page.getByLabel('Photo link').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rowsOf(page).first()).toContainText('An idea');
  const { items } = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { url: string | null; imageUrl: string | null }[];
  };
  expect(items[0]).toMatchObject({ url: null, imageUrl: null });
});

test('says what’s wrong with a field, and Cancel throws the change away', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'invalid');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('  ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fill this in.')).toBeVisible();
  await expect(page.getByLabel('Title')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(titleButton(page, 'Kettle')).toBeFocused();
  await expect(page.getByLabel('Title')).toHaveCount(0);
});

test('one item is open at a time, and unsaved changes aren’t thrown away', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'one-open');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await addItemViaApi(page.request, base, { title: 'Socks' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('Kettle, blue');
  await titleButton(page, 'Socks').click();
  await expect(status(page, 'Save or cancel the item you’re editing first.')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Kettle, blue');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await titleButton(page, 'Socks').click();
  await expect(page.getByLabel('Title')).toHaveValue('Socks');
});

test('deletes only after asking, and moves focus to the next item', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'delete');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await addItemViaApi(page.request, base, { title: 'Socks' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete “Kettle”?' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeFocused();
  await expect(rowsOf(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted “Kettle”.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(titleButton(page, 'Socks')).toBeFocused();
  await page.reload();
  await expect(rowsOf(page)).toHaveCount(1);
});

test('an item deleted on another device can’t be saved here (Review Focus 4)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'gone');
  const item = await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  const gone = await page.request.delete(`/api/wishlist/items/${item.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(gone.status()).toBe(204);
  await page.getByLabel('Title').fill('Kettle, blue');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'That item was already removed, so we’ve reloaded your list.' }),
  ).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
});
```

Run: `pnpm test:e2e tests/local/edit-item.spec.ts`
Expected: FAIL, because rows don't open yet.

- [ ] **Step 3: The alert dialog**

Create `apps/web/src/components/ui/alert-dialog.tsx`, hand-copied in shadcn/ui's shape and put on our tokens:

```tsx
'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

/**
 * A question that needs an answer before anything happens. Radix traps focus inside it, closes on
 * Escape, and returns focus to the trigger unless onCloseAutoFocus moves it elsewhere.
 */
export function AlertDialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/50" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-background p-5 sm:p-6',
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('font-display text-3xl leading-tight [overflow-wrap:anywhere]', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('mt-2 text-[15px] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex flex-wrap justify-end gap-2', className)} {...props} />;
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: 'secondary' }), className)}
      {...props}
    />
  );
}

/** The confirming button: espresso, since terracotta is for making things, not destroying them. */
export function AlertDialogAction({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant: 'strong' }), className)}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Failures that always reach the status line**

TanStack fires `mutate(vars, { onError })` callbacks only for an observer's latest call. A second quick delete would therefore swallow the first one's failure. Composing the handler into the options avoids that. Append to `apps/web/src/components/list/use-list-mutations.ts`, and add `useMutation` and `type MutationOptions` to its `@tanstack/react-query` import:

```ts
/**
 * A list mutation whose every failure also reaches `onFailure`. Per-call mutate() callbacks fire
 * only for an observer's latest call, so quick repeated moves or deletes would lose one.
 */
export function useListMutation<D, V>(
  options: MutationOptions<D, unknown, V>,
  onFailure: (error: unknown) => void,
) {
  return useMutation<D, unknown, V>({
    ...options,
    onError: (error, ...rest) => {
      void options.onError?.(error, ...rest);
      onFailure(error);
    },
  });
}
```

In `apps/web/src/lib/messages.ts`, add:

```ts
/** Another row was tapped while the open one had unsaved changes (Plan 3b rule 8). */
export const FINISH_EDITING = 'Save or cancel the item you’re editing first.';
```

- [ ] **Step 5: The edit form**

Create `apps/web/src/components/list/item-edit-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreateItemRequestSchema, ErrorCode, type Item } from '@wishlist/contracts';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formValuesOf } from '@/lib/add-input';
import { formErrorMap } from '@/lib/form-errors';
import { hasCode } from '@/lib/messages';
import { TrashIcon } from './icons';
import { ItemFields, showFieldErrors } from './item-fields';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

/**
 * One item's form, opened in place (D37). Save sends all six fields, so a cleared field becomes
 * null (Plan 3b rule 7). Delete asks first.
 */
export function ItemEditForm({
  item,
  onDone,
  onDelete,
  onDeleteClosed,
  onDirtyChange,
}: {
  item: Item;
  onDone: () => void;
  onDelete: () => void;
  onDeleteClosed: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { announce, fail } = useListStatus();
  const update = useMutation(useListMutations().update);
  const form = useForm({
    resolver: zodResolver(CreateItemRequestSchema, { error: formErrorMap }),
    defaultValues: formValuesOf(item),
  });
  const { isDirty } = form.formState;
  const { setFocus } = form;
  // Set when Delete is confirmed, so closing the dialog moves focus on instead of back to Delete.
  const deleting = useRef(false);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync({ id: item.id, body: values });
      announce(`Saved “${saved.title}”.`);
      onDone();
    } catch (error) {
      if (showFieldErrors(form, error)) return;
      fail(error);
      // Gone on another device: the refetch removes the row, so close it now.
      if (hasCode(error, ErrorCode.NOT_FOUND)) onDone();
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={`Edit ${item.title}`}
      className="flex flex-col gap-3.5 px-3.5 pt-1.5 pb-4"
    >
      <ItemFields form={form} idPrefix={`edit-${item.id}`} />
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="link" size="compact" className="text-destructive">
              <TrashIcon />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (!deleting.current) return;
              event.preventDefault();
              onDeleteClosed();
            }}
          >
            <AlertDialogTitle>Delete “{item.title}”?</AlertDialogTitle>
            <AlertDialogDescription>It comes off your list. This can’t be undone.</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleting.current = true;
                  onDelete();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="flex-1" />
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: The row opens; the list keeps one open**

Replace `ItemRow` in `apps/web/src/components/list/item-row.tsx`. Keep `ItemSummary` as it is, and add `cn` and `type ReactNode, type Ref` to the imports:

```tsx
/** One row of the list (D37). Its title button opens the item's form in place, below it. */
export function ItemRow({
  item,
  open,
  onToggle,
  titleButtonRef,
  children,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
  titleButtonRef: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const formId = `edit-${item.id}`;
  return (
    <li
      className={cn(
        'border-t border-foreground/15 first:border-t-0',
        open && 'bg-background shadow-[inset_3px_0_0_var(--foreground)]',
      )}
    >
      <div className="flex items-center gap-1.5 py-2.5 pr-1 pl-2.5">
        <ItemPhoto item={item} />
        <button
          ref={titleButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={onToggle}
          className="min-h-14 min-w-0 flex-1 rounded-control px-1.5 text-left"
        >
          <ItemSummary item={item} />
        </button>
      </div>
      {open ? <div id={formId}>{children}</div> : null}
    </li>
  );
}
```

`aria-controls` is set only while the form exists, so it never points at a missing element.

Replace `apps/web/src/components/list/item-list.tsx`:

```tsx
'use client';

import type { Item } from '@wishlist/contracts';
import { useCallback, useRef, useState } from 'react';
import { FINISH_EDITING } from '@/lib/messages';
import { ItemEditForm } from './item-edit-form';
import { ItemRow } from './item-row';
import { useListStatus } from './list-status';
import { useListMutation, useListMutations } from './use-list-mutations';

/** The rows, one open at a time (Plan 3b rule 8). */
export function ItemList({ items }: { items: Item[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const dirty = useRef(false);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterDelete = useRef<string | null>(null);
  const { announce, fail } = useListStatus();
  const remove = useListMutation(useListMutations().remove, fail);

  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  function toggle(id: string) {
    if (openId !== null && openId !== id && dirty.current) {
      announce(FINISH_EDITING, 'info');
      return;
    }
    dirty.current = false;
    setOpenId((current) => (current === id ? null : id));
  }

  function done(id: string) {
    dirty.current = false;
    setOpenId(null);
    titleButtons.current.get(id)?.focus();
  }

  function deleteItem(item: Item) {
    const index = items.findIndex((i) => i.id === item.id);
    focusAfterDelete.current = items[index + 1]?.id ?? items[index - 1]?.id ?? null;
    dirty.current = false;
    setOpenId(null);
    remove.mutate(item.id);
    announce(`Deleted “${item.title}”.`);
  }

  function moveFocusAfterDelete() {
    const next = focusAfterDelete.current;
    (next ? titleButtons.current.get(next) : document.getElementById('add-box'))?.focus();
  }

  return (
    <ol
      aria-label="Your items, most wanted first"
      className="mt-5 overflow-hidden rounded-card border border-border bg-card"
    >
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          open={openId === item.id}
          onToggle={() => toggle(item.id)}
          titleButtonRef={(button) => {
            if (button) titleButtons.current.set(item.id, button);
            else titleButtons.current.delete(item.id);
          }}
        >
          <ItemEditForm
            item={item}
            onDone={() => done(item.id)}
            onDelete={() => deleteItem(item)}
            onDeleteClosed={moveFocusAfterDelete}
            onDirtyChange={setDirty}
          />
        </ItemRow>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e tests/local/edit-item.spec.ts tests/local/list.spec.ts tests/local/add-item.spec.ts
```

Expected: PASS.
- **Focus lands back on Delete after a confirmed delete:** Radix may fire `onCloseAutoFocus` after the row has unmounted. That's fine, because `deleting` is a ref in the closure. Make sure `event.preventDefault()` runs before `onDeleteClosed()`.
- **axe flags the open dialog:** check that the Title and Description elements are rendered. Radix links them with `aria-labelledby` and `aria-describedby`.

- [ ] **Step 8: Gate, commit, submit**

Run the gate from the top of this plan.

```bash
git add apps/web e2e pnpm-lock.yaml
git commit -F - <<'EOF'
feat(web): edit and delete items in place

Tapping a row opens its form in place, one row at a time (D37); a row
with unsaved changes stays open until it's saved or cancelled. Save
sends all six fields, so clearing the link or the photo stores null and
the item becomes an idea. Delete asks in an alert dialog, then removes
the row at once and moves focus to the next one. An item deleted on
another device says so and the list reloads.

Deletes report their failures through the mutation's options, since
TanStack fires per-call callbacks only for an observer's latest call.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `feat(web): edit and delete items in place`.

---
### Task 5: Reordering: drag by the handle, or the arrows

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (add `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` and `@dnd-kit/utilities@3.2.2`)
- Modify: `apps/web/src/components/list/item-row.tsx`, `apps/web/src/components/list/item-list.tsx`
- Create: `e2e/tests/local/reorder.spec.ts`

**Interfaces:**
- **Consumes:** Task 1's `move` mutation, Task 4's `useListMutation`, `ItemRow` and `ItemList`, and Task 2's icons.
- **Produces:** `ItemRow` gains these props:
  - `index: number`
  - `count: number`
  - `onMove: (step: -1 | 1) => void`
  - `arrowRef: (which: 'up' | 'down') => Ref<HTMLButtonElement>`

- [ ] **Step 1: Add the layer and dnd-kit**

```bash
gh stack add web/reorder
pnpm --filter @wishlist/web add --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
```

- [ ] **Step 2: Write the failing E2E test**

Create `e2e/tests/local/reorder.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** The titles in the API's order: what a reload would show. */
async function savedOrder(page: Page): Promise<string[]> {
  const { items } = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { title: string }[];
  };
  return items.map((item) => item.title);
}

async function ownerWith(page: Page, baseURL: string, label: string, titles: string[]) {
  await verifiedOwner(page, baseURL, label);
  for (const title of titles) await addItemViaApi(page.request, baseURL, { title });
  await page.goto('/list');
}

const arrow = (page: Page, title: string, way: 'up' | 'down') =>
  page.getByRole('button', { name: `Move “${title}” ${way}` });

test('moves an item with the arrows, keeping focus, and the order is saved', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'arrows', ['A', 'B', 'C']);
  await arrow(page, 'A', 'down').click();
  await expect(status(page, 'Moved “A” to position 2 of 3.')).toBeVisible();
  await expect(arrow(page, 'A', 'down')).toBeFocused();
  await arrow(page, 'A', 'down').click();
  // At the bottom, "down" is disabled, so focus moves to "up".
  await expect(arrow(page, 'A', 'down')).toBeDisabled();
  await expect(arrow(page, 'A', 'up')).toBeFocused();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'C', 'A']);
  await page.reload();
  await expect(page.getByRole('listitem').first()).toContainText('B');
});

test('moves an item with the keyboard, by its drag handle', async ({ page, baseURL }) => {
  await ownerWith(page, baseURL ?? '', 'keyboard', ['A', 'B', 'C']);
  await page.getByRole('button', { name: 'Drag “C” to reorder' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(() => savedOrder(page)).toEqual(['C', 'A', 'B']);
});

test('several quick moves all land, in order (Review Focus 2)', async ({ page, baseURL }) => {
  await ownerWith(page, baseURL ?? '', 'quick', ['A', 'B', 'C', 'D']);
  for (let n = 0; n < 3; n++) await arrow(page, 'A', 'down').click();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'C', 'D', 'A']);
  await expect(page.getByRole('alert').filter({ hasText: 'reloaded' })).toHaveCount(0);
});

test('a move made while an add is still on its way includes the new item (Review Focus 2)', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'in-flight', ['A', 'B']);
  // Hold the add, so the move is queued behind it.
  await page.route('**/api/wishlist/items', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByLabel('Add to your list').fill('C');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await arrow(page, 'B', 'up').click();
  await expect(status(page, 'Added “C”.')).toBeVisible();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'A', 'C']);
  await expect(page.getByRole('alert').filter({ hasText: 'reloaded' })).toHaveCount(0);
});

test('a stale order reloads the list and says why', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await ownerWith(page, base, 'stale', ['A', 'B']);
  await page.route(
    '**/api/wishlist/items/order',
    (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'ORDER_CONFLICT',
          requestId: 'e2e',
        }),
      }),
    { times: 1 },
  );
  await arrow(page, 'B', 'up').click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Your list changed on another device, so we’ve reloaded it.' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem').first()).toContainText('A');
});
```

Run: `pnpm test:e2e tests/local/reorder.spec.ts`
Expected: FAIL. There are no arrows or handles yet.

- [ ] **Step 3: The row gets a handle and arrows**

Replace `ItemRow` in `apps/web/src/components/list/item-row.tsx`. `ItemSummary` stays. Add these imports:
- `useSortable` from `@dnd-kit/sortable`;
- `CSS` from `@dnd-kit/utilities`;
- `ChevronDownIcon`, `ChevronUpIcon` and `GripIcon` from `./icons`.

```tsx
const ARROW = 'inline-flex size-11 items-center justify-center rounded-control disabled:opacity-30';

/**
 * One row of the list (D37). The handle drags it, and only the handle: touch-action is off there
 * alone, so a thumb can still scroll the page anywhere else (Plan 3b rule 12). The arrows move it
 * one place. While its form is open, it can't be dragged.
 */
export function ItemRow({
  item,
  index,
  count,
  open,
  onToggle,
  onMove,
  titleButtonRef,
  arrowRef,
  children,
}: {
  item: Item;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onMove: (step: -1 | 1) => void;
  titleButtonRef: Ref<HTMLButtonElement>;
  arrowRef: (which: 'up' | 'down') => Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: open });
  const formId = `edit-${item.id}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative border-t border-foreground/15 bg-card first:border-t-0',
        open && 'bg-background shadow-[inset_3px_0_0_var(--foreground)]',
        isDragging && 'z-10 shadow-[0_8px_18px_rgba(30,27,24,0.16)]',
      )}
    >
      <div className="flex items-center gap-1 py-2 pr-1 pl-0.5">
        {open ? (
          <span className="size-11 shrink-0" />
        ) : (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag “${item.title}” to reorder`}
            className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted-foreground"
          >
            <GripIcon />
          </button>
        )}
        <ItemPhoto item={item} />
        <button
          ref={titleButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={onToggle}
          className="min-h-14 min-w-0 flex-1 rounded-control px-1.5 text-left"
        >
          <ItemSummary item={item} />
        </button>
        <div className="flex shrink-0 flex-col">
          <button
            ref={arrowRef('up')}
            type="button"
            aria-label={`Move “${item.title}” up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className={ARROW}
          >
            <ChevronUpIcon />
          </button>
          <button
            ref={arrowRef('down')}
            type="button"
            aria-label={`Move “${item.title}” down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className={ARROW}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>
      {open ? <div id={formId}>{children}</div> : null}
    </li>
  );
}
```

- [ ] **Step 4: The list sorts**

In `apps/web/src/components/list/item-list.tsx`, make these changes, keeping everything Task 4 wrote.

**Imports:**

```tsx
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useCallback, useEffect, useRef, useState } from 'react';
```

**Inside `ItemList`**, after the `remove` line:

```tsx
  const move = useListMutation(useListMutations().move, fail);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const arrowButtons = useRef(new Map<string, HTMLButtonElement>());
  // The arrow to focus once a move has rendered. React moves a row's DOM node with insertBefore,
  // and a focused element that's removed and reinserted loses focus.
  const arrowToFocus = useRef<string | null>(null);

  useEffect(() => {
    const key = arrowToFocus.current;
    if (!key) return;
    arrowToFocus.current = null;
    arrowButtons.current.get(key)?.focus();
  }, [items]);

  /** One place up or down. Focus stays on the arrow pressed, or the other one if it's now disabled. */
  function moveBy(item: Item, index: number, step: -1 | 1) {
    const toIndex = index + step;
    const way = toIndex === 0 ? 'down' : toIndex === items.length - 1 ? 'up' : step < 0 ? 'up' : 'down';
    arrowToFocus.current = `${item.id}:${way}`;
    move.mutate({ id: item.id, toIndex });
    announce(`Moved “${item.title}” to position ${String(toIndex + 1)} of ${String(items.length)}.`);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const toIndex = items.findIndex((item) => item.id === over.id);
    if (toIndex !== -1) move.mutate({ id: String(active.id), toIndex });
  }

  const titleOf = (id: UniqueIdentifier) => items.find((item) => item.id === id)?.title ?? 'the item';
  const placeOf = (id: UniqueIdentifier) =>
    `position ${String(items.findIndex((item) => item.id === id) + 1)} of ${String(items.length)}`;
  // dnd-kit reads these to screen readers as a drag goes on (spec §7, Plan 3b rule 12).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${titleOf(active.id)}”, ${placeOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `“${titleOf(active.id)}” is over ${placeOf(over.id)}.`
        : `“${titleOf(active.id)}” is outside the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped “${titleOf(active.id)}” at ${placeOf(over.id)}.`
        : `Dropped “${titleOf(active.id)}” where it was.`,
    onDragCancel: ({ active }) =>
      `Cancelled. “${titleOf(active.id)}” is back at ${placeOf(active.id)}.`,
  };
```

**The returned JSX** wraps the `<ol>` and passes the new props:

```tsx
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move an item, press Space. Use the up and down arrow keys to choose its new place, then press Space to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ol
          aria-label="Your items, most wanted first"
          className="mt-5 overflow-hidden rounded-card border border-border bg-card"
        >
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              open={openId === item.id}
              onToggle={() => toggle(item.id)}
              onMove={(step) => moveBy(item, index, step)}
              titleButtonRef={(button) => {
                if (button) titleButtons.current.set(item.id, button);
                else titleButtons.current.delete(item.id);
              }}
              arrowRef={(which) => (button) => {
                const key = `${item.id}:${which}`;
                if (button) arrowButtons.current.set(key, button);
                else arrowButtons.current.delete(key);
              }}
            >
              <ItemEditForm
                item={item}
                onDone={() => done(item.id)}
                onDelete={() => deleteItem(item)}
                onDeleteClosed={moveFocusAfterDelete}
                onDirtyChange={setDirty}
              />
            </ItemRow>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
```

On the `<ol>`, `overflow-hidden` clips a dragged row's shadow. If a reviewer finds a dragged row clipped at the card's edge, use dnd-kit's `DragOverlay` rather than dropping the card's rounded corners.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e tests/local/reorder.spec.ts tests/local/edit-item.spec.ts tests/local/list.spec.ts
```

Expected: PASS.
- **The keyboard test moves nothing:** check that the handle carries `{...attributes}` before `aria-label`, so dnd-kit's `aria-describedby` and `tabIndex` reach it, and that `setActivatorNodeRef` is on the handle.
- **`list.spec.ts`'s axe check flags the handle's `aria-roledescription`:** that's dnd-kit's documented pattern. Report it rather than removing it.

- [ ] **Step 6: Gate, commit, submit**

Run the gate from the top of this plan.

```bash
git add apps/web e2e pnpm-lock.yaml
git commit -F - <<'EOF'
feat(web): reorder the list by dragging or with the arrows

Each row has a drag handle and up and down arrows (spec §7). Only the
handle drags, and only the handle turns touch-action off, so a thumb
can still scroll the page from anywhere else on a row. The keyboard
sensor drags with Space and the arrow keys, and every step is announced
in Hanker's words.

Every move sends the whole order through the list's mutation queue, so
quick repeated moves and a move made while an add is in flight all land
in order. A stale order reloads the list and says why. After an arrow
move, focus returns to the arrow pressed, or the other one when the
item reaches an end, since React reinserts the moved row and the
browser drops focus from it.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `feat(web): reorder the list by dragging or with the arrows`.

---
### Task 6: Settings: the list's name, its share link, and the delete dialog

**Files:**
- Create: `apps/web/src/components/account/list-name-form.tsx`, `apps/web/src/components/account/share-link-card.tsx`
- Modify: `apps/web/src/components/account/delete-account-form.tsx`
- Modify: `apps/web/src/app/(account)/settings/page.tsx`
- Create: `e2e/tests/local/settings.spec.ts`
- Modify: `e2e/tests/local/golden-path.spec.ts`, `e2e/tests/local/account.spec.ts` (the delete steps)

**Interfaces:**
- **Consumes:**
  - Task 2's `loadWishlist` and icons;
  - Task 4's alert dialog;
  - `UpdateWishlistRequestSchema`, `WishlistSettingsResponseSchema`, `RotateShareTokenResponseSchema` and `DeleteMeRequestSchema` from contracts;
  - `LOGIN_AGAIN` from `components/account/name-form`.
- **Produces:**
  - `ListNameForm({ title: string })`;
  - `ShareLinkCard({ shareUrl: string })`;
  - `DeleteAccountForm()`, now a dialog.

- [ ] **Step 1: Add the layer**

```bash
gh stack add web/list-settings
```

- [ ] **Step 2: Write the failing E2E tests**

Create `e2e/tests/local/settings.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { verifiedOwner } from '../../support/owner.js';

async function shareUrlOf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/wishlist')).json()) as { shareUrl: string })
    .shareUrl;
}

test('renames the list, and the list page shows the new name', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'rename');
  await page.goto('/settings');
  await page.getByLabel('List name').fill('Birthday, 2027');
  await page.getByRole('button', { name: 'Save list name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'List name saved' })).toBeVisible();
  await page.goto('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Birthday, 2027' })).toBeVisible();
});

test('gets a new share link only after asking, then shows and copies it', async ({
  page,
  baseURL,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, baseURL ?? '', 'rotate');
  const old = await shareUrlOf(page);
  // The share link is one long unbroken string; it must wrap at phone width.
  await expectFitsPhone(page, '/settings');
  await expect(page.getByText(old)).toBeVisible();

  await page.getByRole('button', { name: 'Get a new link' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Get a new share link?' });
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep this link' }).click();
  expect(await shareUrlOf(page)).toBe(old);

  await page.getByRole('button', { name: 'Get a new link' }).click();
  await dialog.getByRole('button', { name: 'Get a new link' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'New link ready. The old one no longer works.' }),
  ).toBeVisible();
  const fresh = await shareUrlOf(page);
  expect(fresh).not.toBe(old);
  await expect(page.getByText(fresh)).toBeVisible();

  await page.getByRole('button', { name: 'Copy link' }).click();
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(fresh);
});

test('deletes the account only from its dialog, with the right password (D38)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'delete-dialog');
  await page.goto('/settings');
  // No password field on the page itself, so autofill can't make deleting one click.
  await expect(page.getByLabel('Your password')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await expect(dialog.getByLabel('Your password')).toBeFocused();
  await expectAccessible(page);
  await dialog.getByLabel('Your password').fill('not my password');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByText('That password isn’t right.')).toBeVisible();
  await dialog.getByLabel('Your password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
});

test('an unconfirmed owner gets no list settings', async ({ page, baseURL }) => {
  const email = uniqueEmail('unverified-settings');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Share link' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your name' })).toBeVisible();
});
```

Update the two existing delete flows, which now go through the dialog:
- **`golden-path.spec.ts`:** replace its last three steps (fill 'Your password', click 'Delete account', expect `/`) with:
  ```ts
  await page.getByRole('button', { name: 'Delete account' }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await deleteDialog.getByLabel('Your password').fill(NEW_PASSWORD);
  await deleteDialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
  ```
- **`account.spec.ts`,** in 'deletes the account after the password, and signs out': make the same change with `PASSWORD`, and leave the Back assertions as they are.

Run: `pnpm test:e2e tests/local/settings.spec.ts`
Expected: FAIL. There's no list-name field yet, and the password field is still on the page.

- [ ] **Step 3: The list's name**

Create `apps/web/src/components/account/list-name-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ErrorCode,
  UpdateWishlistRequestSchema,
  WishlistSettingsResponseSchema,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/** The list's title, which heads the list and the page gifters open (spec §2). */
export function ListNameForm({ title }: { title: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(UpdateWishlistRequestSchema, { error: formErrorMap }),
    defaultValues: { title },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    try {
      await browserApi.patch('/wishlist', values, WishlistSettingsResponseSchema);
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      const message = fieldErrors(error).title;
      if (message) setError('title', { message }, { shouldFocus: true });
      else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="list-name-heading">
      <h2 id="list-name-heading" className="font-display text-3xl">
        Your list
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Its name is the heading people see when they open your link.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="listTitle" label="List name" error={errors.title?.message}>
            {(props) => <Input {...props} {...register('title')} autoComplete="off" />}
          </Field>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Save list name
        </Button>
      </form>
      <div role="status">
        {saved ? (
          <Notice tone="success" announce={false} className="mt-4">
            List name saved
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 4: The share link**

Create `apps/web/src/components/account/share-link-card.tsx`:

```tsx
'use client';

import { ErrorCode, RotateShareTokenResponseSchema } from '@wishlist/contracts';
import { useState } from 'react';
import { CopyIcon } from '@/components/list/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/** The share link: copy it, or replace it after a confirmation (spec §2, Plan 3b rule 13). */
export function ShareLinkCard({ shareUrl: initial }: { shareUrl: string }) {
  const [shareUrl, setShareUrl] = useState(initial);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const say = (text: string) => setMessage((last) => ({ text, id: (last?.id ?? 0) + 1 }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${shareUrl}`);
    }
  }

  async function rotate() {
    setRotating(true);
    setFormError(null);
    try {
      const rotated = await browserApi.post(
        '/wishlist/share-token/rotate',
        {},
        RotateShareTokenResponseSchema,
      );
      setShareUrl(rotated.shareUrl);
      say('New link ready. The old one no longer works.');
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      setFormError(errorMessage(error));
    } finally {
      setRotating(false);
    }
  }

  return (
    <Card aria-labelledby="share-heading">
      <h2 id="share-heading" className="font-display text-3xl">
        Share link
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Anyone with this link can see your list.
      </p>
      <p className="mt-4 rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[15px] [overflow-wrap:anywhere]">
        {shareUrl}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="compact" onClick={() => void copy()}>
          <CopyIcon />
          Copy link
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" size="compact" disabled={rotating}>
              Get a new link
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Get a new share link?</AlertDialogTitle>
            <AlertDialogDescription>
              Your old link stops working right away. Anyone you sent it to will need the new one.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep this link</AlertDialogCancel>
              <AlertDialogAction onClick={() => void rotate()}>Get a new link</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 5: Deleting the account asks first (D38)**

Replace `apps/web/src/components/account/delete-account-form.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DeleteMeRequestSchema, ErrorCode } from '@wishlist/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode, WRONG_PASSWORD } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/**
 * The password lives in a dialog that only an explicit click opens, so a browser that autofills
 * passwords can't make deleting the account one click (D38). The API clears the cookie on success.
 */
export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(DeleteMeRequestSchema, { error: formErrorMap }),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.delete('/me', NoContentSchema, values);
      // Full navigations, here and below: a soft one leaves the deleted account's pages in the
      // router's cache for Back to restore (see AccountHeader).
      window.location.replace('/');
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('password', { message: WRONG_PASSWORD }, { shouldFocus: true });
      } else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="font-display text-3xl">
        Delete account
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Deletes your account, your list and every claim on it. This can’t be undone.
      </p>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            reset();
            setFormError(null);
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="strong" className="mt-5">
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            setFocus('password');
          }}
        >
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            Your account, your list and every claim on it go for good. Enter your password to
            confirm.
          </AlertDialogDescription>
          <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
            <Field id="deletePassword" label="Your password" error={errors.password?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </Field>
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <AlertDialogFooter className="mt-1">
              <AlertDialogCancel>Keep my account</AlertDialogCancel>
              {/* A plain submit, not AlertDialogAction, so a wrong password keeps the dialog open. */}
              <Button type="submit" variant="strong" disabled={isSubmitting}>
                Delete account
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 6: The settings page**

Replace `apps/web/src/app/(account)/settings/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { DeleteAccountForm } from '@/components/account/delete-account-form';
import { ListNameForm } from '@/components/account/list-name-form';
import { NameForm } from '@/components/account/name-form';
import { PasswordForm } from '@/components/account/password-form';
import { ShareLinkCard } from '@/components/account/share-link-card';
import { requireMe } from '@/lib/require-me';
import { loadWishlist } from '@/lib/wishlist.server';

export const metadata: Metadata = { title: 'Settings' };

/** Account and list settings (spec §7). The list's cards need a confirmed email, as the API does. */
export default async function SettingsPage() {
  const me = await requireMe('/settings');
  const list = me.emailVerified ? await loadWishlist('/settings') : null;
  return (
    <>
      <AccountHeader current="settings" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Settings</h1>
        <p className="mt-2.5 text-muted-foreground">Signed in as {me.email}</p>
        <div className="mt-10 flex flex-col gap-5">
          <NameForm displayName={me.displayName} />
          {list ? (
            <>
              <ListNameForm title={list.title} />
              <ShareLinkCard shareUrl={list.shareUrl} />
            </>
          ) : null}
          <PasswordForm />
          <DeleteAccountForm />
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @wishlist/web exec vitest run
pnpm test:e2e tests/local/settings.spec.ts tests/local/account.spec.ts tests/local/golden-path.spec.ts tests/local/pages.spec.ts
```

Expected: PASS.
- **The password field isn't focused when the dialog opens:** `onOpenAutoFocus` runs before the field mounts. Move `setFocus('password')` into a `requestAnimationFrame` callback, and say so in your report.

- [ ] **Step 8: Gate, commit, submit**

Run the gate from the top of this plan.

```bash
git add apps/web e2e
git commit -F - <<'EOF'
feat(web): rename the list, rotate its link, and confirm account deletion

Settings gains the list's name and its share link (spec §7). Getting a
new link asks first, because the old one stops working at once. Both
cards appear only for a confirmed email, since the API refuses anyone
else.

Deleting the account now happens in a dialog that holds the password
field (D38). With the field on the page, a browser that autofilled
passwords made deleting the account a single click.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `feat(web): rename the list, rotate its link, and confirm account deletion`.

---
### Task 7: A lost session can't leave signed-in pages for Back, then docs

**Files:**
- Create: `apps/web/src/lib/soft-navigation.ts`, `apps/web/src/lib/soft-navigation.spec.ts`
- Create: `apps/web/src/components/auth/fresh-document.tsx`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `e2e/tests/local/session-ended.spec.ts`
- Modify: `e2e/tests/local/golden-path.spec.ts` (build a list on the way)
- Modify: `docs/development.md`, `AGENTS.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`

**Interfaces:**
- **Consumes:** E2E `verifiedOwner`, `addItemViaApi`, `logInViaApi` and `PASSWORD`.
- **Produces:**
  - `cameByClientNavigation(documentUrl: string, currentUrl: string): boolean`;
  - `FreshDocument()`.

- [ ] **Step 1: Add the layer**

```bash
gh stack add web/finish-3b
```

- [ ] **Step 2: Reproduce the bug first**

Plan 2b's final review found the bug by reading code: when `requireMe` or the proxy sends a signed-out visitor to login during a client-side navigation, the router's in-memory cache keeps the signed-in pages, and Back restores them. Ted's debugging rule (`~/.claude/CLAUDE.md`) needs it reproduced before it's fixed.

Create `e2e/tests/local/session-ended.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { logInViaApi, PASSWORD } from '../../support/accounts.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

test('after the session ends on another device, Back from login can’t show signed-in pages (D38)', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const phone = await browser.newContext({ baseURL: base });
  const page = await phone.newPage();
  const email = await verifiedOwner(page, base, 'ended');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  // A password change on another device ends every other session (spec §6.1).
  const laptop = await browser.newContext({ baseURL: base });
  expect(await logInViaApi(laptop.request, base, email)).toBe(204);
  const changed = await laptop.request.post('/api/me/password', {
    headers: { origin: base },
    data: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase 2' },
  });
  expect(changed.status()).toBe(204);

  // The phone's next client-side navigation finds its session gone, and lands on login.
  await nav.getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/login?next=%2Flist');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.goBack();
  await expect(page.getByText(`Signed in as ${email}`)).toBeHidden();
  await expect(page).toHaveURL('/login?next=%2Fsettings');
  await laptop.close();
  await phone.close();
});
```

Run: `pnpm test:e2e tests/local/session-ended.spec.ts`

Expected: FAIL. After `goBack()`, "Signed in as …" is visible: the router restored `/settings` from its cache.

**If it passes instead,** the bug doesn't reproduce in Next 16.4. Stop. Keep the test as a guard, skip Steps 3 and 4, and report it as a finding. Don't write a fix for a bug you can't see.

- [ ] **Step 3: The failing unit test**

Create `apps/web/src/lib/soft-navigation.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cameByClientNavigation } from './soft-navigation';

describe('cameByClientNavigation (Plan 3b rule 14)', () => {
  const login = 'https://hanker.dev/login?next=%2Flist';

  it('is false when this document was loaded here', () => {
    expect(cameByClientNavigation(login, login)).toBe(false);
  });

  it('is true when the document was loaded at another page', () => {
    expect(cameByClientNavigation('https://hanker.dev/settings', login)).toBe(true);
    expect(cameByClientNavigation('https://hanker.dev/login?next=%2Fsettings', login)).toBe(true);
  });

  it('ignores the fragment', () => {
    expect(cameByClientNavigation(`${login}#form`, login)).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/web exec vitest run src/lib/soft-navigation.spec.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 4: The fix**

Create `apps/web/src/lib/soft-navigation.ts`:

```ts
/**
 * Whether this page was reached by a client-side navigation: the URL this document loaded at
 * (`performance`'s navigation entry) isn't the page's URL now. The fragment doesn't count.
 */
export function cameByClientNavigation(documentUrl: string, currentUrl: string): boolean {
  const loaded = new URL(documentUrl);
  const now = new URL(currentUrl);
  return loaded.pathname + loaded.search !== now.pathname + now.search;
}
```

Create `apps/web/src/components/auth/fresh-document.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { cameByClientNavigation } from '@/lib/soft-navigation';

/**
 * Reloads the login page when a client-side navigation brought it here with `next`, which is how
 * requireMe and the proxy send someone whose session has ended. The router's in-memory cache still
 * holds the signed-in pages they left, and Back would restore them. A fresh document drops that
 * cache (D38, Plan 3b rule 14).
 */
export function FreshDocument() {
  useEffect(() => {
    const [entry] = performance.getEntriesByType('navigation');
    const here = window.location.href;
    if (!entry || !new URL(here).searchParams.has('next')) return;
    if (cameByClientNavigation(entry.name, here)) window.location.replace(here);
  }, []);
  return null;
}
```

In `apps/web/src/app/(auth)/login/page.tsx`, import `FreshDocument` and render it first inside `<AuthPage>`:

```tsx
    <AuthPage action="signup">
      <FreshDocument />
      <div className="mx-auto mt-16 max-w-[460px]">
```

Run:
```bash
pnpm --filter @wishlist/web exec vitest run src/lib/soft-navigation.spec.ts
pnpm test:e2e tests/local/session-ended.spec.ts tests/local/login.spec.ts tests/local/account.spec.ts
```
Expected: PASS. `login.spec.ts` must still pass: a person who opens `/login` directly never reloads.

- [ ] **Step 5: The golden path builds a list**

Spec §8's golden path is "signup → verify → build list → reorder → share → …"; the claim half arrives in Plan 4. In `e2e/tests/local/golden-path.spec.ts`:
- give the test `context`, and start it with `await context.grantPermissions(['clipboard-read', 'clipboard-write']);`;
- after the first login's `Ada’s wishlist` heading assertion, insert:

```ts
  // Build a list, reorder it, and copy the link to share (spec §8).
  const box = page.getByLabel('Add to your list');
  await box.fill('Pottery class for two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added “Pottery class for two”.' })).toBeVisible();
  await box.fill('Enamel kettle https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Enamel kettle');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByRole('button', { name: 'Move “Enamel kettle” up' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Enamel kettle');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();
```

Run: `pnpm test:e2e tests/local/golden-path.spec.ts`
Expected: PASS.

- [ ] **Step 6: Docs and the roadmap**

**`docs/development.md`:** add this section after `## Trying the owner API`:

```markdown
## Trying the editor

With `pnpm dev` running, sign up at http://localhost:3000/signup, confirm the email from Mailpit, log in, and open `/list`.

- Pasting a shop link unfurls it from your machine. A link to a `.invalid` host, such as `https://hanker-e2e.invalid/kettle`, fails fast with "We couldn’t find that site", which is how the E2E tests reach the add form without depending on a real shop.
- The editor's changes go through one TanStack Query mutation queue (`apps/web/src/lib/list-mutations.ts`). Its unit tests run that queue against a real `QueryClient`.
```

**`AGENTS.md`:** in `## Conventions`, under **Web:**, add a bullet after the one about account forms:

```markdown
  - The `/list` editor keeps the list in one TanStack Query cache (`lib/list-cache.ts`). Every list change is a mutation from `lib/list-mutations.ts`, in one scope, so changes reach the API in order; a failure refetches the list rather than restoring a snapshot.
```

**`docs/superpowers/plans/2026-10-07-roadmap.md`:**
- link row 3a's name to `2026-10-12-plan-3a-owner-api.md`, as rows 2a and 2b link theirs;
- link row 3b's name to `2026-10-13-plan-3b-owner-web.md`, and set its status to `Done`.

Check what still refers to work this plan finishes:

```bash
grep -rn "Plan 3b\|until Plan 3\b" apps/web/src docs/development.md AGENTS.md
```

Every hit should describe the code as it now is. In particular, `list/page.tsx`'s old "until Plan 3b brings the list editor" comment is gone, because Task 2 replaced the page.

- [ ] **Step 7: Gate, commit, submit**

Run the gate from the top of this plan, with `pnpm format:check || (pnpm exec prettier --write docs AGENTS.md && pnpm format:check)` in place of its first line.

```bash
git add apps/web e2e docs AGENTS.md
git commit -F - <<'EOF'
fix(web): keep a lost session's pages from Back, and document the editor

When requireMe or the proxy sends someone whose session has ended to
login during a client-side navigation, the router's in-memory cache
still holds the signed-in pages they left, and Back restored them
(D38). The login page now reloads itself when a client-side navigation
brought it there with `next`, so the cache goes with the old document.
An E2E test reproduces it: a password change on another device, then a
navigation, then Back.

The golden path now builds, reorders and shares a list. The
development guide shows how to try the editor, AGENTS.md records the
mutation-queue convention, and the roadmap marks Plan 3b done.

Co-Authored-By: <the model that actually wrote this> <noreply@anthropic.com>
EOF
gh stack submit --open
```

Title the PR `fix(web): keep a lost session's pages from Back, and document the editor`.

Expected: every PR in `owner-web` passes its required checks (`checks`, `actionlint`, `integration`, `migrations-lint` and `e2e`), and has a preview.

---

### Task 8: ⏸ CHECKPOINT: Ted tries the editor, merges `owner-web`, production is verified (still dark)

**Files:** none. The controller runs this with Ted.

- [ ] **Step 1: Ted uses the top preview on a phone**

Previews use Turnstile's always-pass test keys and log emails instead of sending them, so a preview is the one place a real account can reach the editor.

1. On a phone, open the top PR's web alias (`https://<PREVIEW_ALIAS_PREFIX><n>.vercel.app/signup`) and sign up.
2. Find the verification link in the **wishlist-api** preview deployment's logs in the Vercel dashboard (search for `verify-email`). Open it, press Confirm, then log in.
3. On `/list`:
   - add a product from a shop's app with its Share button;
   - add an idea;
   - open an item, change its quantity and note, and save;
   - drag one item by its handle, and move another with the arrows;
   - delete an item;
   - press Share (the system share sheet), then Copy share link.
4. In Settings, rename the list, get a new link, and open the delete dialog. Press "Keep my account".

Expected: every step works with a thumb. Nothing scrolls sideways, and dragging never fights the page's scrolling. Note anything that felt wrong; it's input for a follow-up, not a blocker unless something is broken.

- [ ] **Step 2: The screen-reader pass (D38)**

With VoiceOver (iOS or macOS) or NVDA:
- **A field error is read when it takes focus.** Save an item with an empty title, and in Settings change the password with a wrong current one. This is Plan 2b's open timing question.
- **The status line is read.** Add an item, then move one with an arrow.
- **Dragging with the keyboard is announced:** the instructions, "Picked up …", "… is over position …" and "Dropped …".
- **Each dialog says what it is and what it asks.**

Note anything not read, or read twice.

- [ ] **Step 3: Ted merges the stack**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 4: Verify production**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
APP=$(gh variable get APP_PRODUCTION_ORIGIN)
curl -s "$APP/api/health" | jq -c '{sha, db}'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$APP/list"
curl -s "$APP/api/wishlist" | jq -r .code
curl -s -X POST "$APP/api/auth/signup" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase","displayName":"Probe","turnstileToken":"x"}' | jq -r .code
```

Expected:
- **Deploy:** 7/7, including smoke.
- **Health:** the merge's `sha`, and `db.migrationsApplied` is 3 (no new migration).
- **`/list` without a cookie:** `307` to `/login?next=%2Flist`.
- **`GET /api/wishlist`:** `UNAUTHENTICATED`.
- **Sign-up:** `CAPTCHA_UNAVAILABLE`, so it's still dark (D31).
