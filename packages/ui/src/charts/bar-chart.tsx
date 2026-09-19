'use client';

import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { ChartFrame, ChartTable, type ChartFrameProps } from './chart-frame.js';
import {
  colorSlotClass,
  colorSlotVar,
  type ColorSlot,
  type ColorVar,
} from '../tokens/area-color.js';
import { barPath, barThickness, linearScale, niceTicks, zeroBasedDomain } from './chart-scale.js';
import { SERIES_LIMIT, seriesClass, seriesSlot } from './series.js';
import { resolveFormat, type ValueFormat } from './value-format.js';

export interface BarDatum {
  label: string;
  /** One value per series, in the order `series` names them. */
  values: readonly number[];
  /**
   * Overrides the categorical slot for this row — pass `areaColorSlot(key)`
   * here so the bar matches that area's badge everywhere else on the screen.
   *
   * A slot rather than a colour, because the row is painted twice: as an SVG
   * `fill` on the bar and as a class on the tooltip's key. Both derive from
   * this, so they cannot disagree.
   */
  slot?: ColorSlot;
}

export interface BarChartProps extends Omit<
  ChartFrameProps,
  'children' | 'tableView' | 'legend' | 'empty'
> {
  data: readonly BarDatum[];
  /** Series names. One means no legend — the title already says what it is. */
  series: readonly string[];
  /** Only reachable from a client component — a function cannot be serialised. */
  format?: (value: number) => string;
  /** The same instruction as data, for a server component (`./value-format.ts`). */
  formatAs?: ValueFormat;
  /** Marks a reference position on the value axis: a target, an agreed share. */
  reference?: { value: number; label: string };
}

const WIDTH = 640;
const LABEL_WIDTH = 150;
const VALUE_WIDTH = 56;
const ROW_GAP = 8;
const AXIS_HEIGHT = 24;
const SURFACE_GAP = 2;

/**
 * Horizontal bars, one row per category.
 *
 * Horizontal rather than vertical because the categories here are areas and
 * initiatives — names long enough that a column chart would tilt them, and
 * tilted labels are unreadable at a glance.
 *
 * The SVG has a fixed logical width and scales with its container, so the
 * proportions are identical everywhere and there is no measuring pass. Its
 * height grows with the number of rows *and includes the axis band*: a fixed
 * height that clips the axis is how a card ends up with its own tiny scrollbar.
 */
export function BarChart({ data, series, format, formatAs, reference, ...frame }: BarChartProps) {
  const [hovered, setHovered] = useState<{ row: number; series: number } | null>(null);
  const formatValue = resolveFormat(format, formatAs);

  if (series.length > SERIES_LIMIT) {
    return (
      <ChartFrame
        {...frame}
        error={`${String(series.length)} series: the palette holds ${String(SERIES_LIMIT)}. Fold the tail into "Other" or facet into small multiples.`}
        tableView={null}
      >
        {null}
      </ChartFrame>
    );
  }

  const rowHeight = Math.max(28, series.length * 14 + 14);
  const plotHeight = data.length * (rowHeight + ROW_GAP);
  const height = plotHeight + AXIS_HEIGHT;
  const plotWidth = WIDTH - LABEL_WIDTH - VALUE_WIDTH;

  const domain = zeroBasedDomain(data.flatMap((datum) => [...datum.values]));
  const x = linearScale(domain, [LABEL_WIDTH, LABEL_WIDTH + plotWidth]);
  const ticks = niceTicks(domain[0], domain[1], 5);

  const slotFor = (datum: BarDatum, index: number): ColorSlot => datum.slot ?? seriesSlot(index);
  const colorFor = (datum: BarDatum, index: number): ColorVar =>
    colorSlotVar(slotFor(datum, index));

  const tableView = (
    <ChartTable head={[frame.title, ...series]} caption={`${frame.title}, as a table`}>
      {data.map((datum) => (
        <tr key={datum.label} className="border-b border-border-hairline last:border-0">
          <th scope="row" className="px-2 py-1.5 text-left font-normal text-ink">
            {datum.label}
          </th>
          {datum.values.map((value, index) => (
            <td
              key={series[index] ?? index}
              className="px-2 py-1.5 text-right text-ink tabular-nums"
            >
              {formatValue(value)}
            </td>
          ))}
        </tr>
      ))}
    </ChartTable>
  );

  return (
    <ChartFrame
      {...frame}
      empty={data.length === 0}
      tableView={tableView}
      legend={series.map((label, index) => ({
        label,
        colorClass: seriesClass(index),
        shape: 'rect',
      }))}
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${frame.title}. The same values are available as a table.`}
        >
          {/* Gridlines: solid hairlines, one step off the surface, recessive. */}
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={x(tick)}
              x2={x(tick)}
              y1={0}
              y2={plotHeight}
              stroke="var(--prisme-chart-gridline)"
              strokeWidth={1}
            />
          ))}

          {reference ? (
            <line
              x1={x(reference.value)}
              x2={x(reference.value)}
              y1={0}
              y2={plotHeight}
              stroke="var(--prisme-chart-baseline)"
              strokeWidth={2}
            >
              <title>{reference.label}</title>
            </line>
          ) : null}

          {data.map((datum, row) => {
            const bandTop = row * (rowHeight + ROW_GAP);
            const thickness = barThickness(rowHeight, series.length);
            const stackHeight = thickness * series.length + SURFACE_GAP * (series.length - 1);
            const firstTop = bandTop + (rowHeight - stackHeight) / 2;

            return (
              <g key={datum.label}>
                <text
                  x={LABEL_WIDTH - 8}
                  y={bandTop + rowHeight / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill="var(--prisme-ink-secondary)"
                >
                  {datum.label}
                </text>

                {datum.values.map((value, index) => {
                  const top = firstTop + index * (thickness + SURFACE_GAP);
                  const isHovered = hovered?.row === row && hovered.series === index;

                  return (
                    <g key={series[index] ?? index}>
                      <path
                        d={barPath(x(0), top, x(value) - x(0), thickness, 'right')}
                        fill={colorFor(datum, index)}
                        opacity={isHovered ? 0.85 : 1}
                      />
                      {/*
                        The hit target is the whole band, not the painted
                        pixels: a 6px bar is a pinpoint, and a reader should
                        only have to be near it.
                      */}
                      <rect
                        x={LABEL_WIDTH}
                        y={top - SURFACE_GAP}
                        width={plotWidth}
                        height={thickness + SURFACE_GAP * 2}
                        fill="transparent"
                        tabIndex={0}
                        role="img"
                        aria-label={`${datum.label}${series.length > 1 ? `, ${series[index] ?? ''}` : ''}: ${formatValue(value)}`}
                        onPointerEnter={() => {
                          setHovered({ row, series: index });
                        }}
                        onPointerLeave={() => {
                          setHovered(null);
                        }}
                        onFocus={() => {
                          setHovered({ row, series: index });
                        }}
                        onBlur={() => {
                          setHovered(null);
                        }}
                        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      />
                      {/*
                        The value rides the tip, outside the bar — never
                        inside, because no ink clears AA on the lightest slots
                        (tokens/contrast.test.ts). The reserved right margin is
                        what keeps a full-length bar's label on the canvas.
                      */}
                      {index === 0 || series.length <= 2 ? (
                        <text
                          x={x(value) + 6}
                          y={top + thickness / 2}
                          dominantBaseline="middle"
                          fontSize={11}
                          fill="var(--prisme-ink-secondary)"
                          className="tabular-nums"
                        >
                          {formatValue(value)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* The baseline is the only heavier rule on the plot. */}
          <line
            x1={x(0)}
            x2={x(0)}
            y1={0}
            y2={plotHeight}
            stroke="var(--prisme-chart-baseline)"
            strokeWidth={1}
          />

          {ticks.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={plotHeight + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--prisme-ink-secondary)"
              className="tabular-nums"
            >
              {formatValue(tick)}
            </text>
          ))}
        </svg>

        {hovered ? (
          <BarTooltip
            label={data[hovered.row]?.label ?? ''}
            series={series.length > 1 ? (series[hovered.series] ?? '') : undefined}
            value={formatValue(data[hovered.row]?.values[hovered.series] ?? 0)}
            colorClass={colorSlotClass(
              data[hovered.row]?.slot ??
                seriesSlot(hovered.series < SERIES_LIMIT ? hovered.series : 0),
            )}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}

/**
 * Values lead, labels follow — the legend's hierarchy inverted, because here
 * the reader already knows which bar they are pointing at and wants the number.
 */
function BarTooltip({
  label,
  series,
  value,
  colorClass,
}: {
  label: string;
  series?: string | undefined;
  value: string;
  colorClass: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none absolute top-0 right-0 flex items-center gap-2 rounded-md',
        'border border-border-hairline bg-surface-overlay px-2 py-1 shadow-overlay',
      )}
    >
      <span aria-hidden="true" className={cn('h-0.5 w-3 rounded-full', colorClass)} />
      <span className="text-sm font-semibold text-ink tabular-nums">{value}</span>
      <span className="text-xs text-ink-secondary">
        {label}
        {series ? ` · ${series}` : ''}
      </span>
    </div>
  );
}
