import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_TAGS_PER_ITEM,
  MAX_TAGS_PER_LIST,
  type TagSuggestionsRequest,
  type TagSuggestionsResponse,
} from '@wishlist/contracts';
import { SNAPSHOT } from '../claims/queries.js';
import { DB, type Database } from '../db/database.module.js';
import { unauthenticated } from '../http/errors.js';
import { ERROR_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import type { RateLimitRule } from '../rate-limit/window.js';
import { askSuggester, hostOf } from './ask-suggester.js';
import { cleanSuggestions } from './clean-suggestions.js';
import { readSuggestContext } from './queries.js';
import { TAG_SUGGESTER, type SuggestInput, type TagSuggester } from './tag-suggester.js';

/** Design §5.2: the same budget as unfurl. */
export const TAG_SUGGEST_PER_USER: RateLimitRule = { limit: 60, windowSeconds: 3600 };

/** Tag suggestions for the owner's add and edit forms (design §5.2). Nothing is saved. */
@Injectable()
export class TagSuggestService {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(DB) private readonly db: Database,
    @Inject(TAG_SUGGESTER) private readonly suggester: TagSuggester,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  /**
   * Rate limit first, so every call counts (ruling 3); then one read of the setting and the list's
   * tags; then the port. `[]` without a call when suggestions are off, or when the item already has
   * the most tags it can (ruling 4).
   */
  async suggest(userId: string, body: TagSuggestionsRequest): Promise<TagSuggestionsResponse> {
    await this.limiter.enforce(rateLimitKey('tag-suggest:user', userId), TAG_SUGGEST_PER_USER);
    const onItem = body.tagIds ?? [];
    if (onItem.length >= MAX_TAGS_PER_ITEM) return { suggestions: [] };

    const context = await this.db.transaction((tx) => readSuggestContext(tx, userId), SNAPSHOT);
    if (!context) throw unauthenticated();
    if (!context.suggestTags) return { suggestions: [] };

    const host = hostOf(body.url);
    const input: SuggestInput = {
      title: body.title,
      // `NoteSchema` also takes null, which clears a note on an update; the port has no such state.
      ...(typeof body.note === 'string' && { note: body.note }),
      ...(host !== undefined && { host }),
      ...(body.description !== undefined && { description: body.description }),
      tagNames: context.tags.slice(0, MAX_TAGS_PER_LIST).map((tag) => tag.name),
    };
    const names = await askSuggester(this.suggester, input, this.reporter);
    // `z.uuid()` accepts upper case, and Postgres hands IDs back in lower case.
    const exclude = new Set(onItem.map((id) => id.toLowerCase()));
    return { suggestions: cleanSuggestions(names, context.tags, exclude) };
  }
}
