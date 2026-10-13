/**
 * Whether this page was reached by a client-side navigation: the URL this document loaded at
 * (`performance`'s navigation entry) isn't the page's URL now. The fragment doesn't count.
 */
export function cameByClientNavigation(documentUrl: string, currentUrl: string): boolean {
  const loaded = new URL(documentUrl);
  const now = new URL(currentUrl);
  return loaded.pathname + loaded.search !== now.pathname + now.search;
}
