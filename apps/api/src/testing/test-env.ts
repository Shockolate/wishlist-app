import type { Env } from '../core/env.js';

/** A complete, valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { NODE_ENV: 'test', PORT: 0, GIT_SHA: 'test-sha', ...overrides };
}
