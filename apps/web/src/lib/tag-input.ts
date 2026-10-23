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
 * The owner's own tags that match what's typed (spec §7, the tag field): those whose key
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
 * gives the message to show instead (Plan 7b ruling 7).
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

/**
 * The chosen tags with a suggestion added (tag suggestions design §5.1): an `{ id }` as it is, a
 * `{ name }` through `addTypedTag`, so a name that matches a tag on the list becomes that tag.
 * Already chosen is a no-op. The row hides itself at the per-item limit (ruling 5), so a refusal
 * here can only be a stale tap and leaves the tags as they were.
 */
export function addSuggestedTag(
  chosen: readonly ItemTagRef[],
  suggestion: ItemTagRef,
  all: readonly Tag[],
): ItemTagRef[] {
  if ('name' in suggestion) {
    const result = addTypedTag(chosen, suggestion.name, all);
    return 'tags' in result ? result.tags : [...chosen];
  }
  const taken = chosen.some(
    (ref) => ('id' in ref && ref.id === suggestion.id) || isSameTag(ref, suggestion, all),
  );
  if (taken || chosen.length >= MAX_TAGS_PER_ITEM) return [...chosen];
  return [...chosen, suggestion];
}

/** Whether two refs are one tag, by key. Unknown ids (a deleted tag) have no key and match nothing. */
function isSameTag(a: ItemTagRef, b: ItemTagRef, all: readonly Tag[]): boolean {
  const key = keyOf(a, all);
  return key !== undefined && key === keyOf(b, all);
}

/**
 * The suggestions to show as chips (Plan 9 ruling 5): those not already chosen, by key, and none at
 * all once the item holds `MAX_TAGS_PER_ITEM` tags, so a tap never meets the per-item limit.
 */
export function openSuggestions(
  suggestions: readonly ItemTagRef[],
  chosen: readonly ItemTagRef[],
  all: readonly Tag[],
): ItemTagRef[] {
  if (chosen.length >= MAX_TAGS_PER_ITEM) return [];
  return suggestions.filter(
    (suggestion) =>
      !chosen.some(
        (ref) =>
          ('id' in ref && 'id' in suggestion && ref.id === suggestion.id) ||
          isSameTag(ref, suggestion, all),
      ),
  );
}

/**
 * Adds typed text as Enter or a save would (spec §7, the tag field): each comma-separated
 * part in order, through `addTypedTag`, so no tag is made holding a comma. Blank parts are skipped.
 * It stops at the first part refused: `tags` keeps the parts added before it, `left` is the text
 * from that part on, and `error` says why. A suggestion is added with `addTypedTag` instead, since
 * an existing tag's own name may hold a comma.
 */
export function addPendingTags(
  chosen: readonly ItemTagRef[],
  typed: string,
  all: readonly Tag[],
): { tags: ItemTagRef[]; left: string; error?: string } {
  let tags = [...chosen];
  const parts = typed.split(',');
  for (const [index, part] of parts.entries()) {
    if (part.trim() === '') continue;
    const result = addTypedTag(tags, part, all);
    if ('error' in result) return { tags, left: parts.slice(index).join(','), error: result.error };
    tags = result.tags;
  }
  return { tags, left: '' };
}

/** The chosen tags without any `{ id }` the list no longer holds: a tag deleted meanwhile (Plan 7b ruling 6). */
export function liveTags(chosen: readonly ItemTagRef[], all: readonly Tag[]): ItemTagRef[] {
  return chosen.filter((ref) => keyOf(ref, all) !== undefined);
}

/** The chips to show: the live chosen tags with their names, by name (Plan 7b ruling 6). */
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
 * An item write's body, with `tags` only when they changed (Plan 7b ruling 5). Leaving them out keeps the
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
