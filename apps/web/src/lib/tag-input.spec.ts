import type { ItemTagRef, Tag } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import {
  addPendingTags,
  addSuggestedTag,
  addTypedTag,
  itemBody,
  liveTags,
  openSuggestions,
  shownTags,
  suggestTags,
} from './tag-input';

let next = 0;
const tag = (name: string): Tag => ({
  id: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  name,
});
const names = (tags: readonly Tag[]) => tags.map((each) => each.name);

describe('suggestTags (spec §7, the tag field)', () => {
  const kitchen = tag('Kitchen');
  const books = tag('Books');
  const hashBooks = tag('#books');
  const all = [
    tag('Stocking'),
    kitchen,
    tag('Christmas'),
    tag('Kitchen gadgets'),
    tag('Sticky notes'),
    tag('Outdoors'),
    books,
    hashBooks,
    tag('Baking'),
  ];

  it('puts names that start with the text before ones that contain it, each alphabetical', () => {
    expect(names(suggestTags(all, 'st', []))).toEqual(['Sticky notes', 'Stocking', 'Christmas']);
    expect(names(suggestTags(all, 'KIT', []))).toEqual(['Kitchen', 'Kitchen gadgets']);
  });

  it('matches the cleaned text, whitespace collapsed', () => {
    expect(names(suggestTags(all, '  kitchen   g', []))).toEqual(['Kitchen gadgets']);
  });

  it('offers at most 6', () => {
    const many = Array.from({ length: 9 }, (_, i) => tag(`Gift ${String(i)}`));
    expect(suggestTags(many, 'gift', [])).toHaveLength(6);
    expect(names(suggestTags(many, 'gift', []))[0]).toBe('Gift 0');
  });

  it('leaves out tags already chosen, by id or by a name with the same key', () => {
    expect(names(suggestTags(all, 'kit', [{ id: kitchen.id }]))).toEqual(['Kitchen gadgets']);
    expect(names(suggestTags(all, 'kit', [{ name: 'KITCHEN' }]))).toEqual(['Kitchen gadgets']);
  });

  it('keeps the # in a name: "#books" is the only match for #b, and only contains b (D59)', () => {
    expect(names(suggestTags(all, '#b', []))).toEqual(['#books']);
    // "Baking" and "Books" start with b; "#books" merely contains it, so it comes after them.
    expect(names(suggestTags(all, 'b', []))).toEqual(['Baking', 'Books', '#books']);
  });

  it('offers every tag, alphabetically, before anything is typed', () => {
    expect(names(suggestTags([kitchen, books, hashBooks], '', []))).toEqual([
      '#books',
      'Books',
      'Kitchen',
    ]);
  });
});

describe('addTypedTag (Plan 7b ruling 7)', () => {
  const kitchen = tag('Kitchen');
  const all = [kitchen, tag('Christmas')];

  it('joins an existing tag by its key, as { id }', () => {
    expect(addTypedTag([], ' kitchen ', all)).toEqual({ tags: [{ id: kitchen.id }] });
  });

  it('makes a new tag from the cleaned text, keeping a leading #', () => {
    expect(addTypedTag([], '#Kitchen', all)).toEqual({ tags: [{ name: '#Kitchen' }] });
    expect(addTypedTag([{ id: kitchen.id }], '  Garden   tools ', all)).toEqual({
      tags: [{ id: kitchen.id }, { name: 'Garden tools' }],
    });
  });

  it('does nothing for a tag already chosen', () => {
    const chosen: ItemTagRef[] = [{ id: kitchen.id }, { name: 'Garden' }];
    expect(addTypedTag(chosen, 'KITCHEN', all)).toEqual({ tags: chosen });
    expect(addTypedTag(chosen, 'garden', all)).toEqual({ tags: chosen });
  });

  it('says what’s wrong with a name', () => {
    expect(addTypedTag([], 'x'.repeat(31), all)).toEqual({
      error: 'Use 30 characters or fewer.',
    });
    expect(addTypedTag([], '   ', all)).toEqual({ error: 'Fill this in.' });
  });

  it('refuses an 11th tag', () => {
    const ten: ItemTagRef[] = Array.from({ length: 10 }, (_, i) => ({ name: `Tag ${String(i)}` }));
    expect(addTypedTag(ten, 'Kitchen', all)).toEqual({
      error: 'An item can have at most 10 tags.',
    });
    // A tag it already has is still a no-op, not an error.
    expect(addTypedTag(ten, 'tag 3', all)).toEqual({ tags: ten });
  });
});

describe('addPendingTags (spec §7: typed text is added on save, comma by comma)', () => {
  const kitchen = tag('Kitchen');
  const all = [kitchen];
  const chosen: ItemTagRef[] = [{ name: 'Garden' }];
  const long = 'x'.repeat(31);

  it('leaves the tags as they are when nothing, or only spaces and commas, was typed', () => {
    expect(addPendingTags(chosen, '', all)).toEqual({ tags: chosen, left: '' });
    expect(addPendingTags(chosen, '   ', all)).toEqual({ tags: chosen, left: '' });
    expect(addPendingTags(chosen, ' , ,', all)).toEqual({ tags: chosen, left: '' });
  });

  it('adds what was typed exactly as Enter would', () => {
    expect(addPendingTags(chosen, ' kitchen ', all)).toEqual({
      tags: [{ name: 'Garden' }, { id: kitchen.id }],
      left: '',
    });
    expect(addPendingTags(chosen, 'garden', all)).toEqual({ tags: chosen, left: '' });
  });

  it('adds each comma-separated part in order, never one tag holding a comma', () => {
    expect(addPendingTags([], 'Books, kitchen,Garden tools', all)).toEqual({
      tags: [{ name: 'Books' }, { id: kitchen.id }, { name: 'Garden tools' }],
      left: '',
    });
  });

  it('stops at the first refused part, keeping the earlier ones and the text from there on', () => {
    expect(addPendingTags(chosen, `Books,${long}, Kitchen`, all)).toEqual({
      tags: [{ name: 'Garden' }, { name: 'Books' }],
      left: `${long}, Kitchen`,
      error: 'Use 30 characters or fewer.',
    });
    const ten: ItemTagRef[] = Array.from({ length: 10 }, (_, i) => ({ name: `Tag ${String(i)}` }));
    expect(addPendingTags(ten, 'Kitchen', all)).toEqual({
      tags: ten,
      left: 'Kitchen',
      error: 'An item can have at most 10 tags.',
    });
  });
});

describe('shownTags and liveTags (Plan 7b ruling 6)', () => {
  const kitchen = tag('Kitchen');
  const books = tag('books');
  const deleted = tag('Gone');

  it('drops an id the list no longer has, and sorts by name', () => {
    const chosen: ItemTagRef[] = [{ id: kitchen.id }, { id: deleted.id }, { name: 'Apron' }];
    expect(shownTags(chosen, [kitchen, books])).toEqual([
      { ref: { name: 'Apron' }, name: 'Apron' },
      { ref: { id: kitchen.id }, name: 'Kitchen' },
    ]);
    expect(liveTags(chosen, [kitchen, books])).toEqual([{ id: kitchen.id }, { name: 'Apron' }]);
  });
});

describe('itemBody (Plan 7b ruling 5)', () => {
  const values = { title: 'Kettle', tags: [{ name: 'Kitchen' }] };

  it('sends the tags only when they changed', () => {
    expect(itemBody(values, true)).toEqual(values);
    expect(itemBody(values, false)).toEqual({ title: 'Kettle' });
    expect('tags' in itemBody(values, false)).toBe(false);
  });
});

describe('addSuggestedTag (tag suggestions design §5.1)', () => {
  const kitchen = tag('Kitchen');
  const all = [kitchen, tag('Books')];

  it('appends an existing tag by id', () => {
    expect(addSuggestedTag([], { id: kitchen.id }, all)).toEqual([{ id: kitchen.id }]);
  });

  it('leaves the tags alone when it is already chosen', () => {
    const chosen = [{ id: kitchen.id }];
    expect(addSuggestedTag(chosen, { id: kitchen.id }, all)).toEqual(chosen);
  });

  it('turns a new name that matches a tag on the list into that tag', () => {
    expect(addSuggestedTag([], { name: 'kitchen' }, all)).toEqual([{ id: kitchen.id }]);
  });

  it('adds a new name as a name', () => {
    expect(addSuggestedTag([], { name: 'Coffee' }, all)).toEqual([{ name: 'Coffee' }]);
  });
});

describe('openSuggestions (Plan 9 ruling 5)', () => {
  const kitchen = tag('Kitchen');
  const books = tag('Books');
  const all = [kitchen, books];

  it('hides a suggestion already chosen, by key', () => {
    expect(openSuggestions([{ name: 'kitchen' }], [{ id: kitchen.id }], all)).toEqual([]);
    expect(openSuggestions([{ id: kitchen.id }], [{ name: 'KITCHEN' }], all)).toEqual([]);
  });

  it('keeps the ones not chosen, in order', () => {
    expect(
      openSuggestions([{ id: kitchen.id }, { name: 'Coffee' }], [{ id: books.id }], all),
    ).toEqual([{ id: kitchen.id }, { name: 'Coffee' }]);
  });

  it('shows none once the item holds the most tags', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `Tag ${String(i)}` }));
    expect(openSuggestions([{ name: 'Coffee' }], ten, all)).toEqual([]);
  });
});
