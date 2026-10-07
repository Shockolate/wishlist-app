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
      headers: {
        ...headers,
        accept: 'application/json, application/problem+json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!res.ok) throw new ApiError(await readProblem(res));

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
