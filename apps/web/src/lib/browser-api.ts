import { createApiClient } from './api-client';

/**
 * The API from the browser: same origin, through the /api rewrite, so the API's Set-Cookie lands
 * in the browser (spec §7: auth forms don't use Server Actions).
 */
export const browserApi = createApiClient({ baseUrl: '' });
