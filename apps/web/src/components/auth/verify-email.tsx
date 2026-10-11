'use client';

import { ErrorCode } from '@wishlist/contracts';
import Link from 'next/link';
import { useEffect, useState, type Ref } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode, LINK_EXPIRED } from '@/lib/messages';
import { stripTokenFromUrl } from '@/lib/strip-token';
import { useFocusOnMount } from '@/lib/use-focus-on-mount';
import { cn } from '@/lib/utils';
import { EmailLinkForm } from './email-link-form';

const EXPIRED_BODY = 'Confirmation links work once, within 24 hours. Send yourself a new one.';

type State = 'confirm' | 'confirmed' | 'spent' | 'invalid' | 'check';

/**
 * Confirms an address only when the person presses the button. Rendering the page never uses
 * the token, so a mail scanner or a second look can't spend it (Plan 2b rule 7, Review Focus 1).
 *
 * 'invalid' and 'check' are what the page shows on arrival; 'spent' is the link turning out to be
 * used up after a press, so only that one moves focus.
 */
export function VerifyEmail({
  token,
  hadToken,
  nonce,
}: {
  token: string | null;
  hadToken: boolean;
  nonce: string | undefined;
}) {
  const [state, setState] = useState<State>(token ? 'confirm' : hadToken ? 'invalid' : 'check');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await browserApi.post('/auth/verify-email', { token }, NoContentSchema);
      setState('confirmed');
    } catch (failure) {
      if (hasCode(failure, ErrorCode.INVALID_TOKEN)) setState('spent');
      else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'confirmed') return <Confirmed />;
  if (state === 'spent') return <SpentLink nonce={nonce} />;

  if (state === 'confirm') {
    return (
      <Card>
        <h1 className="font-display text-5xl leading-none">Confirm your email</h1>
        <p className="mt-4 leading-relaxed">Press the button to finish setting up your account.</p>
        {error ? (
          <Notice tone="error" className="mt-5">
            {error}
          </Notice>
        ) : null}
        <Button className="mt-7" onClick={confirm} disabled={busy}>
          Confirm my email
        </Button>
      </Card>
    );
  }

  return state === 'invalid' ? (
    <ResendCard heading={LINK_EXPIRED} body={EXPIRED_BODY} nonce={nonce} />
  ) : (
    <ResendCard
      heading="Check your email"
      body="We sent a confirmation link when you signed up. It works for 24 hours. Need a new one?"
      nonce={nonce}
    />
  );
}

function Confirmed() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <Card>
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-5xl leading-none focus:outline-none"
      >
        Your email is confirmed.
      </h1>
      <p className="mt-4 leading-relaxed">You’re all set.</p>
      <Link href="/list" className={cn(buttonVariants(), 'mt-7')}>
        Go to your list
      </Link>
    </Card>
  );
}

/** The link failed after a press: say so, and take focus to the new heading. */
function SpentLink({ nonce }: { nonce: string | undefined }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <ResendCard heading={LINK_EXPIRED} body={EXPIRED_BODY} nonce={nonce} headingRef={heading} />
  );
}

function ResendCard({
  heading,
  body,
  nonce,
  headingRef,
}: {
  heading: string;
  body: string;
  nonce: string | undefined;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <Card>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display text-5xl leading-none focus:outline-none"
      >
        {heading}
      </h1>
      <p className="mt-4 leading-relaxed text-muted-foreground">{body}</p>
      <EmailLinkForm
        endpoint="/auth/resend-verification"
        submitLabel="Send a new link"
        sentMessage="If that address has an account waiting to be confirmed, a new link is on its way."
        nonce={nonce}
      />
    </Card>
  );
}
