import {
  DESCRIPTION_MAX,
  type ItemTagRef,
  type TagSuggestionsRequest,
  type TagSuggestionsResponse,
} from '@wishlist/contracts';

/** What the item form holds now, as far as a suggestion request reads it. */
export interface SuggestionFormValues {
  title: string;
  note?: string | null | undefined;
  url?: string | null | undefined;
  tags?: ItemTagRef[] | undefined;
}

/** The link's unfurled description, and the link it was unfurled from. */
export interface Unfurled {
  url?: string | null | undefined;
  description?: string | undefined;
}

/**
 * The request for what the form holds now: an empty note and link are left out, and `tagIds` are
 * the `{ id }` tags. The description is sent only while the form's link is still the one it came
 * from (design §5.3), so an edited link never carries the old product's description.
 */
export function suggestionRequest(
  values: SuggestionFormValues,
  unfurled: Unfurled,
): TagSuggestionsRequest {
  const { title, note, url, tags } = values;
  const tagIds = (tags ?? []).flatMap((ref) => ('id' in ref ? [ref.id] : []));
  const sameLink = unfurled.url != null && url?.trim() === unfurled.url.trim();
  const description = sameLink ? unfurled.description : undefined;
  return {
    title,
    ...(note?.trim() ? { note } : {}),
    ...(url?.trim() ? { url } : {}),
    ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(tagIds.length > 0 ? { tagIds } : {}),
  };
}

/**
 * Asks the API for tag suggestions and keeps only the latest answer (tag suggestions design §5.1,
 * Plan 9 ruling 2). It is a class, not hook logic, so the ordering rules can be unit-tested: the
 * web's Vitest runs in Node with no component renderer.
 */
export class SuggestionAsker {
  private lastTitle: string | undefined;
  private inFlight: AbortController | undefined;
  private disposed = false;
  /** Whether the last `onChange` gave any suggestions, which a re-ask then clears. */
  private showing = false;

  constructor(
    private readonly post: (
      body: TagSuggestionsRequest,
      signal: AbortSignal,
    ) => Promise<TagSuggestionsResponse>,
    private readonly onChange: (suggestions: ItemTagRef[]) => void,
  ) {}

  /**
   * Skips an empty title, or the same title as last asked. Otherwise aborts the older request,
   * clears suggestions shown for the old title (the row isn't shown while waiting), and asks again;
   * only this request's answer reaches `onChange`. Any failure gives `[]`: a suggestion is a
   * convenience, so the form never shows an error for it.
   */
  ask(body: TagSuggestionsRequest): void {
    const title = body.title.trim();
    if (this.disposed || title === '' || title === this.lastTitle) return;
    this.lastTitle = title;

    this.inFlight?.abort();
    const request = new AbortController();
    this.inFlight = request;
    if (this.showing) this.change([]);

    // A request that was replaced or disposed is aborted; whatever it settles with is stale.
    const current = () => this.inFlight === request && !this.disposed;
    this.post(body, request.signal).then(
      (answer) => {
        if (current()) this.change(answer.suggestions);
      },
      () => {
        if (current()) this.change([]);
      },
    );
  }

  private change(suggestions: ItemTagRef[]): void {
    this.showing = suggestions.length > 0;
    this.onChange(suggestions);
  }

  /** Aborts the request in flight; `onChange` isn't called after this, and later asks do nothing. */
  dispose(): void {
    this.disposed = true;
    this.inFlight?.abort();
    this.inFlight = undefined;
  }
}
