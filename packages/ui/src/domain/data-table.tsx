'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_RAISED } from '../lib/focus.js';
import { Button } from '../primitives/button.js';
import { Input } from '../primitives/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover.js';
import { EmptyState } from '../primitives/states.js';
import {
  cycleSort,
  filterRows,
  GRID_KEYS,
  moveFocus,
  sortRows,
  type GridPosition,
  type SortableValue,
  type SortState,
} from './data-table-core.js';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /**
   * What this column sorts on. Omit and the column is not sortable — which is
   * the right answer for a column of buttons.
   */
  sortValue?: (row: T) => SortableValue;
  align?: 'left' | 'right';
  /** Columns a reader may hide. The first column is never hideable. */
  hideable?: boolean;
  defaultHidden?: boolean;
  /**
   * A width **utility class** — `w-24`, `w-1/3` — not a CSS length. It used to
   * be a length in a `style` attribute, which the web tier's policy refuses,
   * so the column silently took its natural width instead. A literal class at
   * the call site is a width Tailwind can actually generate.
   */
  widthClass?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowId: (row: T) => string;
  /**
   * Required. A table without a caption is a grid a screen reader announces
   * with no idea what it holds, and it costs one sentence to fix.
   */
  caption: string;
  /** Hides the caption visually. It stays in the accessibility tree. */
  captionHidden?: boolean;
  /** Turns on the filter box. Needs `searchText` to know what to match. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowActivate?: (row: T) => void;
  className?: string;
}

/**
 * The one table.
 *
 * It is a `role="grid"` with a roving tabindex rather than a list of focusable
 * rows: that gives one tab stop for the whole table and arrow keys inside it,
 * so a reader tabbing through a screen does not have to press Tab forty times
 * to get past a backlog. The movement rules live in `data-table-core.ts` and
 * are tested there.
 *
 * Sorting, filtering and column visibility are **client state on purpose** —
 * they are how one reader looks at data, not a decision worth persisting, and
 * every one of them is reversible in a click.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  captionHidden = false,
  searchText,
  searchPlaceholder = 'Filter…',
  emptyTitle = 'Nothing here',
  emptyDescription = 'No rows match the current filter.',
  onRowActivate,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)),
  );
  const [focus, setFocus] = useState<GridPosition>({ row: -1, col: 0 });
  const cells = useRef(new Map<string, HTMLElement>());

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.has(column.id)),
    [columns, hidden],
  );

  const visibleRows = useMemo(() => {
    const filtered = searchText ? filterRows(rows, query, searchText) : [...rows];
    const column = sort ? columns.find((c) => c.id === sort.columnId) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const sortValue = column.sortValue;
    return sortRows(filtered, sort, (row) => sortValue(row));
  }, [rows, query, searchText, sort, columns]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableElement>) => {
      if (!GRID_KEYS.has(event.key)) return;

      const next = moveFocus(
        focus,
        event.key,
        { rows: visibleRows.length, cols: visibleColumns.length },
        // Meta as well as Control, so the shortcut is the one a Mac reader
        // already has in their fingers.
        { ctrl: event.ctrlKey || event.metaKey },
      );
      if (next.row === focus.row && next.col === focus.col) return;

      event.preventDefault();
      setFocus(next);
      cells.current.get(`${String(next.row)}:${String(next.col)}`)?.focus();
    },
    [focus, visibleRows.length, visibleColumns.length],
  );

  const registerCell = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element) cells.current.set(key, element);
      else cells.current.delete(key);
    },
    [],
  );

  const isFocused = (row: number, col: number): boolean => focus.row === row && focus.col === col;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(searchText ?? columns.some((c) => c.hideable !== false)) ? (
        <div className="flex items-center gap-2">
          {searchText ? (
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={searchPlaceholder}
              aria-label={`Filter ${caption}`}
              className="h-8 max-w-64"
            />
          ) : null}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto">
                <Columns3 />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52">
              <fieldset className="flex flex-col gap-1">
                <legend className="sr-only">Visible columns</legend>
                {columns.map((column, index) => (
                  <label
                    key={column.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-1 py-1 text-sm text-ink',
                      'hover:bg-surface-page',
                      index === 0 && 'text-ink-muted',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent-solid"
                      checked={!hidden.has(column.id)}
                      // The first column carries the row's identity: hiding it
                      // leaves a table of attributes belonging to nothing.
                      disabled={index === 0 || column.hideable === false}
                      onChange={(event) => {
                        setHidden((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.delete(column.id);
                          else next.add(column.id);
                          return next;
                        });
                      }}
                    />
                    {column.header}
                  </label>
                ))}
              </fieldset>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border-hairline bg-surface-raised">
        <table
          role="grid"
          onKeyDown={onKeyDown}
          className="w-full border-collapse text-sm"
          aria-rowcount={visibleRows.length + 1}
        >
          <caption
            className={cn(
              'px-3 py-2 text-left text-xs text-ink-secondary',
              captionHidden && 'sr-only',
            )}
          >
            {caption}
          </caption>

          <thead>
            <tr className="border-b border-border-hairline">
              {visibleColumns.map((column, col) => {
                const sorted = sort?.columnId === column.id ? sort.direction : undefined;
                const SortIcon =
                  sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : column.sortValue
                            ? 'none'
                            : undefined
                    }
                    className={cn(
                      'px-3 py-2 font-medium text-ink-secondary',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.widthClass,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        ref={registerCell(`-1:${String(col)}`)}
                        type="button"
                        tabIndex={isFocused(-1, col) ? 0 : -1}
                        onFocus={() => {
                          setFocus({ row: -1, col });
                        }}
                        onClick={() => {
                          setSort((current) => cycleSort(current, column.id));
                        }}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm hover:text-ink',
                          column.align === 'right' && 'flex-row-reverse',
                          FOCUS_RING_RAISED,
                        )}
                      >
                        {column.header}
                        <SortIcon className="size-3" aria-hidden="true" />
                      </button>
                    ) : (
                      <span
                        ref={registerCell(`-1:${String(col)}`)}
                        tabIndex={isFocused(-1, col) ? 0 : -1}
                        className={cn('inline-block rounded-sm', FOCUS_RING_RAISED)}
                      >
                        {column.header}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  'border-b border-border-hairline last:border-0',
                  'hover:bg-surface-page',
                  focus.row === rowIndex && 'bg-surface-page',
                )}
              >
                {visibleColumns.map((column, col) => (
                  <td
                    key={column.id}
                    ref={registerCell(`${String(rowIndex)}:${String(col)}`)}
                    tabIndex={isFocused(rowIndex, col) ? 0 : -1}
                    onFocus={() => {
                      setFocus({ row: rowIndex, col });
                    }}
                    onClick={() => {
                      setFocus({ row: rowIndex, col });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && onRowActivate) {
                        event.preventDefault();
                        onRowActivate(row);
                      }
                    }}
                    className={cn(
                      'px-3 py-2 align-middle text-ink',
                      column.align === 'right' && 'text-right tabular-nums',
                      FOCUS_RING_RAISED,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {visibleRows.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            className="m-3 border-0"
            action={
              query === '' ? undefined : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                  }}
                >
                  Clear the filter
                </Button>
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
