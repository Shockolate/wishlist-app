import type { Pool } from 'pg';

/**
 * Waits until `waiting` backends are blocked on a lock and at least one of them is blocked by
 * `holderPid`, so a lock-holder test commits only once its requests reached the lock (Plan 5b,
 * replacing fixed sleeps). Returns early if `settled` resolves first: an implementation that
 * doesn't take the lock lets the requests finish, and the test's own assertions then fail.
 * Integration files run serially against their own database, so no other test's backends count.
 */
export async function untilBlockedBy(
  pool: Pool,
  holderPid: number,
  waiting: number,
  settled: Promise<unknown>,
  timeoutMs = 10_000,
): Promise<void> {
  let done = false;
  void settled.then(
    () => (done = true),
    () => (done = true),
  );
  const deadline = Date.now() + timeoutMs;
  while (!done) {
    const { rows } = await pool.query<{ waiting: number; blocked: number }>(
      `select count(*) filter (where wait_event_type = 'Lock')::int as waiting,
              count(*) filter (where $1 = any(pg_blocking_pids(pid)))::int as blocked
         from pg_stat_activity
        where datname = current_database() and pid <> $1`,
      [holderPid],
    );
    const row = rows[0];
    if (row && row.waiting >= waiting && row.blocked >= 1) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${waiting} requests to block on pid ${holderPid}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
