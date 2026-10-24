'use client';

import { ClaimLinkResponseSchema, type ClaimDetailsResponse } from '@wishlist/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { ON_SOMEONE_ELSES_GIFTS, ON_YOUR_GIFTS, TAKEN_OFF_GIFTS } from '@/lib/gifts-copy';
import { errorMessage } from '@/lib/messages';

type Phase = 'quiet' | 'someone-else' | 'added' | 'yours' | 'taken-off';

/** Where each `link` the API sends starts; `none` stays quiet until the link request answers. */
const START: Record<NonNullable<ClaimDetailsResponse['link']>, Phase> = {
  none: 'quiet',
  yours: 'yours',
  'someone-else': 'someone-else',
};

/**
 * Where a signed-in gifter's manage link stands on Your gifts (design §5.2, §5.10). Nothing for a
 * guest or for the list's owner.
 *
 * Opening a page changes nothing (D75, D82): a claim nobody has linked (`none`) is linked here, by
 * a request sent once the page is loaded in a browser, never by the server render and never by a
 * prefetch. Not mine takes the link off again and leaves the claim alone, whether the link was
 * just made or the claim was already on this account's gifts (`yours`, R12).
 */
export function ClaimLink({
  manageToken,
  link,
}: {
  manageToken: string;
  link: ClaimDetailsResponse['link'];
}) {
  const [phase, setPhase] = useState<Phase>(link ? START[link] : 'quiet');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  // React runs an effect twice in development. Linking is idempotent, but one request is the
  // contract, and the first request's answer must still land, so no cleanup cancels it.
  const asked = useRef(false);

  useEffect(() => {
    if (link !== 'none' || asked.current) return;
    asked.current = true;
    browserApi.post(`/claims/${manageToken}/link`, {}, ClaimLinkResponseSchema).then(
      (answer) => setPhase(answer.link === 'yours' ? 'added' : 'someone-else'),
      // The claim is untouched either way; a page with nothing extra is the safe answer.
      () => undefined,
    );
  }, [link, manageToken]);

  async function notMine() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.delete(`/claims/${manageToken}/link`, NoContentSchema);
      setPhase('taken-off');
      // The button that was pressed is gone: focus stays with the notice that replaced it.
      requestAnimationFrame(() => region.current?.focus());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={region} role="status" tabIndex={-1} className="focus:outline-none">
      {phase === 'someone-else' ? (
        <Notice tone="info" announce={false} className="mb-5">
          {ON_SOMEONE_ELSES_GIFTS}
        </Notice>
      ) : null}
      {phase === 'added' || phase === 'yours' ? (
        <Notice tone={phase === 'added' ? 'success' : 'info'} announce={false} className="mb-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {phase === 'added' ? (
              <span>
                Added to{' '}
                <Link href="/gifts" className="underline">
                  Your gifts
                </Link>
                .
              </span>
            ) : (
              <WithGiftsLink sentence={ON_YOUR_GIFTS} />
            )}
            <Button
              variant="secondary"
              size="compact"
              disabled={busy}
              onClick={() => void notMine()}
            >
              Not mine
            </Button>
          </div>
          {error ? <p className="mt-2 text-destructive">{error}</p> : null}
        </Notice>
      ) : null}
      {phase === 'taken-off' ? (
        <Notice tone="info" announce={false} className="mb-5">
          {TAKEN_OFF_GIFTS}
        </Notice>
      ) : null}
    </div>
  );
}

/** A sentence with its `Your gifts` made a link to `/gifts`. */
function WithGiftsLink({ sentence }: { sentence: string }) {
  const [before, after] = sentence.split('Your gifts');
  return (
    <span>
      {before}
      <Link href="/gifts" className="underline">
        Your gifts
      </Link>
      {after}
    </span>
  );
}
