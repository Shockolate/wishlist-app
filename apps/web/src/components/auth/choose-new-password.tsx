'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, PasswordResetConfirmRequestSchema } from '@wishlist/contracts';
import Link from 'next/link';
import { useEffect, useState, type Ref } from 'react';
import { useForm } from 'react-hook-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, hasCode, LINK_EXPIRED } from '@/lib/messages';
import { stripTokenFromUrl } from '@/lib/strip-token';
import { useFocusOnMount } from '@/lib/use-focus-on-mount';
import { cn } from '@/lib/utils';

const NewPasswordSchema = PasswordResetConfirmRequestSchema.pick({ newPassword: true });

/**
 * 'invalid' is what a missing or malformed token shows on arrival; 'spent' is the token turning
 * out to be used up after a submit, so only that one moves focus.
 */
type State = 'form' | 'done' | 'spent' | 'invalid';

export function ChooseNewPassword({ token }: { token: string | null }) {
  const [state, setState] = useState<State>(token ? 'form' : 'invalid');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(NewPasswordSchema, { error: formErrorMap }),
    defaultValues: { newPassword: '' },
  });

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await browserApi.post('/auth/password-reset/confirm', { token, ...values }, NoContentSchema);
      setState('done');
    } catch (error) {
      if (hasCode(error, ErrorCode.INVALID_TOKEN)) setState('spent');
      else if (hasCode(error, ErrorCode.PASSWORD_BREACHED)) {
        setError('newPassword', { message: errorMessage(error) }, { shouldFocus: true });
      } else setFormError(errorMessage(error));
    }
  });

  if (state === 'done') return <Done />;
  if (state === 'spent') return <Spent />;
  if (state === 'invalid') return <ExpiredLink />;

  return (
    <Card>
      <h1 className="font-display text-5xl leading-none">Choose a new password</h1>
      <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-5">
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
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Save the new password
        </Button>
      </form>
    </Card>
  );
}

function Done() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <Card>
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-5xl leading-none focus:outline-none"
      >
        Your password is changed.
      </h1>
      <p className="mt-4 leading-relaxed">You’re signed out everywhere. Log in with the new one.</p>
      <Link href="/login" className={cn(buttonVariants(), 'mt-7')}>
        Go to login
      </Link>
    </Card>
  );
}

/** The token failed after a submit: say so, and take focus to the new heading. */
function Spent() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return <ExpiredLink headingRef={heading} />;
}

function ExpiredLink({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <Card>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display text-5xl leading-none focus:outline-none"
      >
        {LINK_EXPIRED}
      </h1>
      <p className="mt-4 leading-relaxed text-muted-foreground">
        Reset links work once, within an hour.
      </p>
      <Link href="/reset-password" className={cn(buttonVariants(), 'mt-7')}>
        Send a new link
      </Link>
    </Card>
  );
}
