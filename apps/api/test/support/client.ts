import type { INestApplication } from '@nestjs/common';
import { SESSION_COOKIE } from '../../src/auth/session-cookie.js';
import { http } from '../../src/testing/app.js';
import { TEST_APP_ORIGIN } from '../../src/testing/test-env.js';

type PendingRequest = ReturnType<ReturnType<typeof http>['get']>;
export type ApiResponse = Awaited<PendingRequest>;

/**
 * Calls the API the way the web app's browser does: under /api, with JSON bodies, and with
 * `Origin: APP_ORIGIN` on anything that changes state, which is all the CSRF guard accepts. Pass
 * a cookie from `sessionCookie` to act as a signed-in user.
 */
export function client(app: INestApplication, cookie?: string) {
  const signedIn = (req: PendingRequest): PendingRequest =>
    cookie ? req.set('Cookie', cookie) : req;
  const mutate = (req: PendingRequest, body: object): PendingRequest =>
    signedIn(req.set('Origin', TEST_APP_ORIGIN)).send(body);
  return {
    get: (path: string) => signedIn(http(app).get(`/api${path}`)),
    post: (path: string, body: object = {}) => mutate(http(app).post(`/api${path}`), body),
    patch: (path: string, body: object = {}) => mutate(http(app).patch(`/api${path}`), body),
    delete: (path: string, body: object = {}) => mutate(http(app).delete(`/api${path}`), body),
  };
}

/** Every Set-Cookie header on a response. */
export function setCookies(res: ApiResponse): string[] {
  const header: unknown = res.headers['set-cookie'];
  if (Array.isArray(header)) return header.map(String);
  return typeof header === 'string' ? [header] : [];
}

/** The `__Host-session=<token>` pair a response set, ready to send back as a Cookie header. */
export function sessionCookie(res: ApiResponse): string {
  const pair = setCookies(res)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split(';')[0];
  if (!pair) throw new Error('the response did not set a session cookie');
  return pair;
}

/** The token from an emailed link (`…?token=<43 characters>`). */
export function linkToken(text: string): string {
  const token = /[?&]token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];
  if (!token) throw new Error('no link with a token in this email');
  return token;
}
