'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClaimerNameSchema,
  ErrorCode,
  GiftSchema,
  type Gift,
  type UpdateGiftRequest,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { QuantityStepper } from '@/components/list/quantity-stepper';
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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { remainingFromConflict } from '@/lib/claim-conflict';
import { formErrorMap } from '@/lib/form-errors';
import { focusGiftsHeading } from '@/lib/gifts-focus';
import { letGoText } from '@/lib/gifts-copy';
import { claimChangeConflictMessage, errorMessage, fieldErrors, hasCode } from '@/lib/messages';
import { manageHint } from '@/lib/share-copy';

const NameSchema = z.object({ claimerName: ClaimerNameSchema });

/**
 * Change a gift in place (design §5.7): a new name, a new quantity up to what is left plus what
 * the claim holds, or let the claim go after a confirmation. It mirrors `/c`'s form. Only what
 * changed is sent, and Save with nothing changed just closes.
 */
export function ChangeGiftForm({ gift, onClose }: { gift: Gift; onClose: () => void }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(gift.claim.quantity);
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [letting, setLetting] = useState(false);
  // Set once the claim is gone, so the dialog's close doesn't hand focus back to a button that is
  // about to leave with its card.
  const gone = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(NameSchema, { error: formErrorMap }),
    defaultValues: { claimerName: gift.claim.claimerName },
  });
  // Opening the card puts you in its first field.
  useEffect(() => setFocus('claimerName'), [setFocus]);
  const max = Math.max(1, gift.remaining + gift.claim.quantity);

  /** The claim went meanwhile (Plan 10b ruling 9): the refresh turns the card into a note. */
  function claimWentAway() {
    gone.current = true;
    focusGiftsHeading();
    router.refresh();
  }

  async function save({ claimerName }: z.infer<typeof NameSchema>) {
    setConflict(null);
    setFormError(null);
    const body: UpdateGiftRequest = {
      ...(claimerName !== gift.claim.claimerName ? { claimerName } : {}),
      ...(quantity !== gift.claim.quantity ? { quantity } : {}),
    };
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      await browserApi.patch(`/me/gifts/${gift.linkId}`, body, GiftSchema);
    } catch (error) {
      if (hasCode(error, ErrorCode.NOT_FOUND)) {
        claimWentAway();
        return;
      }
      if (hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING)) {
        const most = remainingFromConflict(error) + gift.claim.quantity;
        setQuantity(most);
        setConflict(claimChangeConflictMessage(most));
        router.refresh();
        return;
      }
      const nameError = fieldErrors(error).claimerName;
      if (nameError) {
        setError('claimerName', { message: nameError }, { shouldFocus: true });
        return;
      }
      setFormError(errorMessage(error));
      return;
    }
    router.refresh();
    onClose();
  }

  async function letGo() {
    setLetting(true);
    setFormError(null);
    try {
      await browserApi.delete(`/me/gifts/${gift.linkId}`, NoContentSchema);
    } catch (error) {
      // Already gone elsewhere: the refresh shows what is left of it.
      if (!hasCode(error, ErrorCode.NOT_FOUND)) {
        setFormError(errorMessage(error));
        setLetting(false);
        setConfirming(false);
        return;
      }
    }
    gone.current = true;
    setConfirming(false);
    router.refresh();
  }

  const idBase = gift.linkId;
  return (
    <form
      onSubmit={(event) => void handleSubmit(save)(event)}
      noValidate
      aria-label={`Change ${gift.item.title}`}
      className="mt-3 flex flex-col gap-4 border-t border-border pt-3.5"
    >
      {conflict ? <Notice tone="error">{conflict}</Notice> : null}
      <Field
        id={`${idBase}-name`}
        label="Your name, as other gifters see it"
        error={errors.claimerName?.message}
      >
        {(control) => <Input {...control} {...register('claimerName')} autoComplete="name" />}
      </Field>
      <QuantityStepper
        id={`${idBase}-quantity`}
        value={quantity}
        onChange={setQuantity}
        max={max}
        hint={manageHint(gift.remaining, gift.claim.quantity)}
      />
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog open={confirming} onOpenChange={(open) => !letting && setConfirming(open)}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="link" className="mr-auto text-destructive">
              Let it go
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (!gone.current) return;
              event.preventDefault();
              focusGiftsHeading();
            }}
          >
            <AlertDialogTitle>Let this go?</AlertDialogTitle>
            <AlertDialogDescription>{letGoText(gift.ownerDisplayName)}</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={letting}>Keep it</AlertDialogCancel>
              <AlertDialogAction
                disabled={letting}
                onClick={(event) => {
                  // Stay open until the answer is in, so focus can be placed once it closes.
                  event.preventDefault();
                  void letGo();
                }}
              >
                Let it go
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button type="button" variant="secondary" size="compact" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" size="compact" disabled={isSubmitting}>
          Save
        </Button>
      </div>
    </form>
  );
}
