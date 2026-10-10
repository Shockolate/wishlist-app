/**
 * Takes ?token= out of the address bar and this history entry, keeping the path (spec §6.7). Call
 * it once on mount, before anything else happens on a token page (rule 7).
 */
export function stripTokenFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
