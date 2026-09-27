'use client';

import { Badge, DataTable, relativeTime, type DataTableColumn } from '@prisme/ui';
import type { AreaCompletion } from '@/lib/contracts';
import { minutesLabel, sourceLabel } from '@/lib/completions-view';

/**
 * What an area's observed share was made of, one completion per row.
 *
 * A client component only because `<DataTable>` is one: its columns are
 * functions, and a function cannot cross from a server component. Every value
 * here arrived from the API; the table sorts and filters what it was handed and
 * computes nothing.
 *
 * `now` is passed in rather than read, so the relative dates render the same
 * on the server and in the browser.
 */
export function CompletionsTable({
  rows,
  now,
  areaName,
}: {
  rows: readonly AreaCompletion[];
  now: string;
  areaName: string;
}) {
  const at = new Date(now);

  const columns: DataTableColumn<AreaCompletion>[] = [
    {
      id: 'completed',
      header: 'Completed',
      widthClass: 'w-36',
      sortValue: (row) => row.completedAt,
      cell: (row) => (
        <time
          dateTime={row.completedAt}
          title={row.completedAt}
          className="whitespace-nowrap text-ink-secondary"
        >
          {relativeTime(new Date(row.completedAt), at)}
        </time>
      ),
    },
    {
      id: 'task',
      header: 'Task',
      sortValue: (row) => row.content ?? '',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {row.content === null ? (
            <span className="text-ink-muted">Title not recorded</span>
          ) : (
            <span className="text-ink">{row.content}</span>
          )}
          {row.ritual ? <Badge variant="outline">ritual</Badge> : null}
        </span>
      ),
    },
    {
      id: 'time',
      header: 'Time counted',
      align: 'right',
      widthClass: 'w-48',
      sortValue: (row) => row.minutes,
      cell: (row) => (
        <span className="flex items-center justify-end gap-2 whitespace-nowrap">
          {row.minutesSource === null ? null : (
            <span className="tabular-nums text-ink">{minutesLabel(row.minutes)}</span>
          )}
          <Badge variant={row.minutesSource === 'default' ? 'outline' : 'neutral'}>
            {sourceLabel(row)}
          </Badge>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => `${row.externalTaskId}@${row.completedAt}`}
      caption={`Completions counted toward ${areaName} in the window`}
      captionHidden
      searchText={(row) => row.content ?? ''}
      searchPlaceholder="Filter by title…"
      emptyTitle="No completion matches"
      emptyDescription="Nothing in this window has a title containing that text."
    />
  );
}
