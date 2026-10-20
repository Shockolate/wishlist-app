import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, LiveResponseSchema } from './health.js';

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

describe('LiveResponseSchema', () => {
  it('accepts ok with the deployed commit', () => {
    const body = { status: 'ok', sha: 'abc123' };
    expect(LiveResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects anything but ok, and an empty sha', () => {
    expect(LiveResponseSchema.safeParse({ status: 'degraded', sha: 'abc123' }).success).toBe(false);
    expect(LiveResponseSchema.safeParse({ status: 'ok', sha: '' }).success).toBe(false);
  });
});
