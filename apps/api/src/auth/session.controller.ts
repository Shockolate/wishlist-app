import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clearSessionCookie, readSessionToken } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class SessionController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  /** Idempotent: 204 and a cleared cookie, whether or not a live session came with it. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readSessionToken(req.headers.cookie);
    if (token) await this.sessions.revoke(token);
    clearSessionCookie(res);
  }
}
