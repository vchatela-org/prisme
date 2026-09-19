/**
 * The time axis: dates to pixels, and back again for a drag.
 *
 * ## This is geometry, not scheduling
 *
 * `apps/web/CLAUDE.md` non-negotiable 1 forbids computing a date in the
 * browser, and nothing here does. Every date this module takes is one the API
 * already decided — an `earliestStart`, a `plannedEnd`, a `deadline` — and all
 * it does is place that date along a ruler. The one direction that produces a
 * date is {@link dateOfDay}, which turns a cursor position into the start a
 * human is *asking for*. That is an input to the replan, exactly like typing a
 * date into a box, and the answer still comes from the API. A requested start
 * and a planned start are different things, and the preview shows the gap
 * between them whenever the plan refuses the request.
 *
 * ## Why day numbers rather than a date library
 *
 * A calendar date in prisme is `YYYY-MM-DD` and means a whole day in UTC
 * (`packages/domain/src/entities/calendar.ts`). Converting one to a day number
 * through `Date.UTC` is exact — there is no hour to lose to a daylight-saving
 * transition, which is the trap W02's notes call out for the engine and which
 * applies here for the same reason. The axis therefore works in integers and
 * formats only at the tick.
 */

const MS_PER_DAY = 86_400_000;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Weeks to a year, as the brief asks for. */
export type Zoom = 'week' | 'month' | 'quarter' | 'year';

export const ZOOMS: readonly Zoom[] = ['week', 'month', 'quarter', 'year'];

export const ZOOM_LABELS: Readonly<Record<Zoom, string>> = {
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
  year: 'Year',
};

/** Pixels one day occupies, per zoom. */
export const DAY_WIDTH: Readonly<Record<Zoom, number>> = {
  week: 22,
  month: 7,
  quarter: 3,
  year: 1.4,
};

/**
 * How far one keyboard nudge moves, in days.
 *
 * Tied to the zoom because a nudge should be visible: one day at the year zoom
 * is 1.4 pixels, which reads as nothing happening.
 */
export const NUDGE_DAYS: Readonly<Record<Zoom, number>> = {
  week: 1,
  month: 7,
  quarter: 7,
  year: 28,
};

/**
 * The closest two tick labels may sit, in pixels.
 *
 * W09 found both halves of this the hard way on the KPI charts: a label drawn
 * next to its neighbour overprints it, and a label centred on the plot's right
 * edge is clipped by the viewBox — `Sep 26` rendered as `Sep 2(`. Thinning is
 * therefore a rule over the whole tick list rather than a per-tick decision.
 */
const MIN_LABEL_GAP = 52;

/** Half a label's width, used to keep the last one inside the plot. */
const LABEL_HALF_WIDTH = 22;

export interface Tick {
  readonly day: number;
  readonly x: number;
  /** Absent when thinning dropped it; the gridline is still drawn. */
  readonly label: string | null;
  /** A month boundary at this zoom, drawn one shade stronger. */
  readonly major: boolean;
}

export interface Scale {
  readonly zoom: Zoom;
  readonly dayWidth: number;
  /** Day number at x = 0. */
  readonly originDay: number;
  readonly days: number;
  readonly width: number;
  readonly ticks: readonly Tick[];
  /** Where today sits, or `null` when the plan does not cover it. */
  readonly todayX: number | null;
}

/** Days since the Unix epoch, in UTC. Exact for a whole-day date. */
export function dayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** The inverse, as `YYYY-MM-DD`. */
export function dateOfDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, signed. Calendar days, not working days. */
export function daysBetween(from: string, to: string): number {
  return dayOf(to) - dayOf(from);
}

/** `0` is Sunday, matching `Date.prototype.getUTCDay` and the schedule config. */
function weekdayOf(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCDay();
}

export function isWeekend(day: number): boolean {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

function monthLabel(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  const month = MONTHS[date.getUTCMonth()] ?? '';
  return date.getUTCMonth() === 0 ? `${month} ${String(date.getUTCFullYear())}` : month;
}

function dayLabel(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** The first of the month on or after `day`. */
function monthStartOnOrAfter(day: number): number {
  const date = new Date(day * MS_PER_DAY);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / MS_PER_DAY;
  if (start === day) return day;
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / MS_PER_DAY);
}

/** The Monday on or after `day`. */
function mondayOnOrAfter(day: number): number {
  const weekday = weekdayOf(day);
  return day + ((8 - weekday) % 7);
}

/**
 * Drop the labels that would collide, keeping the gridlines.
 *
 * Three things can make a label unreadable, and all three are properties of the
 * *list* rather than of one tick, which is why this is a pass over the whole
 * thing rather than a decision at each `<text>`:
 *
 * 1. **A neighbour too close.** The label overprints the one before it.
 * 2. **An edge.** A label is centred on its tick, so half of it hangs off the
 *    plot at either end and the browser clips it — `Sep 26` rendered as
 *    `Sep 2(`, which is how W09 found this on the KPI charts. Both ends: the
 *    first version of this function guarded only the right, and the left edge
 *    then clipped the opening month the first time the page was opened.
 * 3. **The today marker**, which has its own label in the same band. Nothing
 *    about a tick knows that, so the marker's position is passed in.
 *
 * The first *surviving* label is always kept where it fits — an axis whose
 * opening tick is bare reads as though the plan starts somewhere unnamed.
 */
export function thinLabels(
  ticks: readonly Tick[],
  width: number,
  minGap = MIN_LABEL_GAP,
  todayX: number | null = null,
): readonly Tick[] {
  let lastLabelled = Number.NEGATIVE_INFINITY;
  return ticks.map((tick) => {
    const insidePlot = tick.x - LABEL_HALF_WIDTH >= 0 && tick.x + LABEL_HALF_WIDTH <= width;
    const clearOfNeighbour =
      lastLabelled === Number.NEGATIVE_INFINITY || tick.x - lastLabelled >= minGap;
    // `today` is a short word and sits to the right of its rule, so it needs
    // less room than a tick's own half-width on that side.
    const clearOfToday = todayX === null || Math.abs(tick.x - todayX) >= minGap;

    if (insidePlot && clearOfNeighbour && clearOfToday) {
      lastLabelled = tick.x;
      return tick;
    }
    return { ...tick, label: null };
  });
}

export interface ScaleInput {
  /** The plan's first day, `YYYY-MM-DD`. */
  readonly from: string;
  /** The plan's last day. */
  readonly to: string;
  readonly zoom: Zoom;
  /** Today, so the axis can mark it. Passed in — this module has no clock. */
  readonly today?: string | undefined;
  /** Blank days kept on each side, so a bar is never flush with the edge. */
  readonly padDays?: number;
}

export function buildScale({ from, to, zoom, today, padDays = 7 }: ScaleInput): Scale {
  const dayWidth = DAY_WIDTH[zoom];
  const originDay = dayOf(from) - padDays;
  // At least one day, so a plan holding a single one-day initiative still has
  // a plot to draw in rather than a zero-width one.
  const days = Math.max(1, dayOf(to) + padDays - originDay + 1);
  const width = days * dayWidth;

  const xOfDay = (day: number): number => (day - originDay) * dayWidth;

  const raw: Tick[] = [];
  if (zoom === 'week') {
    for (let day = mondayOnOrAfter(originDay); day < originDay + days; day += 7) {
      raw.push({
        day,
        x: xOfDay(day),
        label: dayLabel(day),
        major: new Date(day * MS_PER_DAY).getUTCDate() <= 7,
      });
    }
  } else {
    for (
      let day = monthStartOnOrAfter(originDay);
      day < originDay + days;
      day = monthStartOnOrAfter(day + 1)
    ) {
      raw.push({ day, x: xOfDay(day), label: monthLabel(day), major: true });
    }
  }

  const todayDay = today === undefined ? null : dayOf(today);
  const todayX =
    todayDay === null || todayDay < originDay || todayDay > originDay + days
      ? null
      : xOfDay(todayDay);

  return {
    zoom,
    dayWidth,
    originDay,
    days,
    width,
    ticks: thinLabels(raw, width, MIN_LABEL_GAP, todayX),
    todayX,
  };
}

/** Where a date sits on the plot. */
export function xOf(scale: Scale, date: string): number {
  return (dayOf(date) - scale.originDay) * scale.dayWidth;
}

/**
 * How wide a bar from `start` to `end` is.
 *
 * Inclusive of both ends: a one-day initiative is one day wide, not zero. The
 * floor keeps a bar visible at the year zoom, where one day is 1.4 pixels and
 * a two-day slice would otherwise vanish.
 */
export function widthOf(scale: Scale, start: string, end: string): number {
  const days = Math.max(1, dayOf(end) - dayOf(start) + 1);
  return Math.max(3, days * scale.dayWidth);
}
