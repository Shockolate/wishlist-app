import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import type { Database } from '../../src/db/database.module.js';
import * as schema from '../../src/db/schema.js';

export interface TestDatabase {
  url: string;
  pool: Pool;
  db: Database;
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

export function openTestDatabase(): TestDatabase {
  const url = inject('databaseUrl');
  const pool = new Pool({ connectionString: url, max: 20 });
  return {
    url,
    pool,
    db: drizzle({ client: pool, schema }),
    async truncateAll() {
      const { rows } = await pool.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'",
      );
      if (rows.length === 0) return;
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      await pool.query(`truncate ${tables} restart identity cascade`);
    },
    close: () => pool.end(),
  };
}
