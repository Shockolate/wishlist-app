import { Controller, Get, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import {
  clearSessionCookie,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  setSessionCookie,
} from './session-cookie.js';

const TOKEN = 'A'.repeat(43);

describe('readSessionToken', () => {
  it('finds the session cookie among others', () => {
    expect(readSessionToken(`theme=dark; ${SESSION_COOKIE}=${TOKEN}; other=1`)).toBe(TOKEN);
  });

  it('ignores a missing header, a missing cookie, and a malformed token', () => {
    expect(readSessionToken(undefined)).toBeUndefined();
    expect(readSessionToken('theme=dark')).toBeUndefined();
    expect(readSessionToken(`${SESSION_COOKIE}=not-a-token`)).toBeUndefined();
  });
});

@Controller('probe')
class ProbeController {
  @Get('set')
  set(@Res({ passthrough: true }) res: Response): void {
    setSessionCookie(res, TOKEN, SESSION_TTL_MS);
  }

  @Get('clear')
  clear(@Res({ passthrough: true }) res: Response): void {
    clearSessionCookie(res);
  }
}

describe('session cookie attributes (spec §6.1)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('sets __Host-session HttpOnly, Secure, SameSite=Lax, Path=/ for 30 days', async () => {
    const res = await http(app).get('/api/probe/set');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=${TOKEN}; Max-Age=2592000; Path=/; `));
    expect(cookie).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('clears it with the same attributes, so the browser replaces rather than adds', async () => {
    const res = await http(app).get('/api/probe/clear');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));
    expect(cookie).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
  });
});
