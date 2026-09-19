/**
 * Row selection for the backlog's bulk actions.
 *
 * Bulk selection exists for review work: a weekly review moves six things from
 * `next` to `later` in one decision, and doing that one dialog at a time is how
 * a review stops happening. The rules are small and entirely about edge cases —
 * a shift-click with no anchor, an anchor that has since been filtered away —
 * so they live here with tests rather than inside a component where each one is
 * a bug found by a person.
 *
 * The selection is a set of ids, never of rows: a row object is stale the
 * moment the list re-renders after a status change, and a selection holding
 * stale rows applies its next action to what used to be there.
 */

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  /** The last row toggled without shift: where a range starts from. */
  readonly anchor: string | undefined;
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchor: undefined };

export function isSelected(state: SelectionState, id: string): boolean {
  return state.ids.has(id);
}

/** Toggle one row, and make it the anchor for a later range. */
export function toggle(state: SelectionState, id: string): SelectionState {
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

/**
 * Select every row between the anchor and `id`, in whichever order they appear.
 *
 * With no anchor, or with an anchor no longer in the list — filtered away,
 * moved to another status, paged past — this degrades to a plain toggle rather
 * than selecting nothing or, worse, everything.
 */
export function selectRange(
  state: SelectionState,
  id: string,
  visibleIds: readonly string[],
): SelectionState {
  const anchor = state.anchor;
  if (anchor === undefined) return toggle(state, id);

  const from = visibleIds.indexOf(anchor);
  const to = visibleIds.indexOf(id);
  if (from === -1 || to === -1) return toggle(state, id);

  const ids = new Set(state.ids);
  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const between = visibleIds[index];
    if (between !== undefined) ids.add(between);
  }
  // The anchor stays put, so shift-clicking further extends the same range
  // rather than starting a new one from where the last one ended.
  return { ids, anchor };
}

/** Select every visible row, or clear when they are all already selected. */
export function toggleAll(state: SelectionState, visibleIds: readonly string[]): SelectionState {
  if (allSelected(state, visibleIds)) return { ids: new Set(), anchor: undefined };
  return { ids: new Set(visibleIds), anchor: state.anchor };
}

export function allSelected(state: SelectionState, visibleIds: readonly string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => state.ids.has(id));
}

/**
 * Drop ids that are no longer on screen.
 *
 * Called when the list changes underneath the selection. A bulk action that
 * silently included three rows the reader can no longer see is the bulk-action
 * failure worth designing against.
 */
export function pruneTo(state: SelectionState, visibleIds: readonly string[]): SelectionState {
  const visible = new Set(visibleIds);
  const ids = new Set([...state.ids].filter((id) => visible.has(id)));
  if (ids.size === state.ids.size) return state;
  return {
    ids,
    anchor: state.anchor !== undefined && visible.has(state.anchor) ? state.anchor : undefined,
  };
}

/** "3 selected", or the empty string when nothing is. */
export function selectionLabel(state: SelectionState): string {
  const count = state.ids.size;
  return count === 0 ? '' : `${String(count)} selected`;
}
