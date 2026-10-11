import { LoginRequestSchema, SignupRequestSchema } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { formErrorMap } from './form-errors';

const messages = (schema: z.ZodType, input: unknown) =>
  Object.fromEntries(
    (schema.safeParse(input, { error: formErrorMap }).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('formErrorMap (rule 23)', () => {
  it('speaks plainly about the sign-up fields', () => {
    const SignupForm = SignupRequestSchema.omit({ turnstileToken: true });
    expect(messages(SignupForm, { displayName: '  ', email: 'ada', password: 'short' })).toEqual({
      displayName: 'Enter a name.',
      email: 'Enter an email address, like ada@example.com.',
      password: 'Use at least 10 characters.',
    });
  });

  it('asks for the password at login without revealing the policy', () => {
    expect(messages(LoginRequestSchema, { email: 'ada@example.com', password: '' })).toEqual({
      password: 'Enter your password.',
    });
  });

  it('states the upper limit', () => {
    expect(
      messages(LoginRequestSchema, { email: 'ada@example.com', password: 'x'.repeat(129) }),
    ).toEqual({ password: 'Use 128 characters or fewer.' });
  });

  it('keeps a refinement’s own message', () => {
    const NameOnly = SignupRequestSchema.pick({ displayName: true });
    expect(messages(NameOnly, { displayName: 'Ada\u202E' })).toEqual({
      displayName: 'Use visible characters only',
    });
  });
});
