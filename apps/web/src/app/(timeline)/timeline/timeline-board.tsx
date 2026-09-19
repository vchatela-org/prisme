'use client';

import { areaColorVar, Badge, Button, Card, useToast, type AreaKind } from '@prisme/ui';
import { Check, Keyboard, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import type { Replan, Timeline } from '@/lib/contracts';
import {
  buildScale,
  dateOfDay,
  dayOf,
  isWeekend,
  NUDGE_DAYS,
  widthOf,
  xOf,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from '@/lib/timeline-scale';
import {
  applyPreview,
  BOUND_BY_LABEL,
  capacityBands,
  criticalIn,
  explain,
  groupRows,
  infeasibleIn,
  previewSummary,
  spanOf,
  toRows,
  type GroupBy,
  type TimelineRow,
} from '@/lib/timeline-view';
import { commitMove, previewMove } from './replan-actions';

/**
 * The Gantt.
 *
 * ## It renders a plan; it never computes one
 *
 * Every date drawn here arrived from `GET /timeline`, and every date in a
 * preview arrived from `GET /timeline/replan`. The one date this component
 * produces is the *requested* start under the cursor — the same thing typing a
 * date into a box would produce — and the plan's answer to that request comes
 * back over the wire before a single bar moves. That is the discipline the
 * brief is most insistent about, and the failure it prevents is specific: a
 * preview the browser worked out is a preview that can disagree with what gets
 * saved, and the disagreement surfaces only once somebody has committed it.
 *
 * ## Why it is hand-drawn rather than a library
 *
 * The brief asks for a library to be evaluated first, and the check it names is
 * the one that rules them out: dependency edges *and* custom markers, both
 * first-class. The candidates worth having treat edges as an add-on and expect
 * to own their own colour and interaction, which here would mean a second
 * design system inside one screen, `style` attributes the content security
 * policy refuses, and retro-fitting `boundBy` into a tooltip slot. What is left
 * once those are excluded is a few hundred lines of SVG over the geometry in
 * `lib/timeline-scale.ts`, which is tested without a browser.
 *
 * ## Colour, and what carries meaning besides it
 *
 * Bars wear their **area's** hue, derived from the area key like everywhere
 * else. The critical path is a **stroke**, an impossible deadline is a
 * **marker shape** in the status colour, and saturated capacity is a **wash** —
 * three encodings that are not a ninth categorical hue, because the palette has
 * eight slots and a generated ninth is indistinguishable under colour-vision
 * deficiency. Every one of them is also a column in the table twin below, so
 * nothing here is readable by colour alone.
 */

/** Row geometry. The left rail's `h-8`/`h-7` classes must match these. */
const ROW_HEIGHT = 32;
const GROUP_HEIGHT = 28;
const BAR_HEIGHT = 14;
const BAR_TOP = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const AXIS_HEIGHT = 24;

interface LaidOutRow {
  readonly row: TimelineRow;
  readonly y: number;
}

interface LaidOutGroup {
  readonly key: string;
  readonly label: string;
  readonly areaKey: string | null;
  readonly kind: AreaKind | 'project';
  readonly y: number;
  readonly rows: readonly LaidOutRow[];
}

export interface TimelineBoardProps {
  readonly timeline: Timeline;
  readonly areas: readonly { key: string; name: string; kind: AreaKind }[];
  readonly projects: readonly { id: string; name: string }[];
  /** Today, from the server. This component has no clock of its own. */
  readonly today: string;
}

export function TimelineBoard({ timeline, areas, projects, today }: TimelineBoardProps) {
  const [zoom, setZoom] = useState<Zoom>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('area');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Replan | null>(null);
  const [drag, setDrag] = useState<{ id: string; deltaDays: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const [committing, setCommitting] = useState(false);
  const { toast } = useToast();
  const dragOrigin = useRef<{ x: number; startDay: number } | null>(null);

  const areaIndex = useMemo(
    () => new Map(areas.map((area) => [area.key, { name: area.name, kind: area.kind }])),
    [areas],
  );
  const projectIndex = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const titleById = useMemo(
    () => new Map(timeline.initiatives.map((entry) => [entry.initiativeId, entry.title])),
    [timeline.initiatives],
  );
  const slotsByArea = useMemo(
    () => new Map(timeline.areaSlots.map((slot) => [slot.areaKey, slot.slots])),
    [timeline.areaSlots],
  );

  const rows = useMemo(
    () => applyPreview(toRows(timeline.initiatives), preview),
    [timeline.initiatives, preview],
  );
  const groups = useMemo(
    () => groupRows({ rows, groupBy, areas: areaIndex, projects: projectIndex }),
    [rows, groupBy, areaIndex, projectIndex],
  );

  const critical = useMemo(
    () => criticalIn(timeline.criticalPath, preview),
    [timeline.criticalPath, preview],
  );
  const infeasible = useMemo(
    () => infeasibleIn(timeline.initiatives, preview),
    [timeline.initiatives, preview],
  );
  const bands = useMemo(() => capacityBands(rows, slotsByArea), [rows, slotsByArea]);

  const span = useMemo(
    () =>
      spanOf(rows, {
        from: timeline.projectStart,
        to: timeline.projectEnd ?? timeline.projectStart,
      }),
    [rows, timeline.projectStart, timeline.projectEnd],
  );
  const scale = useMemo(
    () => buildScale({ from: span.from, to: span.to, zoom, today }),
    [span, zoom, today],
  );

  // One walk, producing every y — so the left rail and the plot cannot drift
  // apart, which is the one way a Gantt becomes actively misleading.
  const { laidOut, height } = useMemo(() => {
    const result: LaidOutGroup[] = [];
    let y = 0;
    for (const group of groups) {
      const groupY = y;
      y += GROUP_HEIGHT;
      const laidOutRows = group.rows.map((row) => {
        const rowY = y;
        y += ROW_HEIGHT;
        return { row, y: rowY };
      });
      result.push({ ...group, y: groupY, rows: laidOutRows });
    }
    return { laidOut: result, height: Math.max(y, ROW_HEIGHT) };
  }, [groups]);

  const yById = useMemo(() => {
    const index = new Map<string, number>();
    for (const group of laidOut)
      for (const row of group.rows) index.set(row.row.initiativeId, row.y);
    return index;
  }, [laidOut]);

  const rowById = useMemo(() => new Map(rows.map((row) => [row.initiativeId, row])), [rows]);

  /**
   * Ask the plan what a move would do.
   *
   * Nothing is drawn differently until the answer arrives. A local guess held
   * on screen "while the request is in flight" is exactly the preview that
   * disagrees with what gets saved.
   */
  const requestMove = useCallback(
    (initiativeId: string, newStart: string) => {
      setSelectedId(initiativeId);
      startTransition(async () => {
        const result = await previewMove({ initiativeId, newStart });
        if (!result.ok || result.preview === null) {
          setPreview(null);
          toast({ title: result.title, description: result.description, tone: 'error' });
          return;
        }
        setPreview(result.preview);
      });
    },
    [toast],
  );

  const apply = useCallback(() => {
    if (preview === null) return;
    setCommitting(true);
    startTransition(async () => {
      const result = await commitMove({
        initiativeId: preview.move.initiativeId,
        // The date the plan settled on, not the one the pointer was let go
        // over: committing the refused day would ask for a move the preview
        // has already said cannot happen.
        newStart: preview.move.actualStart,
      });
      setCommitting(false);
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) setPreview(null);
    });
  }, [preview, toast]);

  const onBarKeyDown = useCallback(
    (event: React.KeyboardEvent, row: TimelineRow) => {
      if (event.key === 'Escape') {
        setPreview(null);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelectedId(row.initiativeId);
        return;
      }
      // Shift with an arrow moves; a bare arrow is left to the scroll
      // container, where a reader expects it. Every drag has this equivalent —
      // it is a requirement, not a courtesy (`apps/web/CLAUDE.md`).
      if (!event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = NUDGE_DAYS[zoom] * (event.key === 'ArrowRight' ? 1 : -1);
      requestMove(row.initiativeId, dateOfDay(dayOf(row.start) + step));
    },
    [requestMove, zoom],
  );

  const onPointerDown = useCallback((event: React.PointerEvent, row: TimelineRow) => {
    // Primary button only: a right-click that started a drag would be a move
    // nobody asked for, mid-context-menu.
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = { x: event.clientX, startDay: dayOf(row.start) };
    setDrag({ id: row.initiativeId, deltaDays: 0 });
    setSelectedId(row.initiativeId);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent, row: TimelineRow) => {
      const origin = dragOrigin.current;
      if (origin === null || drag?.id !== row.initiativeId) return;
      // A pixel offset, not a date. The bar follows the cursor; what that
      // means in days is settled once, on release, by the plan.
      const deltaDays = Math.round((event.clientX - origin.x) / scale.dayWidth);
      if (deltaDays !== drag.deltaDays) setDrag({ id: row.initiativeId, deltaDays });
    },
    [drag, scale.dayWidth],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent, row: TimelineRow) => {
      const origin = dragOrigin.current;
      dragOrigin.current = null;
      const moved = drag?.deltaDays ?? 0;
      setDrag(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (origin === null) return;
      if (moved === 0) {
        setSelectedId(row.initiativeId);
        return;
      }
      requestMove(row.initiativeId, dateOfDay(origin.startDay + moved));
    },
    [drag, requestMove],
  );

  const selected = selectedId === null ? null : (rowById.get(selectedId) ?? null);
  const summary = preview === null ? null : previewSummary(preview, titleById);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        zoom={zoom}
        onZoom={setZoom}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        disabled={preview !== null}
      />

      {preview !== null && summary !== null ? (
        <PreviewPanel
          summary={summary}
          pending={pending || committing}
          onApply={apply}
          onCancel={() => {
            setPreview(null);
          }}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex">
          {/* The rail is sticky, the plot scrolls. A plan whose labels leave
              the screen at the third month is a plan nobody reads sideways. */}
          <div className="w-64 shrink-0 border-r border-border-hairline">
            <div className="h-6 border-b border-border-hairline" />
            {laidOut.map((group) => (
              <div key={group.key}>
                <div className="flex h-7 items-center gap-2 bg-surface-page px-3 text-xs font-semibold text-ink-secondary">
                  <span className="truncate">{group.label}</span>
                  <span className="tabular-nums text-ink-muted">{group.rows.length}</span>
                </div>
                {group.rows.map(({ row }) => (
                  <RailRow
                    key={row.initiativeId}
                    row={row}
                    selected={row.initiativeId === selectedId}
                    onSelect={() => {
                      setSelectedId(row.initiativeId);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-x-auto">
            <svg
              width={scale.width}
              height={height + AXIS_HEIGHT}
              className="block"
              aria-label="The plan, as bars over time. Every bar is also a row in the table below."
            >
              <Axis scale={scale} height={height} />

              {bands.map((band) => {
                const group = laidOut.find((candidate) => candidate.areaKey === band.areaKey);
                if (group === undefined) return null;
                const top = group.rows[0]?.y ?? group.y;
                const bottom = (group.rows[group.rows.length - 1]?.y ?? group.y) + ROW_HEIGHT;
                return (
                  <rect
                    key={`${band.areaKey}-${String(band.fromDay)}`}
                    x={(band.fromDay - scale.originDay) * scale.dayWidth}
                    y={top}
                    width={(band.toDay - band.fromDay) * scale.dayWidth}
                    height={bottom - top}
                    fill="var(--prisme-ink)"
                    fillOpacity={0.07}
                  >
                    <title>
                      {`Every one of ${band.areaKey}'s ${String(band.slots)} slots is in use from ${dateOfDay(band.fromDay)} to ${dateOfDay(band.toDay - 1)}. Work in this area cannot start sooner than the next free slot.`}
                    </title>
                  </rect>
                );
              })}

              <Edges
                edges={timeline.edges}
                rowById={rowById}
                yById={yById}
                scale={scale}
                critical={critical}
              />

              {laidOut.map((group) =>
                group.rows.map(({ row, y }) => (
                  <Bar
                    key={row.initiativeId}
                    row={row}
                    y={y}
                    scale={scale}
                    kind={
                      groupBy === 'area'
                        ? group.kind === 'project'
                          ? 'area'
                          : group.kind
                        : (areaIndex.get(row.areaKey)?.kind ?? 'area')
                    }
                    critical={critical.has(row.initiativeId)}
                    infeasible={infeasible.has(row.initiativeId)}
                    selected={row.initiativeId === selectedId}
                    dragDelta={drag?.id === row.initiativeId ? drag.deltaDays : 0}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onKeyDown={onBarKeyDown}
                  />
                )),
              )}
            </svg>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
        <Legend />
        <span className="flex items-center gap-1.5 text-ink-muted">
          <Keyboard className="size-3.5" aria-hidden />
          Drag a bar to move it, or focus one and press Shift with ← or →. Enter explains a date;
          Escape drops a preview.
        </span>
      </div>

      {selected === null ? (
        <Card className="text-sm text-ink-secondary">
          Select any bar to read why it starts when it does.
        </Card>
      ) : (
        <Explanation
          row={selected}
          areaName={areaIndex.get(selected.areaKey)?.name ?? selected.areaKey}
          areaSlots={slotsByArea.get(selected.areaKey) ?? 1}
          critical={critical.has(selected.initiativeId)}
          titleById={titleById}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Pieces
 * ---------------------------------------------------------------------- */

function Toolbar({
  zoom,
  onZoom,
  groupBy,
  onGroupBy,
  disabled,
}: {
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">Zoom</legend>
        <span className="text-xs text-ink-muted">Zoom</span>
        {ZOOMS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={candidate === zoom ? 'secondary' : 'ghost'}
            aria-pressed={candidate === zoom}
            onClick={() => {
              onZoom(candidate);
            }}
          >
            {ZOOM_LABELS[candidate]}
          </Button>
        ))}
      </fieldset>

      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">Group by</legend>
        <span className="text-xs text-ink-muted">Group by</span>
        {(['area', 'project'] as const).map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={candidate === groupBy ? 'secondary' : 'ghost'}
            aria-pressed={candidate === groupBy}
            // Regrouping mid-preview would move the bars a reader is deciding
            // about. The preview is a question; answer it first.
            disabled={disabled}
            onClick={() => {
              onGroupBy(candidate);
            }}
          >
            {candidate === 'area' ? 'Area' : 'Project'}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}

function RailRow({
  row,
  selected,
  onSelect,
}: {
  row: TimelineRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        selected
          ? 'flex h-8 w-full items-center gap-2 bg-surface-raised px-3 text-left'
          : 'flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-surface-raised'
      }
    >
      <span className="truncate text-xs text-ink">{row.title}</span>
      {/* `boundBy` on every row, always visible. The brief is explicit that it
          does not belong in a tooltip nobody finds: a plan that cannot explain
          itself gets overridden once and ignored afterwards. */}
      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
        {BOUND_BY_LABEL[row.boundBy]}
      </span>
    </button>
  );
}

function Axis({ scale, height }: { scale: ReturnType<typeof buildScale>; height: number }) {
  return (
    <g>
      {/* Weekends, where a day is wide enough for the shading to mean
          something. A plan counted in working days reads wrong without them. */}
      {scale.dayWidth >= 7
        ? Array.from({ length: scale.days }, (_, offset) => scale.originDay + offset)
            .filter(isWeekend)
            .map((day) => (
              <rect
                key={day}
                x={(day - scale.originDay) * scale.dayWidth}
                y={24}
                width={scale.dayWidth}
                height={height}
                fill="var(--prisme-chart-gridline)"
                fillOpacity={0.4}
              />
            ))
        : null}

      {scale.ticks.map((tick) => (
        <g key={tick.day}>
          <line
            x1={tick.x}
            y1={24}
            x2={tick.x}
            y2={height + 24}
            stroke="var(--prisme-chart-gridline)"
            strokeWidth={1}
          />
          {tick.label === null ? null : (
            <text
              x={tick.x}
              y={16}
              textAnchor="middle"
              className="fill-ink-muted text-[10px] tabular-nums"
            >
              {tick.label}
            </text>
          )}
        </g>
      ))}

      {scale.todayX === null ? null : (
        <g>
          <line
            x1={scale.todayX}
            y1={20}
            x2={scale.todayX}
            y2={height + 24}
            stroke="var(--prisme-accent)"
            strokeWidth={2}
          />
          <text x={scale.todayX + 4} y={16} className="fill-ink-secondary text-[10px]">
            today
          </text>
        </g>
      )}
    </g>
  );
}

function Edges({
  edges,
  rowById,
  yById,
  scale,
  critical,
}: {
  edges: Timeline['edges'];
  rowById: ReadonlyMap<string, TimelineRow>;
  yById: ReadonlyMap<string, number>;
  scale: ReturnType<typeof buildScale>;
  critical: ReadonlySet<string>;
}) {
  return (
    <g>
      {edges.map((edge) => {
        const from = rowById.get(edge.from);
        const to = rowById.get(edge.to);
        const fromY = yById.get(edge.from);
        const toY = yById.get(edge.to);
        // A dangling dependency has no bar to draw from. The plan reports it
        // separately and the screen says so in words rather than inventing an
        // edge to nowhere.
        if (from === undefined || to === undefined || fromY === undefined || toY === undefined) {
          return null;
        }

        const startX = xOf(scale, from.start) + widthOf(scale, from.start, from.end);
        const endX = xOf(scale, to.start);
        const y1 = fromY + ROW_HEIGHT / 2 + AXIS_HEIGHT;
        const y2 = toY + ROW_HEIGHT / 2 + AXIS_HEIGHT;
        const elbow = Math.max(startX + 6, endX - 6);
        const onPath = critical.has(edge.from) && critical.has(edge.to);

        return (
          <path
            key={`${edge.from}-${edge.to}`}
            d={`M ${String(startX)} ${String(y1)} H ${String(elbow)} V ${String(y2)} H ${String(endX)}`}
            fill="none"
            stroke={onPath ? 'var(--prisme-ink)' : 'var(--prisme-ink-muted)'}
            strokeWidth={onPath ? 2 : 1}
            strokeOpacity={onPath ? 0.9 : 0.5}
            aria-hidden="true"
          />
        );
      })}
    </g>
  );
}

function Bar({
  row,
  y,
  scale,
  kind,
  critical,
  infeasible,
  selected,
  dragDelta,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  row: TimelineRow;
  y: number;
  scale: ReturnType<typeof buildScale>;
  kind: AreaKind;
  critical: boolean;
  infeasible: boolean;
  selected: boolean;
  dragDelta: number;
  onPointerDown: (event: React.PointerEvent, row: TimelineRow) => void;
  onPointerMove: (event: React.PointerEvent, row: TimelineRow) => void;
  onPointerUp: (event: React.PointerEvent, row: TimelineRow) => void;
  onKeyDown: (event: React.KeyboardEvent, row: TimelineRow) => void;
}) {
  const x = xOf(scale, row.start) + dragDelta * scale.dayWidth;
  const width = widthOf(scale, row.start, row.end);
  const top = y + BAR_TOP + AXIS_HEIGHT;
  const centre = y + ROW_HEIGHT / 2 + AXIS_HEIGHT;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${row.title}. ${row.start} to ${row.end}. ${BOUND_BY_LABEL[row.boundBy]}.${critical ? ' On the critical path.' : ''}${infeasible ? ' Its deadline cannot be met.' : ''} Shift with an arrow key moves it.`}
      onPointerDown={(event) => {
        onPointerDown(event, row);
      }}
      onPointerMove={(event) => {
        onPointerMove(event, row);
      }}
      onPointerUp={(event) => {
        onPointerUp(event, row);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, row);
      }}
      className="cursor-grab outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <title>{`${row.title} · ${row.start} → ${row.end} · ${BOUND_BY_LABEL[row.boundBy]}`}</title>

      {selected ? (
        <rect
          x={0}
          y={y + AXIS_HEIGHT}
          width={scale.width}
          height={ROW_HEIGHT}
          fill="var(--prisme-accent)"
          fillOpacity={0.06}
        />
      ) : null}

      <rect
        x={x}
        y={top}
        width={width}
        height={BAR_HEIGHT}
        rx={4}
        fill={areaColorVar(row.areaKey, kind)}
        fillOpacity={row.moved ? 0.55 : 1}
        stroke={critical ? 'var(--prisme-ink)' : 'none'}
        strokeWidth={critical ? 2 : 0}
      />

      {/* Where a preview moved it from, so the distance is visible rather than
          remembered. Drawn behind, at a wash. */}
      {row.moved ? (
        <rect
          x={x}
          y={top}
          width={width}
          height={BAR_HEIGHT}
          rx={4}
          fill="none"
          stroke="var(--prisme-accent)"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      ) : null}

      {row.deadline === null ? null : (
        <g>
          <path
            d={`M ${String(xOf(scale, row.deadline))} ${String(centre - 6)} L ${String(xOf(scale, row.deadline) + 6)} ${String(centre)} L ${String(xOf(scale, row.deadline))} ${String(centre + 6)} L ${String(xOf(scale, row.deadline) - 6)} ${String(centre)} Z`}
            fill={infeasible ? 'var(--prisme-status-critical)' : 'var(--prisme-chart-neutral)'}
            stroke="var(--prisme-surface-raised)"
            strokeWidth={2}
          />
          <title>
            {infeasible
              ? `Deadline ${row.deadline}, which this plan misses. prisme flags it and never moves it.`
              : `Deadline ${row.deadline}, which this plan meets.`}
          </title>
        </g>
      )}
    </g>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden>
          <rect x="0" y="0" width="16" height="10" rx="3" fill="var(--prisme-series-1)" />
        </svg>
        Bar: an initiative, in its area&rsquo;s colour
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden>
          <rect
            x="1"
            y="1"
            width="14"
            height="8"
            rx="3"
            fill="var(--prisme-series-1)"
            stroke="var(--prisme-ink)"
            strokeWidth="2"
          />
        </svg>
        Outlined: on the critical path
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden>
          <path d="M 7 1 L 13 7 L 7 13 L 1 7 Z" fill="var(--prisme-status-critical)" />
        </svg>
        Deadline the plan misses
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden>
          <rect x="0" y="0" width="16" height="10" fill="var(--prisme-ink)" fillOpacity="0.07" />
        </svg>
        Area running every slot it has
      </span>
    </span>
  );
}

function Explanation({
  row,
  areaName,
  areaSlots,
  critical,
  titleById,
}: {
  row: TimelineRow;
  areaName: string;
  areaSlots: number;
  critical: boolean;
  titleById: ReadonlyMap<string, string>;
}) {
  const detail = explain(row, { titleById, areaName, areaSlots, onCriticalPath: critical });

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{row.title}</h2>
        <Badge variant="outline">{BOUND_BY_LABEL[row.boundBy]}</Badge>
        {critical ? <Badge variant="outline">Critical path</Badge> : null}
      </div>
      <p className="text-sm text-ink">
        {row.start} → {row.end} · {row.durationDays} working{' '}
        {row.durationDays === 1 ? 'day' : 'days'}
      </p>
      <p className="text-sm text-ink-secondary">{detail.why}</p>
      <p className="text-sm text-ink-secondary">{detail.slack}</p>
      {detail.deadline === null ? null : (
        <p
          className={
            row.deadlineFeasible ? 'text-sm text-ink-secondary' : 'text-sm text-status-critical'
          }
        >
          {detail.deadline}
        </p>
      )}
    </Card>
  );
}

function PreviewPanel({
  summary,
  pending,
  onApply,
  onCancel,
}: {
  summary: ReturnType<typeof previewSummary>;
  pending: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <Card
      className={
        summary.broken.length > 0
          ? 'flex flex-col gap-3 border-status-critical'
          : 'flex flex-col gap-3 border-accent'
      }
      // A preview appearing below the fold is a preview nobody reads before
      // they commit. `assertive` because it is the answer to something the
      // reader just did.
      aria-live="assertive"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-ink">Nothing is saved yet</p>
          <p className="text-sm text-ink-secondary">{summary.headline}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            <Undo2 className="size-4" aria-hidden />
            Discard
          </Button>
          <Button size="sm" onClick={onApply} disabled={pending || summary.empty}>
            <Check className="size-4" aria-hidden />
            {pending ? 'Saving…' : 'Apply the move'}
          </Button>
        </div>
      </div>

      {summary.downstream.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Moves with it
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-ink-secondary">
            {summary.downstream.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.broken.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-critical">
            Breaks a deadline
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-ink">
            {summary.broken.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">
            The deadline itself does not move, and applying this will not move it. prisme flags an
            impossible deadline and leaves the decision with you (ADR-0003).
          </p>
        </div>
      ) : null}

      {summary.repaired.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm text-ink-success">
          {summary.repaired.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
