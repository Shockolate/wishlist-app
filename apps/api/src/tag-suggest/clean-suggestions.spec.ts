import { MAX_TAGS_PER_LIST, type Tag } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { cleanSuggestions } from './clean-suggestions.js';

const KITCHEN: Tag = { id: '11111111-1111-4111-8111-111111111111', name: 'Kitchen' };
const BOOKS: Tag = { id: '22222222-2222-4222-8222-222222222222', name: 'Books' };
const LIST = [BOOKS, KITCHEN];
const NONE: ReadonlySet<string> = new Set();

describe('cleanSuggestions (tag suggestions design §5.2 steps 5 and 6)', () => {
  it('turns a name that matches a list tag by key into its id, whatever its case', () => {
    expect(cleanSuggestions(['kitchen', 'Coffee'], LIST, NONE)).toEqual([
      { id: KITCHEN.id },
      { name: 'Coffee' },
    ]);
  });

  it('puts existing tags first, then new names, each group in the model’s order', () => {
    expect(cleanSuggestions(['Coffee', 'Kitchen'], LIST, NONE)).toEqual([
      { id: KITCHEN.id },
      { name: 'Coffee' },
    ]);
    expect(cleanSuggestions(['Tea', 'books', 'Mugs', 'KITCHEN'], LIST, NONE)).toEqual([
      { id: BOOKS.id },
      { id: KITCHEN.id },
      { name: 'Tea' },
    ]);
  });

  it('cleans each name once and keeps one of the names that share a key', () => {
    expect(cleanSuggestions(['  Coffee  ', 'coffee', 'COFFEE'], LIST, NONE)).toEqual([
      { name: 'Coffee' },
    ]);
    expect(cleanSuggestions(['Kitchen', ' kitchen ', 'Tea  Time'], LIST, NONE)).toEqual([
      { id: KITCHEN.id },
      { name: 'Tea Time' },
    ]);
  });

  it('drops names TagNameSchema refuses, and caps the answer at three', () => {
    const answer = cleanSuggestions(
      ['', '   ', 'x'.repeat(31), 'Tea', 'Mugs', 'Gifts', 'Cups'],
      LIST,
      NONE,
    );
    expect(answer).toEqual([{ name: 'Tea' }, { name: 'Mugs' }, { name: 'Gifts' }]);
  });

  it('does not suggest a tag the item already has, by either spelling', () => {
    const onItem = new Set([KITCHEN.id]);
    expect(cleanSuggestions(['Kitchen', 'kitchen', 'Books'], LIST, onItem)).toEqual([
      { id: BOOKS.id },
    ]);
  });

  it('drops new names when the list is full, and keeps existing matches', () => {
    const full: Tag[] = Array.from({ length: MAX_TAGS_PER_LIST }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Tag ${i}`,
    }));
    expect(cleanSuggestions(['Coffee', 'tag 7', 'Tea'], full, NONE)).toEqual([{ id: full[7]?.id }]);
  });

  it('answers nothing for no names', () => {
    expect(cleanSuggestions([], LIST, NONE)).toEqual([]);
  });
});
