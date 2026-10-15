import { CAPABILITY_TOKEN_PATTERN } from '@wishlist/contracts';
import { z } from 'zod';

/**
 * A claim this browser knows (D45). Written before the claim is sent, with no `claimId` until the
 * API answers (D42). Item IDs are unique on their own, so a rotated share link keeps them.
 */
const RecordSchema = z.object({
  itemId: z.string().min(1),
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN),
  claimId: z.string().min(1).optional(),
});
export type ClaimRecord = z.infer<typeof RecordSchema>;

export const RECORDS_KEY = 'hanker:claims';
export const NAME_KEY = 'hanker:claimerName';

/** What storage held, keeping only well-formed records. */
export function parseRecords(raw: string | null): ClaimRecord[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = RecordSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Adds the record, or replaces the one with its manage token. */
export function saveRecord(records: readonly ClaimRecord[], record: ClaimRecord): ClaimRecord[] {
  return [...records.filter((r) => r.manageToken !== record.manageToken), record];
}

export function dropRecord(records: readonly ClaimRecord[], manageToken: string): ClaimRecord[] {
  return records.filter((r) => r.manageToken !== manageToken);
}

/** The token of this item's claim whose answer never came (Plan 4b rule 4). */
export function pendingTokenFor(
  records: readonly ClaimRecord[],
  itemId: string,
): string | undefined {
  return records.find((r) => r.itemId === itemId && r.claimId === undefined)?.manageToken;
}

/** This browser's answered claims on the item. */
export function ownClaimsOn(records: readonly ClaimRecord[], itemId: string): ClaimRecord[] {
  return records.filter((r) => r.itemId === itemId && r.claimId !== undefined);
}

interface PageItem {
  id: string;
  claims?: readonly { id: string }[];
}

/**
 * Squares the records with the page (Plan 4b rule 8). A record whose claim isn't on its item any
 * more is dropped; records for items elsewhere are kept, since they may be on another list. The
 * pending records for items on this page are the ones to look up.
 */
export function reconcile(
  records: readonly ClaimRecord[],
  items: readonly PageItem[],
): { kept: ClaimRecord[]; pending: ClaimRecord[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = records.filter((record) => {
    const claims = byId.get(record.itemId)?.claims;
    if (claims === undefined || record.claimId === undefined) return true;
    return claims.some((claim) => claim.id === record.claimId);
  });
  const pending = kept.filter((r) => r.claimId === undefined && byId.has(r.itemId));
  return { kept, pending };
}

/** The part of Storage this uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, or nothing: touching it throws in some private windows (Plan 4b rule 7). */
function browserStorage(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readRecords(store: KeyValueStore | undefined = browserStorage()): ClaimRecord[] {
  try {
    return parseRecords(store?.getItem(RECORDS_KEY) ?? null);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; records: ClaimRecord[] } = { raw: null, records: [] };

export function writeRecords(
  records: readonly ClaimRecord[],
  store: KeyValueStore | undefined = browserStorage(),
): void {
  try {
    store?.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Full or blocked: the manage link is still the way back (spec §7).
  }
  for (const listener of listeners) listener();
}

/**
 * The records for useSyncExternalStore: the same array until what's stored changes, so React
 * re-renders only on a real change. Storage that throws reads as no records.
 */
export function recordsSnapshot(
  store: KeyValueStore | undefined = browserStorage(),
): ClaimRecord[] {
  let raw: string | null = null;
  try {
    raw = store?.getItem(RECORDS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== snapshot.raw) snapshot = { raw, records: parseRecords(raw) };
  return snapshot.records;
}

export function subscribeRecords(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads, changes and writes in one step, so a change never works from a stale copy. */
export function updateRecords(
  change: (records: ClaimRecord[]) => ClaimRecord[],
  store: KeyValueStore | undefined = browserStorage(),
): ClaimRecord[] {
  const next = change(readRecords(store));
  writeRecords(next, store);
  return next;
}

export function readClaimerName(store: KeyValueStore | undefined = browserStorage()): string {
  try {
    return store?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeClaimerName(
  name: string,
  store: KeyValueStore | undefined = browserStorage(),
): void {
  try {
    store?.setItem(NAME_KEY, name);
  } catch {
    // As above: only a convenience.
  }
}
