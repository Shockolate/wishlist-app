import { ClaimConflictProblemSchema } from '@wishlist/contracts';
import { ApiError } from './api-client';

/**
 * What is left beyond every claim, from a `409 CLAIM_EXCEEDS_REMAINING` (Plan 4a rule 7). Zero
 * when the error isn't one that carries it, which reads as "none left" and never over-offers.
 */
export function remainingFromConflict(error: unknown): number {
  return error instanceof ApiError
    ? (ClaimConflictProblemSchema.safeParse(error.problem).data?.remaining ?? 0)
    : 0;
}
