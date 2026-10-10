import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import { BREACHED_PASSWORD_CHECKER, PwnedPasswordsChecker } from './breached-passwords.js';
import { CAPTCHA_VERIFIER, TurnstileVerifier } from './captcha.js';
import { PasswordPolicy } from './password-policy.js';

/** The CAPTCHA and breached-password ports (spec §8) with their real adapters. */
@Module({
  providers: [
    {
      provide: CAPTCHA_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env) => new TurnstileVerifier(env.TURNSTILE_SECRET_KEY),
    },
    { provide: BREACHED_PASSWORD_CHECKER, useFactory: () => new PwnedPasswordsChecker() },
    PasswordPolicy,
  ],
  exports: [CAPTCHA_VERIFIER, BREACHED_PASSWORD_CHECKER, PasswordPolicy],
})
export class SecurityModule {}
