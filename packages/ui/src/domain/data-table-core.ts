/**
 * Sorting, filtering and grid movement for `<DataTable>` — pure, so the
 * awkward cases are settled by tests rather than by clicking around.
 *
 * Wave 4 puts three agents in `apps/web` at once. If each writes its own
 * table, the repository ends up with three sort comparators that disagree
 * about where a blank cell goes, and a reader who learns one screen learns
 * nothing about the next.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/**
 * Click a column: ascending, then descending, then back to the table's own
 * order. The third state matters — without it there is no way back to the
 * order the server chose, which for a ranked backlog is the meaningful one.
 */
export function cycleSort(current: SortState | null, columnId: string): SortState | null {
  if (current === null || current.columnId !== columnId) {
    return { columnId, direction: 'asc' };
  }
  return current.direction === 'asc' ? { columnId, direction: 'desc' } : null;
}

/**
 * What a column may sort on.
 *
 * Deliberately not `unknown`: a comparator handed an object has nothing
 * useful to do with it and would silently sort a column by the text
 * `[object Object]` — every row equal, the table apparently sorted. Saying so
 * in the type means a column that wants to sort by something structured has to
 * say which part of it, at the call site, where the answer is known.
 */
export type SortableValue = string | number | boolean | Date | null | undefined;

/**
 * One comparator for the whole system.
 *
 * Blanks sort last in **both** directions rather than flipping to the top on
 * descending: an empty deadline is an absence, not a very early date, and a
 * reader reversing a column to see the latest deadlines does not want a screen
 * of blanks.
 */
export function compareValues(a: SortableValue, b: SortableValue): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();

  // Locale-aware, because the instance's data is French: "école" belongs
  // beside "ecole", not after "z".
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Narrowed by the blank check above; `null` and `undefined` cannot arrive. */
function text(value: NonNullable<SortableValue>): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * A **stable** sort: rows the comparator calls equal keep the order they
 * arrived in. That is what makes a secondary sort possible, and what stops a
 * table reshuffling itself when a value updates.
 */
export function sortRows<T>(
  rows: readonly T[],
  state: SortState | null,
  getValue: (row: T, columnId: string) => SortableValue,
): T[] {
  if (state === null) return [...rows];

  const sign = state.direction === 'asc' ? 1 : -1;
  // Read each cell once: `getValue` may be doing real work, and calling it
  // inside the comparator makes the cost O(n log n) instead of O(n).
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: getValue(row, state.columnId),
  }));

  decorated.sort((left, right) => {
    const leftBlank = isBlank(left.value);
    const rightBlank = isBlank(right.value);
    // The sign is applied to real comparisons only, so blanks stay last
    // whichever way the column is pointing.
    if (leftBlank && rightBlank) return left.index - right.index;
    if (leftBlank) return 1;
    if (rightBlank) return -1;

    const compared = compareValues(left.value, right.value);
    return compared === 0 ? left.index - right.index : compared * sign;
  });

  return decorated.map(({ row }) => row);
}

/**
 * A type predicate rather than a plain boolean, so that `const blank =
 * isBlank(value)` narrows the value for everything after it — which is what
 * lets `text()` below promise it never sees a null.
 */
function isBlank(value: SortableValue): value is null | undefined | '' {
  return value === null || value === undefined || value === '';
}

/**
 * Plain substring matching over whatever text the caller says a row has.
 * Deliberately not fuzzy: a table filter that matches loosely hides rows a
 * reader can see should be there, and they stop trusting the count.
 */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  getSearchText: (row: T) => string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) => getSearchText(row).toLowerCase().includes(needle));
}

export interface GridPosition {
  readonly row: number;
  readonly col: number;
}

export interface GridSize {
  /** Body rows. Row -1 is the header, which is always reachable. */
  readonly rows: number;
  readonly cols: number;
}

/**
 * Where the focus goes for a key press in a grid.
 *
 * Movement is clamped rather than wrapped: arrowing off the last row and
 * landing back at the top is disorientating, and with a header row above
 * there is no sensible thing for "up from the top" to mean. Row -1 is the
 * header, so a reader can always arrow up into the sort controls.
 *
 * Returns the same position when nothing should move, so a caller can tell
 * whether to call `preventDefault` — an unhandled key must stay available to
 * the browser.
 */
export function moveFocus(
  position: GridPosition,
  key: string,
  size: GridSize,
  modifiers: { ctrl?: boolean } = {},
): GridPosition {
  const lastRow = size.rows - 1;
  const lastCol = size.cols - 1;
  const clampRow = (row: number): number => Math.max(-1, Math.min(row, lastRow));
  const clampCol = (col: number): number => Math.max(0, Math.min(col, lastCol));

  switch (key) {
    case 'ArrowDown':
      return { ...position, row: clampRow(position.row + 1) };
    case 'ArrowUp':
      return { ...position, row: clampRow(position.row - 1) };
    case 'ArrowRight':
      return { ...position, col: clampCol(position.col + 1) };
    case 'ArrowLeft':
      return { ...position, col: clampCol(position.col - 1) };
    case 'Home':
      return modifiers.ctrl ? { row: -1, col: 0 } : { ...position, col: 0 };
    case 'End':
      return modifiers.ctrl
        ? { row: clampRow(lastRow), col: clampCol(lastCol) }
        : { ...position, col: clampCol(lastCol) };
    case 'PageDown':
      return { ...position, row: clampRow(position.row + 10) };
    case 'PageUp':
      return { ...position, row: clampRow(position.row - 10) };
    default:
      return position;
  }
}

/** The keys `moveFocus` claims. Anything else belongs to the browser. */
export const GRID_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'PageDown',
  'PageUp',
]);
