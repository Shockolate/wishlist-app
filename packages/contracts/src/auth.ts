import { z } from 'zod';

/** Emails are stored and compared lowercased (spec §4). 254 characters is the longest valid address. */
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Spec §6.4. The upper cap stops oversized inputs being used to burn hashing CPU. */
export const PasswordSchema = z.string().min(10).max(128);

/** For checking a password someone already has: never reveal the policy, but still cap the cost. */
const ExistingPasswordSchema = z.string().min(1).max(128);

export const DisplayNameSchema = z.string().trim().min(1).max(50);

/** An email-link token: 256 random bits, base64url without padding (spec §4). */
export const EmailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

const TurnstileTokenSchema = z.string().min(1).max(2048);

export const SignupRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const VerifyEmailRequestSchema = z.object({ token: EmailTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z.object({
  email: EmailSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: ExistingPasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: EmailSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  token: EmailTokenSchema,
  newPassword: PasswordSchema,
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeRequestSchema = z.object({ displayName: DisplayNameSchema });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: ExistingPasswordSchema,
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const DeleteMeRequestSchema = z.object({ password: ExistingPasswordSchema });
export type DeleteMeRequest = z.infer<typeof DeleteMeRequestSchema>;
