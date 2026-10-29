import type { ErrorReporter } from '../observability/error-reporter.js';

/**
 * Port for the daily cron's heartbeat (D86): Better Stack expects a ping per run, so a cron that
 * stops running, or fails every day, alerts someone. Neither method ever throws.
 */
export interface CronHeartbeat {
  succeeded(): Promise<void>;
  failed(): Promise<void>;
}

export const CRON_HEARTBEAT = Symbol('CRON_HEARTBEAT');

/** Used when CRON_HEARTBEAT_URL is unset: previews, CI, tests and local development. */
export const NO_HEARTBEAT: CronHeartbeat = {
  succeeded: () => Promise.resolve(),
  failed: () => Promise.resolve(),
};

const TIMEOUT_MS = 5000;

/**
 * Pings a Better Stack heartbeat URL, and `<url>/fail` for a failed run. The URL carries the
 * heartbeat's token, so it's a secret: a failed ping reports a fixed message with the status
 * only, never the URL, the error's message or its cause (which can carry the URL).
 */
export class BetterStackCronHeartbeat implements CronHeartbeat {
  constructor(
    private readonly url: string,
    private readonly reporter: ErrorReporter,
    private readonly fetchFn: typeof fetch = fetch,
    /** Names the heartbeat in a failed ping's warning: the quota check has its own (D105). */
    private readonly name = 'cron heartbeat',
  ) {}

  succeeded(): Promise<void> {
    return this.ping(this.url);
  }

  failed(): Promise<void> {
    return this.ping(`${this.url}/fail`);
  }

  private async ping(url: string): Promise<void> {
    let status = 'none';
    // A plain timer rather than AbortSignal.timeout, so tests can drive the deadline.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, { method: 'GET', signal: deadline.signal });
      if (res.ok) return;
      status = String(res.status);
    } catch {
      // Network error or timeout. Its message and cause may hold the URL, so neither is kept.
    } finally {
      clearTimeout(timer);
    }
    this.reporter.captureWarning(`${this.name} failed status=${status}`);
  }
}
