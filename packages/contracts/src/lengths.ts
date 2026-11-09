import { z } from 'zod';

// Length limits in UTF-16 code units, the way D41 counts every length, as JavaScript and the forms
// do. Zod's own `.min()` and `.max()` count code points since 4.6, so an emoji costs one there and
// two here. These raise the same issues as zod's checks, so the forms' messages don't change, and
// mark them `continue` as zod does, so later checks still run.

export function minUnits(minimum: number): z.core.$ZodCheck<string> {
  return z.check<string>((payload) => {
    if (payload.value.length >= minimum) return;
    payload.issues.push({
      code: 'too_small',
      origin: 'string',
      minimum,
      inclusive: true,
      input: payload.value,
      continue: true,
    });
  });
}

export function maxUnits(maximum: number): z.core.$ZodCheck<string> {
  return z.check<string>((payload) => {
    if (payload.value.length <= maximum) return;
    payload.issues.push({
      code: 'too_big',
      origin: 'string',
      maximum,
      inclusive: true,
      input: payload.value,
      continue: true,
    });
  });
}
