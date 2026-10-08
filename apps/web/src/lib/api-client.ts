import { ErrorCode, ProblemSchema, type Problem } from '@wishlist/contracts';
import type { z } from 'zod';

/** The API (or something in front of it) answered with an error status. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.status} ${problem.code}`);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }
}

/**
 * The API answered successfully but the body doesn't match its contract. Web and API deploy
 * independently, so this is how version skew shows up: loudly, instead of as undefined in the UI.
 */
export class ContractMismatchError extends Error {
  constructor(
    readonly endpoint: string,
    readonly issues: z.ZodError['issues'],
  ) {
    super(`Response from ${endpoint} does not match its contract`);
    this.name = 'ContractMismatchError';
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Origin to call; '' for same-origin browser calls through the /api rewrite. */
  baseUrl: string;
  /** Sent on every request, e.g. the incoming cookie when calling from the server. */
  headers?: Record<string, string>;
  fetch?: FetchFn;
}

export function createApiClient({
  baseUrl,
  headers = {},
  fetch: fetchFn = fetch,
}: ApiClientOptions) {
  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const endpoint = `${method} ${path}`;
    const res = await fetchFn(`${baseUrl}/api${path}`, {
      method,
      cache: 'no-store',
      // Our API never redirects. A redirect means something in front of it answered instead
      // (e.g. Vercel's login page for a protected preview), so surface it rather than follow it.
      redirect: 'manual',
      headers: {
        ...headers,
        accept: 'application/json, application/problem+json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (isRedirect(res)) {
      const location = res.headers.get('location');
      throw new ApiError(
        unexpectedResponse(
          res,
          `Unexpected redirect (${res.status || 'opaque'})${location ? ` to ${location}` : ''}`,
        ),
      );
    }
    if (!res.ok) throw new ApiError(await readProblem(res));
    if (res.status !== 204 && !isJson(res)) {
      throw new ApiError(
        unexpectedResponse(
          res,
          `Expected JSON, got ${res.headers.get('content-type') ?? 'no content type'}`,
        ),
      );
    }

    let payload: unknown;
    if (res.status !== 204) {
      try {
        payload = await res.json();
      } catch {
        throw new ContractMismatchError(endpoint, []);
      }
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ContractMismatchError(endpoint, parsed.error.issues);
    return parsed.data;
  }

  return {
    get: <S extends z.ZodType>(path: string, schema: S) => request('GET', path, schema),
    post: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('POST', path, schema, body),
    patch: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('PATCH', path, schema, body),
    put: <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
      request('PUT', path, schema, body),
    delete: <S extends z.ZodType>(path: string, schema: S) => request('DELETE', path, schema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function isRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
}

function isJson(res: Response): boolean {
  const type = res.headers.get('content-type') ?? '';
  return type.includes('application/json') || type.includes('+json');
}

/**
 * A response that isn't from our API but isn't an error status either (a redirect, an HTML page).
 * Reported as 502, so the Problem keeps its 4xx/5xx invariant; the original status is in `detail`.
 */
function unexpectedResponse(res: Response, detail: string): Problem {
  return {
    type: 'about:blank',
    title: 'Unexpected response',
    status: 502,
    code: ErrorCode.UNEXPECTED_RESPONSE,
    requestId: res.headers.get('x-request-id') ?? 'unknown',
    detail,
  };
}

/**
 * Errors that didn't come from our API (Vercel edge pages, deployment-protection 401s) have no
 * problem body; synthesize one so callers handle every failure the same way.
 */
async function readProblem(res: Response): Promise<Problem> {
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = ProblemSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  return {
    type: 'about:blank',
    title: res.statusText || 'Unexpected response',
    status: res.status,
    code: ErrorCode.UNEXPECTED_RESPONSE,
    requestId: res.headers.get('x-request-id') ?? 'unknown',
  };
}
