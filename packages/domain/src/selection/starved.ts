import { type Area, type AreaKey, isRankable } from '../entities/area.js';
import type { Initiative, InitiativeStatus } from '../entities/initiative.js';
import type { UnderWayContext } from './index.js';
import { notUnderWay } from './index.js';

/**
 * Starved areas with nothing queued — the core loop with nothing to feed it.
 *
 * The balance factor lifts a starved area's initiatives (ADR-0005). An area
 * that is starved **and** holds no work has nothing for the lift to act on:
 * the factor sits at its height week after week and no ranking changes,
 * because there is nothing in the area to rank. The screens say so and point
 * at the one action that unblocks it — creating an initiative there — instead
 * of leaving the factor to read as a finding nobody can act on.
 *
 * This is a **nudge, never a write**: nothing is created, nothing is moved.
 */

/**
 * From this balance factor up, an area counts as starved for the nudge.
 *
 * The factor is `clamp(target ÷ observed, 0.5, 2)`, so 1.5 means the area has
 * received at most two thirds of its agreed share over the window — clearly
 * under, without waiting for the clamp's ceiling, where every area more than
 * twice under its share reads the same 2.00.
 */
export const STARVED_BALANCE_FACTOR = 1.5;

/**
 * The statuses that count as *something queued* for an area: anything a
 * person has not finished or let go of, and is not merely confirming.
 *
 * `inbox` counts — triaging it is the better advice than creating more —
 * and so do `now` and `waiting`, which are work already going. `review` does
 * not: its anchor was completed, and confirming it adds nothing to the queue.
 */
const QUEUED_STATUSES: ReadonlySet<InitiativeStatus> = new Set<InitiativeStatus>([
  'inbox',
  'later',
  'next',
  'now',
  'waiting',
]);

export interface StarvedArea {
  readonly areaKey: AreaKey;
  readonly balanceFactor: number;
}

/**
 * The rankable areas whose factor is at or above `STARVED_BALANCE_FACTOR` and
 * which hold no queued initiative **under way** (ADR-0035): an initiative that
 * may not start before a later day, or whose project is paused or closed, is
 * not something the lift can act on today, so it does not count as queued.
 *
 * Ordered by area key, so the same inputs always produce the same list.
 */
export function starvedWithNothingQueued(input: {
  readonly areas: readonly Area[];
  readonly capacity: readonly { readonly areaKey: AreaKey; readonly balanceFactor: number }[];
  readonly initiatives: readonly Initiative[];
  readonly underWay: UnderWayContext;
}): readonly StarvedArea[] {
  const queued = new Set<AreaKey>();
  for (const initiative of input.initiatives) {
    if (!QUEUED_STATUSES.has(initiative.status)) continue;
    if (notUnderWay(initiative, input.underWay) !== undefined) continue;
    queued.add(initiative.areaKey);
  }

  const factorOf = new Map(input.capacity.map((entry) => [entry.areaKey, entry.balanceFactor]));

  return input.areas
    .filter(isRankable)
    .map((area) => ({ areaKey: area.key, balanceFactor: factorOf.get(area.key) }))
    .filter(
      (entry): entry is StarvedArea =>
        entry.balanceFactor !== undefined &&
        entry.balanceFactor >= STARVED_BALANCE_FACTOR &&
        !queued.has(entry.areaKey),
    )
    .sort((a, b) => (a.areaKey < b.areaKey ? -1 : a.areaKey > b.areaKey ? 1 : 0));
}
