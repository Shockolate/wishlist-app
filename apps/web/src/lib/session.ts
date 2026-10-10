/**
 * The API's session cookie (apps/api/src/auth/session-cookie.ts). The proxy only checks that it
 * exists (spec §6.1); the account E2E tests fail if the two names drift apart (rule 24).
 */
export const SESSION_COOKIE = '__Host-session';
