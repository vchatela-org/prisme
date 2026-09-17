import { describe, expect, it } from 'vitest';
import {
  compareValues,
  cycleSort,
  filterRows,
  GRID_KEYS,
  moveFocus,
  sortRows,
  type GridPosition,
  type SortableValue,
} from './data-table-core.js';

interface Row {
  id: string;
  title: string;
  score: number | null;
  deadline: string | null;
}

/** Fixture-shaped rows: invented titles, as everything in this repo must be. */
const ROWS: Row[] = [
  { id: 'a', title: 'Garage shelving installed', score: 3, deadline: null },
  { id: 'b', title: 'Passport renewed', score: 9, deadline: '2026-09-25' },
  { id: 'c', title: 'Draught-proofing done', score: 3, deadline: '2026-11-15' },
  { id: 'd', title: 'Volunteer rota agreed', score: null, deadline: null },
];

const get = (row: Row, columnId: string): SortableValue =>
  (row as unknown as Record<string, SortableValue>)[columnId];
const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

describe('cycleSort', () => {
  it('goes ascending, descending, then back to the table’s own order', () => {
    const first = cycleSort(null, 'score');
    expect(first).toEqual({ columnId: 'score', direction: 'asc' });

    const second = cycleSort(first, 'score');
    expect(second).toEqual({ columnId: 'score', direction: 'desc' });

    expect(cycleSort(second, 'score')).toBeNull();
  });

  it('starts a different column from ascending rather than inheriting', () => {
    expect(cycleSort({ columnId: 'score', direction: 'desc' }, 'title')).toEqual({
      columnId: 'title',
      direction: 'asc',
    });
  });
});

describe('compareValues', () => {
  it('compares numbers numerically, not as text', () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues('9', '10')).toBeLessThan(0);
  });

  it('compares dates and booleans', () => {
    expect(compareValues(new Date('2026-01-01'), new Date('2026-06-01'))).toBeLessThan(0);
    expect(compareValues(false, true)).toBeLessThan(0);
  });

  it('sorts accented text where a French reader expects it', () => {
    expect(compareValues('école', 'zèbre')).toBeLessThan(0);
    expect(compareValues('école', 'ecole')).toBe(0);
  });

  it('puts a blank after a value, whatever the blank is', () => {
    for (const blank of [null, undefined, '']) {
      expect(compareValues(blank, 1)).toBeGreaterThan(0);
      expect(compareValues(1, blank)).toBeLessThan(0);
    }
    expect(compareValues(null, undefined)).toBe(0);
  });
});

describe('sortRows', () => {
  it('returns the rows untouched when nothing is sorted', () => {
    expect(ids(sortRows(ROWS, null, get))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never mutates the array it was given', () => {
    const original = [...ROWS];
    sortRows(ROWS, { columnId: 'score', direction: 'desc' }, get);
    expect(ROWS).toEqual(original);
  });

  it('is stable — equal rows keep the order they arrived in', () => {
    // 'a' and 'c' both score 3 and must stay in that order.
    expect(ids(sortRows(ROWS, { columnId: 'score', direction: 'asc' }, get))).toEqual([
      'a',
      'c',
      'b',
      'd',
    ]);
  });

  it('keeps blanks last in both directions', () => {
    const asc = ids(sortRows(ROWS, { columnId: 'deadline', direction: 'asc' }, get));
    const desc = ids(sortRows(ROWS, { columnId: 'deadline', direction: 'desc' }, get));

    expect(asc).toEqual(['b', 'c', 'a', 'd']);
    expect(desc).toEqual(['c', 'b', 'a', 'd']);
    // The two blanks are last in both, and in their original relative order.
    expect(asc.slice(-2)).toEqual(['a', 'd']);
    expect(desc.slice(-2)).toEqual(['a', 'd']);
  });

  it('reverses the real values when the direction flips', () => {
    const asc = ids(sortRows(ROWS, { columnId: 'title', direction: 'asc' }, get));
    const desc = ids(sortRows(ROWS, { columnId: 'title', direction: 'desc' }, get));
    expect(desc).toEqual([...asc].reverse());
  });

  it('reads each cell once per sort', () => {
    let reads = 0;
    const counting = (row: Row, columnId: string): SortableValue => {
      reads += 1;
      return get(row, columnId);
    };
    sortRows(ROWS, { columnId: 'score', direction: 'asc' }, counting);
    expect(reads).toBe(ROWS.length);
  });
});

describe('filterRows', () => {
  it('matches anywhere in the text, case-insensitively', () => {
    expect(ids(filterRows(ROWS, 'renewed', (r) => r.title))).toEqual(['b']);
    expect(ids(filterRows(ROWS, 'PASSPORT', (r) => r.title))).toEqual(['b']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(filterRows(ROWS, '', (r) => r.title)).toHaveLength(4);
    expect(filterRows(ROWS, '   ', (r) => r.title)).toHaveLength(4);
  });

  it('does not match loosely — a table filter that guesses loses trust', () => {
    expect(filterRows(ROWS, 'psprt', (r) => r.title)).toEqual([]);
  });

  it('never mutates the array it was given', () => {
    const original = [...ROWS];
    filterRows(ROWS, 'passport', (r) => r.title);
    expect(ROWS).toEqual(original);
  });
});

describe('moveFocus', () => {
  const size = { rows: 4, cols: 3 };
  const at = (row: number, col: number): GridPosition => ({ row, col });

  it('moves one cell per arrow key', () => {
    expect(moveFocus(at(1, 1), 'ArrowDown', size)).toEqual(at(2, 1));
    expect(moveFocus(at(1, 1), 'ArrowUp', size)).toEqual(at(0, 1));
    expect(moveFocus(at(1, 1), 'ArrowRight', size)).toEqual(at(1, 2));
    expect(moveFocus(at(1, 1), 'ArrowLeft', size)).toEqual(at(1, 0));
  });

  it('clamps instead of wrapping', () => {
    expect(moveFocus(at(3, 2), 'ArrowDown', size)).toEqual(at(3, 2));
    expect(moveFocus(at(3, 2), 'ArrowRight', size)).toEqual(at(3, 2));
    expect(moveFocus(at(0, 0), 'ArrowLeft', size)).toEqual(at(0, 0));
  });

  it('lets a reader arrow up into the header and no further', () => {
    expect(moveFocus(at(0, 1), 'ArrowUp', size)).toEqual(at(-1, 1));
    expect(moveFocus(at(-1, 1), 'ArrowUp', size)).toEqual(at(-1, 1));
    expect(moveFocus(at(-1, 1), 'ArrowDown', size)).toEqual(at(0, 1));
  });

  it('takes Home and End to the ends of the row, and Ctrl to the ends of the grid', () => {
    expect(moveFocus(at(2, 1), 'Home', size)).toEqual(at(2, 0));
    expect(moveFocus(at(2, 1), 'End', size)).toEqual(at(2, 2));
    expect(moveFocus(at(2, 1), 'Home', size, { ctrl: true })).toEqual(at(-1, 0));
    expect(moveFocus(at(2, 1), 'End', size, { ctrl: true })).toEqual(at(3, 2));
  });

  it('pages by ten rows, clamped', () => {
    expect(moveFocus(at(0, 0), 'PageDown', { rows: 40, cols: 3 })).toEqual(at(10, 0));
    expect(moveFocus(at(0, 0), 'PageDown', size)).toEqual(at(3, 0));
    expect(moveFocus(at(3, 0), 'PageUp', size)).toEqual(at(-1, 0));
  });

  it('returns the same position for a key it does not own, so the browser keeps it', () => {
    for (const key of ['Tab', 'Enter', 'a', 'Escape', ' ']) {
      expect(moveFocus(at(1, 1), key, size), key).toEqual(at(1, 1));
      expect(GRID_KEYS.has(key)).toBe(false);
    }
  });

  it('survives an empty table', () => {
    const empty = { rows: 0, cols: 0 };
    expect(moveFocus(at(-1, 0), 'ArrowDown', empty)).toEqual(at(-1, 0));
    expect(moveFocus(at(-1, 0), 'End', empty, { ctrl: true })).toEqual(at(-1, 0));
  });

  it('claims exactly the keys it handles', () => {
    for (const key of GRID_KEYS) {
      expect(moveFocus(at(1, 1), key, size), key).not.toEqual(at(1, 1));
    }
  });
});
