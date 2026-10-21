import { describe, expect, it } from 'vitest';
import robots from './robots';

describe('robots', () => {
  it('the legal pages stay indexable (Plan 6)', () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap(
      (rule) => rule.disallow ?? [],
    );
    expect(disallow).toEqual([
      '/verify-email',
      '/reset-password',
      '/list',
      '/settings',
      '/s/',
      '/c/',
    ]);
    for (const path of ['/privacy', '/terms']) {
      expect(disallow.some((prefix) => path.startsWith(prefix))).toBe(false);
    }
  });
});
