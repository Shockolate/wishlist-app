import { ErrorCode } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { FakeBreachedPasswords } from '../testing/fakes.js';
import { PasswordPolicy } from './password-policy.js';

describe('PasswordPolicy', () => {
  it('refuses a breached password with 400 PASSWORD_BREACHED, without echoing it', async () => {
    const breaches = new FakeBreachedPasswords();
    breaches.breached.add('hunter2hunter2');
    const error: unknown = await new PasswordPolicy(breaches)
      .assertNotBreached('hunter2hunter2')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, code: ErrorCode.PASSWORD_BREACHED });
    expect(JSON.stringify(error)).not.toContain('hunter2');
  });

  it('accepts a password HIBP does not know', async () => {
    await expect(
      new PasswordPolicy(new FakeBreachedPasswords()).assertNotBreached('a fine password'),
    ).resolves.toBeUndefined();
  });
});
