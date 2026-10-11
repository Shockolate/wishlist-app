'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordRequestSchema, ErrorCode } from '@wishlist/contracts';
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
import { errorMessage, hasCode, WRONG_PASSWORD } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

export function PasswordForm() {
  const [changed, setChanged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(ChangePasswordRequestSchema, { error: formErrorMap }),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setChanged(false);
    setFormError(null);
    try {
      await browserApi.post('/me/password', values, NoContentSchema);
      reset();
      setChanged(true);
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        // Full navigation, so Back can't restore signed-in pages from the router's cache.
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('currentPassword', { message: WRONG_PASSWORD }, { shouldFocus: true });
      } else if (hasCode(error, ErrorCode.PASSWORD_BREACHED)) {
        setError('newPassword', { message: errorMessage(error) }, { shouldFocus: true });
      } else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="password-heading">
      <h2 id="password-heading" className="font-display text-3xl">
        Password
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Changing it signs you out on every other device.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex max-w-[400px] flex-col gap-4">
        <Field
          id="currentPassword"
          label="Current password"
          error={errors.currentPassword?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('currentPassword')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>
        <Field
          id="newPassword"
          label="New password"
          hint="10 characters or more."
          error={errors.newPassword?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('newPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Button type="submit" className="self-start" disabled={isSubmitting}>
          Change password
        </Button>
      </form>
      {/* The status region is always mounted, so the notice inserted into it is announced once. */}
      <div role="status">
        {changed ? (
          <Notice tone="success" announce={false} className="mt-4">
            Password changed. Other devices are signed out.
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
