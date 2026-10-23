import { Logger } from '@nestjs/common';
import type { ErrorReporter } from '../observability/error-reporter.js';
import type { SuggestInput, SuggestResult, TagSuggester } from './tag-suggester.js';

/** One suggestion, from asking to answer (design §5.2). Past it the answer is `[]`. */
export const TAG_SUGGEST_DEADLINE_MS = 5_000;

const logger = new Logger('TagSuggest');

/** The link's host, which is all of a link that ever leaves the API; undefined for what isn't a URL. */
export function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The port call with its deadline, logging and reporting. Returns the raw names, or `[]` for any
 * failure: suggestions are optional help, so no failure reaches the owner. A line carries the outcome
 * and the HTTP status, never the item's text, a tag name, a URL or the token. A status that means our
 * configuration is wrong (ruling 10) is also reported once, as a warning. The deadline aborts the
 * request and is also raced here, so a suggester that ignores its signal can't hold the route.
 */
export async function askSuggester(
  suggester: TagSuggester,
  input: SuggestInput,
  reporter: ErrorReporter,
  deadlineMs: number = TAG_SUGGEST_DEADLINE_MS,
): Promise<string[]> {
  const signal = AbortSignal.timeout(deadlineMs);
  let result: SuggestResult;
  try {
    result = await Promise.race([suggester.suggest(input, signal), timedOut(signal)]);
  } catch (error) {
    // The port promises never to throw, so this is a bug in an adapter: worth a report.
    reporter.captureException(error);
    return [];
  }
  // `=== true`, not truthiness: Vercel's builder type-checks without strictNullChecks (see metadata-fetcher.ts).
  if (result.ok === true) return result.names;
  if (result.reason === 'UNAVAILABLE') {
    const status = result.status ?? 'none';
    if (result.misconfigured) {
      // An operator has to act: the token, the account or the model is wrong. Only the status goes.
      reporter.captureWarning(`Workers AI answered ${status}`);
    }
    logger.log(`tag-suggest UNAVAILABLE status=${status}`);
  } else {
    logger.log(`tag-suggest ${result.reason}`);
  }
  return [];
}

/** Resolves as TIMEOUT when the signal aborts, and never otherwise. */
function timedOut(signal: AbortSignal): Promise<SuggestResult> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ ok: false, reason: 'TIMEOUT' }), {
      once: true,
    });
  });
}
