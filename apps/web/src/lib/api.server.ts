import 'server-only';
import { headers } from 'next/headers';
import { createApiClient, type ApiClient } from './api-client';

/**
 * API client for Server Components. Calls the API origin directly (server to server) and
 * forwards the browser's cookies so the API sees the same session.
 */
export async function serverApi(): Promise<ApiClient> {
  const origin = process.env.API_ORIGIN;
  if (!origin) throw new Error('API_ORIGIN is not configured');
  const cookie = (await headers()).get('cookie');
  return createApiClient({ baseUrl: origin, headers: cookie ? { cookie } : {} });
}
