/**
 * Takes ?token= out of the address bar and this history entry, keeping the path (spec §6.7). Call
 * it once on mount, before anything else happens on a token page (rule 7).
 */
export function stripTokenFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  // null state, as Next documents: passing history.state back (with Next's internal marker) makes
  // Next treat this as its own call and leave the router's canonical URL, token included.
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
