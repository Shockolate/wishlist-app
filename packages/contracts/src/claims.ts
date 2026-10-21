import { z } from 'zod';
import { DisplayNameSchema } from './auth.js';
import { CAPABILITY_TOKEN_PATTERN } from './patterns.js';
import { ProblemSchema } from './problem.js';
import { TagSchema } from './tags.js';
import { ClaimSchema, ITEM_CLAIM_FIELDS, ItemSchema, QuantitySchema } from './wishlist.js';

/** A gifter's name, which the other gifters see: the display-name rule (spec §2, D35, D41). */
export const ClaimerNameSchema = DisplayNameSchema;

export const CreateClaimRequestSchema = z.object({
  claimerName: ClaimerNameSchema,
  quantity: QuantitySchema.default(1),
  /**
   * The claim sheet's own manage token (D42). Sent again, it finds the claim it already made, so a
   * response lost on a bad connection costs nothing. Without it, the API mints one.
   */
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN).optional(),
});
export type CreateClaimRequest = z.infer<typeof CreateClaimRequestSchema>;

/** A new name, a new quantity, or both (spec §5). */
export const UpdateClaimRequestSchema = z
  .object({ claimerName: ClaimerNameSchema.optional(), quantity: QuantitySchema.optional() })
  .refine((body) => body.claimerName !== undefined || body.quantity !== undefined, {
    message: 'Change the name or the quantity',
  });
export type UpdateClaimRequest = z.infer<typeof UpdateClaimRequestSchema>;

/**
 * An item on the share page (spec §5): the owner's fields without its position, plus `remaining`
 * and `claims` when the viewer may see them (spec §5.1).
 */
export const SharedItemSchema = ItemSchema.omit({ position: true }).extend(ITEM_CLAIM_FIELDS);
export type SharedItem = z.infer<typeof SharedItemSchema>;

/** `GET /shared/:shareToken` (spec §5). `ownerSeesClaims` is the list's setting (D40). */
export const SharedWishlistResponseSchema = z.object({
  title: z.string(),
  ownerDisplayName: z.string(),
  viewerIsOwner: z.boolean(),
  ownerSeesClaims: z.boolean(),
  tags: z.array(TagSchema).optional(),
  items: z.array(SharedItemSchema),
});
export type SharedWishlistResponse = z.infer<typeof SharedWishlistResponseSchema>;

/** `201` from `POST …/claims`: the claim's manage token, the sheet's own or one the API minted (D42). */
export const CreateClaimResponseSchema = z.object({
  claim: ClaimSchema,
  manageToken: z.string().regex(CAPABILITY_TOKEN_PATTERN),
  manageUrl: z.url(),
});
export type CreateClaimResponse = z.infer<typeof CreateClaimResponseSchema>;

/**
 * `GET /claims/:manageToken`: the claimer's own view (spec §5.1). It always has `remaining`, and
 * never anyone else's claims.
 */
export const ClaimDetailsResponseSchema = z.object({
  claim: ClaimSchema,
  item: SharedItemSchema.omit({ remaining: true, claims: true, tagIds: true }),
  wishlistTitle: z.string(),
  ownerDisplayName: z.string(),
  remaining: z.number().int().min(0),
  shareUrl: z.url(),
  ownerSeesClaims: z.boolean(),
});
export type ClaimDetailsResponse = z.infer<typeof ClaimDetailsResponseSchema>;

/** `409 CLAIM_EXCEEDS_REMAINING` says how many are left, so a stepper can reset (spec §7). */
export const ClaimConflictProblemSchema = ProblemSchema.extend({
  remaining: z.number().int().min(0),
});

/**
 * How many of an item are still wanted (spec §2): what the owner wants less what's claimed. Never
 * stored, and never below 0, because an owner may lower a quantity below what's claimed (D19).
 */
export function remainingOf(quantity: number, claimed: number): number {
  return Math.max(0, quantity - claimed);
}
