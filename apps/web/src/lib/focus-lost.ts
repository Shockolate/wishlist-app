/**
 * Whether focus has nowhere useful to be: on the page itself, or on a control that has been
 * disabled. That happens when the control that was pressed disables itself while it works, or when
 * a refetch removes or re-inserts it. An error that appears then takes focus (WCAG 2.4.3), so a
 * keyboard or screen-reader user isn't sent back to the top of the page.
 */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active.matches(':disabled');
}
