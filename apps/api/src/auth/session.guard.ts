import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { unauthenticated } from '../http/errors.js';
import { readSessionToken, setSessionCookie } from './session-cookie.js';
import { SessionsService, type SessionUser } from './sessions.service.js';

export interface AuthContext {
  sessionId: string;
  user: SessionUser;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * Requires a live session. It attaches the session to the request and reissues the cookie when
 * the expiry slid. Every authorization decision is made here, in the API (spec §6.1).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!token || !session) throw unauthenticated();
    if (session.refreshed) {
      setSessionCookie(http.getResponse<Response>(), token, session.maxAgeMs);
    }
    req.auth = { sessionId: session.sessionId, user: session.user };
    return true;
  }
}

/** The session SessionGuard attached. Use it only on guarded routes. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('@CurrentAuth() used on a route without SessionGuard');
    return auth;
  },
);
