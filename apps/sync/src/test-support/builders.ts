import type { ExternalTask } from '@prisme/connectors';
import { parseCalendarDate } from '@prisme/domain';
import { managedLine } from '../reconcile/description.js';
import { DEFAULT_ANCHOR_LABEL, DEFAULT_STATUS_REQUEST_PREFIX } from '../reconcile/labels.js';
import {
  lastAppliedKey,
  locationKey,
  type DesiredAnchor,
  type DesiredState,
  type LastAppliedIndex,
  type ObservedState,
  type PlannerConfig,
} from '../reconcile/types.js';

/**
 * Fixture builders for the planner's tests.
 *
 * **Synthetic throughout.** Titles here are invented English strings and ids
 * are obviously not a real tool's — the same rule the connectors fixtures
 * follow, for the same reason (docs/17-privacy.md).
 */

/** A calendar date, branded. `'2026-10-01'` is a string; a deadline is a day. */
export const day = parseCalendarDate;

export const CONFIG: PlannerConfig = {
  anchorLabel: DEFAULT_ANCHOR_LABEL,
  statusRequestPrefix: DEFAULT_STATUS_REQUEST_PREFIX,
  baseUrl: 'https://prisme.example',
};

export const PROJECT = 'project-0001';
export const SECTION = 'section-0001';

export function anchorOf(overrides: Partial<DesiredAnchor> = {}): DesiredAnchor {
  return {
    initiativeId: 'init-001',
    title: 'Ship the first slice',
    areaKey: 'craft',
    status: 'now',
    origin: 'created_in_prisme',
    priority: 'highest',
    location: { projectId: PROJECT, sectionId: SECTION },
    ...overrides,
  };
}

export function desiredOf(
  anchors: readonly DesiredAnchor[],
  areas: readonly (readonly [string, string | undefined, string])[] = [[PROJECT, SECTION, 'craft']],
): DesiredState {
  return {
    anchors,
    areaByLocation: new Map(
      areas.map(([projectId, sectionId, areaKey]) => [locationKey(projectId, sectionId), areaKey]),
    ),
  };
}

export function taskOf(overrides: Partial<ExternalTask> = {}): ExternalTask {
  const description = overrides.description ?? {
    text: managedLine(CONFIG.baseUrl, 'init-001'),
    segments: [],
    urls: [],
  };
  return {
    externalId: 'task-0001',
    projectId: PROJECT,
    sectionId: SECTION,
    content: 'Ship the first slice',
    labels: [DEFAULT_ANCHOR_LABEL],
    priority: 'highest',
    completed: false,
    order: 1,
    urls: [],
    contentHash: 'hash',
    ...overrides,
    description,
  };
}

export function observedOf(tasks: readonly ExternalTask[]): ObservedState {
  return { tasks };
}

export function lastAppliedOf(
  entries: readonly (readonly [string, string, string, string | null])[],
  at = new Date('2026-09-17T08:00:00Z'),
): LastAppliedIndex {
  return new Map(
    entries.map(([entityKind, entityId, field, value]) => [
      lastAppliedKey(entityKind, entityId, field),
      { entityKind, entityId, field, value, appliedAt: at },
    ]),
  );
}

/** Adds entries to an index — for the fields only some tests care about, such as `location`. */
export function plus(
  index: LastAppliedIndex,
  entries: readonly (readonly [string, string, string, string | null])[],
): LastAppliedIndex {
  return new Map([...index, ...lastAppliedOf(entries)]);
}

/** The five fields prisme has written on a freshly converged anchor. */
export function convergedAnchorState(
  externalId = 'task-0001',
  overrides: Partial<Record<string, string | null>> = {},
): LastAppliedIndex {
  return lastAppliedOf([
    ['anchor', externalId, 'title', overrides['title'] ?? 'Ship the first slice'],
    ['anchor', externalId, 'priority', overrides['priority'] ?? 'highest'],
    ['anchor', externalId, 'deadline', overrides['deadline'] ?? null],
    ['anchor', externalId, 'label', overrides['label'] ?? 'present'],
    [
      'anchor',
      externalId,
      'description',
      overrides['description'] ?? managedLine(CONFIG.baseUrl, 'init-001'),
    ],
  ]);
}
