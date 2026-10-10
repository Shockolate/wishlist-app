import { z } from 'zod';

/** A bare origin such as https://example.com: no path, query or trailing slash. */
const OriginSchema = z.string().refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'must be a bare origin such as https://example.com');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
    /** Commit the deployment was built from; set by the deploy pipelines. */
    GIT_SHA: z.string().min(1).default('dev'),
    /** Set by Vercel at runtime: production, preview or development. Unset everywhere else. */
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    /**
     * The web origin browsers use. The CSRF guard only accepts state-changing requests from it
     * (spec §6.2), and links in emails point at it.
     */
    APP_ORIGIN: OriginSchema,
    /** `log` prints emails (previews, tests), `mailpit` delivers locally, `resend` sends for real. */
    EMAIL_TRANSPORT: z.enum(['log', 'mailpit', 'resend']).default('log'),
    EMAIL_FROM: z
      .string()
      .regex(/^[^<>]+ <[^<>\s]+@[^<>\s]+>$/, 'must look like "Name <address@domain>"')
      .default('Hanker <hanker@localhost>'),
    RESEND_API_KEY: z.string().min(1).optional(),
    MAILPIT_URL: z.url().default('http://localhost:8025'),
    /** Unset means Turnstile is unavailable, so email-sending endpoints refuse (spec §6.5). */
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /** Vercel Cron sends it as a bearer token. Unset means the cron endpoint refuses everyone. */
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when EMAIL_TRANSPORT=resend',
      });
    }
    // The day sign-up opens, the log transport would swallow every account email (rule 15).
    if (
      env.VERCEL_ENV === 'production' &&
      env.TURNSTILE_SECRET_KEY &&
      env.EMAIL_TRANSPORT === 'log'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message:
          'must be resend in production once TURNSTILE_SECRET_KEY is set: with log, account emails would only be written to the logs',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** DI token for the validated environment. */
export const ENV = Symbol('ENV');

/** Validates the environment once at boot so a misconfigured deploy fails fast and says why. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
