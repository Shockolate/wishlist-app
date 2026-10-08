import { pathToFileURL } from 'node:url';
import { runMigrations } from './migrate.js';

export interface MigrateCliIo {
  run(url: string): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}

const POSTGRES_URL = /^postgres(ql)?:\/\//;

/**
 * Applies the committed migrations to DATABASE_URL_DIRECT. CI jobs that hold database secrets run
 * this built file instead of drizzle-kit, so no devDependency code executes next to the secret
 * (spec addendum 2026-10-08, §4). Never prints the URL.
 */
export async function migrateCli(env: NodeJS.ProcessEnv, io: MigrateCliIo): Promise<number> {
  const url = env.DATABASE_URL_DIRECT;
  if (!url || !POSTGRES_URL.test(url)) {
    io.error('DATABASE_URL_DIRECT must be set to a postgres:// connection string');
    return 1;
  }
  try {
    await io.run(url);
    io.log('migrations applied');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(`migration failed: ${redact(message, url)}`);
    return 1;
  }
}

/** Removes the URL and its password (raw and percent-decoded) from a message. */
function redact(message: string, url: string): string {
  let out = message.split(url).join('<DATABASE_URL_DIRECT>');
  for (const secret of passwordForms(url)) out = out.split(secret).join('***');
  return out;
}

function passwordForms(url: string): string[] {
  try {
    const raw = new URL(url).password;
    return [...new Set([raw, decodeURIComponent(raw)])].filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

// Executed directly (`node dist/db/migrate-cli.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await migrateCli(process.env, {
    run: runMigrations,
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
}
