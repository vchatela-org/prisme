import type { DocRecord, ExternalProject, ExternalSection, ExternalTask } from '@prisme/connectors';
import { locationKey } from '../reconcile/types.js';
import type { ExternalObject } from './types.js';

/**
 * Both tools, folded into one shape.
 *
 * The resolution rules are written once, against {@link ExternalObject}, and
 * this is the only file that knows either tool's vocabulary. Two mappings that
 * drift apart would mean a task and a page being matched by subtly different
 * rules, and nobody would notice until something was bound to the wrong thing.
 *
 * Pure: counts are computed from the collections handed in, nothing is fetched,
 * and no property name from the workspace reaches a return value. The
 * document tool keys its properties by **names that are instance data**
 * (W03's journal entry), so the two that are read here are named by the caller
 * and never logged.
 */

export interface AdaptOptions {
  /** `area_mapping`, keyed by {@link locationKey}. */
  readonly areaByLocation: ReadonlyMap<string, string>;
  /** Each area's lane, so a signal or a run item is recognised by where it lives. */
  readonly laneByArea: ReadonlyMap<string, 'area' | 'run' | 'signals'>;
  /**
   * The property carrying a prisme identifier an earlier automation wrote —
   * **Guard 4**. Its name is instance data, so it arrives as configuration and
   * is never written down here. Absent means the workspace has no such mapping,
   * which is a fact about the instance rather than an error.
   */
  readonly mappingProperty?: string | undefined;
  /** The property holding a takeaway's type. Same reasoning as above. */
  readonly takeawayTypeProperty?: string | undefined;
}

/** The area an external location folds into, following the section then the project. */
export function areaOfLocation(
  options: AdaptOptions,
  projectId: string,
  sectionId?: string,
): string | undefined {
  // Most specific first: a section-level mapping overrides its project's, which
  // is what makes one project able to feed two areas.
  if (sectionId !== undefined) {
    const bySection = options.areaByLocation.get(locationKey(projectId, sectionId));
    if (bySection !== undefined) return bySection;
  }
  return options.areaByLocation.get(locationKey(projectId));
}

function laneOf(options: AdaptOptions, areaKey: string | undefined) {
  return areaKey === undefined ? undefined : options.laneByArea.get(areaKey);
}

/**
 * Tasks, with their structure counted from the same list.
 *
 * `childCount` is derived here rather than trusted from the tool, because the
 * question the classifier asks — *does anything hang off this?* — is about the
 * subtree prisme can actually see. A child the read did not return is a child
 * that cannot be adopted either.
 */
export function adaptTasks(
  tasks: readonly ExternalTask[],
  options: AdaptOptions,
): readonly ExternalObject[] {
  const children = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentId === undefined) continue;
    children.set(task.parentId, (children.get(task.parentId) ?? 0) + 1);
  }

  return tasks.map((task) => {
    const areaKey = areaOfLocation(options, task.projectId, task.sectionId);
    const lane = laneOf(options, areaKey);
    return {
      kind: 'task',
      externalId: task.externalId,
      title: task.content,
      ...(areaKey === undefined ? {} : { areaKey }),
      ...(lane === undefined ? {} : { areaLane: lane }),
      closed: task.completed,
      childCount: children.get(task.externalId) ?? 0,
      ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
      recurring: task.due?.isRecurring ?? false,
      labels: task.labels,
    } satisfies ExternalObject;
  });
}

/** Projects, with their sections counted from the same snapshot. */
export function adaptProjects(
  projects: readonly ExternalProject[],
  sections: readonly ExternalSection[],
  options: AdaptOptions,
): readonly ExternalObject[] {
  const counts = new Map<string, number>();
  for (const section of sections) {
    if (section.archived) continue;
    counts.set(section.projectId, (counts.get(section.projectId) ?? 0) + 1);
  }

  return projects.map((project) => {
    const areaKey = areaOfLocation(options, project.externalId);
    const lane = laneOf(options, areaKey);
    return {
      kind: 'project',
      externalId: project.externalId,
      title: project.name,
      ...(areaKey === undefined ? {} : { areaKey }),
      ...(lane === undefined ? {} : { areaLane: lane }),
      closed: project.archived,
      sectionCount: counts.get(project.externalId) ?? 0,
    } satisfies ExternalObject;
  });
}

/**
 * A takeaway's type, from the property the instance happens to call it.
 *
 * Anything that is not recognisably one of the two values is left **unset**
 * rather than guessed. A takeaway whose type prisme cannot read stays a
 * takeaway, which is the safe direction: the wrong guess puts a principle in
 * the backlog, and principles are the things that should never be there.
 */
function takeawayTypeOf(record: DocRecord, property: string | undefined) {
  if (property === undefined) return undefined;
  const value = record.properties.get(property);
  if (value === undefined) return undefined;
  const raw =
    value.kind === 'select' || value.kind === 'status'
      ? value.value
      : value.kind === 'multi_select'
        ? (value.values[0] ?? null)
        : null;
  if (raw === null) return undefined;
  const lowered = raw.trim().toLowerCase();
  if (lowered.startsWith('action')) return 'action' as const;
  if (lowered.startsWith('principe') || lowered.startsWith('principle'))
    return 'principle' as const;
  return undefined;
}

function mappedIdOf(record: DocRecord, property: string | undefined) {
  if (property === undefined) return undefined;
  const value = record.properties.get(property);
  if (value === undefined) return undefined;
  const raw =
    value.kind === 'rich_text'
      ? value.text.text
      : value.kind === 'url'
        ? value.value
        : value.kind === 'select'
          ? value.value
          : null;
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** Document-tool records, one per store, carrying the role they came from. */
export function adaptDocRecords(
  records: readonly DocRecord[],
  options: AdaptOptions,
): readonly ExternalObject[] {
  return records.map((record) => {
    const takeawayType = takeawayTypeOf(record, options.takeawayTypeProperty);
    const mappedPrismeId = mappedIdOf(record, options.mappingProperty);
    return {
      kind: 'page',
      externalId: record.externalId,
      title: record.title,
      closed: record.archived,
      role: record.role,
      ...(takeawayType === undefined ? {} : { takeawayType }),
      ...(mappedPrismeId === undefined ? {} : { mappedPrismeId }),
    } satisfies ExternalObject;
  });
}
