/**
 * Takes ?token= out of the address bar and this history entry, keeping the path (spec §6.7). Call
 * it once on mount, before anything else happens on a token page (Plan 2b rule 7).
 */
export function stripTokenFromUrl(): void {
  // Wait one task. On a page's first load this runs inside a child's effect, before Next's router
  // has patched history.replaceState in its own effect. Called later, Next's patch sees a null
  // state as an outside change: it updates the router's URL too (so a refresh can't bring the
  // token back) and fills in its own history state (so Back to this page still renders it).
  setTimeout(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, 0);
}
