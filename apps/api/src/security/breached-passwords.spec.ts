import { describe, expect, it } from 'vitest';
import { PwnedPasswordsChecker } from './breached-passwords.js';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function fakeFetch(respond: () => Response | Promise<Response>) {
  const urls: string[] = [];
  const fn = ((url: string) => {
    urls.push(url);
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const range = (lines: string[]) => new Response(lines.join('\r\n'), { status: 200 });

describe('PwnedPasswordsChecker (spec §6.4)', () => {
  it('reports a password whose hash suffix is in the range with a count', async () => {
    const { fn } = fakeFetch(() =>
      range(['0018A45C4D1DEF81644B54AB7F969B88D65:1', `${SUFFIX}:9545824`]),
    );
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(true);
  });

  it('sends only the five-character prefix (k-anonymity)', async () => {
    const { fn, urls } = fakeFetch(() => range([]));
    await new PwnedPasswordsChecker(fn).isBreached('password');
    expect(urls).toEqual([`https://api.pwnedpasswords.com/range/${PREFIX}`]);
  });

  it('ignores padding entries, which have a count of 0', async () => {
    const { fn } = fakeFetch(() => range([`${SUFFIX}:0`]));
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(false);
  });

  it('accepts a password whose suffix is absent', async () => {
    const { fn } = fakeFetch(() => range(['0018A45C4D1DEF81644B54AB7F969B88D65:1']));
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(false);
  });

  it('skips the check when HIBP fails or is unreachable (spec §9)', async () => {
    const down = fakeFetch(() => new Response('', { status: 503 }));
    expect(await new PwnedPasswordsChecker(down.fn).isBreached('password')).toBe(false);
    const unreachable = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await new PwnedPasswordsChecker(unreachable).isBreached('password')).toBe(false);
  });
});
