'use client';

import {
  ErrorCode,
  ItemTitleSchema,
  retailerOf,
  UnfurlResponseSchema,
  type Item,
  type Retailer,
} from '@wishlist/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { classifyAddInput, prefill, type AddInput, type ItemFormValues } from '@/lib/add-input';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import {
  ADD_BOX_EMPTY,
  AMAZON_WAIT,
  hasCode,
  IDEA_FORM,
  LINK_TOO_LONG,
  LOOKUP_SKIPPED,
  OTHER_SCHEME_LINK,
  prefillMessage,
} from '@/lib/messages';
import { AddForm } from './add-form';
import { LookupWait } from './lookup-wait';
import { useListStatus } from './list-status';

type Step =
  | { step: 'box' }
  | {
      step: 'reading';
      link: Extract<AddInput, { kind: 'link' }>;
      retailer: Retailer | null;
      abort: AbortController;
    }
  | { step: 'form'; values: ItemFormValues; message: string };

/**
 * The link-first add box (spec §7 Owner editor, Plan 3b rules 5 and 6). A link is read, then opens
 * the add form prefilled; an idea opens the same form at once, titled with the text, so tags and
 * a note can be added before it is saved (Plan 9 design §5.8). Nothing is saved from the box.
 */
export function AddItem() {
  const [text, setText] = useState('');
  // The id changes with every refusal, so the alert is re-announced even for the same message.
  const [boxError, setBoxError] = useState<{ message: string; id: number } | null>(null);
  const refusals = useRef(0);
  const [step, setStep] = useState<Step>({ step: 'box' });
  // Bumped to move focus to the box once it has rendered again.
  const [focusBox, setFocusBox] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const { announce, fail } = useListStatus();

  useEffect(() => {
    if (focusBox > 0) box.current?.focus();
  }, [focusBox]);

  function refuse(message: string) {
    refusals.current += 1;
    setBoxError({ message, id: refusals.current });
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
      setStep({
        step: 'form',
        values: { ...prefill('', null, null), title: title.data, url: '' },
        message: IDEA_FORM,
      });
      return;
    }
    if (input.url.length > 2048) return refuse(LINK_TOO_LONG);
    const abort = new AbortController();
    setStep({ step: 'reading', link: input, retailer: retailerOf(input.url), abort });
    try {
      const response = await browserApi.post(
        '/wishlist/unfurl',
        { url: input.url },
        UnfurlResponseSchema,
        { signal: abort.signal },
      );
      // Skipped: the form is already open, and may already hold what the owner typed.
      if (abort.signal.aborted) return;
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, response),
        message: prefillMessage({ response }, input.url),
      });
    } catch (error) {
      if (abort.signal.aborted) return;
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) return fail(error);
      setStep({
        step: 'form',
        values: prefill(input.url, input.titleHint, null),
        message: prefillMessage({ error }, input.url),
      });
    }
  }

  /** Skip (retailer lookups §5.5): stop waiting, and open the form with just the link. */
  function skip() {
    if (step.step !== 'reading') return;
    step.abort.abort();
    setStep({
      step: 'form',
      values: prefill(step.link.url, step.link.titleHint, null),
      message: LOOKUP_SKIPPED,
    });
  }

  const reading = step.step === 'reading';
  const amazon = step.step === 'reading' && step.retailer === 'amazon';
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
        {reading ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {amazon ? AMAZON_WAIT : 'Reading the page…'}
          </p>
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
            <Button type="submit" disabled={reading}>
              {reading ? 'Reading the page…' : 'Add'}
            </Button>
          </div>
          {boxError ? (
            <p
              key={boxError.id}
              id="add-box-error"
              role="alert"
              className="mt-1.5 text-sm font-medium text-destructive"
            >
              {boxError.message}
            </p>
          ) : null}
          {amazon ? <LookupWait onSkip={skip} /> : null}
        </form>
      )}
    </section>
  );
}
