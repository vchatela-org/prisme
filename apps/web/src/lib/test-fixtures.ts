import type { FocusEntry, Initiative } from './contracts';

/**
 * Builders for the tests in this directory.
 *
 * Invented data, as everything in this repository's tests must be
 * (`docs/17-privacy.md`). The titles are deliberately shaped like the ones in
 * `fixtures/` — a result, not an activity — so a test reads like the screen it
 * is about, and never like somebody's actual week.
 */
export function anInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: 'init-001',
    title: 'Workshop bench finished',
    areaKey: 'craft',
    projectId: null,
    status: 'next',
    value: 8,
    timeCriticality: 5,
    risk: 3,
    size: 5,
    deadline: null,
    earliestStart: null,
    plannedStart: null,
    plannedEnd: null,
    dependsOn: [],
    externalPageId: null,
    externalAnchorId: null,
    origin: 'created_in_prisme',
    doneAt: null,
    droppedReason: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    score: null,
    rollup: {
      openTaskCount: 2,
      totalTaskCount: 5,
      progressPct: 60,
      lastActivity: '2026-09-14T09:00:00.000Z',
    },
    blockedBy: [],
    sizedForNow: true,
    ...overrides,
  };
}

export function aFocusEntry(overrides: Partial<FocusEntry> = {}): FocusEntry {
  return {
    initiative: anInitiative({ status: 'now' }),
    score: 7.5,
    rank: 1,
    proposedStatus: 'unchanged',
    reason: 'in_flight',
    priority: 'high',
    blockedBy: [],
    daysUntilDeadline: null,
    deadlineAtRisk: false,
    ...overrides,
  };
}
