/** The shop's name as people say it: the link's host, without "www.". Null for an idea or a bad link. */
export function shopName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
