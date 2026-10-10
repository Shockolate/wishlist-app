import type { RateLimitRule } from '../rate-limit/window.js';

/**
 * Spec §6.6. Signup, resend-verification and reset-request share these two buckets: together they
 * cap how much mail one address, or one IP, can trigger.
 */
export const MAIL_PER_EMAIL: RateLimitRule = { limit: 3, windowSeconds: 3600 };
export const MAIL_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 3600 };

/** Spec §6.6. Password confirmations on /me count against the same per-address bucket. */
export const LOGIN_PER_EMAIL: RateLimitRule = { limit: 10, windowSeconds: 900 };
export const LOGIN_PER_IP: RateLimitRule = { limit: 50, windowSeconds: 900 };
