import { HealthResponseSchema } from '@wishlist/contracts';
import { ApiError } from '@/lib/api-client';
import { serverApi } from '@/lib/api.server';

// Rendered per request: the status must reflect the live API, and prerendering at build time
// would make CI call the API.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Wishlist</h1>
      <p className="mt-2 text-neutral-600">Wishlists for family and friends. Coming soon.</p>
      <p className="mt-8 font-mono text-sm" data-testid="api-status">
        {await apiStatus()}
      </p>
    </main>
  );
}

async function apiStatus(): Promise<string> {
  try {
    const api = await serverApi();
    const health = await api.get('/health', HealthResponseSchema);
    return `API: ${health.status} · db: ${health.db.ok ? 'ok' : 'down'}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return 'API: degraded · db: down';
    return 'API: unreachable';
  }
}
