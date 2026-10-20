import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import { ERROR_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { BREACHED_PASSWORD_CHECKER, PwnedPasswordsChecker } from './breached-passwords.js';
import { CAPTCHA_VERIFIER, TurnstileVerifier } from './captcha.js';
import { PasswordPolicy } from './password-policy.js';

/** The CAPTCHA and breached-password ports (spec §8) with their real adapters. */
@Module({
  providers: [
    {
      provide: CAPTCHA_VERIFIER,
      inject: [ENV, ERROR_REPORTER],
      useFactory: (env: Env, reporter: ErrorReporter) =>
        new TurnstileVerifier(env.TURNSTILE_SECRET_KEY, fetch, reporter),
    },
    {
      provide: BREACHED_PASSWORD_CHECKER,
      inject: [ERROR_REPORTER],
      useFactory: (reporter: ErrorReporter) => new PwnedPasswordsChecker(fetch, reporter),
    },
    PasswordPolicy,
  ],
  exports: [CAPTCHA_VERIFIER, BREACHED_PASSWORD_CHECKER, PasswordPolicy],
})
export class SecurityModule {}
