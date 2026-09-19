import {
  colorSlotClass,
  colorSlotVar,
  type ColorVar,
  type SeriesSlot,
} from '../tokens/area-color.js';
import { CATEGORICAL_SLOT_COUNT } from '../tokens/palette.js';

/** Eight. Not a soft limit — there is no ninth hue to reach for. */
export const SERIES_LIMIT = CATEGORICAL_SLOT_COUNT;

/**
 * The colour for the *n*th series of a chart, 0-based.
 *
 * Assignment is in fixed order and never cycles. Past the eighth series this
 * throws rather than wrapping around, because a repeated hue is worse than a
 * missing chart: the reader has no way to know that two identical colours mean
 * two different things. The fix is always one of the three the skill names —
 * fold the tail into "Other", facet into small multiples, or encode with
 * something other than hue.
 *
 * Chart components catch this and render their error state, so a ninth series
 * is a visible, explained failure rather than a crash.
 */
export function seriesSlot(index: number): SeriesSlot {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`A series index must be a non-negative integer, got ${String(index)}`);
  }
  if (index >= SERIES_LIMIT) {
    throw new Error(
      `${String(index + 1)} series: the palette has ${String(SERIES_LIMIT)} slots and a ninth ` +
        `hue is indistinguishable from one already on screen. Fold the tail into "Other", ` +
        `facet into small multiples, or encode with shape as well as colour.`,
    );
  }
  return (index + 1) as SeriesSlot;
}

/** The value an SVG mark paints with. */
export function seriesVar(index: number): ColorVar {
  return colorSlotVar(seriesSlot(index));
}

/** The class an HTML mark — a legend swatch, a tooltip key — paints with. */
export function seriesClass(index: number): string {
  return colorSlotClass(seriesSlot(index));
}
