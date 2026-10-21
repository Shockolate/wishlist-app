import { describe, expect, it } from 'vitest';
import { deleteTagTitle, itemCount } from './tag-copy';

describe('Tags sheet copy', () => {
  it('asks before taking a tag off its items, or deleting an empty one (values table)', () => {
    expect(deleteTagTitle('Kitchen', 3)).toBe('Remove “Kitchen” from 3 items?');
    expect(deleteTagTitle('Kitchen', 1)).toBe('Remove “Kitchen” from 1 item?');
    expect(deleteTagTitle('Kitchen', 0)).toBe('Delete “Kitchen”?');
  });

  it('counts a tag’s items, empty tags included', () => {
    expect(itemCount(0)).toBe('0 items');
    expect(itemCount(1)).toBe('1 item');
    expect(itemCount(4)).toBe('4 items');
  });
});
