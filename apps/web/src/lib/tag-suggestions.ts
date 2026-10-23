import type {
  ItemTagRef,
  TagSuggestionsRequest,
  TagSuggestionsResponse,
} from '@wishlist/contracts';

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
