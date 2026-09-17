import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { linearScale, linePath, paddedDomain } from './chart-scale.js';

export interface StatTileProps {
  /** Sentence case, no trailing colon. */
  label: string;
  value: string;
  /** Change against a named period — "vs last month". Optional. */
  delta?: {
    value: string;
    direction: 'up' | 'down' | 'flat';
    /** Whether up is the good direction. Throughput yes; overdue no. */
    goodDirection?: 'up' | 'down';
    period: string;
  };
  /** A short history. Twelve points is the shape this was drawn for. */
  trend?: readonly number[];
  /** Renders at hero size. Exactly one per view. */
  hero?: boolean;
  className?: string;
}

/**
 * A number is not a chart.
 *
 * A single current value with maybe a trend is a stat tile — a one-bar bar
 * chart with axes and a legend is the most common way a dashboard misses its
 * own point. The value uses the font's proportional figures rather than
 * `tabular-nums`: equal-width digits make `121` look loose at display sizes,
 * and nothing here has to line up vertically.
 */
export function StatTile({ label, value, delta, trend, hero = false, className }: StatTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border-hairline bg-surface-raised p-4',
        className,
      )}
    >
      <span className="text-xs text-ink-secondary">{label}</span>
      <span className={cn('font-semibold text-ink', hero ? 'text-hero leading-tight' : 'text-2xl')}>
        {value}
      </span>

      {delta ? <Delta {...delta} /> : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
    </div>
  );
}

/**
 * Direction is carried by an arrow and by the word, and only *then* by colour —
 * "up" is not universally good, so the tile has to be told which way is which.
 */
function Delta({
  value,
  direction,
  goodDirection = 'up',
  period,
}: NonNullable<StatTileProps['delta']>) {
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : ArrowRight;
  const good = direction === 'flat' ? null : direction === goodDirection;

  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs',
        good === null ? 'text-ink-secondary' : good ? 'text-ink-success' : 'text-status-critical',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="tabular-nums">{value}</span>
      <span className="text-ink-secondary">{period}</span>
    </span>
  );
}

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 28;

/**
 * Twelve points of context, in the de-emphasis ink with the current value in
 * the accent. No axes, no labels: a sparkline is a shape, and the number above
 * it is the value.
 */
function Sparkline({ values }: { values: readonly number[] }) {
  const domain = paddedDomain(values, 0.15);
  const y = linearScale(domain, [SPARK_HEIGHT - 3, 3]);
  const step = SPARK_WIDTH / (values.length - 1);
  const points = values.map((value, index) => ({ x: index * step, y: y(value) }));
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${String(SPARK_WIDTH)} ${String(SPARK_HEIGHT)}`}
      className="mt-1 h-7 w-full"
      aria-hidden="true"
    >
      <path
        d={linePath(points)}
        fill="none"
        stroke="var(--prisme-ink-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          fill="var(--prisme-accent)"
          stroke="var(--prisme-surface-raised)"
          strokeWidth={2}
        />
      ) : null}
    </svg>
  );
}

/** A row of stat tiles — the standard way a dashboard opens. */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
  );
}
