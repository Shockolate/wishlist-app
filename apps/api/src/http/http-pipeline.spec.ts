import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import { AppError } from './app-error.js';

@Controller('probe')
class ProbeController {
  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Get('conflict')
  conflict(): never {
    throw new AppError(409, 'PROBE_CONFLICT', 'probe conflicted', { remaining: 2 });
  }

  @Get('crash')
  crash(): never {
    throw new Error('database password is hunter2');
  }
}

describe('HTTP pipeline', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('answers unknown routes with problem+json 404 carrying the request id', async () => {
    const res = await http(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = ProblemSchema.parse(res.body);
    expect(problem.code).toBe(ErrorCode.NOT_FOUND);
    expect(problem.requestId).toBe(res.headers['x-request-id']);
  });

  it('renders AppErrors with their code, detail and extension members', async () => {
    const res = await http(app).get('/api/probe/conflict');
    expect(res.status).toBe(409);
    expect(ProblemSchema.parse(res.body)).toMatchObject({
      code: 'PROBE_CONFLICT',
      detail: 'probe conflicted',
      remaining: 2,
    });
  });

  it('hides unexpected errors behind an opaque 500', async () => {
    const res = await http(app).get('/api/probe/crash');
    expect(res.status).toBe(500);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('parses valid JSON bodies', async () => {
    const res = await http(app).post('/api/probe/echo').send({ hello: 'world' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ hello: 'world' });
  });

  it('answers malformed JSON with problem+json 400', async () => {
    const res = await http(app)
      .post('/api/probe/echo')
      .set('content-type', 'application/json')
      .send('{"broken": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.BAD_REQUEST);
  });

  it('answers oversized bodies with problem+json 413', async () => {
    const res = await http(app)
      .post('/api/probe/echo')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
  });

  it('does not advertise Express', async () => {
    const res = await http(app).get('/api/definitely-not-a-route');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
