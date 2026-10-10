import type { MetadataRoute } from 'next';

/** Auth, token and account pages stay out of search (spec §6.7). Plan 3 adds /s/ and /c/. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/verify-email', '/reset-password', '/list', '/settings'] },
  };
}
