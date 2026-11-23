# Clean Pasted Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a link is pasted into the add box, the add form's Link field or the edit form's Link field, known tracking, campaign and affiliate parameters are removed before the owner saves it. Everything that might describe the item stays.

**Architecture:** a pure `cleanLink()` in `packages/contracts`, which edits the pasted string in place and never re-serializes it. On the web, `classifyAddInput()` applies it to every link it finds, which covers the add box and the add form's paste. The edit form gets a paste-only `onLinkInput` that swaps in the cleaned link. The API is unchanged.

**Tech Stack:** TypeScript, Vitest + fast-check, React Hook Form, Playwright. No new dependency.

**Spec:** [`docs/superpowers/specs/2026-11-22-clean-pasted-links-design.md`](../specs/2026-11-22-clean-pasted-links-design.md) (D118), approved by Ted on 2026-11-22.

## Global Constraints

- Everything in [AGENTS.md](../../../AGENTS.md) applies: ESM; `.js` relative imports in `contracts`; `import type` for types; exact pins; behavior changes written test-first; unit tests never touch Docker.
- `packages/contracts` compiles without DOM or Node types. Reach `URL` through the same `globalThis` cast that `retailers.ts` uses.
- **When in doubt, keep it.** A parameter is removed only if its name is on a list below. Every other parameter, the path (apart from Amazon's `/ref=…`) and the fragment are kept.
- **No re-serializing.** The output is the input string with whole `name=value` segments (and Amazon `/ref=` segments) cut out. Case, encoding, `+`, trailing slashes, ports and IDN hosts are kept as typed. A link with nothing to remove comes back `===` the input.
- No ClearURLs regex or data is copied. Only parameter names we can show are tracking are used.
- Typed text in the Link field is never cleaned; only pasted text is. The API saves what it is sent.
- Lands as a three-layer `gh stack` (contracts → web → docs). The first `gh stack submit --open` needs Ted's approval (AGENTS.md).

## Review Focus

1. **Encoding of kept parameters.** `?q=a%20b+c&utm_source=x` must become `?q=a%20b+c`, not `?q=a+b+c`. `URLSearchParams.toString()` would rewrite it, which is why cleaning works on raw segments. *(Task 1 test: "keeps the kept parameters byte for byte")*
2. **The fragment is never touched**, even when it looks like a query string: SPA shops route with `#/product?utm_source=x`. *(Task 1 test: "never touches the fragment")*
3. **Look-alike and other-country hosts.** `notamazon.com` and `amazon.com.evil.test` get only the global rules, and so does `amazon.co.uk` (the spec keys site rules to `retailers.ts`'s hosts). So `tag=` stays on amazon.co.uk: a known limitation, not a bug. *(Task 1 test: "applies Amazon's rules only to Amazon's hosts")*
4. **Cleaning can bring a link under the length limit.** `pastedLink()` checks `LINK_MAX` against the cleaned link, so a 2,100-unit link that is mostly `utm_` is read. *(Task 2 test: "checks the length of the cleaned link")*
5. **Odd query segments:** an empty segment (`a=1&&b=2`), a name with no `=` (`?gift`), repeated names, and a malformed percent-escape in a name (`%zz=1`) are kept and never throw. *(Task 1 test: "keeps segments it can't read, and never throws")*

---

### Task 1: `cleanLink()` in contracts

**Files:**
- Create: `packages/contracts/src/url.ts`: the `WhatwgUrl`/`parse` helper and the Amazon, Etsy and eBay host sets, moved out of `retailers.ts`. It is internal, so don't export it from `index.ts`.
- Modify: `packages/contracts/src/retailers.ts`: import those from `./url.js`. No behavior change; `retailers.spec.ts` must pass untouched.
- Create: `packages/contracts/src/links.ts`
- Modify: `packages/contracts/src/index.ts`: add `export * from './links.js';`
- Test: `packages/contracts/src/links.spec.ts`

**Interfaces:**
- Produces: `export function cleanLink(url: string): string`. It never throws, and its input is a whole http(s) link.

**Lists (exact, matched case-insensitively against the percent-decoded parameter name):**

| Scope | Hosts | Remove: exact names | Remove: prefixes | Path rule |
| --- | --- | --- | --- | --- |
| Global | any | `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `igshid`, `igsh`, `_ga`, `_gl` | `utm_` | none |
| Share IDs | `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `open.spotify.com` | `si` | none | none |
| Amazon | `AMAZON_HOSTS` | `ref`, `ref_`, `tag`, `ascsubtag`, `linkcode`, `linkid`, `creative`, `creativeasin`, `camp`, `content-id`, `qid`, `sr`, `sprefix`, `crid`, `dib`, `dib_tag`, `social_share`, `starsleft`, `spia`, `sp_csd` | `pd_rd_`, `pf_rd_` | remove each `/ref=[^/?#]*` path segment |
| eBay | `EBAY_HOSTS` | `_trkparms`, `_trksid`, `_from`, `mkevt`, `mkcid`, `mkrid`, `campid`, `toolid`, `customid` | none | none |
| Etsy | `ETSY_HOSTS` | `click_key`, `click_sum`, `organic_search_click`, `ref`, `pro`, `frs`, `sts`, `sr_prefetch`, `pf_from` | `ga_` | none |

Kept on purpose (pin each one in a test): Amazon `th`, `psc`, `smid`; eBay `var`, `hash`; Etsy `variation0`; Shopify `variant`.

- [ ] **Step 1: Move the parser and host sets into `url.ts`, then run `pnpm --filter @wishlist/contracts test`.** Expected: PASS, with `retailers.spec.ts` unchanged.

- [ ] **Step 2: Write the failing tests in `links.spec.ts`**

```ts
describe('cleanLink (D118)', () => {
  it.each([
    ['https://shop.example/kettle?utm_source=ig&utm_medium=social', 'https://shop.example/kettle'],
    ['https://shop.example/kettle?color=blue&fbclid=abc', 'https://shop.example/kettle?color=blue'],
    ['https://shop.example/kettle?UTM_Campaign=x&size=m', 'https://shop.example/kettle?size=m'],
    ['https://youtu.be/abc?si=xyz&t=30', 'https://youtu.be/abc?t=30'],
  ])('removes global tracking from %s', (input, expected) => {
    expect(cleanLink(input)).toBe(expected);
  });

  it('keeps si where it is not a known share ID', () => {
    expect(cleanLink('https://shop.example/x?si=2')).toBe('https://shop.example/x?si=2');
  });

  it('cleans an Amazon product link, keeping the variant and seller', () => {
    expect(
      cleanLink(
        'https://www.amazon.com/Stagg-Kettle/dp/B08FK7B2SC/ref=sr_1_3?crid=2X&keywords=kettle&qid=17&sr=8-3&th=1&psc=1&smid=A1&tag=someone-20&pd_rd_w=Q&pf_rd_p=Z',
      ),
    ).toBe('https://www.amazon.com/Stagg-Kettle/dp/B08FK7B2SC?th=1&psc=1&smid=A1');
  });

  it('cleans an eBay item link, keeping var and hash', () => {
    expect(
      cleanLink('https://www.ebay.com/itm/226447947273?var=525779043744&hash=item34b8&_trksid=p1&mkevt=1'),
    ).toBe('https://www.ebay.com/itm/226447947273?var=525779043744&hash=item34b8');
  });

  it('cleans an Etsy listing link, keeping the variation', () => {
    expect(
      cleanLink('https://www.etsy.com/listing/123/mug?ref=hp&click_key=a&ga_order=most&variation0=55'),
    ).toBe('https://www.etsy.com/listing/123/mug?variation0=55');
  });

  it('keeps a Shopify variant', () => {
    expect(cleanLink('https://shop.example/products/mug?variant=4411&utm_source=x')).toBe(
      'https://shop.example/products/mug?variant=4411',
    );
  });

  it.each([
    'https://notamazon.com/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://amazon.com.evil.test/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://www.amazon.co.uk/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://shop.example/x?ref=friend',
  ])('applies Amazon’s rules only to Amazon’s hosts: %s (Review Focus 3)', (url) => {
    expect(cleanLink(url)).toBe(url);
  });

  it('keeps the kept parameters byte for byte (Review Focus 1)', () => {
    expect(cleanLink('https://shop.example/x?q=a%20b+c&utm_source=x&n=%E2%9C%93')).toBe(
      'https://shop.example/x?q=a%20b+c&n=%E2%9C%93',
    );
  });

  it('never touches the fragment (Review Focus 2)', () => {
    expect(cleanLink('https://shop.example/#/p?utm_source=x')).toBe(
      'https://shop.example/#/p?utm_source=x',
    );
    expect(cleanLink('https://shop.example/p?utm_source=x#reviews')).toBe(
      'https://shop.example/p#reviews',
    );
  });

  it('keeps segments it can’t read, and never throws (Review Focus 5)', () => {
    expect(cleanLink('https://shop.example/x?a=1&&gift&%zz=1&a=2&utm_id=9')).toBe(
      'https://shop.example/x?a=1&&gift&%zz=1&a=2',
    );
  });

  it.each([
    'HTTPS://Shop.example/K',
    'http://shop.example',
    'https://a.co/d/xyz',
    'not a url',
    'ftp://files.example/x?utm_source=a',
    'https://shop.example/x?',
  ])('returns %j unchanged when there is nothing to remove', (url) => {
    expect(cleanLink(url)).toBe(url);
  });
});
```

Add fast-check properties over `fc.webUrl({ withQueryParameters: true, withFragments: true })`, extended with an arbitrary that appends listed and unlisted `name=value` pairs:
- `cleanLink(cleanLink(u)) === cleanLink(u)`.
- Everything before the first `?` or `#` is unchanged, except an Amazon `/ref=` segment on Amazon hosts; everything from the first `#` on is unchanged.
- Every query segment whose name isn't on a list for that host is still present, in order.

- [ ] **Step 3: Run `pnpm --filter @wishlist/contracts test links`.** Expected: FAIL, `cleanLink` not exported.

- [ ] **Step 4: Implement `cleanLink(url: string): string` in `links.ts`**

The algorithm is pinned because the tests above rely on it:
1. `parse(url)`. If it is null or the protocol isn't `http:`/`https:`, return `url`.
2. Split the *original string* at the first `#` (the fragment is kept verbatim), then the rest at the first `?`.
3. Pick the rule set from the parsed lowercase `hostname`: global, plus share IDs, Amazon, eBay or Etsy.
4. On Amazon hosts, remove `/ref=[^/?#]*` from the path string.
5. Split the query on `&`. Drop a segment only when its name (before the first `=`, `decodeURIComponent` in a try/catch, lowercased) is in the set's names or starts with one of its prefixes. Rejoin the remaining segments with `&`.
6. Rebuild as path + (`?` + query, only if there are segments left **and** something was removed; otherwise the original `?…` exactly) + fragment. If nothing was removed, return `url` itself.

Put a short doc comment on the lists saying where each name came from (ClearURLs as a reference, and why each one is tracking), and stating the "when in doubt, keep it" rule.

- [ ] **Step 5: Run `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts typecheck && pnpm --filter @wishlist/contracts lint`.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): cleanLink removes tracking from pasted links (D118)"
```

---

### Task 2: Clean pasted links on the web

**Files:**
- Modify: `apps/web/src/lib/add-input.ts`: `classifyAddInput` returns `url: cleanLink(…)` for both link branches (an `http(s)` link found in the text, and a bare shop address after `https://` is added).
- Modify: `apps/web/src/components/list/item-edit-form.tsx`: pass `onLinkInput` to `ItemFields`.
- Modify: `apps/web/src/components/list/item-fields.tsx`: the `onLinkInput` doc comment says the edit form now uses it too, to clean pasted links (it still never reads them).
- Test: `apps/web/src/lib/add-input.spec.ts`, `e2e/tests/local/add-item.spec.ts`, `e2e/tests/local/edit-item.spec.ts`

**Interfaces:**
- Consumes: `cleanLink(url: string): string` from `@wishlist/contracts`.
- No changes to the add form: `pastedLink()` goes through `classifyAddInput`, and `add-form.tsx` already does `setValue('url', link.url)` when `link.url !== value`.

- [ ] **Step 1: Write the failing unit tests in `add-input.spec.ts`**

```ts
describe('cleaning (D118)', () => {
  it('cleans the link the add box reads', () => {
    expect(classifyAddInput('https://shop.example/mug?variant=4&utm_source=ig')).toEqual({
      kind: 'link', url: 'https://shop.example/mug?variant=4', titleHint: null,
    });
  });
  it('cleans the link in text a phone app shared, keeping the title hint', () => {
    expect(classifyAddInput('Mug https://shop.example/mug?fbclid=1')).toEqual({
      kind: 'link', url: 'https://shop.example/mug', titleHint: 'Mug',
    });
  });
  it('cleans a bare shop address', () => {
    expect(classifyAddInput('shop.example/mug?utm_id=1')).toMatchObject({ url: 'https://shop.example/mug' });
  });
  it('checks the length of the cleaned link (Review Focus 4)', () => {
    const link = `https://shop.example/mug?utm_content=${'x'.repeat(LINK_MAX)}`;
    expect(pastedLink(link)).toEqual({ url: 'https://shop.example/mug', titleHint: null });
  });
});
```

The existing `classifyAddInput` cases (`HTTPS://Shop.example/K`, `https://a.co/d/xyz`, and so on) must pass unchanged. They show that a link with nothing to remove is untouched.

- [ ] **Step 2: Run `pnpm --filter @wishlist/web test add-input`.** Expected: the four new tests FAIL.

- [ ] **Step 3: Call `cleanLink` in `classifyAddInput`.** Run the same command. Expected: PASS.

- [ ] **Step 4: Give the edit form a paste-only `onLinkInput(value: string, pasted: boolean)`.** On a paste, `const link = pastedLink(value)`; if `link && link.url !== value`, call `form.setValue('url', link.url, { shouldDirty: true })`. Otherwise do nothing. It never reads the page (D117).

- [ ] **Step 5: Write the E2E tests.** Paste through the clipboard, using the pattern in `tag-suggestions.spec.ts:141-159` (`grantPermissions`, `clipboard.writeText`, focus, `ControlOrMeta+V`).
  - `add-item.spec.ts`: "a pasted link loses its tracking, and keeps its variant (D118)". Stub unfurl (as in the existing `page.route('**/api/wishlist/unfurl', …)` tests) and record the request body. `addThroughTheBox(page, 'https://hanker-e2e.invalid/mug?variant=4&utm_source=ig&fbclid=1')`. Expect the unfurl request's `url` to be `https://hanker-e2e.invalid/mug?variant=4`, and the Link field to have that value. Then save, and expect the saved row's link to be that value.
  - `add-item.spec.ts`: "a link pasted into the add form’s Link field is cleaned (D118)". Open an idea's form, paste `https://hanker-e2e.invalid/mug?utm_campaign=x`, and expect the field to be `https://hanker-e2e.invalid/mug`.
  - `edit-item.spec.ts`: "a link pasted into the edit form is cleaned, and a typed one isn’t (D118)". Paste a tracked link into a saved item's Link field and expect it cleaned. Then `fill()` a tracked link and expect it kept as typed. Save and reload, and expect the typed link.

- [ ] **Step 6: Run the checks**

```bash
pnpm format:check
API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build
pnpm test:e2e
```

Expected: all green, with the three new E2E tests among the passes.

- [ ] **Step 7: Commit**

```bash
git add apps/web e2e/tests/local
git commit -m "feat(web): clean links pasted into the add box and Link fields (D118)"
```

---

### Task 3: Record D118

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`: add a D118 row after D117, in the same format. Ruling: *pasted links have known tracking, campaign and affiliate parameters removed on the web before save; unknown parameters, the path apart from Amazon `/ref=`, and the fragment are kept; typed links and saved items are never changed (Ted, 2026-11-22)*. Rejected: *ClearURLs' rule file (LGPL, removes parameters that may pick a variant); cleaning in the API or the unfurl answer*.
- Modify: `docs/superpowers/specs/2026-10-22-retailer-lookups-design.md`: change the non-goal "Affiliate links. Saved links are the ones the owner pasted." to add *(Since D118, 2026-11-22, a pasted link's affiliate and tracking parameters are removed before save; see [clean pasted links](2026-11-22-clean-pasted-links-design.md).)*, as the eBay note beside it is done.
- Modify: `docs/superpowers/specs/2026-11-22-clean-pasted-links-design.md`: set Status to "approved by Ted, 2026-11-22", and settle "Left to the builder" with the `si` host list and the final lists from Task 1.
- Modify: `AGENTS.md`: in the **Add box (Plan 9)** bullet, add one sentence: *A pasted link, in the add box or either form's Link field, passes through `cleanLink()` (`packages/contracts/src/links.ts`, D118), which removes only listed tracking parameters; never add a name you can't show is tracking, and never clean typed links or saved items.*
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md`: add row `17 | [Clean pasted links](2026-11-22-clean-pasted-links.md) | [design 2026-11-22](../specs/2026-11-22-clean-pasted-links-design.md), D118 | Pasted links lose known tracking, campaign and affiliate parameters before save; variants and unknown parameters kept | In progress`; it moves to Done in a follow-up PR after the stack merges, as earlier plans did.
- `/privacy` is unchanged: it describes what leaves Hanker, and cleaning only reduces that. (My call; the spec left it to the builder.)

- [ ] **Step 1: Make the edits.** Run `pnpm format:check`. Expected: PASS.
- [ ] **Step 2: Commit**

```bash
git add docs AGENTS.md
git commit -m "docs: record D118, cleaning pasted links"
```

- [ ] **Step 3: Stack it.** Create the three layers with `gh stack`, one per task. Give each PR a Conventional Commit title and a summary body ending with the Claude Code line from `CLAUDE.md`. **Ask Ted before the first `gh stack submit --open`.**
