'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PasswordResetRequestSchema } from '@wishlist/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage } from '@/lib/messages';

/** Resend-verification and reset-request take the same body: an email and a Turnstile token. */
const EmailOnlySchema = PasswordResetRequestSchema.omit({ turnstileToken: true });

/**
 * Asks the API to email a link. The answer never says whether the address has an account
 * (spec §8), so the confirmation is worded "if".
 */
export function EmailLinkForm({
  endpoint,
  submitLabel,
  sentMessage,
  nonce,
}: {
  endpoint: '/auth/resend-verification' | '/auth/password-reset/request';
  submitLabel: string;
  sentMessage: string;
  nonce: string | undefined;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(EmailOnlySchema, { error: formErrorMap }),
    defaultValues: { email: '' },
  });

  const submit = handleSubmit(async (values) => {
    if (!token) {
      setFormError('Finish the check above, then try again.');
      return;
    }
    setFormError(null);
    try {
      await browserApi.post(endpoint, { ...values, turnstileToken: token }, NoContentSchema);
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      // A Turnstile token works once: get a fresh one for the next attempt.
      setToken(null);
      setChallenge((n) => n + 1);
    }
  });

  // One request per press (Review Focus 5), in two layers: the disabled button stops a second
  // press; this guard stops a second submit that arrives before the re-render disables it. It sits
  // here, not in the handleSubmit callback, where the React Compiler lint objects to a ref read.
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

  if (sent) {
    return (
      <Notice tone="success" className="mt-6">
        {sentMessage}
      </Notice>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
      <Field id="email" label="Email" error={errors.email?.message}>
        {(control) => (
          <Input {...control} {...register('email')} type="email" autoComplete="email" />
        )}
      </Field>
      <Turnstile nonce={nonce} onToken={setToken} resetKey={challenge} />
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
