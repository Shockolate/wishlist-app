'use client';

import { ErrorCode, RotateShareTokenResponseSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyIcon, ShareIcon } from '@/components/list/icons';
import { updateCachedList } from '@/components/query-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { useCanShare } from '@/lib/use-can-share';
import { LOGIN_AGAIN } from './name-form';

/**
 * The share link: copy it, share it where the Web Share API exists, or replace it after a
 * confirmation (spec §2, Plan 3b rule 13).
 */
export function ShareLinkCard({ title, shareUrl: initial }: { title: string; shareUrl: string }) {
  const router = useRouter();
  const canShare = useCanShare();
  const [shareUrl, setShareUrl] = useState(initial);
  const [message, setMessage] = useState<{
    text: string;
    tone: 'success' | 'info';
    id: number;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const say = (text: string, tone: 'success' | 'info' = 'success') =>
    setMessage((last) => ({ text, tone, id: (last?.id ?? 0) + 1 }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFormError(null);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${shareUrl}`, 'info');
    }
  }

  async function share() {
    try {
      await navigator.share({ title, url: shareUrl });
    } catch (error) {
      // Closing the share sheet rejects with AbortError: the person chose not to share.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copy();
    }
  }

  async function rotate() {
    if (rotating) return;
    setRotating(true);
    setFormError(null);
    try {
      const rotated = await browserApi.post(
        '/wishlist/share-token/rotate',
        {},
        RotateShareTokenResponseSchema,
      );
      setShareUrl(rotated.shareUrl);
      updateCachedList((list) => ({ ...list, shareUrl: rotated.shareUrl }));
      say('New link ready. The old one no longer works.');
      // The router keeps the pages it has rendered, and Back would restore them with the old link.
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      setFormError(errorMessage(error));
    } finally {
      setRotating(false);
    }
  }

  return (
    <Card aria-labelledby="share-heading">
      <h2 id="share-heading" className="font-display text-3xl">
        Share link
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Anyone with the link can see your list.
      </p>
      <p className="mt-4 rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[15px] [overflow-wrap:anywhere]">
        {shareUrl}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="compact" onClick={() => void copy()}>
          <CopyIcon />
          Copy link
        </Button>
        {canShare ? (
          <Button variant="secondary" size="compact" onClick={() => void share()}>
            <ShareIcon />
            Share
          </Button>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            {/* Not disabled while rotating: the dialog hands focus back to this button as it closes. */}
            <Button variant="secondary" size="compact">
              Get a new link
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Get a new share link?</AlertDialogTitle>
            <AlertDialogDescription>
              Your old link stops working right away. Anyone you sent it to will need the new one.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep this link</AlertDialogCancel>
              <AlertDialogAction onClick={() => void rotate()}>Get a new link</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div role="status">
        {rotating ? (
          <Notice tone="info" announce={false} className="mt-4">
            Getting your new link…
          </Notice>
        ) : message ? (
          <Notice key={message.id} tone={message.tone} announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
