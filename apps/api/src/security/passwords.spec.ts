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

  it('burns about as much time as a real check, so unknown emails are not distinguishable', async () => {
    const realHash = await hashPassword('correct horse 1');
    await burnPasswordCheck('x'); // warm-up: the first call also computes the dummy hash
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };
    const verifies: number[] = [];
    const burns: number[] = [];
    for (let i = 0; i < 3; i++) {
      verifies.push(await time(() => verifyPassword(realHash, 'x')));
      burns.push(await time(() => burnPasswordCheck('x')));
    }
    expect(Math.min(...burns)).toBeGreaterThanOrEqual(0.5 * Math.min(...verifies));
  });
});
