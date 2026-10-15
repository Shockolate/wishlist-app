'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClaimConflictProblemSchema,
  ClaimerNameSchema,
  ClaimSchema,
  ErrorCode,
  type ClaimDetailsResponse,
} from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { QuantityStepper } from '@/components/list/quantity-stepper';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ApiError } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { dropRecord, updateRecords } from '@/lib/claim-records';
import { formErrorMap } from '@/lib/form-errors';
import { claimChangeConflictMessage, errorMessage, fieldErrors, hasCode } from '@/lib/messages';
import { manageHint } from '@/lib/share-copy';

const NameSchema = z.object({ claimerName: ClaimerNameSchema });

/** A new name, a new quantity, or both (spec §2, §5): up to what's left plus what it holds. */
export function ChangeClaimForm({
  details,
  manageToken,
  onGone,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
  onGone: () => void;
}) {
  const router = useRouter();
  // What the server holds now, so only what changed is sent.
  const [saved, setSaved] = useState(details.claim);
  const [quantity, setQuantity] = useState(details.claim.quantity);
  const [conflict, setConflict] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({
    resolver: zodResolver(NameSchema, { error: formErrorMap }),
    defaultValues: { claimerName: details.claim.claimerName },
  });
  const max = Math.max(1, details.remaining + details.claim.quantity);
  const changed = isDirty || quantity !== saved.quantity;

  const onSubmit = handleSubmit(async ({ claimerName }) => {
    setSavedNotice(null);
    setConflict(null);
    setFormError(null);
    const body = {
      ...(claimerName !== saved.claimerName ? { claimerName } : {}),
      ...(quantity !== saved.quantity ? { quantity } : {}),
    };
    if (Object.keys(body).length === 0) return;
    try {
      const claim = await browserApi.patch(`/claims/${manageToken}`, body, ClaimSchema);
      setSaved(claim);
      reset({ claimerName: claim.claimerName });
      setQuantity(claim.quantity);
      setSavedNotice((last) => (last ?? 0) + 1);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.NOT_FOUND)) {
        updateRecords((all) => dropRecord(all, manageToken));
        onGone();
        return;
      }
      if (hasCode(error, ErrorCode.CLAIM_EXCEEDS_REMAINING)) {
        // The 409 carries what's left beyond every claim (Plan 4a rule 7).
        const left =
          error instanceof ApiError
            ? (ClaimConflictProblemSchema.safeParse(error.problem).data?.remaining ?? 0)
            : 0;
        const most = left + saved.quantity;
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
    }
  });

  return (
    <Card aria-labelledby="change-heading" className="mt-5">
      <h2 id="change-heading" className="font-display text-3xl">
        Change your claim
      </h2>
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-5">
        {conflict ? <Notice tone="error">{conflict}</Notice> : null}
        <Field
          id="claimerName"
          label="Your name"
          hint="Other gifters see it, so nobody doubles up."
          error={errors.claimerName?.message}
        >
          {(control) => <Input {...control} {...register('claimerName')} autoComplete="name" />}
        </Field>
        <QuantityStepper
          id="claim-quantity"
          value={quantity}
          onChange={setQuantity}
          max={max}
          hint={manageHint(details.remaining, details.claim.quantity)}
        />
        <Button type="submit" disabled={isSubmitting || !changed} className="w-full">
          Save changes
        </Button>
      </form>
      <div role="status">
        {savedNotice !== null && !changed ? (
          <Notice key={savedNotice} tone="success" announce={false} className="mt-4">
            Saved.
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
