'use client';

import type { CreateItemRequestSchema } from '@wishlist/contracts';
import type { Ref } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldErrors } from '@/lib/messages';
import { QuantityStepper } from './quantity-stepper';
import { SuggestedTags } from './suggested-tags';
import { TagField, type TagBox } from './tag-field';
import type { TagSuggestions } from './use-tag-suggestions';

/** The add and edit forms share one schema (Plan 3b rule 7). */
export type ItemForm = UseFormReturn<
  z.input<typeof CreateItemRequestSchema>,
  unknown,
  z.output<typeof CreateItemRequestSchema>
>;

const ITEM_FIELDS = ['title', 'url', 'imageUrl', 'priceText', 'note', 'quantity'] as const;
type ItemField = (typeof ITEM_FIELDS)[number];
const isItemField = (name: string): name is ItemField =>
  (ITEM_FIELDS as readonly string[]).includes(name);

/** Puts a 400's per-field messages on the form, focusing the first; false when there were none. */
export function showFieldErrors(form: ItemForm, error: unknown): boolean {
  const errors = Object.entries(fieldErrors(error)).filter(([name]) => isItemField(name));
  errors.forEach(([name, message], index) => {
    form.setError(name as ItemField, { message }, { shouldFocus: index === 0 });
  });
  return errors.length > 0;
}

/** Title, link, price, how many, photo link, note and tags. No maxLength: the schema explains limits. */
export function ItemFields({
  form,
  idPrefix,
  tagBox,
  suggestions,
}: {
  form: ItemForm;
  idPrefix: string;
  /** The tag field's handle, for adding what's typed in it before a save. */
  tagBox?: Ref<TagBox>;
  /** Suggested tags for the "Suggested:" row, and the title field's blur that asks again. */
  suggestions?: TagSuggestions;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const id = (name: ItemField) => `${idPrefix}-${name}`;
  return (
    <div className="flex flex-col gap-3.5">
      <Field id={id('title')} label="Title" error={errors.title?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('title', { onBlur: () => suggestions?.onTitleBlur() })}
            autoComplete="off"
          />
        )}
      </Field>
      <Field id={id('url')} label="Link" error={errors.url?.message}>
        {(props) => (
          <Input {...props} {...register('url')} type="url" inputMode="url" autoComplete="off" />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_140px]">
          <Field id={id('priceText')} label="Price" error={errors.priceText?.message}>
            {(props) => <Input {...props} {...register('priceText')} autoComplete="off" />}
          </Field>
        </div>
        <Controller
          control={control}
          name="quantity"
          render={({ field }) => (
            <QuantityStepper
              id={id('quantity')}
              value={field.value ?? 1}
              onChange={field.onChange}
            />
          )}
        />
      </div>
      <Field id={id('imageUrl')} label="Photo link" error={errors.imageUrl?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('imageUrl')}
            type="url"
            inputMode="url"
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={id('note')}
        label="Note"
        hint="Gifters see this with the item."
        error={errors.note?.message}
      >
        {(props) => <Textarea {...props} {...register('note')} rows={3} />}
      </Field>
      <div className="flex flex-col gap-2">
        <TagField form={form} id={`${idPrefix}-tags`} handle={tagBox} />
        {suggestions ? (
          <SuggestedTags
            form={form}
            suggestions={suggestions.suggestions}
            tagInputId={`${idPrefix}-tags`}
          />
        ) : null}
      </div>
    </div>
  );
}
