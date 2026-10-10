'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { DocumentLink } from '@/components/document-link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage } from '@/lib/messages';

/** `next` has already been through safeNext (rule 9). */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(LoginRequestSchema, { error: formErrorMap }),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await browserApi.post('/auth/login', values, NoContentSchema);
      router.replace(next);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <Card>
      <h1 className="font-display text-5xl leading-none">Log in</h1>
      <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-5">
        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} {...register('email')} type="email" autoComplete="email" />
          )}
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              {...register('password')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" disabled={isSubmitting}>
          Log in
        </Button>
      </form>
      <p className="mt-5 text-[15px]">
        <DocumentLink
          href="/reset-password"
          className="inline-flex min-h-11 items-center underline"
        >
          Forgot your password?
        </DocumentLink>
      </p>
    </Card>
  );
}
