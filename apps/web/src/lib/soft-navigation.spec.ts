import { describe, expect, it } from 'vitest';
import { cameByClientNavigation } from './soft-navigation';

describe('cameByClientNavigation (Plan 3b rule 14)', () => {
  const login = 'https://hanker.dev/login?next=%2Flist';

  it('is false when this document was loaded here', () => {
    expect(cameByClientNavigation(login, login)).toBe(false);
  });

  it('is true when the document was loaded at another page', () => {
    expect(cameByClientNavigation('https://hanker.dev/settings', login)).toBe(true);
    expect(cameByClientNavigation('https://hanker.dev/login?next=%2Fsettings', login)).toBe(true);
  });

  it('ignores the fragment', () => {
    expect(cameByClientNavigation(`${login}#form`, login)).toBe(false);
  });
});
