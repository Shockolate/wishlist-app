import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema, LiveResponseSchema } from '@wishlist/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { http } from '../src/testing/app.js';
import { createTestApp } from './support/app.js';
import { openTestDatabase } from './support/database.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: unknown[];
};

let app: NestExpressApplication | undefined;
afterEach(() => app?.close());

describe('GET /api/health (real database)', () => {
  it('reports ok and counts every committed migration', async () => {
    app = await createTestApp({ databaseUrl: openTestDatabase().url, env: { GIT_SHA: 'int-sha' } });
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      sha: 'int-sha',
      db: { ok: true, migrationsApplied: journal.entries.length },
    });
  });

  it('answers 503 degraded quickly when the database is unreachable', async () => {
    app = await createTestApp({ databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' });
    const started = Date.now();
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(res.body).status).toBe('degraded');
    expect(Date.now() - started).toBeLessThan(6_000);
  });

  it('answers 503 degraded when the database was never migrated', async () => {
    const admin = openTestDatabase();
    const name = `unmigrated_${Date.now()}`;
    await admin.pool.query(`create database "${name}"`);
    await admin.close();
    const url = new URL(admin.url);
    url.pathname = `/${name}`;

    app = await createTestApp({ databaseUrl: url.toString() });
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(res.body)).toMatchObject({
      status: 'degraded',
      db: { ok: false, migrationsApplied: null },
    });
  });

  it('answers live at once while the database is unreachable', async () => {
    app = await createTestApp({
      databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
      env: { GIT_SHA: 'int-sha' },
    });
    const started = Date.now();
    const res = await http(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(LiveResponseSchema.parse(res.body)).toEqual({ status: 'ok', sha: 'int-sha' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
