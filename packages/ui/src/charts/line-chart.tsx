'use client';

import { useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { ChartFrame, ChartTable, type ChartFrameProps } from './chart-frame.js';
import {
  colorSlotClass,
  colorSlotVar,
  type ColorSlot,
  type ColorVar,
} from '../tokens/area-color.js';
import { linearScale, linePath, nearestIndex, niceTicks, paddedDomain } from './chart-scale.js';
import { SERIES_LIMIT, seriesSlot } from './series.js';

export interface LineSeries {
  label: string;
  /** `null` is a gap in the record, not a zero. It breaks the line. */
  values: readonly (number | null)[];
  /**
   * Overrides the categorical slot for this line — an area's slot, so the line
   * matches its badge. A slot rather than a colour: the line is an SVG
   * `stroke` and its legend key is a class, and both derive from this one
   * value (`tokens/area-color.ts`).
   */
  slot?: ColorSlot;
}

export interface LineChartProps extends Omit<
  ChartFrameProps,
  'children' | 'tableView' | 'legend' | 'empty'
> {
  /** One label per x position — a week, a month. */
  labels: readonly string[];
  series: readonly LineSeries[];
  format?: (value: number) => string;
}

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 12, right: 16, bottom: 28, left: 44 };

/**
 * A trend over time.
 *
 * Three behaviours are the wrapper's job and are handled here rather than at
 * every call site:
 *
 *  - **One data point** draws a dot, not a line. A single measurement has no
 *    trend, and a line of length zero renders as nothing at all.
 *  - **A short history** still draws, with a footnote the caller can set —
 *    hiding a two-week chart is how a new instance looks broken.
 *  - **A gap** (`null`) breaks the line instead of interpolating across it.
 *    Drawing through a missing week invents a measurement.
 *
 * There is deliberately **no second y-axis**. Two measures of different scale
 * are two charts, or one chart indexed to a common base: a dual axis invents a
 * correlation by choosing where the two scales happen to line up.
 */
export function LineChart({ labels, series, format, ...frame }: LineChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const formatValue = format ?? ((value: number) => value.toFixed(1));

  if (series.length > SERIES_LIMIT) {
    return (
      <ChartFrame
        {...frame}
        error={`${String(series.length)} series: the palette holds ${String(SERIES_LIMIT)}. Facet into small multiples instead.`}
        tableView={null}
      >
        {null}
      </ChartFrame>
    );
  }

  const present = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const domain = paddedDomain(present);
  const y = linearScale(domain, [HEIGHT - PADDING.bottom, PADDING.top]);
  const plotLeft = PADDING.left;
  const plotRight = WIDTH - PADDING.right;
  const step = labels.length > 1 ? (plotRight - plotLeft) / (labels.length - 1) : 0;
  const xAt = (index: number): number =>
    labels.length > 1 ? plotLeft + index * step : (plotLeft + plotRight) / 2;
  const positions = labels.map((_, index) => xAt(index));
  const ticks = niceTicks(domain[0], domain[1], 4);

  const slotFor = (line: LineSeries, index: number): ColorSlot => line.slot ?? seriesSlot(index);
  const colorFor = (line: LineSeries, index: number): ColorVar =>
    colorSlotVar(slotFor(line, index));

  const tableView = (
    <ChartTable
      head={['Period', ...series.map((s) => s.label)]}
      caption={`${frame.title}, as a table`}
    >
      {labels.map((label, index) => (
        <tr key={label} className="border-b border-border-hairline last:border-0">
          <th scope="row" className="px-2 py-1.5 text-left font-normal text-ink">
            {label}
          </th>
          {series.map((line) => {
            const value = line.values[index];
            return (
              <td key={line.label} className="px-2 py-1.5 text-right text-ink tabular-nums">
                {value === null || value === undefined ? '—' : formatValue(value)}
              </td>
            );
          })}
        </tr>
      ))}
    </ChartTable>
  );

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    // The pointer is in CSS pixels; the plot is in viewBox units.
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    setActive(nearestIndex(positions, x));
  };

  return (
    <ChartFrame
      {...frame}
      empty={present.length === 0}
      tableView={tableView}
      legend={series.map((line, index) => ({
        label: line.label,
        colorClass: colorSlotClass(slotFor(line, index)),
        shape: 'line',
      }))}
    >
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${frame.title}. The same values are available as a table.`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            setActive(null);
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--prisme-chart-gridline)"
                strokeWidth={1}
              />
              <text
                x={plotLeft - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--prisme-ink-secondary)"
                className="tabular-nums"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}

          {/* The crosshair finds the x: readers aim at a period, not at a line. */}
          {active !== null ? (
            <line
              x1={xAt(active)}
              x2={xAt(active)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="var(--prisme-chart-baseline)"
              strokeWidth={1}
            />
          ) : null}

          {series.map((line, index) => {
            const color = colorFor(line, index);
            // A gap splits the series into runs, so the line breaks rather
            // than stepping across a week nobody measured.
            const runs: { x: number; y: number }[][] = [];
            let run: { x: number; y: number }[] = [];
            for (const [i, value] of line.values.entries()) {
              if (value === null) {
                if (run.length > 0) runs.push(run);
                run = [];
                continue;
              }
              run.push({ x: xAt(i), y: y(value) });
            }
            if (run.length > 0) runs.push(run);

            return (
              <g key={line.label}>
                {runs.map((points, runIndex) =>
                  points.length === 1 ? (
                    // One point is a dot. A path of a single point draws
                    // nothing, which reads as "no data" rather than "one week".
                    <circle
                      key={runIndex}
                      cx={points[0]?.x}
                      cy={points[0]?.y}
                      r={4}
                      fill={color}
                      stroke="var(--prisme-surface-raised)"
                      strokeWidth={2}
                    />
                  ) : (
                    <path
                      key={runIndex}
                      d={linePath(points)}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ),
                )}

                {/* The end marker, with its 2px surface ring. */}
                {(() => {
                  const last = runs[runs.length - 1]?.at(-1);
                  return last && runs.length > 0 && (runs.at(-1)?.length ?? 0) > 1 ? (
                    <circle
                      cx={last.x}
                      cy={last.y}
                      r={4}
                      fill={color}
                      stroke="var(--prisme-surface-raised)"
                      strokeWidth={2}
                    />
                  ) : null;
                })()}

                {active !== null && line.values[active] != null ? (
                  <circle
                    cx={xAt(active)}
                    cy={y(line.values[active])}
                    r={4}
                    fill={color}
                    stroke="var(--prisme-surface-raised)"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}

          <line
            x1={plotLeft}
            x2={plotRight}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            stroke="var(--prisme-chart-baseline)"
            strokeWidth={1}
          />

          {labels.map((label, index) =>
            // Thin the labels rather than overlapping them.
            index % Math.ceil(labels.length / 8) === 0 || index === labels.length - 1 ? (
              <text
                key={label}
                x={xAt(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--prisme-ink-secondary)"
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>

        {/* One tooltip, every series — the pointer never has to find a line. */}
        {active !== null ? (
          <div
            role="status"
            className={cn(
              'pointer-events-none absolute top-0 right-0 flex min-w-32 flex-col gap-1 rounded-md',
              'border border-border-hairline bg-surface-overlay px-2 py-1.5 shadow-overlay',
            )}
          >
            <span className="text-xs text-ink-secondary">{labels[active]}</span>
            {series.map((line, index) => {
              const value = line.values[active];
              return (
                <span key={line.label} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-0.5 w-3 shrink-0 rounded-full',
                      colorSlotClass(slotFor(line, index)),
                    )}
                  />
                  <span className="text-sm font-semibold text-ink tabular-nums">
                    {value === null || value === undefined ? '—' : formatValue(value)}
                  </span>
                  <span className="truncate text-xs text-ink-secondary">{line.label}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}
