import { z } from 'zod';

/**
 * RFC 9457 problem details, extended with a stable `code` and the `requestId` (spec §5).
 * A loose object, because domain errors add extension members such as `remaining` on a claim
 * conflict, and those must survive parsing.
 */
export const ProblemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
  requestId: z.string().min(1),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
