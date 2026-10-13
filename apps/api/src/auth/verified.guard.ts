import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { emailNotVerified } from './auth-errors.js';
import type { AuthContext } from './session.guard.js';

/**
 * Owner endpoints need a confirmed email (spec §5): anyone else gets 403 EMAIL_NOT_VERIFIED. It
 * reads the session SessionGuard attached, so it always comes second:
 * `@UseGuards(SessionGuard, VerifiedGuard)`.
 */
@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    if (!auth) throw new Error('VerifiedGuard must run after SessionGuard');
    if (!auth.user.emailVerified) throw emailNotVerified();
    return true;
  }
}
