import { DOLLAR_SCALE, parsePrice } from '@wishlist/contracts';

// The share page's filter logic (design §3–§4, D61–D62): tags narrow with AND, price bands widen
// with OR, and a band only ever matches a readable price in the list's own currency. Pure, so the
// counts on the chips and the cards that are shown can't disagree.

export type BandId = 'under-25' | '25-50' | '50-100' | '100-plus';

/** Each band's `max` is exclusive; the last has none. */
export const BANDS: readonly { id: BandId; min: number; max: number | null }[] = [
  { id: 'under-25', min: 0, max: 25 },
  { id: '25-50', min: 25, max: 50 },
  { id: '50-100', min: 50, max: 100 },
  { id: '100-plus', min: 100, max: null },
];

/** What the filters need to know about an item. */
export interface FilterItem {
  id: string;
  tagIds?: string[];
  priceText: string | null;
}

export interface Filters {
  tagIds: readonly string[];
  bands: readonly BandId[];
}

export const NO_FILTERS: Filters = { tagIds: [], bands: [] };

/**
 * The prefix of the list's most readable prices, if it's on the dollar scale. A tie goes to the
 * prefix that appears first in the list. Null means the list gets no price pill.
 */
export function listCurrency(items: readonly FilterItem[]): string | null {
  // A Map iterates in insertion order, which is first-seen order.
  const counts = new Map<string, number>();
  for (const { priceText } of items) {
    const price = parsePrice(priceText);
    if (price) counts.set(price.currency, (counts.get(price.currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best !== null && DOLLAR_SCALE.includes(best) ? best : null;
}

function inBands(item: FilterItem, bands: readonly BandId[], currency: string | null): boolean {
  const price = parsePrice(item.priceText);
  if (currency === null || price?.currency !== currency) return false;
  const { amount } = price;
  return BANDS.some(
    (band) =>
      bands.includes(band.id) && amount >= band.min && (band.max === null || amount < band.max),
  );
}

/** Whether the item is shown. With a band on, an item without a readable price in `currency` isn't. */
export function matches(item: FilterItem, f: Filters, currency: string | null): boolean {
  const carried = item.tagIds ?? [];
  if (!f.tagIds.every((id) => carried.includes(id))) return false;
  return f.bands.length === 0 || inBands(item, f.bands, currency);
}

const countOf = (items: readonly FilterItem[], f: Filters, currency: string | null) =>
  items.filter((item) => matches(item, f, currency)).length;

/** How many items would be shown with this tag on. For a tag already on, the number shown. */
export function tagCount(
  items: readonly FilterItem[],
  f: Filters,
  currency: string | null,
  tagId: string,
): number {
  const tagIds = f.tagIds.includes(tagId) ? f.tagIds : [...f.tagIds, tagId];
  return countOf(items, { ...f, tagIds }, currency);
}

/**
 * How many items would be shown with this band on. `'any'` is the tag matches alone, whether or
 * not the price is readable (the pill's "Any price" row).
 */
export function bandCount(
  items: readonly FilterItem[],
  f: Filters,
  currency: string | null,
  band: BandId | 'any',
): number {
  if (band === 'any') return countOf(items, { ...f, bands: [] }, currency);
  const bands = f.bands.includes(band) ? f.bands : [...f.bands, band];
  return countOf(items, { ...f, bands }, currency);
}

/**
 * Tags by how many of the list's items carry them, most first, then by name. It takes the whole
 * list, not the shown items, so the chips don't shuffle as filters change.
 */
export function orderTags<T extends { id: string; name: string }>(
  tags: readonly T[],
  items: readonly FilterItem[],
): T[] {
  const carried = (id: string) => items.filter((item) => item.tagIds?.includes(id)).length;
  return tags
    .map((tag) => ({ tag, count: carried(tag.id) }))
    .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name))
    .map(({ tag }) => tag);
}

const BAND_ORDER = BANDS.map(({ id }) => id);
const bandAt = (index: number) => BANDS[index] as (typeof BANDS)[number];

export function bandLabel(band: BandId, currency: string): string {
  return runLabel(BAND_ORDER.indexOf(band), BAND_ORDER.indexOf(band), currency);
}

// A run of neighbouring bands, by index: the first band's lower bound to the last's upper bound.
function runLabel(first: number, last: number, currency: string): string {
  if (first === 0 && last === BANDS.length - 1) return 'Any listed price';
  const lower = bandAt(first).min;
  const upper = bandAt(last).max;
  if (first === 0) return `Under ${currency}${upper}`;
  if (upper === null) return `${currency}${lower}+`;
  return `${currency}${lower}–${upper}`;
}

/** The selected bands as one label: neighbours merge into a run, runs are joined with " · ". */
export function joinedBandLabel(bands: readonly BandId[], currency: string): string {
  const picked = BAND_ORDER.map((id, index) => (bands.includes(id) ? index : -1)).filter(
    (index) => index >= 0,
  );
  const runs: [number, number][] = [];
  for (const index of picked) {
    const run = runs.at(-1);
    if (run && run[1] === index - 1) run[1] = index;
    else runs.push([index, index]);
  }
  return runs.map(([first, last]) => runLabel(first, last, currency)).join(' · ');
}
