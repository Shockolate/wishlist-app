'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClaimerNameSchema,
  CreateClaimResponseSchema,
  ErrorCode,
  type CreateClaimResponse,
  type SharedItem,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CloseIcon, EyeOffIcon } from '@/components/list/icons';
import { QuantityStepper } from '@/components/list/quantity-stepper';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { remainingFromConflict } from '@/lib/claim-conflict';
import { pendingTokenFor, readClaimerName, writeClaimerName } from '@/lib/claim-records';
import { formErrorMap } from '@/lib/form-errors';
import { mintManageToken } from '@/lib/manage-token';
import {
  claimConflictMessage,
  errorMessage,
  fieldErrors,
  hasCode,
  ITEM_TAKEN_OFF,
  LAST_ONE_GONE,
} from '@/lib/messages';
import {
  claimButtonLabel,
  claimedLine,
  countLine,
  ownerSeesLine,
  stepperHint,
} from '@/lib/share-copy';
import { ClaimDone } from './claim-done';
import { useShareClaims } from './share-claims';

const NameSchema = z.object({ claimerName: ClaimerNameSchema });

/**
 * Whether an error answers "this token made no claim here": a replay of a committed token gets
 * 201 before the remaining check, a deleted item took its claims with it, a token in use belongs
 * to another item, and the owner is refused before anything is written.
 */
function provesNoClaim(error: unknown): boolean {
  return (
    hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING) ||
    hasCode(error, ErrorCode.NOT_FOUND) ||
    hasCode(error, ErrorCode.MANAGE_TOKEN_IN_USE) ||
    hasCode(error, ErrorCode.OWNER_CANNOT_CLAIM)
  );
}

/** A failure that may have hidden a made claim and isn't about a field: offer "Try again". */
function mayHideClaim(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return (
    error.status >= 500 || error.status === 429 || hasCode(error, ErrorCode.UNEXPECTED_RESPONSE)
  );
}

type Phase =
  | { kind: 'form' }
  | { kind: 'done'; claim: CreateClaimResponse }
  | { kind: 'ended'; message: string };

/** The claim sheet (spec §7 Claim flow, the Plan 4b mockups). Mounted fresh for each item. */
export function ClaimSheet({
  item,
  shareToken,
  ownerName,
  ownerSeesClaims,
  onClose,
  returnFocus,
}: {
  item: SharedItem;
  shareToken: string;
  ownerName: string;
  ownerSeesClaims: boolean;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const router = useRouter();
  const { records, remember, forget, pendingTokens } = useShareClaims();
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [max, setMax] = useState(Math.max(1, item.remaining ?? item.quantity));
  const [quantity, setQuantity] = useState(1);
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const token = useRef<string | null>(null);
  const inFlight = useRef(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(NameSchema, { error: formErrorMap }),
    defaultValues: { claimerName: readClaimerName() },
  });
  const { ref: nameRef, ...nameField } = register('claimerName');

  // The form's button is gone once the sheet says what happened: the title takes focus.
  useEffect(() => {
    if (phase.kind !== 'form') title.current?.focus();
  }, [phase.kind]);

  async function send({ claimerName }: { claimerName: string }) {
    // Reuse a claim whose answer never came, so a retry finds it rather than making another (D42).
    token.current ??=
      pendingTokenFor(records, item.id) ?? pendingTokens.get(item.id) ?? mintManageToken();
    const manageToken = token.current;
    pendingTokens.set(item.id, manageToken);
    writeClaimerName(claimerName);
    remember({ itemId: item.id, manageToken });
    setFormError(null);
    try {
      const claim = await browserApi.post(
        `/shared/${shareToken}/items/${item.id}/claims`,
        { claimerName, quantity, manageToken },
        CreateClaimResponseSchema,
      );
      remember({ itemId: item.id, manageToken, claimId: claim.claim.id });
      pendingTokens.delete(item.id);
      setPhase({ kind: 'done', claim });
      router.refresh();
    } catch (error) {
      // Only an answer that proves this token made no claim on this item lets it go: any other
      // failure may hide a claim that was made and whose answer was lost, such as a 429 on the
      // retry. Those keep the token, so the next press replays it and finds the claim, or a later
      // visit's lookup does (D42, Plan 4b rule 5 as amended).
      if (provesNoClaim(error)) {
        forget(manageToken);
        pendingTokens.delete(item.id);
        token.current = null;
      }
      failed(error);
    }
  }

  function failed(error: unknown) {
    setRetry(false);
    if (hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING)) {
      const left = remainingFromConflict(error);
      router.refresh();
      if (left === 0) {
        setPhase({ kind: 'ended', message: LAST_ONE_GONE });
        return;
      }
      setMax(left);
      setQuantity(left);
      setConflict(claimConflictMessage(left));
      return;
    }
    if (hasCode(error, ErrorCode.SHARE_LINK_NOT_FOUND)) {
      // The page itself is gone: the refresh lands on the dead-link page.
      onClose();
      router.refresh();
      return;
    }
    if (hasCode(error, ErrorCode.NOT_FOUND)) {
      router.refresh();
      setPhase({ kind: 'ended', message: ITEM_TAKEN_OFF });
      return;
    }
    const nameError = fieldErrors(error).claimerName;
    if (nameError) {
      setError('claimerName', { message: nameError }, { shouldFocus: true });
      return;
    }
    setRetry(mayHideClaim(error));
    setFormError(errorMessage(error));
  }

  // One request per press (Plan 2b Review Focus 5): the disabled button stops a second press, and
  // this guard stops a second submit that arrives before the re-render disables it.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (inFlight.current) {
      event.preventDefault();
      return;
    }
    inFlight.current = true;
    void handleSubmit(send)(event).finally(() => {
      inFlight.current = false;
    });
  };

  const description =
    phase.kind === 'done'
      ? claimedLine(
          phase.claim.claim.quantity,
          item.quantity,
          ownerName,
          phase.claim.claim.claimerName,
        )
      : (countLine({
          wants: `${ownerName} wants`,
          quantity: item.quantity,
          ...(item.claims ? { claims: item.claims } : {}),
        }) ?? 'Claim it, so nobody else buys it too.');

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <div className="flex items-start gap-2">
          <SheetTitle ref={title} tabIndex={-1} className="mt-1.5 flex-1">
            {phase.kind === 'done' ? `You’re getting ${item.title}` : item.title}
          </SheetTitle>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
            >
              <CloseIcon />
            </button>
          </SheetClose>
        </div>
        <SheetDescription>{description}</SheetDescription>

        {phase.kind === 'done' ? (
          <ClaimDone claim={phase.claim} itemTitle={item.title} ownerName={ownerName} />
        ) : phase.kind === 'ended' ? (
          <>
            <Notice tone="error" className="mt-4">
              {phase.message}
            </Notice>
            <SheetClose asChild>
              <Button variant="secondary" className="mt-6 w-full">
                Back to the list
              </Button>
            </SheetClose>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-5">
            {conflict ? <Notice tone="error">{conflict}</Notice> : null}
            <Field
              id="claimerName"
              label="Your name"
              hint="Other gifters see it, so nobody doubles up."
              error={errors.claimerName?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  {...nameField}
                  ref={(element) => {
                    nameRef(element);
                    nameInput.current = element;
                  }}
                  autoComplete="name"
                />
              )}
            </Field>
            <QuantityStepper
              id="claim-quantity"
              value={quantity}
              onChange={setQuantity}
              max={max}
              hint={stepperHint(max)}
            />
            <p className="flex items-start gap-2 text-sm leading-snug text-muted-foreground">
              {ownerSeesClaims ? null : <EyeOffIcon />}
              {ownerSeesLine(ownerName, ownerSeesClaims)}
            </p>
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {retry ? 'Try again' : claimButtonLabel(max, conflict !== null)}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
