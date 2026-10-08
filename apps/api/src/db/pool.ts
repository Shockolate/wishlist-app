import { Logger } from '@nestjs/common';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';

const logger = new Logger('PgPool');

/**
 * One small pool per function instance. Fluid compute reuses instances across requests, so the
 * pool outlives a single invocation; attachDatabasePool closes idle clients before Vercel
 * suspends the instance.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  // Neon drops idle connections when its compute scales to zero. pg reports that as an 'error'
  // event on the pool, and an unhandled 'error' event would crash the process.
  pool.on('error', (err) => logger.warn(`idle client error: ${err.message}`));
  if (process.env.VERCEL) attachDatabasePool(pool);
  return pool;
}
