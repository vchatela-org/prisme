'use client';

import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import type { AreaKind } from '../tokens/area-color.js';
import { useAreaColorVar } from './area-color-context.js';
import { balanceReading, balanceSummary, type BalanceTone } from './balance-meter-core.js';

export interface BalanceMeterProps {
  areaKey: string;
  name: string;
  kind?: AreaKind;
  /** The agreed share for the year, as a percentage. 0 for a lane. */
  targetPct: number;
  /** What the area actually received over the window, as a percentage. */
  observedPct: number;
  /** Marks the reading as computed from weights carried from an earlier year. */
  stale?: boolean;
  className?: string;
}

const TONE_ICON: Record<BalanceTone, ReactNode> = {
  starved: <ArrowDown className="size-3" />,
  'over-served': <ArrowUp className="size-3" />,
  'on-target': <Check className="size-3" />,
  unscaled: null,
};

/**
 * Declared versus observed capacity for one area — the view that exists
 * nowhere else in the stack, and the reason prisme allocates before it ranks.
 *
 * ## Two deliberate departures from the chart conventions
 *
 * The `dataviz` meter spec has the fill carry severity (accent → warning →
 * danger). Here the fill carries the **area's own colour** instead, because
 * these meters are read as a stacked list of six areas: repainting a row by
 * how well it is doing would mean the same area changes colour week to week,
 * which is the recolour-on-filter anti-pattern wearing a different hat. The
 * severity is carried by an arrow, a word and the number — three channels,
 * none of them hue.
 *
 * The track is 0 to twice the target rather than 0–100%, so every area that is
 * on its share fills exactly half its bar regardless of how big the share is.
 * The reasoning is in `balance-meter-core.ts`.
 */
export function BalanceMeter({
  areaKey,
  name,
  kind = 'area',
  targetPct,
  observedPct,
  stale = false,
  className,
}: BalanceMeterProps) {
  const color = useAreaColorVar(areaKey, kind);
  const reading = balanceReading(targetPct, observedPct);
  const summary = balanceSummary(targetPct, observedPct);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm text-ink">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          {name}
        </span>
        <span className="flex items-center gap-1 text-xs text-ink-secondary tabular-nums">
          {TONE_ICON[reading.tone]}
          {observedPct.toFixed(1)}%
          {reading.ratio === null ? null : (
            <span className="text-ink-muted">/ {targetPct.toFixed(0)}%</span>
          )}
        </span>
      </div>

      {/*
        A progressbar rather than a div with a width: a screen reader gets the
        value, the range and the summary instead of a decorative rectangle.
      */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(reading.fillPct)}
        aria-valuetext={stale ? `${summary} (carried weights)` : summary}
        aria-label={name}
        className="relative h-2 w-full overflow-hidden rounded-full bg-surface-page ring-1 ring-border-hairline ring-inset"
      >
        <div
          className="h-full rounded-full transition-[width] duration-[var(--prisme-duration-normal)]"
          style={{ width: `${reading.fillPct.toFixed(2)}%`, backgroundColor: color }}
        />

        {/*
          The target tick. It sits at the midpoint by construction, and it is
          drawn in ink rather than in a status colour so it reads as a
          reference line rather than as a verdict.
        */}
        {reading.ratio === null ? null : (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-chart-baseline"
          />
        )}
      </div>

      <p className="text-xs text-ink-secondary">
        {summary}
        {reading.clamped ? ' — beyond the end of the scale' : ''}
        {stale ? ' · carried weights' : ''}
      </p>
    </div>
  );
}
