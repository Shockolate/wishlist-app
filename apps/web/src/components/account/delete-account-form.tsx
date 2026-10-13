'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DeleteMeRequestSchema, ErrorCode } from '@wishlist/contracts';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { focusIsLost } from '@/lib/focus-lost';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode, WRONG_PASSWORD } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/**
 * The password lives in a dialog that only an explicit click opens, so a browser that autofills
 * passwords can't make deleting the account one click (D38). The API clears the cookie on success.
 */
export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errorNotice = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(DeleteMeRequestSchema, { error: formErrorMap }),
    defaultValues: { password: '' },
  });

  // The submit button disables itself while the request runs, so a failure that isn't about the
  // password (which refocuses its field) would leave focus on the page behind the dialog.
  useEffect(() => {
    if (formError !== null && focusIsLost()) errorNotice.current?.focus();
  }, [formError]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.delete('/me', NoContentSchema, values);
      // Full navigations, here and below: a soft one leaves the deleted account's pages in the
      // router's cache for Back to restore (see AccountHeader).
      window.location.replace('/');
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      if (hasCode(error, ErrorCode.INVALID_CREDENTIALS)) {
        setError('password', { message: WRONG_PASSWORD }, { shouldFocus: true });
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
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          // Escape and the like can't close it mid-request: the delete is already on its way.
          if (!next && isSubmitting) return;
          setOpen(next);
          if (!next) {
            reset();
            setFormError(null);
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="strong" className="mt-5">
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            setFocus('password');
          }}
        >
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            Your account, your list and every claim on it go for good. Enter your password to
            confirm.
          </AlertDialogDescription>
          <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
            <Field id="deletePassword" label="Your password" error={errors.password?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </Field>
            {formError ? (
              <Notice ref={errorNotice} tabIndex={-1} tone="error">
                {formError}
              </Notice>
            ) : null}
            <AlertDialogFooter className="mt-1">
              <AlertDialogCancel disabled={isSubmitting}>Keep my account</AlertDialogCancel>
              {/* A plain submit, not AlertDialogAction, so a wrong password keeps the dialog open. */}
              <Button type="submit" variant="strong" disabled={isSubmitting}>
                Delete account
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
