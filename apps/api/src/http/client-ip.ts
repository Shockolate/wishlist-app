import { isIP } from 'node:net';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The caller's IP, for per-IP rate limits (spec §6.6). On Vercel the edge overwrites `x-real-ip`
 * with the real client address (spike B), so it's trusted only there. Anywhere else a client
 * could set it, so the socket address is used instead.
 */
export function clientIp(req: Request, onVercel: boolean): string {
  if (onVercel) {
    const header = req.headers['x-real-ip'];
    if (typeof header === 'string' && isIP(header)) return header;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** `@ClientIp() ip: string` in a handler. `VERCEL` is set by the platform at runtime. */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  clientIp(ctx.switchToHttp().getRequest<Request>(), Boolean(process.env.VERCEL)),
);
