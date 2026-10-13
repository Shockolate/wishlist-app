'use client';

import { useMutation } from '@tanstack/react-query';
import { ErrorCode, ItemTitleSchema, UnfurlResponseSchema, type Item } from '@wishlist/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { classifyAddInput, prefill, type ItemFormValues } from '@/lib/add-input';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import {
  ADD_BOX_EMPTY,
  fieldErrors,
  hasCode,
  LINK_TOO_LONG,
  OTHER_SCHEME_LINK,
  prefillMessage,
} from '@/lib/messages';
import { AddForm } from './add-form';
import { useListStatus } from './list-status';
import { useListMutations } from './use-list-mutations';

type Step =
  { step: 'box' } | { step: 'reading' } | { step: 'form'; values: ItemFormValues; message: string };

/** The link-first add box (spec §7 Owner editor, Plan 3b rules 5 and 6). */
export function AddItem() {
  const [text, setText] = useState('');
  const [boxError, setBoxError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ step: 'box' });
  // Bumped to move focus to the box once it has rendered again.
  const [focusBox, setFocusBox] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const { announce, fail } = useListStatus();
  const addIdea = useMutation(useListMutations().create);

  useEffect(() => {
    if (focusBox > 0) box.current?.focus();
  }, [focusBox]);

  function refuse(message: string) {
    setBoxError(message);
    setFocusBox((n) => n + 1);
  }

  function added(item: Item) {
    setText('');
    setStep({ step: 'box' });
    announce(`Added “${item.title}”.`);
    setFocusBox((n) => n + 1);
  }

  function cancel() {
    setStep({ step: 'box' });
    setFocusBox((n) => n + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBoxError(null);
    const input = classifyAddInput(text);
    if (input.kind === 'empty') return refuse(ADD_BOX_EMPTY);
    if (input.kind === 'other-scheme') return refuse(OTHER_SCHEME_LINK);
    if (input.kind === 'idea') {
      const title = ItemTitleSchema.safeParse(input.title, { error: formErrorMap });
      if (!title.success) return refuse(title.error.issues[0]?.message ?? ADD_BOX_EMPTY);
      try {
        added(await addIdea.mutateAsync({ title: title.data, quantity: 1 }));
      } catch (error) {
        const message = fieldErrors(error).title;
        if (message) refuse(message);
        else fail(error);
      }
      return;
    }
    if (input.url.length > 2048) return refuse(LINK_TOO_LONG);
    setStep({ step: 'reading' });
    try {
      const response = await browserApi.post(
        '/wishlist/unfurl',
        { url: input.url },
        UnfurlResponseSchema,
      );
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, response),
        message: prefillMessage({ response }, input.url),
      });
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) return fail(error);
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, null),
        message: prefillMessage({ error }, input.url),
      });
    }
  }

  const reading = step.step === 'reading';
  return (
    // Not a labelled region: the heading already labels the box, and one label should name one thing.
    <section className="mt-5 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id="add-heading" className="text-[15px] font-semibold">
        Add to your list
      </h2>
      {/* Always mounted, so the prefill's sentence is announced when the form opens. */}
      <div role="status">
        {step.step === 'form' ? (
          <p className="mt-1 text-sm text-muted-foreground">{step.message}</p>
        ) : null}
      </div>
      {step.step === 'form' ? (
        <AddForm initial={step.values} onAdded={added} onCancel={cancel} />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-2">
          <div className="flex gap-2">
            <Input
              ref={box}
              id="add-box"
              aria-labelledby="add-heading"
              aria-describedby={boxError ? 'add-box-error' : undefined}
              aria-invalid={boxError ? true : undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste a link or type an idea"
              readOnly={reading}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={reading || addIdea.isPending}>
              {reading ? 'Reading the page…' : 'Add'}
            </Button>
          </div>
          {boxError ? (
            <p id="add-box-error" className="mt-1.5 text-sm font-medium text-destructive">
              {boxError}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
