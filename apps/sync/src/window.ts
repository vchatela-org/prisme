/**
 * Whether a reconciler pass should run now.
 *
 * Pure, and takes `now` as a parameter — the same discipline `packages/domain`
 * is held to, for the same reason: a schedule decision nobody can reproduce in
 * a test is a schedule decision nobody can debug at 07:01.
 */

export interface WindowDecision {
  readonly shouldRun: boolean;
  readonly reason: 'in-window' | 'sync-disabled' | 'outside-window';
}

export interface WindowOptions {
  readonly enabled: boolean;
  /** Local hour, inclusive. */
  readonly windowStart: number;
  /** Local hour, exclusive. */
  readonly windowEnd: number;
  /** IANA zone. `TZ` drives the sync window and all day boundaries. */
  readonly timezone: string;
}

export function hourIn(timezone: string, now: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number.parseInt(formatted, 10);
}

export function shouldRunNow(options: WindowOptions, now: Date): WindowDecision {
  if (!options.enabled) return { shouldRun: false, reason: 'sync-disabled' };

  const hour = hourIn(options.timezone, now);
  const inWindow = hour >= options.windowStart && hour < options.windowEnd;
  return inWindow
    ? { shouldRun: true, reason: 'in-window' }
    : { shouldRun: false, reason: 'outside-window' };
}
