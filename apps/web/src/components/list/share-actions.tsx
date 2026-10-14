'use client';

import { Button } from '@/components/ui/button';
import { useCanShare } from '@/lib/use-can-share';
import { CopyIcon, ShareIcon } from './icons';
import { useListStatus } from './list-status';

/** Copy share link, and Share where the Web Share API exists (Plan 3b rule 9). */
export function ShareActions({ title, shareUrl }: { title: string; shareUrl: string }) {
  const { announce } = useListStatus();
  const canShare = useCanShare();

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      announce('Link copied.');
    } catch {
      announce(`Copy this link: ${shareUrl}`, 'info');
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

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="compact" onClick={() => void copy()}>
        <CopyIcon />
        Copy share link
      </Button>
      {canShare ? (
        <Button variant="secondary" size="compact" onClick={() => void share()}>
          <ShareIcon />
          Share
        </Button>
      ) : null}
      <p className="basis-full text-[13px] text-muted-foreground">
        Anyone with the link can see your list.
      </p>
    </div>
  );
}
