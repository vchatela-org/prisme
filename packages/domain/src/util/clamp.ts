/**
 * Bounds a value, and decides the two non-finite cases rather than letting them
 * leak into a ranking.
 *
 * Both are reachable in the balance factor, which is `target ÷ observed`:
 *
 * - **`Infinity`** — an area with a target share and no observed work at all.
 *   Clamping to the ceiling is exactly right: that is the most starved an area
 *   can be, and lifting it is the whole purpose of the factor.
 * - **`NaN`** — `0 ÷ 0`, an area deliberately given a 0% share that also did
 *   nothing. It clamps to the floor, because an area allocated nothing should
 *   not be promoted by the absence of evidence.
 *
 * `Math.min`/`Math.max` propagate `NaN`, and a `NaN` score sorts unpredictably
 * and renders as a zero. Neither failure is loud.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
