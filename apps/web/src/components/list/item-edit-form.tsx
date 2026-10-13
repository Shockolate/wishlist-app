'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreateItemRequestSchema, ErrorCode, type Item } from '@wishlist/contracts';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formValuesOf } from '@/lib/add-input';
import { formErrorMap } from '@/lib/form-errors';
import { hasCode } from '@/lib/messages';
import { TrashIcon } from './icons';
import { ItemFields, showFieldErrors } from './item-fields';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

/**
 * One item's form, opened in place (D37). Save sends all six fields, so a cleared field becomes
 * null (Plan 3b rule 7). Delete asks first.
 */
export function ItemEditForm({
  item,
  onDone,
  onDelete,
  onDeleteClosed,
  onDirtyChange,
}: {
  item: Item;
  onDone: () => void;
  onDelete: () => void;
  onDeleteClosed: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { announce, fail } = useListStatus();
  const update = useMutation(useListMutations().update);
  const form = useForm({
    resolver: zodResolver(CreateItemRequestSchema, { error: formErrorMap }),
    defaultValues: formValuesOf(item),
  });
  const { isDirty } = form.formState;
  const { setFocus } = form;
  // Set when Delete is confirmed, so closing the dialog moves focus on instead of back to Delete.
  const deleting = useRef(false);

  useEffect(() => {
    onDirtyChange(isDirty);
    // A form that goes away (closed, or its item removed by a refetch) leaves nothing unsaved.
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync({ id: item.id, body: values });
      announce(`Saved “${saved.title}”.`);
      onDone();
    } catch (error) {
      if (showFieldErrors(form, error)) return;
      fail(error);
      // Gone on another device: the refetch removes the row, so close it now.
      if (hasCode(error, ErrorCode.NOT_FOUND)) onDone();
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={`Edit ${item.title}`}
      className="flex flex-col gap-3.5 px-3.5 pt-1.5 pb-4"
    >
      <ItemFields form={form} idPrefix={`edit-${item.id}`} />
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="link" size="compact" className="text-destructive">
              <TrashIcon />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (!deleting.current) return;
              event.preventDefault();
              onDeleteClosed();
            }}
          >
            <AlertDialogTitle>Delete “{item.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off your list. This can’t be undone.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleting.current = true;
                  onDelete();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="flex-1" />
        <Button variant="secondary" onClick={onDone} disabled={update.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
