'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreateItemRequestSchema, type Item } from '@wishlist/contracts';
import { useEffect, useRef, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import type { ItemFormValues } from '@/lib/add-input';
import { formErrorMap } from '@/lib/form-errors';
import { itemBody, liveTags } from '@/lib/tag-input';
import { ItemFields, showFieldErrors } from './item-fields';
import { ItemPhoto } from './item-photo';
import { useListStatus } from './list-status';
import { useListTags, type TagBox } from './tag-field';
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
  const listTags = useListTags();
  const tagBox = useRef<TagBox>(null);
  const form = useForm({
    resolver: zodResolver(CreateItemRequestSchema, { error: formErrorMap }),
    defaultValues: initial,
  });
  const { setFocus, setValue } = form;
  const photo = useWatch({ control: form.control, name: 'imageUrl' });

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const save = form.handleSubmit(async (values) => {
    try {
      // Tags go only when there are some (Plan 7b ruling 5), less any deleted meanwhile (ruling 6).
      const tags = liveTags(values.tags ?? [], listTags);
      onAdded(await create.mutateAsync(itemBody({ ...values, tags }, tags.length > 0)));
    } catch (error) {
      if (!showFieldErrors(form, error)) fail(error);
    }
  });

  // Text left in the tag box is added first, as Enter would add it; a name it refuses holds the
  // save back, with the reason on the field.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (tagBox.current?.addTyped() === false) {
      event.preventDefault();
      return;
    }
    void save(event);
  };

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
            onClick={() => {
              setValue('imageUrl', '', { shouldDirty: true });
              // This button is about to unmount; keep focus in the form.
              setFocus('imageUrl');
            }}
          >
            Remove photo
          </Button>
        </div>
      ) : null}
      <ItemFields form={form} idPrefix="add" tagBox={tagBox} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
        {/* isSubmitting covers the tick before TanStack reports isPending, so a fast double press adds once. */}
        <Button type="submit" disabled={create.isPending || form.formState.isSubmitting}>
          {create.isPending ? 'Adding…' : 'Add to list'}
        </Button>
      </div>
    </form>
  );
}
