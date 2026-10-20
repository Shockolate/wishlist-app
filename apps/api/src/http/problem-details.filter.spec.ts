import { Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorReporter } from '../observability/error-reporter.js';
import { FakeErrorReporter } from '../testing/fakes.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

function fakeHost() {
  const json = vi.fn();
  const res = {
    locals: { requestId: 'req-1' },
    setHeader: vi.fn(),
    status: vi.fn(),
    type: vi.fn(),
    json,
  };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({ getResponse: <T>() => res as unknown as T }),
  } as unknown as ArgumentsHost;
  return { host, res: res as unknown as Response & typeof res };
}

describe('ProblemDetailsFilter logging', () => {
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the SQL and the driver error of a failed query, never its bound parameters', () => {
    const failure = new DrizzleQueryError(
      'insert into "users" ("email", "password_hash") values ($1, $2)',
      ['ada@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      new Error('Connection terminated unexpectedly'),
    );
    const { host, res } = fakeHost();

    new ProblemDetailsFilter().catch(failure, host);

    expect(logged).toHaveLength(1);
    const line = JSON.stringify(logged[0]);
    expect(line).not.toContain('ada@example.com');
    expect(line).not.toContain('$argon2id');
    expect(line).toContain('insert into \\"users\\"');
    expect(line).toContain('Connection terminated unexpectedly');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: 'req-1',
    });
  });

  it('still logs the stack of any other error', () => {
    const failure = new Error('something broke');
    const { host } = fakeHost();

    new ProblemDetailsFilter().catch(failure, host);

    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe('[req-1] unhandled error');
    expect(logged[0]?.[1]).toBe(failure.stack);
  });

  it('does not log client errors', () => {
    const { host } = fakeHost();
    new ProblemDetailsFilter().catch(
      Object.assign(new Error('x'), { status: 400, expose: true }),
      host,
    );
    expect(logged).toHaveLength(0);
  });
});

function hostWith(route?: string) {
  const { host, res } = fakeHost();
  const req = route ? { route: { path: route } } : {};
  const withRequest = {
    switchToHttp: () => ({ ...host.switchToHttp(), getRequest: <T>() => req as unknown as T }),
  } as unknown as ArgumentsHost;
  return { host: withRequest, res };
}

describe('ProblemDetailsFilter reporting', () => {
  beforeEach(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('reports an unexpected error with its request ID and route pattern', () => {
    const reporter = new FakeErrorReporter();
    const error = new Error('boom');
    const { host } = hostWith('/api/claims/:manageToken');
    new ProblemDetailsFilter(reporter).catch(error, host);
    expect(reporter.exceptions).toEqual([
      { error, context: { requestId: 'req-1', route: '/api/claims/:manageToken' } },
    ]);
  });

  it('reports nothing for a 4xx', () => {
    const reporter = new FakeErrorReporter();
    const { host } = hostWith('/api/x');
    new ProblemDetailsFilter(reporter).catch(new NotFoundException(), host);
    expect(reporter.exceptions).toEqual([]);
  });

  it('still sends the 500 problem when the reporter throws (Review Focus #3)', () => {
    const throwing: ErrorReporter = {
      captureException: () => {
        throw new Error('reporter broke');
      },
      captureWarning: () => undefined,
    };
    const { host, res } = hostWith('/api/x');
    expect(() => new ProblemDetailsFilter(throwing).catch(new Error('boom'), host)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });

  it('still reports, and still sends the 500, when the host has no request', () => {
    const reporter = new FakeErrorReporter();
    const { host, res } = fakeHost();
    expect(() => new ProblemDetailsFilter(reporter).catch(new Error('boom'), host)).not.toThrow();
    expect(reporter.exceptions).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
