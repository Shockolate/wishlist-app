'use client';

import { ErrorCode } from '@wishlist/contracts';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Notice } from '@/components/ui/notice';
import { hasCode, listErrorMessage } from '@/lib/messages';

export const LIST_LOGIN = '/login?next=%2Flist';

type Tone = 'success' | 'info' | 'error';
interface Message {
  tone: Tone;
  text: string;
  /** Changes with every message, so a repeated one is announced again. */
  id: number;
}
interface ListStatus {
  announce(text: string, tone?: 'success' | 'info'): void;
  fail(error: unknown): void;
  message: Message | null;
}

const ListStatusContext = createContext<ListStatus | null>(null);

/** The editor's one status line (Plan 3b rules 4 and 11). */
export function ListStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const announce = useCallback((text: string, tone: 'success' | 'info' = 'success') => {
    setMessage((last) => ({ tone, text, id: (last?.id ?? 0) + 1 }));
  }, []);
  const fail = useCallback((error: unknown) => {
    if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
      // A full navigation, so Back can't restore the list from the router's cache.
      window.location.replace(LIST_LOGIN);
      return;
    }
    setMessage((last) => ({
      tone: 'error',
      text: listErrorMessage(error),
      id: (last?.id ?? 0) + 1,
    }));
  }, []);
  const value = useMemo(() => ({ announce, fail, message }), [announce, fail, message]);
  return <ListStatusContext value={value}>{children}</ListStatusContext>;
}

export function useListStatus(): ListStatus {
  const status = use(ListStatusContext);
  if (!status) throw new Error('useListStatus is only for components inside ListStatusProvider');
  return status;
}

/**
 * Confirmations are read politely, from a region that is always mounted so its new content is
 * announced. Errors interrupt: an error Notice is role="alert".
 */
export function ListStatusLine() {
  const { message } = useListStatus();
  return (
    <>
      <div role="status">
        {message && message.tone !== 'error' ? (
          <Notice key={message.id} tone={message.tone} announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {message?.tone === 'error' ? (
        <Notice key={message.id} tone="error" className="mt-4">
          {message.text}
        </Notice>
      ) : null}
    </>
  );
}
