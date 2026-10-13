'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ErrorCode,
  UpdateWishlistRequestSchema,
  WishlistSettingsResponseSchema,
} from '@wishlist/contracts';
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
import { LOGIN_AGAIN } from './name-form';

/** The list's title, which heads the list and the page gifters open (spec §2). */
export function ListNameForm({ title }: { title: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({
    resolver: zodResolver(UpdateWishlistRequestSchema, { error: formErrorMap }),
    defaultValues: { title },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    try {
      const settings = await browserApi.patch('/wishlist', values, WishlistSettingsResponseSchema);
      // Show what the server stored, and make the form clean again.
      reset({ title: settings.title });
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      const message = fieldErrors(error).title;
      if (message) setError('title', { message }, { shouldFocus: true });
      else setFormError(errorMessage(error));
    }
  });

  return (
    <Card aria-labelledby="list-name-heading">
      <h2 id="list-name-heading" className="font-display text-3xl">
        Your list
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        Its name is the heading people see when they open your link.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_240px]">
          <Field id="listTitle" label="List name" error={errors.title?.message}>
            {(props) => <Input {...props} {...register('title')} autoComplete="off" />}
          </Field>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Save list name
        </Button>
      </form>
      <div role="status">
        {saved && !isDirty ? (
          <Notice tone="success" announce={false} className="mt-4">
            List name saved
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
