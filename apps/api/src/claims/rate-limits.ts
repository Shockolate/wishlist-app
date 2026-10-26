import { ipRateLimitKey, rateLimitKey } from '../rate-limit/keys.js';
import type { RateLimitRule } from '../rate-limit/window.js';

/**
 * Spec §6.6: new claims and claim changes share one bucket per IP and one per list. The list's is
 * keyed by its ID, not its share token: a change arrives by manage token, and a rotation shouldn't
 * reset the count.
 */
export const CLAIMS_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 3600 };
export const CLAIMS_PER_LIST: RateLimitRule = { limit: 30, windowSeconds: 3600 };

export const claimsIpKey = (ip: string): string => ipRateLimitKey('claims:ip', ip);
export const claimsListKey = (wishlistId: string): string =>
  rateLimitKey('claims:list', wishlistId);

/**
 * Share preview photos (Plan 12, design §5.5): each one is an outbound fetch anyone with the link
 * can cause, so they're limited per list and overall. No per-IP limit: the API sees the web
 * function's address, and the callers are mostly chat apps' shared crawlers.
 */
export const PREVIEW_PHOTOS_PER_LIST: RateLimitRule = { limit: 120, windowSeconds: 3600 };
export const PREVIEW_PHOTOS_OVERALL: RateLimitRule = { limit: 3000, windowSeconds: 3600 };

export const previewPhotosListKey = (wishlistId: string): string =>
  rateLimitKey('preview-photos:list', wishlistId);
export const PREVIEW_PHOTOS_OVERALL_KEY = rateLimitKey('preview-photos:all', 'all');
