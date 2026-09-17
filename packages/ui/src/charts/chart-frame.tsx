'use client';

import { Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/button.js';
import { ErrorState, LoadingState } from '../primitives/states.js';

export interface LegendItem {
  label: string;
  /** A CSS colour — always a `var(--prisme-…)`, never a literal. */
  color: string;
  /** Legends mirror the mark: a rect for bars and areas, a line for lines. */
  shape?: 'rect' | 'line';
}

export interface ChartFrameProps {
  title: string;
  subtitle?: string;
  /**
   * The WCAG-clean twin, and **not optional**. Every chart in prisme has a
   * table behind it: it is the relief the light palette needs, the answer for
   * a screen reader, and the only way to read a value that would not fit
   * beside its mark.
   */
  tableView: ReactNode;
  /** The chart itself. Not rendered while loading, empty or failed. */
  children: ReactNode;
  legend?: readonly LegendItem[];
  loading?: boolean;
  /** A message, not an exception. Errors carry no secrets (CLAUDE.md §4). */
  error?: string;
  onRetry?: () => void;
  /** True when there is nothing to draw. The frame says so rather than the axes. */
  empty?: boolean;
  emptyMessage?: string;
  /** Shown under the chart — "one week of history" and similar caveats. */
  footnote?: string;
  className?: string;
}

/**
 * Every chart is wrapped in this.
 *
 * The awkward states are **handled here, once**: loading, error, nothing to
 * show, and the table view. Wave 4 has three agents rendering charts; if each
 * solves the empty state at its own call site, the dashboard reads as three
 * products — and one of them forgets.
 *
 * It renders a `<figure>` with a real `<figcaption>`, so the chart has a name
 * in the accessibility tree rather than being an unlabelled image of a graph.
 */
export function ChartFrame({
  title,
  subtitle,
  tableView,
  children,
  legend,
  loading = false,
  error,
  onRetry,
  empty = false,
  emptyMessage = 'No data for this period yet.',
  footnote,
  className,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border-hairline bg-surface-raised p-4',
        className,
      )}
    >
      <figcaption className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {subtitle ? <span className="text-xs text-ink-secondary">{subtitle}</span> : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          aria-pressed={showTable}
          onClick={() => {
            setShowTable((current) => !current);
          }}
          className="h-7 shrink-0 px-2 text-xs"
        >
          <Table2 />
          {showTable ? 'Chart' : 'Table'}
        </Button>
      </figcaption>

      {legend && legend.length > 1 && !showTable ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0',
                  item.shape === 'line' ? 'h-0.5 w-4 rounded-full' : 'size-2.5 rounded-sm',
                )}
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <LoadingState rows={4} label={`Loading ${title}`} />
      ) : error !== undefined ? (
        <ErrorState
          title="This chart could not be drawn"
          description="The data behind it did not load."
          detail={error}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : showTable ? (
        <div className="overflow-x-auto">{tableView}</div>
      ) : empty ? (
        <p className="px-2 py-10 text-center text-sm text-ink-secondary">{emptyMessage}</p>
      ) : (
        children
      )}

      {footnote ? <p className="text-xs text-ink-muted">{footnote}</p> : null}
    </figure>
  );
}

/** The table twin's shell, so every chart's table looks like every other. */
export function ChartTable({
  head,
  children,
  caption,
}: {
  head: readonly string[];
  children: ReactNode;
  caption: string;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border-hairline">
          {head.map((cell, index) => (
            <th
              key={cell}
              scope="col"
              className={cn(
                'px-2 py-1.5 font-medium text-ink-secondary',
                index === 0 ? 'text-left' : 'text-right',
              )}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
