/** Time source, injected so tests can control expiry and windowing. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };
