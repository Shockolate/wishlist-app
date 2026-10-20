import { describe, expect, it } from 'vitest';
import { FakeErrorReporter } from '../testing/fakes.js';
import { createPool } from './pool.js';

describe('createPool', () => {
  it('reports an idle client error as a warning instead of crashing', async () => {
    const reporter = new FakeErrorReporter();
    const pool = createPool('postgres://nobody@127.0.0.1:1/none', reporter);
    pool.emit('error', new Error('Connection terminated unexpectedly'));
    expect(reporter.warnings).toEqual([
      { message: 'idle client error: Connection terminated unexpectedly' },
    ]);
    await pool.end();
  });
});
