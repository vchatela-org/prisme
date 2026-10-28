import type { TaskLocations, Unattributed } from './contracts';
import { nameLocation } from './settings-view';

/**
 * Completions the share chart counted toward no area, as rows a person can
 * act on (S9).
 *
 * A general project split across areas by section leaves a task at its root —
 * in no section — matching no mapping. The chart left it out silently. Each
 * row names where the completions happened and offers the mapping that would
 * catch them: the **rest** of a project whose sections are mapped (a mapping of
 * the project itself, which sections still outrank), or the whole of a project
 * nothing maps.
 */
export interface UnattributedRow {
  readonly key: string;
  /** Null for a completion the task tool reported with no project. */
  readonly projectId: string | null;
  readonly where: string;
  readonly completions: number;
  readonly action: 'map_rest' | 'map_project' | null;
}

export function unattributedRows(
  data: Unattributed,
  locations: TaskLocations | null,
): readonly UnattributedRow[] {
  return data.items.map((item) => {
    const projectId = item.externalProjectId;
    if (projectId === null) {
      return {
        key: 'no-project',
        projectId: null,
        where: 'No project',
        completions: item.completions,
        action: null,
      };
    }
    const name = nameLocation(locations, projectId, item.externalSectionId);
    const where =
      item.externalSectionId === null
        ? item.partlyMapped
          ? `${name.project} — tasks in no section`
          : name.project
        : `${name.project} / ${name.section ?? item.externalSectionId}`;
    return {
      key: `${projectId}/${item.externalSectionId ?? ''}`,
      projectId,
      where,
      completions: item.completions,
      action: item.partlyMapped ? 'map_rest' : 'map_project',
    };
  });
}

/** The sentence above the list, or null when everything counted. */
export function unattributedSummary(data: Unattributed): string | null {
  if (data.total === 0) return null;
  const things = data.total === 1 ? '1 completion' : `${String(data.total)} completions`;
  return `${things} in the last ${String(data.windowWeeks)} weeks counted toward no area, so the shares above leave them out.`;
}
