import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts an ok response with database details', () => {
    const body = { status: 'ok', sha: 'abc123', db: { ok: true, migrationsApplied: 1 } };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a degraded response where the migration count is unknown', () => {
    const body = { status: 'degraded', sha: 'abc123', db: { ok: false, migrationsApplied: null } };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown statuses', () => {
    const body = { status: 'meh', sha: 'abc123', db: { ok: true, migrationsApplied: 1 } };
    expect(HealthResponseSchema.safeParse(body).success).toBe(false);
  });
});
