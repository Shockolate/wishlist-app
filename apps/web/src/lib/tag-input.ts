import {
  MAX_TAGS_PER_ITEM,
  TagNameSchema,
  tagKey,
  type ItemTagRef,
  type Tag,
} from '@wishlist/contracts';
import { formErrorMap } from './form-errors';
import { ITEM_TAG_LIMIT } from './messages';

/** The tag field offers at most this many suggestions (values table). */
const MAX_SUGGESTIONS = 6;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The key of a chosen tag: its tag's key for an `{ id }` the list holds, else its name's. */
function keyOf(ref: ItemTagRef, all: readonly Tag[]): string | undefined {
  if ('name' in ref) return tagKey(ref.name);
  const known = all.find((each) => each.id === ref.id);
  return known ? tagKey(known.name) : undefined;
}

/**
 * The owner's own tags that match what's typed (values table, Ledger ruling 6): those whose key
 * starts with the typed key, then those that contain it, each alphabetical, at most 6. Tags already
 * chosen are left out. Nothing typed matches every tag, so the list can be browsed from empty.
 */
export function suggestTags(
  all: readonly Tag[],
  typed: string,
  chosen: readonly ItemTagRef[],
): Tag[] {
  const key = tagKey(typed);
  const taken = new Set(chosen.map((ref) => keyOf(ref, all)));
  const open = all.filter((tag) => !taken.has(tagKey(tag.name)));
  const starts = open.filter((tag) => tagKey(tag.name).startsWith(key)).sort(byName);
  const contains = open
    .filter((tag) => !tagKey(tag.name).startsWith(key) && tagKey(tag.name).includes(key))
    .sort(byName);
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/**
 * The chosen tags with `typed` added: the owner's tag with the same key, as `{ id }`, or a new
 * `{ name }`, cleaned. A tag already chosen is a no-op. A name the schema refuses, or an 11th tag,
 * gives the message to show instead (ruling 7).
 */
export function addTypedTag(
  chosen: readonly ItemTagRef[],
  typed: string,
  all: readonly Tag[],
): { tags: ItemTagRef[] } | { error: string } {
  const parsed = TagNameSchema.safeParse(typed, { error: formErrorMap });
  // A failed parse always has an issue; the fallback only satisfies the index's type.
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Fill this in.' };
  const key = tagKey(parsed.data);
  if (chosen.some((ref) => keyOf(ref, all) === key)) return { tags: [...chosen] };
  if (chosen.length >= MAX_TAGS_PER_ITEM) return { error: ITEM_TAG_LIMIT };
  const existing = all.find((tag) => tagKey(tag.name) === key);
  return { tags: [...chosen, existing ? { id: existing.id } : { name: parsed.data }] };
}

/** The chosen tags without any `{ id }` the list no longer holds: a tag deleted meanwhile (ruling 6). */
export function liveTags(chosen: readonly ItemTagRef[], all: readonly Tag[]): ItemTagRef[] {
  return chosen.filter((ref) => keyOf(ref, all) !== undefined);
}

/** The chips to show: the live chosen tags with their names, by name (ruling 6). */
export function shownTags(
  chosen: readonly ItemTagRef[],
  all: readonly Tag[],
): { ref: ItemTagRef; name: string }[] {
  return liveTags(chosen, all)
    .map((ref) => ({
      ref,
      name: 'name' in ref ? ref.name : (all.find((tag) => tag.id === ref.id)?.name ?? ''),
    }))
    .sort(byName);
}

/**
 * An item write's body, with `tags` only when they changed (ruling 5). Leaving them out keeps the
 * item's tags as the API has them, so a tick made elsewhere while the form was open survives.
 */
export function itemBody<T extends { tags: ItemTagRef[] }>(
  values: T,
  tagsChanged: boolean,
): Omit<T, 'tags'> | T {
  if (tagsChanged) return values;
  const rest: Partial<T> = { ...values };
  delete rest.tags;
  return rest as Omit<T, 'tags'>;
}
