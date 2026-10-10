import { v7 } from 'uuid';

/** UUIDv7: time-ordered, so index-friendly, and not enumerable (spec §3). */
export function newId(): string {
  return v7();
}
