import { describe, expect, it } from 'vitest';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords.js';

describe('passwords (spec §6.4)', () => {
  it('hashes with argon2id at m=19 MiB, t=2, p=1', async () => {
    expect(await hashPassword('correct horse 1')).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and only the right password', async () => {
    const hash = await hashPassword('correct horse 1');
    expect(await verifyPassword(hash, 'correct horse 1')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse 2')).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('treats a malformed stored hash as a failed check instead of throwing', async () => {
    expect(await verifyPassword('not-a-phc-string', 'anything')).toBe(false);
  });

  it('can burn the time of a check without a real hash', async () => {
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined();
  });
});
