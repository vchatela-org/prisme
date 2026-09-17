/**
 * "4 minutes ago", computed from two dates that are both passed in.
 *
 * `now` is a parameter rather than a call to the clock, for the same reason it
 * is in `packages/domain`: a component that reads the clock while rendering
 * produces different markup on the server and in the browser, and React calls
 * that a hydration error. Here it also makes the formatting testable without
 * freezing time.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(from: Date, now: Date, locale?: string): string {
  const elapsed = now.getTime() - from.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(elapsed) < MINUTE
      ? [Math.round(elapsed / 1000), 'second']
      : Math.abs(elapsed) < HOUR
        ? [Math.round(elapsed / MINUTE), 'minute']
        : Math.abs(elapsed) < DAY
          ? [Math.round(elapsed / HOUR), 'hour']
          : [Math.round(elapsed / DAY), 'day'];

  // `Intl` says "in 5 minutes" for a positive value, so elapsed time is negated.
  return format.format(-value, unit);
}

/** "1.2s", "340ms" — a duration a reader can compare at a glance. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error('A duration must be a non-negative number of milliseconds');
  }
  if (milliseconds < 1000) return `${Math.round(milliseconds).toString()}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / MINUTE);
  const seconds = Math.round((milliseconds % MINUTE) / 1000);
  return `${minutes.toString()}m ${seconds.toString()}s`;
}
