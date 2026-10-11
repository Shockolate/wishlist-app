'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, MeResponseSchema, UpdateMeRequestSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, hasCode } from '@/lib/messages';

export const LOGIN_AGAIN = '/login?next=%2Fsettings';

export function NameForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(UpdateMeRequestSchema, { error: formErrorMap }),
    defaultValues: { displayName },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    try {
      await browserApi.patch('/me', values, MeResponseSchema);
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        // Full navigation, so Back can't restore signed-in pages from the router's cache.
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      const message = fieldErrors(error).displayName;
      if (message) setError('displayName', { message }, { shouldFocus: true });
      else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="name-heading">
      <h2 id="name-heading" className="font-display text-3xl">
        Your name
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Shown on your list and to the people who open your link.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="displayName" label="Display name" error={errors.displayName?.message}>
            {(control) => (
              <Input {...control} {...register('displayName')} autoComplete="nickname" />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Save name
        </Button>
      </form>
      {/* Always mounted, so the notice inserted into it is announced; focus stays on the form. */}
      <div aria-live="polite">
        {saved ? (
          <Notice tone="success" className="mt-4">
            Name saved
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
