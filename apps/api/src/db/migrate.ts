import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** apps/api/drizzle, from both src/db (tests) and dist/db (built code). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies the committed migrations. The integration-test harness and the CI migrator
 * (`migrate-cli.ts`) use this; local `db:migrate` runs `drizzle-kit migrate` against the same
 * folder and the same journal table.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
