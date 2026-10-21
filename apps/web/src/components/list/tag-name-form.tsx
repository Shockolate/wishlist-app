'use client';

import { ErrorCode, TagNameSchema } from '@wishlist/contracts';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formErrorMap } from '@/lib/form-errors';
import { errorMessage, fieldErrors, hasCode } from '@/lib/messages';

/** What a failed create or rename says on the name field; undefined when it isn't about the name. */
export function tagNameError(error: unknown): string | undefined {
  if (hasCode(error, ErrorCode.TAG_NAME_TAKEN) || hasCode(error, ErrorCode.TAG_LIMIT_REACHED)) {
    return errorMessage(error);
  }
  return fieldErrors(error).name;
}

/**
 * The failure handler for a create or a rename: a problem with the name is shown on the field (by
 * the form), so only the rest reaches the status line. Otherwise the same words would show twice.
 */
export function failUnlessName(fail: (error: unknown) => void): (error: unknown) => void {
  return (error) => {
    if (tagNameError(error) === undefined) fail(error);
  };
}

/**
 * The Tags sheet's inline name field, for a new tag and for a rename (Ted's mockup 2c). `save` gets
 * the cleaned name and answers with the message to show on the field, or undefined; the parent
 * closes the form once it's done. Escape cancels the field: the sheet leaves that key alone inside
 * `[data-inline-edit]`.
 */
export function TagNameForm({
  id,
  initial = '',
  submitLabel,
  pendingLabel,
  save,
  onCancel,
}: {
  id: string;
  initial?: string;
  submitLabel: string;
  pendingLabel: string;
  save: (name: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // One request per press: a second Enter can arrive before the re-render shows it's pending.
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const refuse = (message: string) => {
    setError(message);
    input.current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = TagNameSchema.safeParse(text, { error: formErrorMap });
    if (!parsed.success) {
      // A failed parse always has an issue; the fallback only satisfies the index's type.
      refuse(parsed.error.issues[0]?.message ?? 'Fill this in.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const refused = await save(parsed.data);
      if (refused !== undefined) refuse(refused);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    // While an input method composes, Escape drops its candidates, not the field.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onCancel();
  };

  return (
    <form
      data-inline-edit
      onSubmit={(event) => void submit(event)}
      onKeyDown={onKeyDown}
      noValidate
      className="mt-3 flex flex-col gap-3"
    >
      <Field id={id} label="Tag name" error={error}>
        {(control) => (
          <Input
            {...control}
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {/*
          Not disabled while it waits: a disabled button drops focus, and the editor's status line
          would then take it for an error, outside the sheet. inFlight stops a second request.
        */}
        <Button type="submit" aria-disabled={pending || undefined}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
