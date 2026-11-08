import type { Item, ItemTagRef, UnfurlResponse } from '@wishlist/contracts';

/** What the add box was given (spec §7 Owner editor, Plan 3b rule 5). */
export type AddInput =
  | { kind: 'empty' }
  | { kind: 'link'; url: string; titleHint: string | null }
  | { kind: 'other-scheme' }
  | { kind: 'idea'; title: string };

const HTTP_LINK = /https?:\/\/\S+/i;
/** One token shaped like a shop address: `shop.com`, `www.shop.com/x`, `shop.com:8080/x?y`. */
const SHOP_ADDRESS = /^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const OTHER_SCHEME = /^(?!https?:)[a-z][a-z\d+.-]*:\/\//i;

export function classifyAddInput(raw: string): AddInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  // A phone's share sheet sends "Product name https://…": the link is the item, the rest a hint.
  const link = HTTP_LINK.exec(text);
  if (link) {
    const rest = `${text.slice(0, link.index)} ${text.slice(link.index + link[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return { kind: 'link', url: link[0], titleHint: rest || null };
  }
  const oneToken = !/\s/.test(text);
  if (oneToken && SHOP_ADDRESS.test(text)) {
    return { kind: 'link', url: `https://${text}`, titleHint: null };
  }
  if (oneToken && OTHER_SCHEME.test(text)) return { kind: 'other-scheme' };
  return { kind: 'idea', title: text };
}

/** The add and edit forms' values: strings, as inputs hold them; the schema turns '' into null. */
export interface ItemFormValues {
  title: string;
  url: string;
  imageUrl: string;
  priceText: string;
  note: string;
  quantity: number;
  /**
   * The item's whole tag set. The edit form sends it only when it changed, and the add form only
   * when it isn't empty (Plan 7b ruling 5).
   */
  tags: ItemTagRef[];
}

/** A new item's form, from what unfurl found, else the title hint; the link is always kept. */
export function prefill(
  url: string,
  titleHint: string | null,
  response: UnfurlResponse | null,
): ItemFormValues {
  return {
    title: response?.title ?? titleHint ?? '',
    url,
    imageUrl: response?.imageUrl ?? '',
    priceText: response?.priceText ?? '',
    note: '',
    quantity: 1,
    tags: [],
  };
}

/** The longest link the add box or the add form's Link field will read. */
export const LINK_MAX = 2048;

/**
 * The link to read when text is pasted into the add form's Link field (D117), with any text a phone
 * app shared alongside it as a title hint; null when the field holds no link, or one too long to save.
 */
export function pastedLink(text: string): { url: string; titleHint: string | null } | null {
  const input = classifyAddInput(text);
  if (input.kind !== 'link' || input.url.length > LINK_MAX) return null;
  return { url: input.url, titleHint: input.titleHint };
}

/** The fields a page read can fill in. */
export type FillableValues = Pick<ItemFormValues, 'title' | 'imageUrl' | 'priceText'>;

/**
 * What a read of a pasted link fills in (D117): each field that is still empty, from the page, and
 * the title from the shared text when the page has none. What the owner typed is never replaced.
 */
export function fillEmpty(
  current: FillableValues,
  response: UnfurlResponse | null,
  titleHint: string | null,
): Partial<FillableValues> {
  const found: Partial<FillableValues> = {
    title: response?.title ?? titleHint ?? undefined,
    imageUrl: response?.imageUrl,
    priceText: response?.priceText,
  };
  const filled: Partial<FillableValues> = {};
  for (const name of ['title', 'imageUrl', 'priceText'] as const) {
    const value = found[name];
    if (value && current[name].trim() === '') filled[name] = value;
  }
  return filled;
}

/** An existing item's form. */
export function formValuesOf(item: Item): ItemFormValues {
  return {
    title: item.title,
    url: item.url ?? '',
    imageUrl: item.imageUrl ?? '',
    priceText: item.priceText ?? '',
    note: item.note ?? '',
    quantity: item.quantity,
    tags: (item.tagIds ?? []).map((id) => ({ id })),
  };
}
