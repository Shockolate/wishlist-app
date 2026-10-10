import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's argon2id parameters, as the spec fixes them (§6.4): m=19 MiB, t=2, p=1. Argon2id is the
 * library's default algorithm, and the tests pin it. Its `Algorithm` enum is a `const enum`,
 * which `verbatimModuleSyntax` can't import.
 */
export const ARGON2_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

/** False for a wrong password and for a malformed stored hash; never throws. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Does the work of a password check against a throwaway hash, so a login for an unknown email
 * takes as long as one with a wrong password (spec §6.4).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equalizer, never a real password');
  await verifyPassword(await dummyHash, password);
}
