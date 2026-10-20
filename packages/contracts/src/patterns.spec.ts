import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EMAIL_PATTERN } from './patterns.js';

describe('EMAIL_PATTERN', () => {
  it('is the pattern z.email() validates with, so redaction finds what sign-up accepts', () => {
    expect(EMAIL_PATTERN.source).toBe(z.regexes.email.source);
    expect(EMAIL_PATTERN.flags).toBe(z.regexes.email.flags);
  });
});
