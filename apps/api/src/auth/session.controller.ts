import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginRequestSchema, type LoginRequest } from '@wishlist/contracts';
import type { Request, Response } from 'express';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { LoginService } from './login.service.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class SessionController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(LoginService) private readonly logins: LoginService,
  ) {}

  /** 204 with the session cookie, or 401 INVALID_CREDENTIALS (spec §5). */
  @Post('login')
  @HttpCode(204)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.logins.login(body, ip);
    setSessionCookie(res, session.token);
  }

  /** Idempotent: 204 and a cleared cookie, whether or not a live session came with it. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readSessionToken(req.headers.cookie);
    if (token) await this.sessions.revoke(token);
    clearSessionCookie(res);
  }
}
