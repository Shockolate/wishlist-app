'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui/notice';
import { TURNSTILE_BLOCKED, TURNSTILE_FAILED } from '@/lib/messages';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'light';
      size: 'normal' | 'compact';
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Cloudflare Turnstile, rendered explicitly (spec §6.5, §6.9). `onToken` gets a fresh token, or
 * null when one expires or fails. A token works once, so change `resetKey` after any submit that
 * used one, and the widget renders again for a new token. A script that won't load, or a widget
 * that fails, says so under the widget (D38).
 */
export function Turnstile({
  nonce,
  onToken,
  resetKey,
}: {
  nonce: string | undefined;
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onToken);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<'blocked' | 'error' | null>(null);

  useEffect(() => {
    latest.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const api = window.turnstile;
    const element = container.current;
    if (!ready || !api || !element) return;
    latest.current(null);
    const widget = api.render(element, {
      sitekey: process.env.TURNSTILE_SITE_KEY ?? '',
      theme: 'light',
      // The normal widget is 300px wide; narrow phones get the compact one.
      size: element.clientWidth < 300 ? 'compact' : 'normal',
      callback: (token) => {
        setFailure(null);
        latest.current(token);
      },
      'expired-callback': () => latest.current(null),
      'error-callback': () => {
        latest.current(null);
        setFailure('error');
      },
    });
    return () => api.remove(widget);
  }, [ready, resetKey]);

  return (
    <>
      <Script
        src={SCRIPT}
        strategy="afterInteractive"
        nonce={nonce}
        onReady={() => setReady(true)}
        onError={() => setFailure('blocked')}
      />
      {/* data-turnstile: E2E excludes Cloudflare's iframe from axe; we can't fix its markup. */}
      <div ref={container} data-turnstile="" className="min-h-[65px] w-full" />
      {failure ? (
        <Notice tone="error">{failure === 'blocked' ? TURNSTILE_BLOCKED : TURNSTILE_FAILED}</Notice>
      ) : null}
    </>
  );
}
