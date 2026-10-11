import type * as Argon2 from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';
import { burnPasswordCheck } from './passwords.js';

// Records every hash argon2's verify is asked to check, and still runs the real verify.
const verified = vi.hoisted(() => [] as string[]);
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof Argon2>();
  return {
    ...actual,
    verify: (hash: string, password: string) => {
      verified.push(hash);
      return actual.verify(hash, password);
    },
  };
});

describe('burnPasswordCheck (spec §6.4: an unknown email costs a real check)', () => {
  it('runs a real argon2id verification with the spec’s parameters', async () => {
    verified.length = 0;
    await burnPasswordCheck('x');
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies against one dummy hash, made once, on every call', async () => {
    verified.length = 0;
    await burnPasswordCheck('x');
    await burnPasswordCheck('y');
    expect(verified).toHaveLength(2);
    expect(verified[0]).toBe(verified[1]);
  });
});
