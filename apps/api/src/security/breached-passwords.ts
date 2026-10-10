import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

/** Port for the breached-password check (spec §6.4, §8). */
export interface BreachedPasswordChecker {
  /** True only when the password is known to be breached. Any failure answers false (spec §9). */
  isBreached(password: string): Promise<boolean>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');

/**
 * Have I Been Pwned's range API. Only the first five hex characters of the password's SHA-1
 * leave the server (k-anonymity), and padding hides how many suffixes share that prefix.
 */
export class PwnedPasswordsChecker implements BreachedPasswordChecker {
  private readonly logger = new Logger('PwnedPasswords');

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const res = await this.fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'wishlist-app' },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`HIBP answered ${res.status}`);
      for (const line of (await res.text()).split('\n')) {
        const [candidate, count] = line.trim().split(':');
        if (candidate === suffix) return Number(count) > 0;
      }
      return false;
    } catch (error) {
      this.logger.warn(
        `breach check skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
