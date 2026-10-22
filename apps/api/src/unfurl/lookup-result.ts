import type { PageMetadata } from './metadata.js';

/**
 * A retailer lookup's answer, shared by every lookup port (retailer lookups §5.2–§5.4). Only
 * LOOKUP_UNAVAILABLE carries detail, for the log and the error report.
 */
export type LookupResult =
  | { ok: true; metadata: PageMetadata }
  | { ok: false; reason: 'NO_METADATA' | 'TIMEOUT' }
  | { ok: false; reason: 'LOOKUP_UNAVAILABLE'; status?: number; misconfigured: boolean };
