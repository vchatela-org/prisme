/**
 * The arithmetic behind `<BalanceMeter>`, kept separate so it can be tested
 * without rendering anything.
 *
 * ## Why the meter is scaled to the target rather than to 100%
 *
 * An area on 5% and an area on 30% are both "on target" when they get their
 * agreed share, and a reader scanning six rows wants to see that at a glance.
 * On a 0–100% track the 5% area is a sliver and the 30% area is a third of the
 * bar, so the two look nothing alike even when both are exactly right.
 *
 * So the track is **0 to twice the target**, with the target at the midpoint.
 * Every area that is on its agreed share fills half its bar, whatever the
 * share is, and the eye compares positions instead of doing division. The 2×
 * ceiling is not arbitrary either: it is the clamp the balance factor already
 * uses (`clamp(target / actual, 0.5, 2)`, docs/10-model.md §3).
 *
 * Nothing here computes a balance factor. That belongs to `packages/domain`
 * and arrives from the API — a second implementation in the browser is how the
 * two end up disagreeing in front of the reader.
 */

export type BalanceTone = 'starved' | 'on-target' | 'over-served' | 'unscaled';

export interface BalanceReading {
  /** observed ÷ target, or `null` when there is no target to divide by. */
  readonly ratio: number | null;
  /** Where the fill ends, 0–100, already clamped to the track. */
  readonly fillPct: number;
  /** Whether the fill reached the end of the track and was cut off. */
  readonly clamped: boolean;
  readonly tone: BalanceTone;
}

/** Inside this band either way, an area counts as being on its share. */
const ON_TARGET_BAND = 0.2;

/** The track ends at twice the target — the same ceiling as the clamp. */
const TRACK_MAX_RATIO = 2;

export function balanceReading(targetPct: number, observedPct: number): BalanceReading {
  if (!Number.isFinite(targetPct) || !Number.isFinite(observedPct)) {
    throw new Error('balanceReading needs two finite percentages');
  }
  if (observedPct < 0 || targetPct < 0) {
    throw new Error('A share cannot be negative');
  }

  // A lane has a budget in hours, not a share (docs/10-model.md §3), so there
  // is nothing to be on target with. Show what it took, and say nothing about
  // whether that was right.
  if (targetPct === 0) {
    return {
      ratio: null,
      fillPct: Math.min(observedPct, 100),
      clamped: observedPct > 100,
      tone: 'unscaled',
    };
  }

  const ratio = observedPct / targetPct;
  const fillPct = Math.min(ratio / TRACK_MAX_RATIO, 1) * 100;

  return {
    ratio,
    fillPct,
    clamped: ratio > TRACK_MAX_RATIO,
    tone:
      ratio < 1 - ON_TARGET_BAND
        ? 'starved'
        : ratio > 1 + ON_TARGET_BAND
          ? 'over-served'
          : 'on-target',
  };
}

/** The sentence under the meter. Says the direction in words, not in colour. */
export function balanceSummary(targetPct: number, observedPct: number): string {
  const { ratio, tone } = balanceReading(targetPct, observedPct);
  const observed = `${observedPct.toFixed(1)}%`;

  if (ratio === null) return `${observed} of capacity, no agreed share`;

  const target = `${targetPct.toFixed(0)}%`;
  switch (tone) {
    case 'on-target':
      return `${observed} against ${target} — on its agreed share`;
    case 'starved':
      return `${observed} against ${target} — starved`;
    case 'over-served':
      return `${observed} against ${target} — over-served`;
    /* c8 ignore next 2 — `unscaled` is returned only when ratio is null. */
    default:
      return `${observed} against ${target}`;
  }
}
