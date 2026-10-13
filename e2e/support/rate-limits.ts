import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Empties the API's rate-limit table. Every test signs up from one IP, and the API caps that at 20
 * sign-up emails an hour per IP (spec §6.6, MAIL_PER_IP), which the suite's sign-ups would
 * otherwise exhaust as it grows. No E2E test asserts the real per-IP limits. This is the command
 * scripts/e2e.sh runs at the start of a run.
 */
export function resetRateLimits(): void {
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'wishlist',
      '-d',
      'wishlist_e2e',
      '-c',
      'TRUNCATE rate_limits',
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
