'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  CreateItemRequestSchema,
  ErrorCode,
  retailerOf,
  UnfurlResponseSchema,
  type Item,
} from '@wishlist/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { fillEmpty, pastedLink, type ItemFormValues } from '@/lib/add-input';
import { browserApi } from '@/lib/browser-api';
import { formErrorMap } from '@/lib/form-errors';
import { LinkReader, type ReadOutcome } from '@/lib/link-reader';
import {
  AMAZON_WAIT,
  hasCode,
  IDEA_FORM,
  LOOKUP_SKIPPED,
  pasteMessage,
  READING_PAGE,
} from '@/lib/messages';
import type { Unfurled } from '@/lib/tag-suggestions';
import { itemBody, liveTags } from '@/lib/tag-input';
import { ItemFields, showFieldErrors } from './item-fields';
import { ItemPhoto } from './item-photo';
import { useListStatus } from './list-status';
import { LookupWait } from './lookup-wait';
import { useListTags, type TagBox } from './tag-field';
import { useTagSuggestions } from './use-tag-suggestions';
import { useListMutations } from './use-list-mutations';

/**
 * A new item, checked before it's added. It opens prefilled, or empty but for the link (rule 6).
 * A link pasted into its Link field is read, and fills in the fields still empty (D117).
 */
export function AddForm({
  initial,
  description,
  onMessage,
  onAdded,
  onCancel,
}: {
  initial: ItemFormValues;
  /** The link's description from unfurl: sent for tag suggestions, never part of the item. */
  description?: string | undefined;
  /** Replaces the sentence above the form, which says what reading a pasted link did. */
  onMessage: (message: string) => void;
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
  const { getValues, setFocus, setValue } = form;
  // The link the description came from: the one the form opened with, then the latest pasted one read.
  const [unfurled, setUnfurled] = useState<Unfurled>({ url: initial.url, description });
  const suggestions = useTagSuggestions(form, unfurled);
  const photo = useWatch({ control: form.control, name: 'imageUrl' });
  // An Amazon link being read shows the wait and Skip under the Link field.
  const [amazonWait, setAmazonWait] = useState(false);
  const reader = useRef<LinkReader | undefined>(undefined);
  // Text a phone app shared with each pasted link, which titles the item if the page has no title.
  const titleHints = useRef(new Map<string, string | null>());
  // The latest callbacks, for the reader's answer, which arrives after any render.
  const latest = useRef({ fail, onMessage });
  useEffect(() => {
    latest.current = { fail, onMessage };
  });

  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  useEffect(() => {
    const next = new LinkReader(
      (url, signal) =>
        browserApi.post('/wishlist/unfurl', { url }, UnfurlResponseSchema, { signal }),
      (url, outcome: ReadOutcome) => {
        setAmazonWait(false);
        if ('error' in outcome && hasCode(outcome.error, ErrorCode.UNAUTHENTICATED)) {
          latest.current.fail(outcome.error);
          return;
        }
        const response = 'response' in outcome ? outcome.response : null;
        const { title, imageUrl, priceText } = getValues();
        const filled = fillEmpty(
          { title, imageUrl: imageUrl ?? '', priceText: priceText ?? '' },
          response,
          titleHints.current.get(url) ?? null,
        );
        for (const [name, value] of Object.entries(filled)) {
          setValue(name as keyof typeof filled, value, { shouldDirty: true });
        }
        if (response) setUnfurled({ url, description: response.description });
        latest.current.onMessage(pasteMessage(outcome, url, filled));
      },
    );
    reader.current = next;
    return () => {
      next.dispose();
      reader.current = undefined;
    };
  }, [getValues, setValue]);

  /** Stops a read, saying so only if one was running. */
  function stopReading(message: string): boolean {
    if (!reader.current?.cancel()) return false;
    setAmazonWait(false);
    onMessage(message);
    return true;
  }

  function onLinkInput(value: string, pasted: boolean) {
    const link = pasted ? pastedLink(value) : null;
    // Typing over the link, or pasting something that isn't one, means the read's answer is stale.
    if (!link) {
      stopReading(IDEA_FORM);
      return;
    }
    // Text a phone app shared with the link isn't part of it, and a bare shop address gets https://.
    if (link.url !== value) setValue('url', link.url, { shouldDirty: true });
    const amazon = retailerOf(link.url) === 'amazon';
    setAmazonWait(amazon);
    onMessage(amazon ? AMAZON_WAIT : READING_PAGE);
    titleHints.current.set(link.url, link.titleHint);
    reader.current?.read(link.url);
  }

  /** Skip (retailer lookups §5.5): stop waiting, and keep the form as it is. */
  function skip() {
    stopReading(LOOKUP_SKIPPED);
    // The Skip button is about to unmount; keep focus where it was.
    setFocus('url');
  }

  // Text left in the tag box is added first, as Enter would add it; a name it refuses holds the
  // save back, with the reason on the field. handleSubmit is called here, in the event, because
  // its callback reads the reader's ref, which a render must not.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (tagBox.current?.addTyped() === false) {
      event.preventDefault();
      return;
    }
    void form.handleSubmit(async (values) => {
      // Add saves the item as it stands: an answer arriving now would change a form already sent.
      stopReading(IDEA_FORM);
      try {
        // Tags go only when there are some (Plan 7b ruling 5), less any deleted meanwhile (Plan 7b ruling 6).
        const tags = liveTags(values.tags ?? [], listTags);
        onAdded(await create.mutateAsync(itemBody({ ...values, tags }, tags.length > 0)));
      } catch (error) {
        if (!showFieldErrors(form, error)) fail(error);
      }
    })(event);
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
      <ItemFields
        form={form}
        idPrefix="add"
        tagBox={tagBox}
        suggestions={suggestions}
        onLinkInput={onLinkInput}
        afterLink={amazonWait ? <LookupWait onSkip={skip} /> : null}
      />
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
