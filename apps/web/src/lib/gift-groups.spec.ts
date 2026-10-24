import type { Gift } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { groupByList } from './gift-groups';

const at = (shareUrl: string, title: string) => ({ shareUrl, item: { title } }) as unknown as Gift;

describe('groupByList', () => {
  it('groups consecutive gifts on the same list, keeping the API’s order', () => {
    const groups = groupByList([
      at('https://hanker.dev/s/a', 'one'),
      at('https://hanker.dev/s/a', 'two'),
      at('https://hanker.dev/s/b', 'three'),
    ]);
    expect(groups.map((g) => [g.shareUrl, g.gifts.map((x) => x.item.title)])).toEqual([
      ['https://hanker.dev/s/a', ['one', 'two']],
      ['https://hanker.dev/s/b', ['three']],
    ]);
  });

  it('starts a new group when a list comes round again, rather than reordering', () => {
    const groups = groupByList([
      at('https://hanker.dev/s/a', 'one'),
      at('https://hanker.dev/s/b', 'two'),
      at('https://hanker.dev/s/a', 'three'),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('is empty for no gifts', () => {
    expect(groupByList([])).toEqual([]);
  });
});
