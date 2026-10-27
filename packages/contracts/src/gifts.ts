import { z } from 'zod';
import { ClaimDetailsResponseSchema, UpdateClaimRequestSchema } from './claims.js';
import { ClaimSchema } from './wishlist.js';

/**
 * One of a signed-in gifter's live claims on Your gifts (design §5): their own claim, the item it
 * is on, how many are left, and their private Bought tick. Never sent to an owner (D75, D82).
 */
export const GiftSchema = z.object({
  linkId: z.uuid(),
  claim: ClaimSchema,
  item: ClaimDetailsResponseSchema.shape.item,
  remaining: z.number().int().min(0),
  wishlistTitle: z.string(),
  ownerDisplayName: z.string(),
  shareUrl: z.url(),
  bought: z.boolean(),
});
export type Gift = z.infer<typeof GiftSchema>;

/** What is left of a claim that went: the owner removed it, or it was cancelled through its link. */
export const GoneGiftSchema = z.object({
  linkId: z.uuid(),
  itemTitle: z.string(),
  ownerDisplayName: z.string(),
  reason: z.enum(['removed', 'cancelled']),
});
export type GoneGift = z.infer<typeof GoneGiftSchema>;

/** `GET /me/gifts`: live claims first, then notes about the ones that went. */
export const GiftsResponseSchema = z.object({
  gifts: z.array(GiftSchema),
  gone: z.array(GoneGiftSchema),
});
export type GiftsResponse = z.infer<typeof GiftsResponseSchema>;

/**
 * `PATCH /me/gifts/:linkId`: what `PATCH /claims` takes, plus the Bought tick, which belongs to the
 * gifter's link and never touches the claim. At least one field.
 */
export const UpdateGiftRequestSchema = z
  .object({ ...UpdateClaimRequestSchema.shape, bought: z.boolean().optional() })
  .refine(
    (body) =>
      body.claimerName !== undefined || body.quantity !== undefined || body.bought !== undefined,
    { message: 'Change the name, the quantity or the Bought tick.' },
  );
export type UpdateGiftRequest = z.infer<typeof UpdateGiftRequestSchema>;

/**
 * `POST /claims/:manageToken/link`: whether the claim is now on this account's gifts (`yours`) or
 * already on another account's (`someone-else`).
 */
export const ClaimLinkResponseSchema = z.object({ link: z.enum(['yours', 'someone-else']) });
export type ClaimLinkResponse = z.infer<typeof ClaimLinkResponseSchema>;
