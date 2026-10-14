import { describe, expect, it, vi } from 'vitest';
import {
  dropRecord,
  NAME_KEY,
  ownClaimsOn,
  parseRecords,
  pendingTokenFor,
  readClaimerName,
  readRecords,
  reconcile,
  RECORDS_KEY,
  recordsSnapshot,
  saveRecord,
  subscribeRecords,
  updateRecords,
  writeClaimerName,
  writeRecords,
  type ClaimRecord,
  type KeyValueStore,
} from './claim-records';

const T1 = 'aaaaaaaaaaaaaaaaaaaaaa';
const T2 = 'bbbbbbbbbbbbbbbbbbbbbb';
const T3 = 'cccccccccccccccccccccc';
const KETTLE = 'item-kettle';
const SOCKS = 'item-socks';

function memory(
  initial: Record<string, string> = {},
): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}
const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('the browser’s claims (D45)', () => {
  it('reads only well-formed records, and nothing from garbage', () => {
    expect(parseRecords(null)).toEqual([]);
    expect(parseRecords('not json')).toEqual([]);
    expect(parseRecords('{"itemId":"x"}')).toEqual([]);
    expect(
      parseRecords(
        JSON.stringify([
          { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
          { itemId: SOCKS, manageToken: 'short' },
          { itemId: SOCKS, manageToken: T2 },
          'junk',
        ]),
      ),
    ).toEqual([
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
      { itemId: SOCKS, manageToken: T2 },
    ]);
  });

  it('saves a record once per token, and drops it by token', () => {
    const pending: ClaimRecord = { itemId: KETTLE, manageToken: T1 };
    const done: ClaimRecord = { itemId: KETTLE, manageToken: T1, claimId: 'c1' };
    expect(saveRecord(saveRecord([], pending), done)).toEqual([done]);
    expect(dropRecord([done, { itemId: SOCKS, manageToken: T2 }], T1)).toEqual([
      { itemId: SOCKS, manageToken: T2 },
    ]);
  });

  it('finds the pending token for an item, and the item’s answered claims', () => {
    const records: ClaimRecord[] = [
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' },
      { itemId: KETTLE, manageToken: T2 },
      { itemId: SOCKS, manageToken: T3, claimId: 'c3' },
    ];
    expect(pendingTokenFor(records, KETTLE)).toBe(T2);
    expect(pendingTokenFor(records, SOCKS)).toBeUndefined();
    expect(ownClaimsOn(records, KETTLE)).toEqual([records[0]]);
  });

  it('reconciles with the page: drops claims that are gone, and lists the ones to look up (Plan 4b rule 8)', () => {
    const records: ClaimRecord[] = [
      { itemId: KETTLE, manageToken: T1, claimId: 'c1' }, // still on the item
      { itemId: KETTLE, manageToken: T2, claimId: 'gone' }, // cancelled or deleted
      { itemId: SOCKS, manageToken: T3 }, // its answer never came
      { itemId: 'another-list-item', manageToken: T1.replace(/a/g, 'd'), claimId: 'c9' },
    ];
    const items = [
      { id: KETTLE, claims: [{ id: 'c1' }] },
      { id: SOCKS, claims: [] },
    ];
    const { kept, pending } = reconcile(records, items);
    expect(kept).toEqual([records[0], records[2], records[3]]);
    expect(pending).toEqual([records[2]]);
  });

  it('keeps every record when the page doesn’t carry claims', () => {
    const records: ClaimRecord[] = [{ itemId: KETTLE, manageToken: T1, claimId: 'c1' }];
    expect(reconcile(records, [{ id: KETTLE }]).kept).toEqual(records);
  });

  it('stores records and the name under their keys', () => {
    const store = memory();
    writeRecords([{ itemId: KETTLE, manageToken: T1 }], store);
    expect(JSON.parse(store.data[RECORDS_KEY] ?? '')).toEqual([
      { itemId: KETTLE, manageToken: T1 },
    ]);
    expect(readRecords(store)).toEqual([{ itemId: KETTLE, manageToken: T1 }]);
    expect(
      updateRecords((all) => saveRecord(all, { itemId: SOCKS, manageToken: T2 }), store),
    ).toHaveLength(2);
    writeClaimerName('Priya', store);
    expect(store.data[NAME_KEY]).toBe('Priya');
    expect(readClaimerName(store)).toBe('Priya');
  });

  it('gives one snapshot until storage changes, and tells subscribers when it does', () => {
    const store = memory();
    const first = recordsSnapshot(store);
    expect(recordsSnapshot(store)).toBe(first);
    const heard = vi.fn();
    const stop = subscribeRecords(heard);
    writeRecords([{ itemId: KETTLE, manageToken: T1 }], store);
    expect(heard).toHaveBeenCalledOnce();
    expect(recordsSnapshot(store)).toEqual([{ itemId: KETTLE, manageToken: T1 }]);
    expect(recordsSnapshot(store)).toBe(recordsSnapshot(store));
    stop();
    expect(recordsSnapshot(throwing)).toEqual([]);
  });

  it('treats storage that throws as empty, and never throws itself (Plan 4b rule 7)', () => {
    expect(readRecords(throwing)).toEqual([]);
    expect(() => writeRecords([{ itemId: KETTLE, manageToken: T1 }], throwing)).not.toThrow();
    expect(updateRecords((all) => all, throwing)).toEqual([]);
    expect(readClaimerName(throwing)).toBe('');
    expect(() => writeClaimerName('Priya', throwing)).not.toThrow();
    expect(readRecords(undefined)).toEqual([]);
  });
});
