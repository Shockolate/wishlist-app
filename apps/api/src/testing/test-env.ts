import type { Env } from '../core/env.js';

/** A complete, valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    GIT_SHA: 'test-sha',
    // Unit tests never connect; integration tests override this with the Testcontainers URL.
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    ...overrides,
  };
}
