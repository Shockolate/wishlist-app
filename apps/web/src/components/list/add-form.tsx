'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreateItemRequestSchema, type Item } from '@wishlist/contracts';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import type { ItemFormValues } from '@/lib/add-input';
import { formErrorMap } from '@/lib/form-errors';
import { ItemFields, showFieldErrors } from './item-fields';
import { ItemPhoto } from './item-photo';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

/** A new item, checked before it's added. It opens prefilled, or empty but for the link (rule 6). */
export function AddForm({
  initial,
  onAdded,
  onCancel,
}: {
  initial: ItemFormValues;
  onAdded: (item: Item) => void;
  onCancel: () => void;
}) {
  const { fail } = useListStatus();
  const create = useMutation(useListMutations().create);
  const form = useForm({
    resolver: zodResolver(CreateItemRequestSchema, { error: formErrorMap }),
    defaultValues: initial,
  });
  const { setFocus, setValue } = form;
  const photo = useWatch({ control: form.control, name: 'imageUrl' });

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      onAdded(await create.mutateAsync(values));
    } catch (error) {
      if (!showFieldErrors(form, error)) fail(error);
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="New item"
      className="mt-3.5 flex flex-col gap-3.5"
    >
      {photo ? (
        <div className="flex items-center gap-3">
          <ItemPhoto item={{ url: initial.url, imageUrl: photo }} />
          <Button
            variant="link"
            size="compact"
            onClick={() => setValue('imageUrl', '', { shouldDirty: true })}
          >
            Remove photo
          </Button>
        </div>
      ) : null}
      <ItemFields form={form} idPrefix="add" />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add to list'}
        </Button>
      </div>
    </form>
  );
}
