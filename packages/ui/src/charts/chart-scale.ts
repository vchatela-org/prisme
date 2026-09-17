/**
 * The arithmetic every chart shares: domains, round tick values, pixel
 * mapping, path building and nearest-point lookup.
 *
 * It is separate from the components for the usual reason — this is where the
 * off-by-one errors live, and here they can be tested without a browser. It is
 * also why prisme draws its own SVG rather than pulling in a charting library:
 * the `dataviz` mark specs (a 2px surface gap between bars, a 4px rounded data
 * end square at the baseline, hairline solid gridlines) are all things a
 * library would have to be fought for, and the awkward states — empty,
 * loading, error, one data point — have to be handled in the wrapper anyway.
 */

export interface Scale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

/** Maps a value onto pixels. A zero-width domain maps everything to the start. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  const scale = (value: number): number =>
    span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0);

  return Object.assign(scale, { domain, range });
}

/**
 * Round tick values covering the data — 0, 5, 10 rather than 0, 4.7, 9.4.
 *
 * The axis carries the values that are not directly labelled, so the numbers
 * on it have to be ones a reader can hold in their head.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('niceTicks needs a finite range');
  }
  if (count < 2) throw new Error('niceTicks needs at least two ticks');

  if (min === max) return [min];

  // Divided by `count`, not `count - 1`: the step is then rounded *up* to a
  // nice number, which costs a tick or two, so aiming slightly small lands on
  // roughly the count that was asked for. (0–100 in 5: a raw step of 25 snaps
  // to 50 and gives three ticks; a raw step of 20 snaps to 20 and gives six.)
  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Guard against floating point leaving the last tick just outside.
  for (let tick = first; tick <= max + step * 1e-9; tick += step) {
    // Re-round each tick: accumulating a float step drifts (0.30000000000000004).
    ticks.push(Number((Math.round(tick / step) * step).toPrecision(12)));
  }
  return ticks;
}

/**
 * A domain that starts at zero for bars.
 *
 * Non-negotiable for a length encoding: a bar chart whose axis starts at 40
 * triples a 10% difference, which is the oldest way to mislead with a chart.
 */
export function zeroBasedDomain(values: readonly number[]): [number, number] {
  const max = values.length === 0 ? 0 : Math.max(...values);
  return [Math.min(0, ...values), max === 0 ? 1 : max];
}

/**
 * A padded domain for a line, which may legitimately not include zero — a
 * trend between 60 and 64 flattens into a straight line on a zero axis.
 */
export function paddedDomain(values: readonly number[], padding = 0.1): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    // One value, or a flat series: give it room so the line sits mid-height
    // instead of on the floor.
    const margin = Math.abs(min) * padding || 1;
    return [min - margin, max + margin];
  }
  const margin = (max - min) * padding;
  return [min - margin, max + margin];
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A polyline through the points. Straight segments, not a spline: a curve
 * through measured points invents values between them that were never
 * observed.
 */
export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)},${round(point.y)}`)
    .join(' ');
}

/** The area under a line, closed onto a baseline. */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  /* c8 ignore next — unreachable: length was checked above. */
  if (!first || !last) return '';
  return `${linePath(points)} L${round(last.x)},${round(baseline)} L${round(first.x)},${round(baseline)} Z`;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * The index of the position closest to `x`. This is what lets a crosshair
 * snap: a reader aims at a date, never at a 2px line.
 */
export function nearestIndex(positions: readonly number[], x: number): number {
  if (positions.length === 0) return -1;

  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, position] of positions.entries()) {
    const distance = Math.abs(position - x);
    // Strictly less than, so a tie keeps the earlier point — otherwise the
    // crosshair jitters between two equidistant positions.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * A bar with a **4px rounded data-end and a square baseline** — the mark spec,
 * which no rectangle primitive can express (`rx` rounds all four corners and
 * detaches the bar from its own axis).
 *
 * `length` is measured from the baseline, so a zero-length bar is an empty
 * path rather than a stub of pure radius sitting on the axis pretending to be
 * a value.
 */
export function barPath(
  baseline: number,
  crossStart: number,
  length: number,
  thickness: number,
  direction: 'right' | 'up',
  radius = 4,
): string {
  if (length <= 0 || thickness <= 0) return '';
  const r = Math.min(radius, length, thickness / 2);

  if (direction === 'right') {
    const x0 = baseline;
    const x1 = baseline + length;
    const y0 = crossStart;
    const y1 = crossStart + thickness;
    return [
      `M${n(x0)},${n(y0)}`,
      `H${n(x1 - r)}`,
      `Q${n(x1)},${n(y0)} ${n(x1)},${n(y0 + r)}`,
      `V${n(y1 - r)}`,
      `Q${n(x1)},${n(y1)} ${n(x1 - r)},${n(y1)}`,
      `H${n(x0)}`,
      'Z',
    ].join(' ');
  }

  const y0 = baseline;
  const y1 = baseline - length;
  const x0 = crossStart;
  const x1 = crossStart + thickness;
  return [
    `M${n(x0)},${n(y0)}`,
    `V${n(y1 + r)}`,
    `Q${n(x0)},${n(y1)} ${n(x0 + r)},${n(y1)}`,
    `H${n(x1 - r)}`,
    `Q${n(x1)},${n(y1)} ${n(x1)},${n(y1 + r)}`,
    `V${n(y0)}`,
    'Z',
  ].join(' ');
}

function n(value: number): string {
  return round(value);
}

/**
 * The thickness of one bar in a band, capped.
 *
 * The cap is a mark spec, not a preference: a bar that fills its slot makes
 * the chart a wall of colour, and the leftover is meant to be air.
 */
export function barThickness(bandSize: number, seriesCount: number, max = 24): number {
  const gap = 2; // the surface gap, in the surface colour
  const available = (bandSize * 0.7 - gap * (seriesCount - 1)) / seriesCount;
  return Math.max(2, Math.min(available, max));
}
