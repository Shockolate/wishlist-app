import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Git commit the API was deployed from; deploy pipelines poll for it. */
  sha: z.string().min(1),
  db: z.object({
    ok: z.boolean(),
    /** Applied migrations; null when the database couldn't be reached. */
    migrationsApplied: z.number().int().nonnegative().nullable(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * GET /api/health/live: the API function is up. It never touches the database, so the frequent
 * uptime check can't keep Neon awake past its free compute quota (spec §10 Monitoring, D47).
 */
export const LiveResponseSchema = z.object({
  status: z.literal('ok'),
  sha: z.string().min(1),
});

export type LiveResponse = z.infer<typeof LiveResponseSchema>;
