import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresDbHealth } from './db-health.js';

const poolWith = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

afterEach(() => {
  vi.useRealTimers();
});

describe('PostgresDbHealth', () => {
  it('reports the number of applied migrations', async () => {
    const health = new PostgresDbHealth(poolWith(() => Promise.resolve({ rows: [{ n: 3 }] })));
    await expect(health.check()).resolves.toEqual({ ok: true, migrationsApplied: 3 });
  });

  it('treats a reachable but never-migrated database as zero migrations', async () => {
    const health = new PostgresDbHealth(poolWith(async () => Promise.reject(pgError('42P01'))));
    await expect(health.check()).resolves.toEqual({ ok: true, migrationsApplied: 0 });
  });

  it('reports down when the query fails for any other reason', async () => {
    const health = new PostgresDbHealth(
      poolWith(async () => Promise.reject(pgError('ECONNREFUSED'))),
    );
    await expect(health.check()).resolves.toEqual({ ok: false });
  });

  it('reports down when the database does not answer within 5 seconds', async () => {
    vi.useFakeTimers();
    const health = new PostgresDbHealth(poolWith(() => new Promise(() => {})));
    const result = health.check();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ ok: false });
  });
});
