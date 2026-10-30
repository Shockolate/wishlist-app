import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/database.module.js';

export type DbHealthResult = { ok: true; migrationsApplied: number } | { ok: false };

export interface DbHealth {
  check(): Promise<DbHealthResult>;
}

export const DB_HEALTH = Symbol('DB_HEALTH');

/**
 * Bounded so a sleeping or unreachable database answers "down" quickly. Without the bound,
 * health would hang until pg's 10s connect timeout or the function's own timeout.
 */
const CHECK_TIMEOUT_MS = 5_000;

@Injectable()
export class PostgresDbHealth implements DbHealth {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<DbHealthResult> {
    try {
      return await withTimeout(this.countMigrations(), CHECK_TIMEOUT_MS);
    } catch {
      return { ok: false };
    }
  }

  /** A database with no migrations can't serve the API, so it's down: its query throws or finds none. */
  private async countMigrations(): Promise<DbHealthResult> {
    const { rows } = await this.pool.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    const migrationsApplied = rows[0]?.n ?? 0;
    return migrationsApplied > 0 ? { ok: true, migrationsApplied } : { ok: false };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
