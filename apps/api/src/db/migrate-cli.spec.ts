import { describe, expect, it, vi } from 'vitest';
import { migrateCli, type MigrateCliIo } from './migrate-cli.js';

function io(run: MigrateCliIo['run'] = () => Promise.resolve()) {
  const logs: string[] = [];
  const errors: string[] = [];
  const runner = vi.fn(run);
  return {
    io: { run: runner, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) },
    runner,
    logs,
    errors,
  };
}

const URL_WITH_PASSWORD = 'postgres://owner:s3cr3t-pass@ep-x.neon.tech/neondb';

describe('migrateCli', () => {
  it('refuses to run without DATABASE_URL_DIRECT', async () => {
    const t = io();
    await expect(migrateCli({}, t.io)).resolves.toBe(1);
    expect(t.runner).not.toHaveBeenCalled();
    expect(t.errors.join('\n')).toContain('DATABASE_URL_DIRECT');
  });

  it('refuses a non-postgres URL without echoing it', async () => {
    const t = io();
    await expect(migrateCli({ DATABASE_URL_DIRECT: 'mysql://u:hunter2@db/x' }, t.io)).resolves.toBe(
      1,
    );
    expect(t.runner).not.toHaveBeenCalled();
    expect(t.errors.join('\n')).not.toContain('hunter2');
    expect(t.errors.join('\n')).not.toContain('mysql://');
  });

  it('runs the migrations and reports success', async () => {
    const t = io();
    await expect(migrateCli({ DATABASE_URL_DIRECT: URL_WITH_PASSWORD }, t.io)).resolves.toBe(0);
    expect(t.runner).toHaveBeenCalledWith(URL_WITH_PASSWORD);
    expect(t.logs).toEqual(['migrations applied']);
  });

  it('reports a failure without leaking the URL or its password', async () => {
    const t = io(() =>
      Promise.reject(new Error(`could not connect to ${URL_WITH_PASSWORD}: s3cr3t-pass rejected`)),
    );
    await expect(migrateCli({ DATABASE_URL_DIRECT: URL_WITH_PASSWORD }, t.io)).resolves.toBe(1);
    const message = t.errors.join('\n');
    expect(message).toContain('migration failed');
    expect(message).not.toContain(URL_WITH_PASSWORD);
    expect(message).not.toContain('s3cr3t-pass');
  });
});
