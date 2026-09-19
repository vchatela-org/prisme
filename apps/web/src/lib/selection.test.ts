import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  allSelected,
  isSelected,
  pruneTo,
  selectRange,
  selectionLabel,
  toggle,
  toggleAll,
} from './selection';

const VISIBLE = ['a', 'b', 'c', 'd'];

describe('toggle', () => {
  it('adds, removes, and moves the anchor each time', () => {
    const one = toggle(EMPTY_SELECTION, 'b');
    expect(isSelected(one, 'b')).toBe(true);
    expect(one.anchor).toBe('b');

    const none = toggle(one, 'b');
    expect(isSelected(none, 'b')).toBe(false);
    expect(none.anchor).toBe('b');
  });
});

describe('selectRange', () => {
  it('selects everything between the anchor and the row, in either direction', () => {
    const anchored = toggle(EMPTY_SELECTION, 'b');

    expect([...selectRange(anchored, 'd', VISIBLE).ids].sort()).toEqual(['b', 'c', 'd']);
    expect([...selectRange(toggle(EMPTY_SELECTION, 'd'), 'b', VISIBLE).ids].sort()).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('keeps the anchor, so a second shift-click extends the same range', () => {
    const first = selectRange(toggle(EMPTY_SELECTION, 'b'), 'c', VISIBLE);
    const second = selectRange(first, 'd', VISIBLE);

    expect(second.anchor).toBe('b');
    expect([...second.ids].sort()).toEqual(['b', 'c', 'd']);
  });

  it('degrades to a plain toggle with no anchor', () => {
    expect([...selectRange(EMPTY_SELECTION, 'c', VISIBLE).ids]).toEqual(['c']);
  });

  it('degrades to a plain toggle when the anchor has been filtered away', () => {
    const anchored = toggle(EMPTY_SELECTION, 'z');
    expect([...selectRange(anchored, 'c', VISIBLE).ids].sort()).toEqual(['c', 'z']);
  });
});

describe('toggleAll', () => {
  it('selects every visible row, then clears', () => {
    const all = toggleAll(EMPTY_SELECTION, VISIBLE);
    expect(allSelected(all, VISIBLE)).toBe(true);

    expect(toggleAll(all, VISIBLE).ids.size).toBe(0);
  });

  it('is not "all selected" when there is nothing on screen', () => {
    expect(allSelected(EMPTY_SELECTION, [])).toBe(false);
  });
});

describe('pruneTo', () => {
  it('drops what a reader can no longer see', () => {
    const selected = toggle(toggle(EMPTY_SELECTION, 'a'), 'z');

    const pruned = pruneTo(selected, VISIBLE);
    expect([...pruned.ids]).toEqual(['a']);
    expect(pruned.anchor).toBeUndefined();
  });

  it('returns the same object when nothing went away', () => {
    const selected = toggle(EMPTY_SELECTION, 'a');
    expect(pruneTo(selected, VISIBLE)).toBe(selected);
  });
});

describe('selectionLabel', () => {
  it('says nothing when nothing is selected', () => {
    expect(selectionLabel(EMPTY_SELECTION)).toBe('');
    expect(selectionLabel(toggle(EMPTY_SELECTION, 'a'))).toBe('1 selected');
  });
});
