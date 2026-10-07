import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Git commit the API was deployed from; deploy pipelines poll for it. */
  sha: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
