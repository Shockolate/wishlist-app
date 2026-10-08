import { ErrorCode } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, ContractMismatchError, createApiClient } from './api-client';

const Thing = z.object({ id: z.string() });

function clientReturning(response: Response, headers?: Record<string, string>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    ...(headers ? { headers } : {}),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  });
  return { client, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('createApiClient', () => {
  it('GETs under /api and returns the parsed body', async () => {
    const { client, calls } = clientReturning(json({ id: 't1' }));
    await expect(client.get('/things/t1', Thing)).resolves.toEqual({ id: 't1' });
    expect(calls[0]?.url).toBe('https://api.example.test/api/things/t1');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.cache).toBe('no-store');
    expect(calls[0]?.init.headers).toMatchObject({
      accept: 'application/json, application/problem+json',
    });
  });

  it('forwards configured headers such as the incoming cookie', async () => {
    const { client, calls } = clientReturning(json({ id: 't1' }), { cookie: 'a=b' });
    await client.get('/things/t1', Thing);
    expect(calls[0]?.init.headers).toMatchObject({ cookie: 'a=b' });
  });

  it('sends JSON bodies with a JSON content type', async () => {
    const { client, calls } = clientReturning(json({ id: 't2' }, 201));
    await client.post('/things', { name: 'x' }, Thing);
    expect(calls[0]?.init.body).toBe('{"name":"x"}');
    expect(calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('raises ApiError carrying the problem, including extension members', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      requestId: 'req-1',
      remaining: 1,
    };
    const { client } = clientReturning(json(problem, 409));
    const error = await client.get('/x', Thing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).problem).toEqual(problem);
  });

  it('non-JSON error bodies become UNEXPECTED_RESPONSE', async () => {
    const edgePage = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html', 'x-request-id': 'edge-1' },
    });
    const { client } = clientReturning(edgePage);
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      code: ErrorCode.UNEXPECTED_RESPONSE,
      requestId: 'edge-1',
    });
  });

  it('JSON error bodies that are not problems also become UNEXPECTED_RESPONSE', async () => {
    const { client } = clientReturning(json({ error: 'unauthorized' }, 401));
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error.problem.code).toBe(ErrorCode.UNEXPECTED_RESPONSE);
    expect(error.problem.requestId).toBe('unknown');
  });

  it('raises ContractMismatchError when a success body breaks the contract', async () => {
    const { client } = clientReturning(json({ id: 42 }));
    const error = await client.get('/things/t1', Thing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractMismatchError);
    expect((error as ContractMismatchError).endpoint).toBe('GET /things/t1');
  });

  it('raises ContractMismatchError when a body labelled JSON does not parse', async () => {
    const { client } = clientReturning(
      new Response('{"id": ', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(client.get('/things/t1', Thing)).rejects.toBeInstanceOf(ContractMismatchError);
  });

  it('does not follow redirects, and treats one (e.g. to the Vercel login page) as UNEXPECTED_RESPONSE', async () => {
    const toLogin = new Response(null, {
      status: 302,
      headers: { location: 'https://vercel.com/login?next=x', 'x-request-id': 'edge-2' },
    });
    const { client, calls } = clientReturning(toLogin);
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem).toMatchObject({
      code: ErrorCode.UNEXPECTED_RESPONSE,
      status: 502,
      requestId: 'edge-2',
    });
    expect(error.problem.detail).toContain('302');
  });

  it('treats a browser opaque redirect as UNEXPECTED_RESPONSE with a valid error status', async () => {
    const opaque = {
      type: 'opaqueredirect',
      status: 0,
      ok: false,
      statusText: '',
      headers: new Headers(),
      json: () => Promise.reject(new Error('opaque')),
    } as unknown as Response;
    const { client } = clientReturning(opaque);
    const error = (await client.get('/x', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem).toMatchObject({ code: ErrorCode.UNEXPECTED_RESPONSE, status: 502 });
  });

  it('treats a non-JSON success page as UNEXPECTED_RESPONSE, not version skew', async () => {
    const page = new Response('<html>Log in to Vercel</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const { client } = clientReturning(page);
    const error = (await client.get('/things/t1', Thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem).toMatchObject({ code: ErrorCode.UNEXPECTED_RESPONSE, status: 502 });
  });

  it('resolves 204 responses as undefined', async () => {
    const { client } = clientReturning(new Response(null, { status: 204 }));
    await expect(client.delete('/things/t1', z.undefined())).resolves.toBeUndefined();
  });
});
