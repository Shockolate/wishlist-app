import type { UnfurlResponse } from '@wishlist/contracts';

/** What reading a link came to: unfurl's answer, or why there was none. */
export type ReadOutcome = { response: UnfurlResponse } | { error: unknown };

/**
 * Reads a link pasted into the add form's Link field (D117), keeping only the latest read: pasting
 * another link aborts the older one, and a cancelled or disposed read's answer is dropped. It is a
 * class, not hook logic, so these rules can be unit-tested (the web's Vitest has no renderer).
 */
export class LinkReader {
  private inFlight: AbortController | undefined;
  private disposed = false;

  constructor(
    private readonly post: (url: string, signal: AbortSignal) => Promise<UnfurlResponse>,
    private readonly onDone: (url: string, outcome: ReadOutcome) => void,
  ) {}

  read(url: string): void {
    if (this.disposed) return;
    this.inFlight?.abort();
    const request = new AbortController();
    this.inFlight = request;
    const finish = (outcome: ReadOutcome) => {
      if (this.inFlight !== request || this.disposed) return;
      this.inFlight = undefined;
      this.onDone(url, outcome);
    };
    this.post(url, request.signal).then(
      (response) => finish({ response }),
      (error: unknown) => finish({ error }),
    );
  }

  /** Stops the read in flight, if any, and says whether there was one. */
  cancel(): boolean {
    const reading = this.inFlight !== undefined;
    this.inFlight?.abort();
    this.inFlight = undefined;
    return reading;
  }

  /** Cancels, and makes later reads do nothing. */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}
