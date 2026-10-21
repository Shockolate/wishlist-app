import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DAY = 24 * 60 * 60 * 1000;

describe('security.txt', () => {
  it('security.txt is valid RFC 9116 and has not lapsed (Plan 6)', () => {
    const text = readFileSync(
      new URL('./public/.well-known/security.txt', import.meta.url),
      'utf8',
    );
    const lines = text.split('\n').map((line) => line.trim());
    const contacts = lines.filter((line) => line.startsWith('Contact:'));
    expect(contacts).toEqual([
      'Contact: https://github.com/Shockolate/wishlist-app/security/advisories/new',
      'Contact: mailto:hello@hanker.dev',
    ]);
    expect(lines).toContain('Preferred-Languages: en');
    expect(lines).toContain('Canonical: https://hanker.dev/.well-known/security.txt');
    expect(lines).toContain(
      'Policy: https://github.com/Shockolate/wishlist-app/blob/main/SECURITY.md',
    );

    const expires = lines.filter((line) => line.startsWith('Expires:'));
    expect(expires).toHaveLength(1);
    const at = Date.parse(expires[0]!.slice('Expires:'.length).trim());
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThan(Date.now());
    expect(at - Date.now()).toBeLessThanOrEqual(366 * DAY);
  });
});
