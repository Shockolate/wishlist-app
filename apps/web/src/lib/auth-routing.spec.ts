import { describe, expect, it } from 'vitest';
import { authRedirect } from './auth-routing';

const at = (path: string) => new URL(path, 'https://hanker.dev');

describe('authRedirect (spec §6.1, rule 8)', () => {
  it.each([
    ['/list', false, '/login?next=%2Flist'],
    ['/settings', false, '/login?next=%2Fsettings'],
    ['/settings?tab=password', false, '/login?next=%2Fsettings%3Ftab%3Dpassword'],
    ['/', true, '/list'],
    ['/list', true, null],
    ['/login', true, null],
    ['/', false, null],
    ['/listing', false, null],
    ['/signup', false, null],
  ])('%s with a cookie: %s → %s', (path, hasCookie, expected) => {
    expect(authRedirect(at(path), hasCookie)).toBe(expected);
  });
});
