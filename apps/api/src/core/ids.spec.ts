import { describe, expect, it } from 'vitest';
import { newId } from './ids.js';

describe('newId', () => {
  it('returns a UUIDv7, which is time-ordered and so index-friendly (spec §3)', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sorts IDs in the order they were created', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
