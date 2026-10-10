import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('drops falsy values, and a later Tailwind class wins over an earlier one', () => {
    expect(cn('px-4 text-sm', false, undefined, 'px-6')).toBe('text-sm px-6');
  });
});
