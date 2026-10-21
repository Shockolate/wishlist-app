import { describe, expect, it } from 'vitest';
import {
  BANDS,
  NO_FILTERS,
  bandCount,
  bandLabel,
  joinedBandLabel,
  listCurrency,
  matches,
  orderTags,
  tagCount,
  type BandId,
  type FilterItem,
  type Filters,
} from './share-filters';

let next = 0;
const item = (priceText: string | null, tagIds?: string[]): FilterItem => ({
  id: `item-${next++}`,
  priceText,
  ...(tagIds ? { tagIds } : {}),
});
const filters = (tagIds: string[] = [], bands: BandId[] = []): Filters => ({ tagIds, bands });

describe('listCurrency (D61)', () => {
  it('is the prefix with the most readable prices', () => {
    expect(listCurrency([item('£5'), item('$10'), item('$20'), item('varies')])).toBe('$');
  });

  it('breaks a 2-2 tie toward the prefix seen first in list order', () => {
    expect(listCurrency([item('£5'), item('$10'), item('$20'), item('£7')])).toBe('£');
    expect(listCurrency([item('$5'), item('£10'), item('£20'), item('$7')])).toBe('$');
  });

  it('is null for a yen majority, outside the dollar scale', () => {
    expect(listCurrency([item('¥100'), item('¥200'), item('$5')])).toBeNull();
  });

  it('is null when no price is readable', () => {
    expect(listCurrency([item('about £30'), item(null), item('30')])).toBeNull();
    expect(listCurrency([])).toBeNull();
  });
});

describe('matches', () => {
  it('shows everything when no filter is on', () => {
    expect(matches(item(null), NO_FILTERS, null)).toBe(true);
  });

  it('combines tags with AND', () => {
    const f = filters(['a', 'b']);
    expect(matches(item(null, ['a', 'b', 'c']), f, null)).toBe(true);
    expect(matches(item(null, ['a']), f, null)).toBe(false);
    expect(matches(item(null), f, null)).toBe(false);
  });

  it('combines bands with OR', () => {
    const f = filters([], ['25-50', '100-plus']);
    expect(matches(item('$30'), f, '$')).toBe(true);
    expect(matches(item('$120'), f, '$')).toBe(true);
    expect(matches(item('$60'), f, '$')).toBe(false);
  });

  it('hides items without a readable price in the list currency once a band is on', () => {
    const f = filters([], ['under-25', '25-50', '50-100', '100-plus']);
    expect(matches(item('about £30'), f, '$')).toBe(false);
    expect(matches(item('¥1,200'), f, '$')).toBe(false);
    expect(matches(item(null), f, '$')).toBe(false);
    expect(matches(item('£30'), f, '$')).toBe(false);
    expect(matches(item('$30'), f, '$')).toBe(true);
  });

  it('hides everything behind a band when the list has no dollar-scale currency', () => {
    expect(matches(item('$30'), filters([], ['25-50']), null)).toBe(false);
  });

  it('puts the edges in the upper band, and $0 under 25', () => {
    expect(matches(item('$25.00'), filters([], ['25-50']), '$')).toBe(true);
    expect(matches(item('$25.00'), filters([], ['under-25']), '$')).toBe(false);
    expect(matches(item('$24.99'), filters([], ['under-25']), '$')).toBe(true);
    expect(matches(item('$50.00'), filters([], ['50-100']), '$')).toBe(true);
    expect(matches(item('$50.00'), filters([], ['25-50']), '$')).toBe(false);
    expect(matches(item('$100'), filters([], ['100-plus']), '$')).toBe(true);
    expect(matches(item('$0'), filters([], ['under-25']), '$')).toBe(true);
  });

  it('applies tags and bands together', () => {
    const f = filters(['a'], ['25-50']);
    expect(matches(item('$30', ['a']), f, '$')).toBe(true);
    expect(matches(item('$30', ['b']), f, '$')).toBe(false);
    expect(matches(item('$60', ['a']), f, '$')).toBe(false);
  });
});

describe('BANDS', () => {
  it('has four bands with exclusive upper bounds', () => {
    expect(BANDS).toEqual([
      { id: 'under-25', min: 0, max: 25 },
      { id: '25-50', min: 25, max: 50 },
      { id: '50-100', min: 50, max: 100 },
      { id: '100-plus', min: 100, max: null },
    ]);
  });
});

describe('counts', () => {
  const items = [
    item('$10', ['a']),
    item('$30', ['a', 'b']),
    item('$30', ['b']),
    item('$60', ['a']),
    item('$120', ['a']),
    item('about £30', ['a', 'b']),
    item('¥1,200', ['b']),
    item(null),
  ];
  const shown = (f: Filters) => items.filter((it) => matches(it, f, '$')).length;

  it('tagCount of an unselected tag is the count with that tag added', () => {
    expect(tagCount(items, NO_FILTERS, '$', 'a')).toBe(shown(filters(['a'])));
    expect(tagCount(items, filters(['a']), '$', 'b')).toBe(shown(filters(['a', 'b'])));
    expect(tagCount(items, filters([], ['25-50']), '$', 'b')).toBe(
      shown(filters(['b'], ['25-50'])),
    );
  });

  it('tagCount of a selected tag is the number shown', () => {
    const f = filters(['a', 'b'], ['25-50']);
    expect(tagCount(items, f, '$', 'a')).toBe(shown(f));
    expect(tagCount(items, f, '$', 'b')).toBe(shown(f));
  });

  it('bandCount of a band equals the number shown with that band added (RF2)', () => {
    for (const { id } of BANDS) {
      expect(bandCount(items, NO_FILTERS, '$', id)).toBe(shown(filters([], [id])));
      expect(bandCount(items, filters(['a']), '$', id)).toBe(shown(filters(['a'], [id])));
      expect(bandCount(items, filters(['a'], ['25-50']), '$', id)).toBe(
        shown(filters(['a'], ['25-50', id])),
      );
    }
    expect(bandCount(items, NO_FILTERS, '$', '25-50')).toBe(2);
    expect(bandCount(items, NO_FILTERS, '$', '100-plus')).toBe(1);
  });

  it('bandCount of a selected band is the number shown', () => {
    const f = filters(['a'], ['25-50', '100-plus']);
    expect(bandCount(items, f, '$', '25-50')).toBe(shown(f));
  });

  it('bandCount("any") counts the tag matches, readable price or not', () => {
    expect(bandCount(items, NO_FILTERS, '$', 'any')).toBe(items.length);
    expect(bandCount(items, filters(['a']), '$', 'any')).toBe(5);
    expect(bandCount(items, filters(['a', 'b']), '$', 'any')).toBe(2);
    expect(bandCount(items, filters(['a'], ['25-50']), '$', 'any')).toBe(5);
  });
});

describe('orderTags', () => {
  const tag = (name: string) => ({ id: name.toLowerCase(), name });
  const tags = [tag('Zeta'), tag('Alpha'), tag('Mid'), tag('Unused')];
  const items = [
    item(null, ['zeta', 'alpha', 'mid']),
    item(null, ['zeta', 'alpha']),
    item(null, ['mid']),
    item(null, ['zeta']),
    item(null),
  ];

  it('puts the most carried first, and ties by name', () => {
    expect(orderTags(tags, items).map((t) => t.name)).toEqual(['Zeta', 'Alpha', 'Mid', 'Unused']);
  });

  it('breaks ties with localeCompare', () => {
    const tied = [item(null, ['b']), item(null, ['a'])];
    expect(orderTags([tag('B'), tag('A')], tied).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('does not mutate its input', () => {
    const copy = [...tags];
    orderTags(tags, items);
    expect(tags).toEqual(copy);
  });
});

describe('labels', () => {
  it('labels one band with the list prefix and an en dash', () => {
    expect(bandLabel('under-25', '$')).toBe('Under $25');
    expect(bandLabel('25-50', '$')).toBe('$25–50');
    expect(bandLabel('50-100', 'CA$')).toBe('CA$50–100');
    expect(bandLabel('100-plus', '£')).toBe('£100+');
  });

  it.each<[BandId[], string]>([
    [[], ''],
    [['25-50'], '$25–50'],
    [['under-25'], 'Under $25'],
    [['100-plus'], '$100+'],
    [['25-50', '50-100'], '$25–100'],
    [['under-25', '25-50'], 'Under $50'],
    [['under-25', '25-50', '50-100'], 'Under $100'],
    [['50-100', '100-plus'], '$50+'],
    [['25-50', '50-100', '100-plus'], '$25+'],
    [['under-25', '25-50', '50-100', '100-plus'], 'Any listed price'],
    [['under-25', '100-plus'], 'Under $25 · $100+'],
    [['under-25', '50-100'], 'Under $25 · $50–100'],
    [['25-50', '100-plus'], '$25–50 · $100+'],
    [['100-plus', '25-50', 'under-25'], 'Under $50 · $100+'],
  ])('joins %j as %j, whatever the input order', (bands, label) => {
    expect(joinedBandLabel(bands, '$')).toBe(label);
  });

  it('uses the list’s prefix', () => {
    expect(joinedBandLabel(['25-50', '50-100'], '£')).toBe('£25–100');
  });
});
