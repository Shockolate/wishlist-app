import { z } from 'zod';
import { ItemTagsSchema, TagSchema } from './tags.js';
import { VISIBLE_ONLY_MESSAGE, visibleOnly } from './text.js';

/** A list holds at most this many items (spec §2). */
export const MAX_ITEMS = 200;

// Titles follow the display-name rule: visible characters only (D35).
export const WishlistTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(visibleOnly, VISIBLE_ONLY_MESSAGE);

/** The title sign-up gives a new list (spec §2). Any valid display name makes a valid title. */
export function defaultWishlistTitle(displayName: string): string {
  return `${displayName}'s wishlist`;
}

export const ItemTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(visibleOnly, VISIBLE_ONLY_MESSAGE);
export const QuantitySchema = z.number().int().min(1).max(99);

// Optional text fields (Plan 3a rule 1): trimmed, and null or blank is stored as null. Wrapped in
// `.optional()` on a PATCH, an omitted field is left alone.
const blankToNull = (value: string | null) => (value === '' ? null : value);

/**
 * Postgres can't store U+0000 in a text column, so it would be a 500. Notes and links refuse only
 * that one character: a note keeps its newlines and tabs.
 */
const NUL_MESSAGE = 'Remove the invisible character';
const hasNoNul = (value: string) => !value.includes('\u0000');

/**
 * A link field: blank, or a URL whose scheme matches `protocol`. Zod's URL check does the parsing:
 * this package compiles without DOM or Node types, so it can't name `URL` itself.
 */
function link(protocol: RegExp, message: string) {
  const url = z.url({ protocol });
  return (
    z
      .string()
      .trim()
      .max(2048)
      // First, and aborting: `new URL()` percent-encodes a NUL in the path, so the URL check alone
      // accepts it while the raw string is what gets stored.
      .refine(hasNoNul, { message: NUL_MESSAGE, abort: true })
      .refine((value) => value === '' || url.safeParse(value).success, message)
      .nullable()
      .transform(blankToNull)
  );
}

/** A product link: http or https (spec §2). */
export const ItemUrlSchema = link(/^https?$/, 'Enter a link that starts with http:// or https://');

/** Only ever https: shown as a plain <img>, and never fetched by the server (spec §2, §6.9). */
export const ImageUrlSchema = link(/^https$/, 'Enter an image link that starts with https://');

/** A price sits beside its title in front of gifters, so it follows the title rule (D36). */
export const PriceTextSchema = z
  .string()
  .trim()
  .max(50)
  .refine(visibleOnly, VISIBLE_ONLY_MESSAGE)
  .nullable()
  .transform(blankToNull);
export const NoteSchema = z
  .string()
  .trim()
  .max(1000)
  .refine(hasNoNul, NUL_MESSAGE)
  .nullable()
  .transform(blankToNull);

export const CreateItemRequestSchema = z.object({
  title: ItemTitleSchema,
  url: ItemUrlSchema.optional(),
  imageUrl: ImageUrlSchema.optional(),
  priceText: PriceTextSchema.optional(),
  note: NoteSchema.optional(),
  quantity: QuantitySchema.default(1),
  tags: ItemTagsSchema.optional(),
});
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = z.object({
  title: ItemTitleSchema.optional(),
  url: ItemUrlSchema.optional(),
  imageUrl: ImageUrlSchema.optional(),
  priceText: PriceTextSchema.optional(),
  note: NoteSchema.optional(),
  quantity: QuantitySchema.optional(),
  /** The item's whole tag set; `[]` clears it, and leaving it out keeps it (Plan 7a ruling 4). */
  tags: ItemTagsSchema.optional(),
});
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const ReorderItemsRequestSchema = z.object({
  itemIds: z.array(z.uuid()).max(MAX_ITEMS),
});
export type ReorderItemsRequest = z.infer<typeof ReorderItemsRequestSchema>;

/** A new title, the spoiler setting, or both (spec §5, D33). */
export const UpdateWishlistRequestSchema = z
  .object({ title: WishlistTitleSchema.optional(), showClaimsToOwner: z.boolean().optional() })
  .refine((body) => body.title !== undefined || body.showClaimsToOwner !== undefined, {
    message: 'Change the title or the spoiler setting',
  });
export type UpdateWishlistRequest = z.infer<typeof UpdateWishlistRequestSchema>;

/** A claim as gifters, and an owner who opted in, see it (spec §5). Never its manage token. */
export const ClaimSchema = z.object({
  id: z.uuid(),
  claimerName: z.string(),
  quantity: z.number().int(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * The claim fields an item carries when its viewer may see them (spec §5.1). They're optional
 * because the projection leaves them out, rather than empty, for everyone else.
 */
export const ITEM_CLAIM_FIELDS = {
  remaining: z.number().int().min(0).optional(),
  claims: z.array(ClaimSchema).optional(),
};

/**
 * An item as the owner sees it. Every field is present; empty ones are null (Plan 3a rule 1).
 * `remaining` and `claims` appear only once the owner opts in (spec §5.1). `tagIds` is optional for
 * expand/contract (spec §10); the tags themselves are sent once, beside the items.
 */
export const ItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceText: z.string().nullable(),
  note: z.string().nullable(),
  quantity: z.number().int(),
  position: z.number().int(),
  tagIds: z.array(z.uuid()).optional(),
  ...ITEM_CLAIM_FIELDS,
});
export type Item = z.infer<typeof ItemSchema>;

/**
 * An item write's response (Plan 7a ruling 1): the item with its `tagIds`, plus the tags those ids
 * name, so the editor needs no second request for a tag it has just made.
 */
export const ItemWriteResponseSchema = ItemSchema.extend({ tags: z.array(TagSchema).optional() });
export type ItemWriteResponse = z.infer<typeof ItemWriteResponseSchema>;

/** `GET /wishlist` (spec §5). Fields added after Plan 3a are optional, for expand/contract (spec §10). */
export const WishlistResponseSchema = z.object({
  title: z.string(),
  shareUrl: z.url(),
  showClaimsToOwner: z.boolean().optional(),
  tags: z.array(TagSchema).optional(),
  items: z.array(ItemSchema),
});
export type WishlistResponse = z.infer<typeof WishlistResponseSchema>;

export const WishlistSettingsResponseSchema = z.object({
  title: z.string(),
  shareUrl: z.url(),
  showClaimsToOwner: z.boolean().optional(),
});
export type WishlistSettingsResponse = z.infer<typeof WishlistSettingsResponseSchema>;

export const RotateShareTokenResponseSchema = z.object({ shareUrl: z.url() });
export type RotateShareTokenResponse = z.infer<typeof RotateShareTokenResponseSchema>;

/** Why an unfurl came back empty (spec §6.8). The web app maps each to a sentence. */
export const UNFURL_FAILURE_REASONS = [
  'INVALID_URL',
  'DISALLOWED_ADDRESS',
  'DNS_FAILED',
  'UNREACHABLE',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'BLOCKED_BY_SITE',
  'NOT_HTML',
  'TOO_LARGE',
  'NO_METADATA',
  'LOOKUP_UNAVAILABLE',
] as const;
export const UnfurlFailureReasonSchema = z.enum(UNFURL_FAILURE_REASONS);
export type UnfurlFailureReason = z.infer<typeof UnfurlFailureReasonSchema>;

export const UnfurlRequestSchema = z.object({ url: z.string().trim().min(1).max(2048) });
export type UnfurlRequest = z.infer<typeof UnfurlRequestSchema>;

/** A prefill only: nothing is saved (spec §5). Always 200; a failure carries its reason. */
export const UnfurlResponseSchema = z.object({
  title: z.string().optional(),
  imageUrl: z.string().optional(),
  priceText: z.string().optional(),
  failureReason: UnfurlFailureReasonSchema.optional(),
});
export type UnfurlResponse = z.infer<typeof UnfurlResponseSchema>;
