'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DeleteMeRequestSchema, ErrorCode } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/** The password is the confirmation: no extra dialog. The API clears the cookie on success. */
export function DeleteAccountForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(DeleteMeRequestSchema, { error: formErrorMap }),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.delete('/me', NoContentSchema, values);
      router.replace('/');
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        router.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('password', { message: 'That password isn’t right.' });
      } else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="font-display text-3xl">
        Delete account
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Deletes your account, your list and every claim on it. This can’t be undone.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="deletePassword" label="Your password" error={errors.password?.message}>
            {(control) => (
              <Input
                {...control}
                {...register('password')}
                type="password"
                autoComplete="current-password"
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="strong" disabled={isSubmitting}>
          Delete account
        </Button>
      </form>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
