import { Body, Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { TEST_APP_ORIGIN, testEnv } from '../testing/test-env.js';
import { CsrfGuard } from './csrf.guard.js';

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  create(@Body() body: unknown): unknown {
    return body;
  }

  @Patch()
  update(): { ok: true } {
    return { ok: true };
  }

  @Put()
  replace(): { ok: true } {
    return { ok: true };
  }

  @Delete()
  remove(): { ok: true } {
    return { ok: true };
  }
}

describe('CsrfGuard (spec §6.2)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({
      controllers: [ProbeController],
      providers: [
        { provide: ENV, useValue: testEnv() },
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    });
  });

  afterAll(() => app.close());

  const codeOf = (res: { body: unknown }) => ProblemSchema.parse(res.body).code;

  it('lets safe methods through without an Origin', async () => {
    expect((await http(app).get('/api/probe')).status).toBe(200);
  });

  it('accepts a JSON request from APP_ORIGIN, with or without a charset', async () => {
    const plain = await http(app).post('/api/probe').set('Origin', TEST_APP_ORIGIN).send({ a: 1 });
    expect(plain.status).toBe(201);
    const withCharset = await http(app)
      .post('/api/probe')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ a: 1 }));
    expect(withCharset.status).toBe(201);
  });

  it('rejects a state-changing request without an Origin', async () => {
    const res = await http(app).post('/api/probe').send({ a: 1 });
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN_ORIGIN);
  });

  it('rejects other origins, including a look-alike and the opaque "null" origin', async () => {
    for (const origin of ['https://evil.example', `${TEST_APP_ORIGIN}.evil.example`, 'null']) {
      const res = await http(app).post('/api/probe').set('Origin', origin).send({ a: 1 });
      expect(res.status).toBe(403);
    }
  });

  it('rejects a non-JSON body even from APP_ORIGIN, since a form could send it without a preflight', async () => {
    const res = await http(app)
      .post('/api/probe')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('a=1');
    expect(res.status).toBe(415);
    expect(codeOf(res)).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
  });

  it('guards PATCH, PUT and DELETE as well', async () => {
    for (const method of ['patch', 'put', 'delete'] as const) {
      const res = await http(app)[method]('/api/probe').send({});
      expect(res.status).toBe(403);
    }
  });
});
