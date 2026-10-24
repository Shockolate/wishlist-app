import { GIFTS_HEADING_ID } from './gifts-copy';

/** Where focus goes when the card or note it was on is about to leave the page. */
export function focusGiftsHeading() {
  document.getElementById(GIFTS_HEADING_ID)?.focus();
}
