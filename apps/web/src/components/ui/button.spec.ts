import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

describe('buttonVariants', () => {
  it('lets a variant override the base classes it conflicts with', () => {
    const link = buttonVariants({ variant: 'link' }).split(' ');
    expect(link).toContain('px-0');
    expect(link).not.toContain('px-5');
    expect(link).toContain('font-medium');
    expect(link).not.toContain('font-semibold');
  });

  it('lets the compact size override the base padding', () => {
    const compact = buttonVariants({ size: 'compact' }).split(' ');
    expect(compact).toContain('px-4');
    expect(compact).not.toContain('px-5');
  });
});
