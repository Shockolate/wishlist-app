import { fixedWindow } from '../../src/rate-limit/window.js';
import { TEST_START } from './auth-app.js';
import type { TestDatabase } from './database.js';

/**
 * Sets a rate-limit counter in the current window, as if `count` requests had been made already.
 * The test clock stands at TEST_START, so that's the window the API counts in.
 */
export async function fillBucket(
  db: TestDatabase,
  key: string,
  count: number,
  windowSeconds = 3600,
): Promise<void> {
  const { start } = fixedWindow(TEST_START.getTime(), windowSeconds);
  await db.pool.query(
    `insert into rate_limits (key, window_start, count) values ($1, $2, $3)
     on conflict (key, window_start) do update set count = excluded.count`,
    [key, start, count],
  );
}
