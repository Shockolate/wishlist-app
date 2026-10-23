import { z } from 'zod';
import { ItemTagRefSchema, MAX_TAGS_PER_ITEM } from './tags.js';
import { ItemTitleSchema, NoteSchema } from './wishlist.js';

/** At most this many tags are suggested for one item (tag suggestions design §5.1). */
export const MAX_TAG_SUGGESTIONS = 3;

/** A shop's description is cut to this many UTF-16 units before it is sent (tag suggestions design §5.1). */
export const DESCRIPTION_MAX = 1000;

/**
 * What the add and edit forms send to ask for tags (tag suggestions design §5.1). Only the link's
 * host is used, and `tagIds` are the tags the item already has, which are never suggested again.
 */
export const TagSuggestionsRequestSchema = z.object({
  title: ItemTitleSchema,
  note: NoteSchema.optional(),
  url: z.string().max(2048).optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  tagIds: z.array(z.uuid()).max(MAX_TAGS_PER_ITEM).optional(),
});
export type TagSuggestionsRequest = z.infer<typeof TagSuggestionsRequestSchema>;

/**
 * Up to three tags, the owner's existing ones (by id) first and new names after (tag suggestions
 * design §5.1). Each entry is an `ItemTagRef`, so a chosen suggestion goes straight into an item's
 * `tags`.
 */
export const TagSuggestionsResponseSchema = z.object({
  suggestions: z.array(ItemTagRefSchema).max(MAX_TAG_SUGGESTIONS),
});
export type TagSuggestionsResponse = z.infer<typeof TagSuggestionsResponseSchema>;
