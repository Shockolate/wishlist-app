import {
  MAX_TAG_SUGGESTIONS,
  MAX_TAGS_PER_LIST,
  TagNameSchema,
  type ItemTagRef,
  type Tag,
} from '@wishlist/contracts';
import { keyOfCleanName } from '../wishlist/tag-queries.js';

/**
 * Turns the model's raw names into tags an item can take (design §5.2, steps 5 and 6). Each name
 * goes through `TagNameSchema` once, and what it refuses is dropped. A cleaned name whose key is a
 * list tag's becomes `{ id }`, which is why the key comes from `keyOfCleanName`: the name is already
 * clean. Any other name is `{ name }`, and is dropped when the list already holds the most tags a
 * list can, since a save that creates one would fail with `TAG_LIMIT_REACHED`. A key is suggested
 * once. `exclude` holds the IDs of tags the item already has, which are never offered again. List
 * tags come first, then new names, each in the model's order, and at most `MAX_TAG_SUGGESTIONS`
 * are kept.
 */
export function cleanSuggestions(
  names: string[],
  listTags: Tag[],
  exclude: ReadonlySet<string>,
): ItemTagRef[] {
  const idByKey = new Map(listTags.map((tag) => [keyOfCleanName(tag.name), tag.id]));
  const listIsFull = listTags.length >= MAX_TAGS_PER_LIST;
  const seen = new Set<string>();
  const existing: ItemTagRef[] = [];
  const created: ItemTagRef[] = [];
  for (const raw of names) {
    const parsed = TagNameSchema.safeParse(raw);
    if (!parsed.success) continue;
    const key = keyOfCleanName(parsed.data);
    if (seen.has(key)) continue;
    seen.add(key);
    const id = idByKey.get(key);
    if (id !== undefined) {
      if (!exclude.has(id)) existing.push({ id });
    } else if (!listIsFull) {
      created.push({ name: parsed.data });
    }
  }
  return [...existing, ...created].slice(0, MAX_TAG_SUGGESTIONS);
}
