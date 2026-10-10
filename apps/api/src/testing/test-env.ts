import type { Env } from '../core/env.js';

/** The web origin tests send as `Origin`. The CSRF guard only accepts it. */
export const TEST_APP_ORIGIN = 'http://localhost:3000';

/** A complete, valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    GIT_SHA: 'test-sha',
    // Unit tests never connect; integration tests override this with the Testcontainers URL.
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    APP_ORIGIN: TEST_APP_ORIGIN,
    EMAIL_TRANSPORT: 'log',
    EMAIL_FROM: 'Hanker <hanker@localhost>',
    MAILPIT_URL: 'http://localhost:8025',
    ...overrides,
  };
}
