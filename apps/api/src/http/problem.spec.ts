import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { toProblem } from './problem.js';

describe('toProblem', () => {
  it('maps an AppError to its status, code, detail and extension members', () => {
    const problem = toProblem(
      new AppError(409, 'CLAIM_EXCEEDS_REMAINING', 'Only 1 left', { remaining: 1 }),
      'req-1',
    );
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      detail: 'Only 1 left',
      requestId: 'req-1',
      remaining: 1,
    });
  });

  it('never lets extension members overwrite the core fields', () => {
    const problem = toProblem(
      new AppError(409, 'REAL_CODE', undefined, { status: 200, code: 'FAKE', requestId: 'x' }),
      'req-1',
    );
    expect(problem).toMatchObject({ status: 409, code: 'REAL_CODE', requestId: 'req-1' });
  });

  it('maps Nest HTTP exceptions to a code by status', () => {
    expect(toProblem(new NotFoundException('Cannot GET /api/nope'), 'req-1')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /api/nope',
    });
  });

  it('hides the message of server-side HTTP exceptions', () => {
    const problem = toProblem(new HttpException('pool exhausted at db-7', 503), 'req-1');
    expect(problem).toMatchObject({ status: 503, code: 'INTERNAL_ERROR' });
    expect(problem).not.toHaveProperty('detail');
  });

  it('maps exposed client errors from Express middleware (e.g. body-parser)', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      status: 400,
      expose: true,
    });
    expect(toProblem(parseError, 'req-1')).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      detail: 'The request body is not valid JSON.',
    });
  });

  it('gives exposed middleware errors a fixed detail, never the library message', () => {
    const thrown = (status: number) =>
      Object.assign(new Error('quotes "hunter2" from the body'), { status, expose: true });
    expect(toProblem(thrown(413), 'req-1').detail).toBe('The request body is too large.');
    expect(toProblem(thrown(415), 'req-1').detail).toBe('Unsupported content type.');
    expect(toProblem(thrown(418), 'req-1')).not.toHaveProperty('detail');
  });

  it('turns anything else into an opaque 500', () => {
    for (const thrown of [
      new Error('secret internals'),
      'a string',
      { status: 400, expose: false, message: 'x' },
    ]) {
      const problem = toProblem(thrown, 'req-1');
      expect(problem).toEqual({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: 'req-1',
      });
    }
  });
});
