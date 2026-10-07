import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { testEnv } from '../testing/test-env.js';
import { HealthController } from './health.controller.js';

describe('GET /api/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: testEnv({ GIT_SHA: 'abc123' }) }],
    });
  });

  afterAll(() => app.close());

  it('reports ok with the deployed commit and is never cached', async () => {
    const res = await http(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: 'ok', sha: 'abc123' });
  });
});
