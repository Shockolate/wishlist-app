import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { unauthenticated } from '../http/errors.js';
import { clearSessionCookie, hasSessionCookie, readSessionToken } from './session-cookie.js';
import { SessionsService, type SessionUser } from './sessions.service.js';

export interface AuthContext {
  sessionId: string;
  user: SessionUser;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * Requires a live session and attaches it to the request. Every authorization decision is made
 * here, in the API (spec §6.1). A dead cookie is cleared along with the 401 (Plan 2b rule 2).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      if (hasSessionCookie(req.headers.cookie)) clearSessionCookie(http.getResponse<Response>());
      throw unauthenticated();
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

/**
 * Resolves the session if there is one, and never refuses. The public routes use it to tell the
 * list's owner from a guest (spec §5). Unlike SessionGuard it leaves a dead cookie alone: the
 * share page calls the API server to server, where a Set-Cookie never reaches the browser (D27).
 */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (session) req.auth = { sessionId: session.sessionId, user: session.user };
    return true;
  }
}

/** The session OptionalSessionGuard found, or null for a guest. Use it only behind that guard. */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | null =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth ?? null,
);
