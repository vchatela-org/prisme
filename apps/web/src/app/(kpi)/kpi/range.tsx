import { Card } from '@prisme/ui';
import Link from 'next/link';
import { monthsBefore } from '@/lib/kpi-view';

/**
 * The window the dashboard is drawn over.
 *
 * Plain links rather than a client-side control: the range is in the URL, so
 * it survives a reload, can be bookmarked, and works before any JavaScript
 * runs. `interaction.md` in the `dataviz` skill wants filters in one row above
 * the charts, which is what this is — it does not require them to be
 * stateful widgets.
 */

export interface KpiRange {
  readonly from: string;
  readonly to: string;
  readonly bucket: 'week' | 'month';
  readonly label: string;
}

const PRESETS = [
  { id: '12w', months: 3, bucket: 'week' as const, label: 'Last 12 weeks' },
  { id: '12m', months: 12, bucket: 'month' as const, label: 'Last 12 months' },
  { id: '36m', months: 36, bucket: 'month' as const, label: 'Last 3 years' },
];

const DEFAULT_PRESET = '12m';

/**
 * Resolve a range from the query string, falling back to the default.
 *
 * `to` is always today: a dashboard of a window that ended last Tuesday is a
 * report, and this is meant to be read on the way into a review.
 */
export function resolveRange(preset: string | undefined, today: Date): KpiRange & { id: string } {
  const chosen =
    PRESETS.find((p) => p.id === preset) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET);
  /* c8 ignore next — DEFAULT_PRESET is one of PRESETS by construction. */
  if (chosen === undefined) throw new Error('kpi: no default range preset');

  const to = today.toISOString().slice(0, 10);
  return {
    id: chosen.id,
    from: monthsBefore(to, chosen.months),
    to,
    bucket: chosen.bucket,
    label: chosen.label,
  };
}

export function RangePicker({ active }: { active: string }) {
  return (
    <Card className="flex flex-wrap items-center gap-2 p-2">
      <span className="px-2 text-xs text-ink-secondary">Window</span>
      {PRESETS.map((preset) => (
        <Link
          key={preset.id}
          href={`/kpi?range=${preset.id}`}
          aria-current={preset.id === active ? 'page' : undefined}
          className={
            preset.id === active
              ? 'rounded-md bg-surface-page px-3 py-1.5 text-sm font-medium text-ink'
              : 'rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:text-ink'
          }
        >
          {preset.label}
        </Link>
      ))}
    </Card>
  );
}
