import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext (rule 9, Review Focus 4)', () => {
  it.each([
    ['/settings', '/settings'],
    ['/list?x=1', '/list?x=1'],
  ])('keeps the same-site path %s', (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    [' /settings'],
    ['settings'],
  ])('sends %j to /list instead', (value) => {
    expect(safeNext(value)).toBe('/list');
  });
});
