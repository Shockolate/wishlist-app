import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ErrorCode,
  ProblemSchema,
  SignupRequestSchema,
  type SignupRequest,
} from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('probe')
class ProbeController {
  @Post('signup')
  signup(@Body(new ZodValidationPipe(SignupRequestSchema)) body: SignupRequest): SignupRequest {
    return body;
  }
}

describe('ZodValidationPipe', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('hands the handler the parsed, normalized body, dropping unknown fields', async () => {
    const res = await http(app).post('/api/probe/signup').send({
      email: ' Ada@Example.com ',
      password: 'correct horse 1',
      displayName: 'Ada',
      turnstileToken: 't',
      isAdmin: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      email: 'ada@example.com',
      password: 'correct horse 1',
      displayName: 'Ada',
      turnstileToken: 't',
    });
  });

  it('answers an invalid body with 400 VALIDATION_FAILED naming each bad field, not its value', async () => {
    const res = await http(app)
      .post('/api/probe/signup')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    const problem = ProblemSchema.parse(res.body);
    expect(problem.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(problem.errors?.map((e) => e.path).sort()).toEqual([
      'displayName',
      'email',
      'password',
      'turnstileToken',
    ]);
    expect(JSON.stringify(problem)).not.toContain('not-an-email');
  });

  it('treats a missing body as invalid', async () => {
    const res = await http(app).post('/api/probe/signup');
    expect(res.status).toBe(400);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
