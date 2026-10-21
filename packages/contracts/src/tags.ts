import { z } from 'zod';
import { VISIBLE_ONLY_MESSAGE, visibleOnly } from './text.js';

/** An item carries at most this many tags (design §3). */
export const MAX_TAGS_PER_ITEM = 10;

/** A list holds at most this many tags (design §3). */
export const MAX_TAGS_PER_LIST = 50;

/**
 * A tag name as stored (design §3): every run of whitespace becomes one space, and the ends are
 * trimmed. Everything else is kept as typed, a leading `#` included (Ted, 2026-10-21), so "#books"
 * and "books" are two tags. Cleaning a cleaned name changes nothing.
 */
export function cleanTagName(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

/**
 * What makes two names the same tag (design §3): the cleaned name in lower case, with no locale so
 * the answer doesn't depend on where the server runs. The stored name keeps the owner's spelling.
 */
export function tagKey(raw: string): string {
  return cleanTagName(raw).toLowerCase();
}

/**
 * A tag name (design §3, D35, D41): cleaned, then 1 to 30 UTF-16 units of visible characters. The
 * clean-up runs first and the checks run on its result, so a name that is empty once cleaned (only
 * spaces) gets the one `min(1)` issue and not a second one from `visibleOnly`.
 */
export const TagNameSchema = z
  .string()
  .transform(cleanTagName)
  .pipe(z.string().min(1).max(30).refine(visibleOnly, VISIBLE_ONLY_MESSAGE));

/** A tag as the owner and the list's gifters see it (design §5). */
export const TagSchema = z.object({ id: z.uuid(), name: z.string() });
export type Tag = z.infer<typeof TagSchema>;

/**
 * One entry of an item's `tags` (design §3): a tag the owner already has, by id, or a name that
 * joins the owner's tag of that name or makes it. Strict, so an entry with both is refused rather
 * than one of them being silently ignored.
 */
export const ItemTagRefSchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({ name: TagNameSchema }),
]);
export type ItemTagRef = z.infer<typeof ItemTagRefSchema>;

/** An item's whole tag set, as sent with a create or an update (design §3). */
export const ItemTagsSchema = z.array(ItemTagRefSchema).max(MAX_TAGS_PER_ITEM);

export const CreateTagRequestSchema = z.object({ name: TagNameSchema });
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>;

export const RenameTagRequestSchema = CreateTagRequestSchema;
export type RenameTagRequest = z.infer<typeof RenameTagRequestSchema>;
