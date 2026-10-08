export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** The fixed window containing `nowMs`, and the whole seconds until it resets. */
export function fixedWindow(
  nowMs: number,
  windowSeconds: number,
): { start: Date; retryAfterSeconds: number } {
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    start: new Date(startMs),
    retryAfterSeconds: Math.ceil((startMs + windowMs - nowMs) / 1000),
  };
}
