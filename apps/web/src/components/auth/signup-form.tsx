'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, SignupRequestSchema } from '@wishlist/contracts';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, FINISH_CHECK, hasCode } from '@/lib/messages';
import { useFocusOnMount } from '@/lib/use-focus-on-mount';

const FormSchema = SignupRequestSchema.omit({ turnstileToken: true });
const FIELDS = ['displayName', 'email', 'password'] as const;

export function SignupForm({ nonce }: { nonce: string | undefined }) {
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inFlight = useRef(false);
  // A token means the check is done, so a reminder to finish it is out of date (D38).
  const onToken = (next: string | null) => {
    setToken(next);
    if (next) setFormError((current) => (current === FINISH_CHECK ? null : current));
  };
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(FormSchema, { error: formErrorMap }),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    if (!token) {
      setFormError(FINISH_CHECK);
      return;
    }
    setFormError(null);
    try {
      await browserApi.post('/auth/signup', { ...values, turnstileToken: token }, NoContentSchema);
      setSentTo(values.email);
    } catch (error) {
      const fields = fieldErrors(error);
      const breached = hasCode(error, ErrorCode.PASSWORD_BREACHED);
      if (breached) fields.password = errorMessage(error);
      // Focus the first field with an error, so a screen reader reads its label and the message.
      let focused = false;
      for (const name of FIELDS) {
        const message = fields[name];
        if (!message) continue;
        setError(name, { message }, { shouldFocus: !focused });
        focused = true;
      }
      if (!breached && Object.keys(fields).length === 0) setFormError(errorMessage(error));
    } finally {
      // A Turnstile token works once: get a fresh one for the next attempt.
      setToken(null);
      setChallenge((n) => n + 1);
    }
  });

  // One request per press (Plan 2b Review Focus 5), in two layers: the disabled button stops a
  // second press; this guard stops a second submit that arrives before the re-render disables it.
  // It sits here, not in the handleSubmit callback, where the React Compiler lint objects to a ref
  // read.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (inFlight.current) {
      event.preventDefault();
      return;
    }
    inFlight.current = true;
    void submit(event).finally(() => {
      inFlight.current = false;
    });
  };

  if (sentTo) return <CheckYourEmail email={sentTo} />;

  return (
    <Card className="mt-8">
      <h2 className="font-display text-3xl">Create your account</h2>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <Field
          id="displayName"
          label="Your name"
          hint="Shown on your list, like “Ada’s wishlist”."
          error={errors.displayName?.message}
        >
          {(control) => <Input {...control} {...register('displayName')} autoComplete="nickname" />}
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} {...register('email')} type="email" autoComplete="email" />
          )}
        </Field>
        <Field
          id="password"
          label="Password"
          hint="10 characters or more. A short phrase is easiest to remember."
          error={errors.password?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Turnstile nonce={nonce} onToken={onToken} resetKey={challenge} />
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-[15px]">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

/** The same answer for a new address and an existing one (spec §8): the email says which. */
function CheckYourEmail({ email }: { email: string }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <Card className="mt-8">
      <h2 ref={heading} tabIndex={-1} className="font-display text-3xl focus:outline-none">
        Check your email
      </h2>
      <p className="mt-3 leading-relaxed">
        We sent a link to <strong>{email}</strong>. Open it within 24 hours to confirm your address.
      </p>
      <p className="mt-3 text-[15px] text-muted-foreground">
        Nothing there? Check your spam folder, or{' '}
        <Link href="/verify-email" className="text-foreground underline">
          send a new link
        </Link>
        .
      </p>
    </Card>
  );
}
