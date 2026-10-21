import { describe, expect, it } from 'vitest';
import {
  CreateTagRequestSchema,
  ItemTagsSchema,
  MAX_TAGS_PER_ITEM,
  MAX_TAGS_PER_LIST,
  RenameTagRequestSchema,
  TagNameSchema,
  TagSchema,
  cleanTagName,
  tagKey,
} from './tags.js';
import { VISIBLE_ONLY_MESSAGE } from './text.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

describe('limits (design §3)', () => {
  it('are 10 per item and 50 per list', () => {
    expect(MAX_TAGS_PER_ITEM).toBe(10);
    expect(MAX_TAGS_PER_LIST).toBe(50);
  });
});

describe('cleanTagName (design §3, Plan 7a Review Focus 2)', () => {
  it.each([
    ['  #Kitchen  ', '#Kitchen'],
    ['Kitchen\t \ngadgets', 'Kitchen gadgets'],
    ['# books', '# books'],
    ['##x', '##x'],
    ['C#', 'C#'],
  ])('turns %j into %j', (input, cleaned) => {
    expect(cleanTagName(input)).toBe(cleaned);
  });
});

describe('tagKey', () => {
  it('is the cleaned name in lower case, so respellings share a key', () => {
    expect(tagKey('  KITCHEN ')).toBe('kitchen');
    expect(tagKey('Kitchen\tgadgets')).toBe(tagKey('kitchen  GADGETS'));
  });

  it('keeps a leading # in the key, so "#books" and "books" are two tags', () => {
    expect(tagKey(' #Books')).toBe('#books');
    expect(tagKey('#books')).not.toBe(tagKey('books'));
  });

  it('gives a cleaned name the same key again', () => {
    expect(tagKey(cleanTagName('  ##Kitchen  '))).toBe(tagKey('  ##Kitchen  '));
  });
});

describe('TagNameSchema (design §3)', () => {
  it('cleans before it validates', () => {
    expect(TagNameSchema.parse(' #Kitchen  gadgets ')).toBe('#Kitchen gadgets');
  });

  it.each([
    '#',
    '#books',
    '🎄 Christmas',
    '\u{1F469}\u200D\u{1F373}',
    'می\u200Cخواهم',
    'a'.repeat(30),
  ])('keeps %j', (input) => {
    expect(TagNameSchema.parse(input)).toBe(input);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'only whitespace'],
    ['a'.repeat(31), 'too long'],
    ['a\u202Eb', 'a bidirectional override'],
    ['\u3164', 'a blank letter'],
  ])('refuses %j (%s) with exactly one issue', (input) => {
    const result = TagNameSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(1);
  });

  it('says why a hidden character is refused', () => {
    const result = TagNameSchema.safeParse('a\u202Eb');
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([
      VISIBLE_ONLY_MESSAGE,
    ]);
  });
});

describe('TagSchema and the tag requests', () => {
  it('reads a tag', () => {
    expect(TagSchema.parse({ id: ID, name: 'Books' })).toEqual({ id: ID, name: 'Books' });
  });

  it.each([CreateTagRequestSchema, RenameTagRequestSchema])(
    'clean a name in a request',
    (schema) => {
      expect(schema.parse({ name: ' #Books ' })).toEqual({ name: '#Books' });
    },
  );
});

describe('ItemTagsSchema (design §3)', () => {
  it('accepts a tag by id and a tag by name', () => {
    expect(ItemTagsSchema.parse([{ id: ID }, { name: ' Books ' }])).toEqual([
      { id: ID },
      { name: 'Books' },
    ]);
  });

  it('refuses an entry with both an id and a name', () => {
    expect(ItemTagsSchema.safeParse([{ id: ID, name: 'x' }]).success).toBe(false);
  });

  it('refuses an id that is not a UUID', () => {
    expect(ItemTagsSchema.safeParse([{ id: 'nope' }]).success).toBe(false);
  });

  it('accepts 10 entries and refuses 11', () => {
    const entry = (n: number) => ({ name: `tag ${n}` });
    expect(ItemTagsSchema.safeParse(Array.from({ length: 10 }, (_, n) => entry(n))).success).toBe(
      true,
    );
    expect(ItemTagsSchema.safeParse(Array.from({ length: 11 }, (_, n) => entry(n))).success).toBe(
      false,
    );
  });
});
