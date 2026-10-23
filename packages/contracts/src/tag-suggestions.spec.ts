import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  MAX_TAG_SUGGESTIONS,
  TagSuggestionsRequestSchema,
  TagSuggestionsResponseSchema,
} from './tag-suggestions.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

describe('limits (tag suggestions design §5.1)', () => {
  it('are 3 suggestions and a 1000-unit description', () => {
    expect(MAX_TAG_SUGGESTIONS).toBe(3);
    expect(DESCRIPTION_MAX).toBe(1000);
  });
});

describe('TagSuggestionsRequestSchema (tag suggestions design §5.1)', () => {
  it('takes a title alone', () => {
    expect(TagSuggestionsRequestSchema.parse({ title: 'Kettle' })).toEqual({ title: 'Kettle' });
  });

  it('takes every field', () => {
    const body = {
      title: 'Kettle',
      note: 'The blue one',
      url: 'https://shop.example/kettle',
      description: 'Boils water',
      tagIds: [ID],
    };
    expect(TagSuggestionsRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a 201-character title', { title: 'a'.repeat(201) }],
    ['a 2049-character URL', { title: 'Kettle', url: `http://${'a'.repeat(2049 - 7)}` }],
    ['a 1001-character description', { title: 'Kettle', description: 'a'.repeat(1001) }],
    ['11 tag ids', { title: 'Kettle', tagIds: Array.from({ length: 11 }, () => ID) }],
    ['a tag id that is not a uuid', { title: 'Kettle', tagIds: ['kitchen'] }],
  ])('refuses %s', (_name, body) => {
    expect(TagSuggestionsRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts the limits themselves', () => {
    expect(
      TagSuggestionsRequestSchema.safeParse({
        title: 'a'.repeat(200),
        url: `http://${'a'.repeat(2048 - 7)}`,
        description: 'a'.repeat(1000),
        tagIds: Array.from({ length: 10 }, () => ID),
      }).success,
    ).toBe(true);
  });
});

describe('TagSuggestionsResponseSchema (tag suggestions design §5.1)', () => {
  it('takes an existing tag by id and a new one by name', () => {
    const suggestions = [{ id: ID }, { name: 'Coffee' }];
    expect(TagSuggestionsResponseSchema.parse({ suggestions })).toEqual({ suggestions });
  });

  it('takes none', () => {
    expect(TagSuggestionsResponseSchema.safeParse({ suggestions: [] }).success).toBe(true);
  });

  it('refuses four suggestions', () => {
    const suggestions = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
    expect(TagSuggestionsResponseSchema.safeParse({ suggestions }).success).toBe(false);
  });
});
