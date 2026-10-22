// The sentences the owner's Tags sheet builds from tag counts (values table, Ted's mockup 2c).

/** "0 items", "1 item", "3 items": a tag's count, empty tags included. */
export function itemCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'item' : 'items'}`;
}

/** The delete confirm's title: what deleting takes off, or just the tag when it's on nothing. */
export function deleteTagTitle(name: string, count: number): string {
  return count === 0 ? `Delete “${name}”?` : `Remove “${name}” from ${itemCount(count)}?`;
}
