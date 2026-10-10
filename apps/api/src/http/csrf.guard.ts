import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../core/env.js';
import { forbiddenOrigin, unsupportedMediaType } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF, layer 2 (spec §6.2). Layer 1 is the SameSite=Lax cookie. A state-changing request must
 * come from APP_ORIGIN, which a cross-site page can't forge, and must be JSON. A JSON content
 * type forces a CORS preflight, and we never grant one.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.headers.origin !== this.env.APP_ORIGIN) throw forbiddenOrigin();
    const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') throw unsupportedMediaType();
    return true;
  }
}
