'use client';

import { ClaimDetailsResponseSchema, type SharedItem } from '@wishlist/contracts';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import {
  dropRecord,
  readRecords,
  reconcile,
  recordsSnapshot,
  saveRecord,
  subscribeRecords,
  updateRecords,
  writeRecords,
  type ClaimRecord,
} from '@/lib/claim-records';
import { ClaimSheet } from './claim-sheet';

interface ShareClaims {
  /** This browser's claims (D45). Empty on the server and while hydrating, so the two agree. */
  records: readonly ClaimRecord[];
  open(item: SharedItem, trigger: HTMLElement): void;
  remember(record: ClaimRecord): void;
  forget(manageToken: string): void;
  /**
   * Tokens of claims whose answer hasn't come, by item ID, in memory only. Storage can throw, and
   * then a sheet that is closed and opened again would otherwise mint a second token for a claim
   * the first may have made (D42). Kept and cleared by the same rule as the stored record.
   */
  pendingTokens: Map<string, string>;
}

const ShareClaimsContext = createContext<ShareClaims | null>(null);
const NO_RECORDS: ClaimRecord[] = [];
const currentRecords = () => recordsSnapshot();
const noRecords = () => NO_RECORDS;

/** The gifter's side of the share page: their claims, and the one claim sheet. */
export function ShareClaimsProvider({
  shareToken,
  ownerName,
  ownerSeesClaims,
  items,
  children,
}: {
  shareToken: string;
  ownerName: string;
  ownerSeesClaims: boolean;
  items: readonly SharedItem[];
  children: ReactNode;
}) {
  // Storage is the store: every write tells React, so no state is copied out of it.
  const records = useSyncExternalStore(subscribeRecords, currentRecords, noRecords);
  const [openItem, setOpenItem] = useState<SharedItem | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [pendingTokens] = useState(() => new Map<string, string>());

  const remember = useCallback((record: ClaimRecord) => {
    updateRecords((all) => saveRecord(all, record));
  }, []);
  const forget = useCallback((manageToken: string) => {
    updateRecords((all) => dropRecord(all, manageToken));
  }, []);
  const open = useCallback((item: SharedItem, from: HTMLElement) => {
    trigger.current = from;
    setOpenItem(item);
  }, []);

  // Claims that are gone are dropped, and a claim whose answer never came is looked up by its
  // token (D42, Plan 4b rule 8). Runs again when a refresh brings new items.
  useEffect(() => {
    const { kept, pending } = reconcile(readRecords(), items);
    writeRecords(kept);
    let current = true;
    for (const record of pending) {
      browserApi.get(`/claims/${record.manageToken}`, ClaimDetailsResponseSchema).then(
        (details) => {
          if (current) remember({ ...record, claimId: details.claim.id });
        },
        (error: unknown) => {
          if (current && error instanceof ApiError && error.status === 404) {
            forget(record.manageToken);
          }
        },
      );
    }
    return () => {
      current = false;
    };
  }, [items, remember, forget]);

  // The button that opened the sheet, or the item's title once a claim has replaced the button.
  // If the item has gone too, the page's heading.
  const returnFocus = useCallback(() => {
    const from = trigger.current;
    const target = from?.isConnected
      ? from
      : ((openItem ? document.getElementById(`item-${openItem.id}`) : null) ??
        document.querySelector('h1'));
    target?.focus();
  }, [openItem]);

  const value = useMemo(
    () => ({ records, open, remember, forget, pendingTokens }),
    [records, open, remember, forget, pendingTokens],
  );
  // The sheet shows the item as the page has it now, so a refresh after a conflict updates it.
  const shown = openItem ? (items.find((i) => i.id === openItem.id) ?? openItem) : null;
  return (
    <ShareClaimsContext value={value}>
      {children}
      {shown ? (
        <ClaimSheet
          key={shown.id}
          item={shown}
          shareToken={shareToken}
          ownerName={ownerName}
          ownerSeesClaims={ownerSeesClaims}
          onClose={() => setOpenItem(null)}
          returnFocus={returnFocus}
        />
      ) : null}
    </ShareClaimsContext>
  );
}

export function useShareClaims(): ShareClaims {
  const claims = use(ShareClaimsContext);
  if (!claims) throw new Error('useShareClaims is only for components inside ShareClaimsProvider');
  return claims;
}
