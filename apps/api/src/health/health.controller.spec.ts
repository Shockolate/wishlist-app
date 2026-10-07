import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema } from '@wishlist/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { testEnv } from '../testing/test-env.js';
import { DB_HEALTH, type DbHealth, type DbHealthResult } from './db-health.js';
import { HealthController } from './health.controller.js';

let app: NestExpressApplication | undefined;
afterEach(() => app?.close());

async function appWithDb(result: DbHealthResult): Promise<NestExpressApplication> {
  const fake: DbHealth = { check: () => Promise.resolve(result) };
  app = await createUnitApp({
    controllers: [HealthController],
    providers: [
      { provide: ENV, useValue: testEnv({ GIT_SHA: 'abc123' }) },
      { provide: DB_HEALTH, useValue: fake },
    ],
  });
  return app;
}

describe('GET /api/health', () => {
  it('reports ok with the deployed commit and migration count, never cached', async () => {
    const res = await http(await appWithDb({ ok: true, migrationsApplied: 2 })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      sha: 'abc123',
      db: { ok: true, migrationsApplied: 2 },
    });
  });

  it('answers 503 degraded when the database is down', async () => {
    const res = await http(await appWithDb({ ok: false })).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(res.body)).toEqual({
      status: 'degraded',
      sha: 'abc123',
      db: { ok: false, migrationsApplied: null },
    });
  });
});
