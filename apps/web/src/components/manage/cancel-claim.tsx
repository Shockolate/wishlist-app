'use client';

import { ErrorCode, type ClaimDetailsResponse } from '@wishlist/contracts';
import { useState } from 'react';
import { CloseIcon } from '@/components/list/icons';
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
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { dropRecord, updateRecords } from '@/lib/claim-records';
import { errorMessage, hasCode } from '@/lib/messages';

/** Cancel the claim, after a confirmation (spec §2). The link stops working, so it's forgotten. */
export function CancelClaim({
  details,
  manageToken,
  onCancelled,
  onGone,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
  onCancelled: () => void;
  onGone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setError(null);
    try {
      await browserApi.delete(`/claims/${manageToken}`, NoContentSchema);
    } catch (failure) {
      if (!hasCode(failure, ErrorCode.NOT_FOUND)) {
        setError(errorMessage(failure));
        return;
      }
      updateRecords((all) => dropRecord(all, manageToken));
      onGone();
      return;
    }
    updateRecords((all) => dropRecord(all, manageToken));
    onCancelled();
  }

  return (
    <div className="mt-8 border-t border-foreground/15 pt-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="link" className="text-destructive">
            <CloseIcon />
            Cancel my claim
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Cancel your claim?</AlertDialogTitle>
          <AlertDialogDescription>
            {details.item.title} goes back on the list for someone else.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my claim</AlertDialogCancel>
            <AlertDialogAction onClick={() => void cancel()}>Cancel claim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
