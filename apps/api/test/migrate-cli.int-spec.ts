import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { openTestDatabase } from './support/database.js';

// Run from source, exactly as CI's secret-holding jobs do (Node type stripping; final review C-1).
const CLI = fileURLToPath(new URL('../src/db/migrate-cli.ts', import.meta.url));
const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: unknown[];
};

const admin = openTestDatabase();
afterAll(() => admin.close());

function runCli(databaseUrl: string) {
  return spawnSync(process.execPath, [CLI], {
    env: { PATH: process.env.PATH, DATABASE_URL_DIRECT: databaseUrl },
    encoding: 'utf8',
  });
}

async function freshDatabase(): Promise<string> {
  const name = `cli_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.pool.query(`create database "${name}"`);
  const url = new URL(admin.url);
  url.pathname = `/${name}`;
  return url.toString();
}

async function appliedCount(url: string): Promise<number> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    return rows[0]?.n ?? 0;
  } finally {
    await pool.end();
  }
}

describe('migrate-cli (from source)', () => {
  it('applies every migration to an empty database, then nothing on a re-run', async () => {
    const url = await freshDatabase();

    const first = runCli(url);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('migrations applied');
    expect(await appliedCount(url)).toBe(journal.entries.length);

    const second = runCli(url);
    expect(second.status, second.stderr).toBe(0);
    expect(await appliedCount(url)).toBe(journal.entries.length);
  });

  it('exits 1 without leaking the URL or password when the database is unreachable', () => {
    const url = 'postgres://owner:p4ssw0rd-leak-check@127.0.0.1:1/nowhere';
    const result = runCli(url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('migration failed');
    expect(result.stderr).not.toContain('p4ssw0rd-leak-check');
    expect(result.stderr).not.toContain(url);
  });
});
