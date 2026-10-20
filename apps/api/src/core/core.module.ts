import { Global, Module } from '@nestjs/common';
import {
  ERROR_REPORTER,
  NOOP_REPORTER,
  type ErrorReporter,
} from '../observability/error-reporter.js';
import { SentryErrorReporter } from '../observability/sentry-error-reporter.js';
import { CLOCK, systemClock } from './clock.js';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: ERROR_REPORTER,
      inject: [ENV],
      useFactory: (env: Env): ErrorReporter =>
        env.SENTRY_DSN
          ? new SentryErrorReporter({
              dsn: env.SENTRY_DSN,
              release: env.GIT_SHA,
              environment: env.VERCEL_ENV ?? env.NODE_ENV,
            })
          : NOOP_REPORTER,
    },
  ],
  exports: [ENV, CLOCK, ERROR_REPORTER],
})
export class CoreModule {}
