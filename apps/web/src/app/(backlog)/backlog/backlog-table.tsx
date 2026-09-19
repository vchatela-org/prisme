'use client';

import {
  AreaBadge,
  Button,
  Card,
  DataTable,
  ScorePill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  statusLabel,
  useToast,
  type DataTableColumn,
} from '@prisme/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { EstimateEditor } from '@/components/estimate-editor';
import { StatusMenu } from '@/components/status-menu';
import { transitionMany } from '@/lib/actions';
import {
  INITIATIVE_STATUSES,
  type Area,
  type BacklogEntry,
  type InitiativeStatus,
} from '@/lib/contracts';
import { countsFrom, type WipCounts } from '@/lib/guardrails';
import {
  allSelected,
  EMPTY_SELECTION,
  isSelected,
  pruneTo,
  selectRange,
  selectionLabel,
  toggle,
  toggleAll,
  type SelectionState,
} from '@/lib/selection';

/**
 * A status cell.
 *
 * Its own component only because `counts` is optional in the strict sense —
 * absent, not `undefined` — and spreading that conditionally inside a column
 * definition reads far worse than one named wrapper.
 */
function StatusMenuCell({ entry, counts }: { entry: BacklogEntry; counts: WipCounts | undefined }) {
  return <StatusMenu initiative={entry.initiative} {...(counts === undefined ? {} : { counts })} />;
}

/**
 * The ranked backlog.
 *
 * ## It does not sort itself
 *
 * `<DataTable>` can sort its rows and here no column declares `sortValue`, so
 * it does not. The ordering comes from the API — sorting by score sorts by
 * *rank*, the position the active method produced — and the sort control lives
 * in the filter bar, where changing it re-asks for the page. Two orderings of
 * the same data is how the list somebody read stops being the list that chose
 * their week.
 *
 * ## The row's own ordering of controls
 *
 * Title, area, status, score, estimates, deadline. The score sits beside the
 * estimates because they are the question and the answer: change one, and the
 * other is what moved.
 *
 * ## Selection is for the review
 *
 * Shift extends a range, the header box takes the page, and a bulk move shows
 * the same guardrails one at a time would — except it says how many it moved
 * when something fails partway, because "failed" over eight rows tells a reader
 * nothing about which six went.
 */

export interface BacklogTableProps {
  entries: readonly BacklogEntry[];
  areas: readonly Area[];
  method: string;
  weightsStale: boolean;
  /** Focus's slot lines, so a move to `now` warns with real numbers. */
  slots: readonly { areaKey: string; used: number; limit: number }[];
  limits: { maxNow: number; maxNowPerArea: number } | undefined;
  nowCount: number;
}

export function BacklogTable({
  entries,
  areas,
  method,
  weightsStale,
  slots,
  limits,
  nowCount,
}: BacklogTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [bulkStatus, setBulkStatus] = useState<InitiativeStatus>('later');

  const visibleIds = useMemo(() => entries.map((entry) => entry.initiative.id), [entries]);

  // The page can change underneath a selection — a filter, a status move, a
  // page turn. Anything no longer on screen is dropped rather than silently
  // included in the next bulk action.
  useEffect(() => {
    setSelection((current) => pruneTo(current, visibleIds));
  }, [visibleIds]);

  const byKey = new Map(areas.map((area) => [area.key, area]));
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;

  const countsFor = (areaKey: string): WipCounts | undefined =>
    limits === undefined
      ? undefined
      : countsFrom(slots, areaKey, nameOf(areaKey), limits, nowCount);

  const columns: DataTableColumn<BacklogEntry>[] = [
    {
      id: 'title',
      header: 'Initiative',
      hideable: false,
      cell: (entry) => (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-accent-solid"
            checked={isSelected(selection, entry.initiative.id)}
            aria-label={`Select ${entry.initiative.title}`}
            onChange={(event) => {
              const native = event.nativeEvent as MouseEvent;
              setSelection((current) =>
                native.shiftKey
                  ? selectRange(current, entry.initiative.id, visibleIds)
                  : toggle(current, entry.initiative.id),
              );
            }}
          />
          <Link
            href={`/initiative/${entry.initiative.id}`}
            className="truncate text-ink hover:underline"
          >
            {entry.initiative.title}
          </Link>
        </div>
      ),
    },
    {
      id: 'area',
      header: 'Area',
      cell: (entry) => (
        <AreaBadge
          areaKey={entry.initiative.areaKey}
          name={nameOf(entry.initiative.areaKey)}
          kind={byKey.get(entry.initiative.areaKey)?.kind ?? 'area'}
          size="sm"
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (entry) => (
        <StatusMenuCell entry={entry} counts={countsFor(entry.initiative.areaKey)} />
      ),
    },
    {
      id: 'score',
      header: 'Score',
      align: 'right',
      cell: (entry) =>
        entry.score === null ? (
          <span className="text-xs text-ink-muted">Not ranked</span>
        ) : (
          <ScorePill
            score={entry.score}
            explain={
              entry.initiative.score?.explain ??
              'This ranking was computed for the list; nothing has been stored yet.'
            }
            {...(entry.initiative.score === null
              ? {}
              : { factors: entry.initiative.score.factors })}
            method={method}
            stale={weightsStale}
          />
        ),
    },
    {
      id: 'rank',
      header: 'Rank',
      align: 'right',
      cell: (entry) => (
        <span className="tabular-nums">{entry.rank === null ? '—' : entry.rank}</span>
      ),
    },
    {
      id: 'estimates',
      header: 'Estimates',
      cell: (entry) => <EstimateEditor initiative={entry.initiative} />,
    },
    {
      id: 'deadline',
      header: 'Deadline',
      cell: (entry) => (
        <span className="tabular-nums text-ink-secondary">{entry.initiative.deadline ?? '—'}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            className="accent-accent-solid"
            checked={allSelected(selection, visibleIds)}
            onChange={() => {
              setSelection((current) => toggleAll(current, visibleIds));
            }}
          />
          Select this page
        </label>

        {selection.ids.size > 0 ? (
          <Card className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="text-sm text-ink">{selectionLabel(selection)}</span>

            <Select
              value={bulkStatus}
              onValueChange={(next) => {
                setBulkStatus(next as InitiativeStatus);
              }}
            >
              <SelectTrigger aria-label="Move the selection to" className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INITIATIVE_STATUSES.filter((status) => status !== 'dropped').map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                const ids = [...selection.ids];
                startTransition(async () => {
                  const result = await transitionMany(ids, bulkStatus);
                  toast(
                    result.ok
                      ? { title: result.message, tone: 'success' }
                      : { title: result.title, description: result.description, tone: 'error' },
                  );
                  setSelection(EMPTY_SELECTION);
                  router.refresh();
                });
              }}
            >
              Move {selection.ids.size}
            </Button>

            {/*
              Dropping is deliberately not a bulk action: each drop is recorded
              with its own reason, and one reason pasted across six initiatives
              is the kind of history that reads as noise six months later.
            */}
            <span className="text-xs text-ink-muted">
              Dropping stays a single decision, with its reason.
            </span>
          </Card>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={entries}
        getRowId={(entry) => entry.initiative.id}
        caption="The ranked backlog"
        captionHidden
        emptyTitle="Nothing matches"
        emptyDescription="No initiative on this page matches the filters above."
        onRowActivate={(entry) => {
          router.push(`/initiative/${entry.initiative.id}`);
        }}
      />
    </div>
  );
}
