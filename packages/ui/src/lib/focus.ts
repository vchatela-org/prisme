/**
 * One focus treatment, defined once.
 *
 * Every interactive thing in prisme is reachable from the keyboard, which is
 * only useful if you can see where you are. `:focus-visible` rather than
 * `:focus` so a mouse click does not leave a ring behind, and a 2px offset
 * ring rather than an outline so it stays visible over a filled control.
 */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page';

/** The same ring for something that sits on a raised surface. */
export const FOCUS_RING_RAISED =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised';

/**
 * A disabled control still has to be readable — 38% opacity would take
 * `ink-secondary` below 3:1. Dimming is done with the muted ink token instead
 * of an opacity, so the result is a colour that was measured.
 */
export const DISABLED = 'disabled:cursor-not-allowed disabled:text-ink-muted';
