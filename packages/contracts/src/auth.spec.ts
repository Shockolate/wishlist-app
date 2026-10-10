import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequestSchema,
  DisplayNameSchema,
  EmailSchema,
  EmailTokenSchema,
  LoginRequestSchema,
  MeResponseSchema,
  PasswordSchema,
  SignupRequestSchema,
} from './auth.js';

describe('EmailSchema', () => {
  it('trims and lowercases, because emails are stored and compared lowercased (spec §4)', () => {
    expect(EmailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects something that is not an address', () => {
    expect(EmailSchema.safeParse('ada').success).toBe(false);
  });

  it('rejects addresses longer than 254 characters', () => {
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@x.io`).success).toBe(false);
  });
});

describe('PasswordSchema (spec §6.4: 10–128 characters)', () => {
  it.each([
    [9, false],
    [10, true],
    [128, true],
    [129, false],
  ])('a %i-character password is accepted: %s', (length, accepted) => {
    expect(PasswordSchema.safeParse('p'.repeat(length)).success).toBe(accepted);
  });
});

describe('SignupRequestSchema', () => {
  const valid = {
    email: 'ada@example.com',
    password: 'correct horse 1',
    displayName: ' Ada ',
    turnstileToken: 'token',
  };

  it('trims the display name', () => {
    expect(SignupRequestSchema.parse(valid).displayName).toBe('Ada');
  });

  it('requires a display name of 1–50 characters', () => {
    expect(SignupRequestSchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...valid, displayName: 'x'.repeat(51) }).success).toBe(
      false,
    );
  });

  it('requires a Turnstile token', () => {
    expect(SignupRequestSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('accepts any non-empty password up to 128 characters, so login never reveals the policy', () => {
    expect(
      LoginRequestSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(true);
    expect(
      LoginRequestSchema.safeParse({ email: 'ada@example.com', password: 'p'.repeat(129) }).success,
    ).toBe(false);
  });
});

describe('EmailTokenSchema', () => {
  it('accepts exactly a 256-bit base64url token (43 characters)', () => {
    expect(EmailTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(EmailTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(EmailTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });
});

describe('ChangePasswordRequestSchema', () => {
  it('applies the password policy to the new password only', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'new password 1',
      }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'short' })
        .success,
    ).toBe(false);
  });
});

describe('MeResponseSchema', () => {
  it('describes the signed-in user', () => {
    const me = {
      id: '0199a3b2-7c4d-7e5f-8a6b-9c0d1e2f3a4b',
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
    };
    expect(MeResponseSchema.parse(me)).toEqual(me);
  });
});

describe('DisplayNameSchema (rule 14)', () => {
  it.each(['Ada', 'Zoë', "O'Brien", 'Ada & Bob', '\u{1F469}‍\u{1F373} Ada'])(
    'accepts %s',
    (name) => {
      expect(DisplayNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each([
    ['a newline', 'Ada\nEvil'],
    ['a tab', 'Ada\tEvil'],
    ['a right-to-left override', 'Ada‮live'],
    ['a zero-width space', 'A​da'],
    ['a soft hyphen', 'A­da'],
  ])('rejects %s', (_label, name) => {
    const result = DisplayNameSchema.safeParse(name);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Use visible characters only');
  });
});
