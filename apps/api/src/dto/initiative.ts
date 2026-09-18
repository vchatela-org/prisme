import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import {
  areaKey,
  calendarDate,
  entityId,
  fibonacci,
  initiativeStatus,
  instant,
  origin,
  page,
  projectStatus,
  taskPriority,
} from './common.js';
import {
  INITIATIVE_READ_ONLY,
  INITIATIVE_STATUS_READ_ONLY,
  PROJECT_READ_ONLY,
} from './ownership.js';

/**
 * Initiatives — **the only scored unit** (ADR-0004) — with projects and the
 * read-only task mirror beside them.
 *
 * Note what the initiative DTO does *not* carry: no `wsjf`, no `score` column,
 * no `due`. The score arrives as its own object naming the method and version
 * that produced it (ADR-0006), because a bare number cannot be interrogated and
 * a ranking nobody can interrogate stops being trusted the first time it
 * surprises someone. `due` belongs to the task tool and appears only on a
 * mirrored task, where it is read and never written (ADR-0003).
 */

export const scoreDto = z.object({
  value: z.number(),
  methodId: z.string(),
  methodVersion: z.int(),
  /** Every intermediate the method used, so the number can be argued with. */
  factors: z.record(z.string(), z.number()),
  explain: z.string(),
  computedAt: instant,
});

export const rollupDto = z.object({
  openTaskCount: z.int(),
  totalTaskCount: z.int(),
  progressPct: z.number().nullable(),
  lastActivity: instant.nullable(),
});

export const initiativeDto = z.object({
  id: entityId,
  title: z.string(),
  areaKey,
  projectId: entityId.nullable(),
  status: initiativeStatus,
  value: fibonacci,
  timeCriticality: fibonacci,
  risk: fibonacci,
  size: fibonacci,
  /** A hard external constraint. prisme writes this outward; it never writes `due`. */
  deadline: calendarDate.nullable(),
  earliestStart: calendarDate.nullable(),
  /** Computed by the schedule engine, and read-only everywhere (∂). */
  plannedStart: calendarDate.nullable(),
  plannedEnd: calendarDate.nullable(),
  dependsOn: z.array(entityId),
  externalPageId: z.string().nullable(),
  externalAnchorId: z.string().nullable(),
  origin,
  doneAt: calendarDate.nullable(),
  droppedReason: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
  /** The latest row from the active method. Absent until a ranking has run. */
  score: scoreDto.nullable(),
  rollup: rollupDto,
  /** Dependencies that are neither `done` nor `dropped`. */
  blockedBy: z.array(entityId),
  /** Ready for `now` in the one respect a machine can check (docs/10-model.md §5). */
  sizedForNow: z.boolean(),
});

export const projectDto = z.object({
  id: entityId,
  name: z.string(),
  areaKey,
  status: projectStatus,
  deadline: calendarDate.nullable(),
  sections: z.array(z.string()),
  externalPageId: z.string().nullable(),
  externalProjectId: z.string().nullable(),
  origin,
  initiativeCount: z.int(),
  createdAt: instant,
  updatedAt: instant,
});

/**
 * A mirrored task. Everything here is the task tool's
 * (docs/11-ownership.md §5) — prisme counts this subtree and never copies it.
 */
export const taskDto = z.object({
  externalId: z.string(),
  externalParentId: z.string().nullable(),
  isAnchor: z.boolean(),
  completed: z.boolean(),
  completedAt: instant.nullable(),
  recordedMinutes: z.int().nullable(),
  /** Read for planned-versus-done. prisme never writes it. */
  due: calendarDate.nullable(),
  priority: taskPriority.nullable(),
  observedAt: instant,
});

export const InitiativeDto = named('Initiative', initiativeDto);
export const InitiativePageDto = named('InitiativePage', page(initiativeDto));
export const ProjectDto = named('Project', projectDto);
export const ProjectPageDto = named('ProjectPage', page(projectDto));
export const TaskListDto = named(
  'TaskList',
  z.object({ initiativeId: entityId, items: z.array(taskDto) }),
);
export const ScoreHistoryDto = named(
  'ScoreHistory',
  z.object({ initiativeId: entityId, items: z.array(scoreDto) }),
);

export const createInitiativeBody = defineWrite(
  'CreateInitiative',
  z.strictObject({
    title: z.string().min(1).max(500),
    areaKey,
    projectId: entityId.optional(),
    /** A new initiative starts in the inbox unless it is being filed deliberately. */
    status: z.enum(['inbox', 'later', 'next']).default('inbox'),
    value: fibonacci,
    timeCriticality: fibonacci,
    risk: fibonacci,
    size: fibonacci,
    deadline: calendarDate.optional(),
    earliestStart: calendarDate.optional(),
    dependsOn: z.array(entityId).default([]),
    externalPageId: z.string().min(1).max(200).optional(),
  }),
  // `status` and `dependsOn` are writable at creation and not afterwards: there
  // is no transition to record on a row that did not exist, and a dependency
  // set given whole can be checked for a cycle.
  {
    origin: INITIATIVE_READ_ONLY.origin,
    due: INITIATIVE_READ_ONLY.due,
    score: INITIATIVE_READ_ONLY.score,
    cod: INITIATIVE_READ_ONLY.cod,
    plannedStart: INITIATIVE_READ_ONLY.plannedStart,
    plannedEnd: INITIATIVE_READ_ONLY.plannedEnd,
    progress: INITIATIVE_READ_ONLY.progress,
    openTaskCount: INITIATIVE_READ_ONLY.openTaskCount,
    lastActivity: INITIATIVE_READ_ONLY.lastActivity,
    externalAnchorId: INITIATIVE_READ_ONLY.externalAnchorId,
    priority: INITIATIVE_READ_ONLY.priority,
    doneAt: INITIATIVE_READ_ONLY.doneAt,
    narrative: INITIATIVE_READ_ONLY.narrative,
    body: INITIATIVE_READ_ONLY.body,
    subtasks: INITIATIVE_READ_ONLY.subtasks,
    labels: INITIATIVE_READ_ONLY.labels,
    recurrence: INITIATIVE_READ_ONLY.recurrence,
  },
);

export const updateInitiativeBody = defineWrite(
  'UpdateInitiative',
  z.strictObject({
    title: z.string().min(1).max(500).optional(),
    areaKey: areaKey.optional(),
    projectId: entityId.nullable().optional(),
    value: fibonacci.optional(),
    timeCriticality: fibonacci.optional(),
    risk: fibonacci.optional(),
    size: fibonacci.optional(),
    deadline: calendarDate.nullable().optional(),
    earliestStart: calendarDate.nullable().optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
    droppedReason: z.string().min(1).max(500).nullable().optional(),
  }),
  INITIATIVE_READ_ONLY,
);

export const transitionInitiativeBody = defineWrite(
  'TransitionInitiative',
  z.strictObject({
    to: initiativeStatus,
    /** Required when moving to `dropped`: a drop with no reason is a deletion. */
    reason: z.string().min(1).max(500).optional(),
  }),
  INITIATIVE_STATUS_READ_ONLY,
);

export const replaceDependenciesBody = defineWrite(
  'ReplaceDependencies',
  z.strictObject({ dependsOn: z.array(entityId) }),
);

export const createProjectBody = defineWrite(
  'CreateProject',
  z.strictObject({
    name: z.string().min(1).max(300),
    areaKey,
    status: projectStatus.default('active'),
    deadline: calendarDate.optional(),
    sections: z.array(z.string().min(1).max(200)).default([]),
  }),
  {
    origin: PROJECT_READ_ONLY.origin,
    externalPageId: PROJECT_READ_ONLY.externalPageId,
    externalProjectId: PROJECT_READ_ONLY.externalProjectId,
    narrative: PROJECT_READ_ONLY.narrative,
    body: PROJECT_READ_ONLY.body,
  },
);

export const updateProjectBody = defineWrite(
  'UpdateProject',
  z.strictObject({
    name: z.string().min(1).max(300).optional(),
    areaKey: areaKey.optional(),
    status: projectStatus.optional(),
    deadline: calendarDate.nullable().optional(),
    sections: z.array(z.string().min(1).max(200)).optional(),
  }),
  PROJECT_READ_ONLY,
);
