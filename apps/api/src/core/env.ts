import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  /** Commit the deployment was built from; set by the deploy pipelines. */
  GIT_SHA: z.string().min(1).default('dev'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
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
