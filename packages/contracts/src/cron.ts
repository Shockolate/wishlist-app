import { z } from 'zod';

/** What the daily cleanup deleted (spec §10, "Monitoring and maintenance"). */
export const CleanupResultSchema = z.object({
  unverifiedUsers: z.number().int().nonnegative(),
  emailTokens: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  rateLimitWindows: z.number().int().nonnegative(),
});
export type CleanupResult = z.infer<typeof CleanupResultSchema>;
