import { remainingOf, type Claim } from '@wishlist/contracts';

// The sentences the share page builds from claim numbers (spec §7, the Plan 4b mockups). Pure, so
// the server render and the browser say the same thing.

/** "Sue", "Sue and Sam", "Sue, Sam and Jo". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const isAre = (count: number) => (count === 1 ? 'is' : 'are');
const total = (claims: readonly Claim[]) => claims.reduce((sum, claim) => sum + claim.quantity, 0);

/** What gifters are told about the owner's spoiler setting (D40). */
export function ownerSeesLine(owner: string, ownerSeesClaims: boolean): string {
  return ownerSeesClaims
    ? `${owner} can see who’s getting what.`
    : `${owner} can’t see who’s getting what, so the surprise is safe.`;
}

/** An item's claims as one viewer sees them. */
export interface ItemClaims {
  /** "Ada wants" for gifters, "You want" for the owner. */
  wants: string;
  quantity: number;
  /** Absent when the viewer may not see claims (spec §5.1). */
  claims?: readonly Claim[];
  /** The claims this browser made (D45). */
  ownIds?: ReadonlySet<string>;
}

/** How many this browser is getting. */
export function mineOf({ claims = [], ownIds }: ItemClaims): number {
  return total(claims.filter((claim) => ownIds?.has(claim.id)));
}

/** Whether nothing is left to claim. Claims the viewer may not see never make an item taken. */
export function isTaken({ quantity, claims }: ItemClaims): boolean {
  return claims !== undefined && remainingOf(quantity, total(claims)) === 0;
}

/**
 * The line on an item that's still wanted: how many, who is getting some, and how many are left.
 * Null when there's nothing worth saying (one wanted and nobody has claimed it) or nothing is left.
 */
export function countLine(item: ItemClaims): string | null {
  const { wants, quantity, claims = [], ownIds } = item;
  const want = quantity > 1 ? `${wants} ${quantity}.` : null;
  if (claims.length === 0) return want;
  const remaining = remainingOf(quantity, total(claims));
  if (remaining === 0) return null;
  const parts = claims
    .filter((claim) => !ownIds?.has(claim.id))
    .map((claim) => `${claim.claimerName} is getting ${claim.quantity}`);
  const mine = mineOf(item);
  if (mine > 0) parts.push(`you’re getting ${mine}`);
  const who = `${capitalize(joinNames(parts))}, so ${remaining} ${isAre(remaining)} left.`;
  return want ? `${want} ${who}` : who;
}

/** The line on an item nobody can claim any more: who is getting it. */
export function takenLine({ claims = [] }: ItemClaims): string {
  const names = [...new Set(claims.map((claim) => claim.claimerName))];
  return `Taken care of: ${joinNames(names)} ${isAre(names.length)} getting this`;
}

/** Under the claim sheet's stepper: the most you can claim. Nothing to say when it's one. */
export function stepperHint(max: number): string | undefined {
  return max > 1 ? `Up to ${max}` : undefined;
}

/** The claim sheet's button. After a 409 leaves one, it says so (the Plan 4b mockups). */
export function claimButtonLabel(max: number, afterConflict: boolean): string {
  return afterConflict && max === 1 ? 'Claim the last one' : 'Claim it';
}

/** Under "You're getting …" once a claim is made. */
export function claimedLine(quantity: number, wanted: number, owner: string, name: string): string {
  return wanted > 1 ? `${quantity} of the ${wanted} ${owner} wants, as ${name}.` : `As ${name}.`;
}

/** The card's strip for this browser's own claim. */
export function ownStripText(mine: number): string {
  return `You’re getting ${mine}`;
}

/** On the manage page's card: how much of the item is yours. */
export function yourClaimLine(quantity: number, wanted: number, owner: string): string {
  return wanted > 1
    ? `You’re getting ${quantity} of the ${wanted} ${owner} wants`
    : 'You’re getting this';
}

/** Under the manage page's stepper: what's left plus what the claim holds (spec §2). */
export function manageHint(remaining: number, current: number): string {
  const most = `Up to ${remaining + current}`;
  return remaining > 0 ? `${most}: ${remaining} more ${isAre(remaining)} free` : most;
}

/** A tag chip's accessible name: "Garden, 1 item", "Kitchen gadgets, 4 items". */
export function tagChipLabel(name: string, count: number): string {
  return `${name}, ${count} ${count === 1 ? 'item' : 'items'}`;
}

/** The filter row's live line: how many of the list's items the filters leave showing. */
export function shownLine(shown: number, total: number): string {
  return `${shown} of ${total} items`;
}
