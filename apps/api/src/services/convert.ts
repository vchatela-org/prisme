import type { z } from 'zod';
import {
  adherencePct,
  computeProgress,
  isRankable,
  isSizedForNow,
  parseCalendarDate,
  parseFibonacci,
  type Area,
  type CalendarDate,
  type Initiative,
} from '@prisme/domain';
import type { adherenceDto, ritualDto, takeawayDto } from '../dto/lanes.js';
import type { areaDto, areaMappingDto } from '../dto/area.js';
import type { initiativeDto, projectDto, scoreDto, taskDto } from '../dto/initiative.js';
import type { keyResultDto, measurementDto, objectiveDto } from '../dto/okr.js';
import type {
  adoptionCandidateDto,
  adoptionEntryDto,
  conflictDto,
  eventDto,
  reviewSessionDto,
} from '../dto/ops.js';
import type {
  AdherenceRecord,
  AdoptionCandidateRecord,
  AdoptionRecord,
  AreaMappingRecord,
  AreaRecord,
  ConflictRecord,
  EventRecord,
  InitiativeRecord,
  KeyResultRecord,
  MeasurementRecord,
  ObjectiveRecord,
  ProjectRecord,
  ReviewRecord,
  RitualRecord,
  RollupRecord,
  ScoreRecord,
  TakeawayRecord,
  TaskRecord,
} from '../store/types.js';

/**
 * Records in, DTOs out — and the only place the two vocabularies meet.
 *
 * Every function here is pure and total. Keeping them in one file is
 * deliberate: "return DTOs, never database rows" is easy to state and easy to
 * erode, and it erodes one convenient spread at a time. A single file of
 * explicit field-by-field constructions is a place a reviewer can check the
 * whole rule at once.
 *
 * The converters into `@prisme/domain` live here too, because they are the same
 * boundary read the other way. They use the domain's own parsers — `size` goes
 * through `parseFibonacci`, a deadline through `parseCalendarDate` — so a value
 * the database's `CHECK` somehow let through is refused here rather than
 * silently scoring as a 4.
 */

export type AreaDtoShape = z.infer<typeof areaDto>;
export type AreaMappingDtoShape = z.infer<typeof areaMappingDto>;
export type InitiativeDtoShape = z.infer<typeof initiativeDto>;
export type ProjectDtoShape = z.infer<typeof projectDto>;
export type ScoreDtoShape = z.infer<typeof scoreDto>;
export type TaskDtoShape = z.infer<typeof taskDto>;
export type ObjectiveDtoShape = z.infer<typeof objectiveDto>;
export type KeyResultDtoShape = z.infer<typeof keyResultDto>;
export type MeasurementDtoShape = z.infer<typeof measurementDto>;
export type TakeawayDtoShape = z.infer<typeof takeawayDto>;
export type RitualDtoShape = z.infer<typeof ritualDto>;
export type AdherenceDtoShape = z.infer<typeof adherenceDto>;
export type ReviewDtoShape = z.infer<typeof reviewSessionDto>;
export type EventDtoShape = z.infer<typeof eventDto>;
export type AdoptionDtoShape = z.infer<typeof adoptionEntryDto>;
export type CandidateDtoShape = z.infer<typeof adoptionCandidateDto>;
export type ConflictDtoShape = z.infer<typeof conflictDto>;

export function iso(value: Date): string {
  return value.toISOString();
}

export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toDomainArea(record: AreaRecord): Area {
  return {
    key: record.key,
    name: record.name,
    kind: record.kind,
    active: record.active,
    externalPageId: record.externalPageId ?? undefined,
    runBudgetHoursPerWeek: record.runBudgetHoursPerWeek ?? undefined,
  };
}

function calendar(value: string | null): CalendarDate | undefined {
  return value === null ? undefined : parseCalendarDate(value);
}

export function toDomainInitiative(record: InitiativeRecord): Initiative {
  return {
    id: record.id,
    title: record.title,
    areaKey: record.areaKey,
    projectId: record.projectId ?? undefined,
    status: record.status as Initiative['status'],
    value: parseFibonacci(record.value),
    timeCriticality: parseFibonacci(record.timeCriticality),
    risk: parseFibonacci(record.risk),
    size: parseFibonacci(record.size),
    deadline: calendar(record.deadline),
    earliestStart: calendar(record.earliestStart),
    plannedStart: calendar(record.plannedStart),
    plannedEnd: calendar(record.plannedEnd),
    dependsOn: record.dependsOn,
    externalPageId: record.externalPageId ?? undefined,
    externalAnchorId: record.externalAnchorId ?? undefined,
    origin: record.origin,
    doneAt: calendar(record.doneAt),
    droppedReason: record.droppedReason ?? undefined,
  };
}

export function toAreaDto(
  record: AreaRecord,
  mappings: readonly AreaMappingRecord[],
): AreaDtoShape {
  return {
    key: record.key,
    name: record.name,
    kind: record.kind,
    active: record.active,
    rankable: isRankable(toDomainArea(record)),
    externalPageId: record.externalPageId,
    runBudgetHoursPerWeek: record.runBudgetHoursPerWeek,
    mappings: mappings
      .filter((mapping) => mapping.areaKey === record.key)
      .map((mapping) => ({
        externalProjectId: mapping.externalProjectId,
        externalSectionId: mapping.externalSectionId,
      })),
  };
}

export function toScoreDto(record: ScoreRecord): ScoreDtoShape {
  return {
    value: record.score,
    methodId: record.methodId,
    methodVersion: record.methodVersion,
    factors: record.factors,
    explain: record.explain,
    computedAt: iso(record.computedAt),
  };
}

const EMPTY_ROLLUP: RollupRecord = {
  initiativeId: '',
  totalTaskCount: 0,
  completedTaskCount: 0,
  lastActivity: null,
};

export function toInitiativeDto(
  record: InitiativeRecord,
  context: {
    readonly score?: ScoreRecord | undefined;
    readonly rollup?: RollupRecord | undefined;
    readonly blockedBy: readonly string[];
  },
): InitiativeDtoShape {
  const rollup = context.rollup ?? EMPTY_ROLLUP;
  return {
    id: record.id,
    title: record.title,
    areaKey: record.areaKey,
    projectId: record.projectId,
    status: record.status as InitiativeDtoShape['status'],
    value: record.value as InitiativeDtoShape['value'],
    timeCriticality: record.timeCriticality as InitiativeDtoShape['timeCriticality'],
    risk: record.risk as InitiativeDtoShape['risk'],
    size: record.size as InitiativeDtoShape['size'],
    deadline: record.deadline,
    earliestStart: record.earliestStart,
    plannedStart: record.plannedStart,
    plannedEnd: record.plannedEnd,
    dependsOn: [...record.dependsOn],
    externalPageId: record.externalPageId,
    externalAnchorId: record.externalAnchorId,
    origin: record.origin,
    doneAt: record.doneAt,
    droppedReason: record.droppedReason,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    score: context.score === undefined ? null : toScoreDto(context.score),
    rollup: {
      openTaskCount: rollup.totalTaskCount - rollup.completedTaskCount,
      totalTaskCount: rollup.totalTaskCount,
      progressPct: computeProgress(rollup.completedTaskCount, rollup.totalTaskCount) ?? null,
      lastActivity: isoOrNull(rollup.lastActivity),
    },
    blockedBy: [...context.blockedBy],
    sizedForNow: isSizedForNow(toDomainInitiative(record)),
  };
}

export function toProjectDto(record: ProjectRecord): ProjectDtoShape {
  return {
    id: record.id,
    name: record.name,
    areaKey: record.areaKey,
    status: record.status as ProjectDtoShape['status'],
    deadline: record.deadline,
    sections: [...record.sections],
    externalPageId: record.externalPageId,
    externalProjectId: record.externalProjectId,
    origin: record.origin,
    initiativeCount: record.initiativeCount,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function toTaskDto(record: TaskRecord): TaskDtoShape {
  return {
    externalId: record.externalId,
    externalParentId: record.externalParentId,
    isAnchor: record.isAnchor,
    completed: record.completed,
    completedAt: isoOrNull(record.completedAt),
    recordedMinutes: record.recordedMinutes,
    due: record.due,
    priority: record.priority as TaskDtoShape['priority'],
    observedAt: iso(record.observedAt),
  };
}

export function toKeyResultDto(record: KeyResultRecord): KeyResultDtoShape {
  return {
    id: record.id,
    objectiveId: record.objectiveId,
    statement: record.statement,
    target: record.target,
    unit: record.unit,
    progressSelf: record.progressSelf,
    // Null rather than zero: no breakdown to compute from is a different fact
    // from no progress, and the gap between self and computed is the signal.
    progressComputed: computeProgress(record.taskDone, record.taskTotal) ?? null,
    externalAnchorId: record.externalAnchorId,
    servedBy: [...record.servedBy],
    measurementCount: record.measurementCount,
    createdAt: iso(record.createdAt),
  };
}

export function toObjectiveDto(
  record: ObjectiveRecord,
  keyResults: readonly KeyResultRecord[],
): ObjectiveDtoShape {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    period: record.period,
    areaKey: record.areaKey,
    status: record.status as ObjectiveDtoShape['status'],
    externalPageId: record.externalPageId,
    keyResults: keyResults
      .filter((keyResult) => keyResult.objectiveId === record.id)
      .map(toKeyResultDto),
    createdAt: iso(record.createdAt),
  };
}

export function toMeasurementDto(record: MeasurementRecord): MeasurementDtoShape {
  return { observedAt: iso(record.observedAt), value: record.value, note: record.note };
}

export function toTakeawayDto(record: TakeawayRecord): TakeawayDtoShape {
  return {
    id: record.id,
    kind: record.kind,
    externalPageId: record.externalPageId,
    areaKey: record.areaKey,
    promotedTo: record.promotedTo,
    // A principle never enters the backlog; it surfaces as context during the
    // review of its area (docs/10-model.md §8).
    mayEnterBacklog: record.kind === 'action',
    observedAt: iso(record.observedAt),
  };
}

export function toAdherenceDto(record: AdherenceRecord): AdherenceDtoShape {
  return {
    periodStart: record.periodStart,
    opportunities: record.opportunities,
    completions: record.completions,
    adherencePct:
      adherencePct({
        ritualId: record.ritualId,
        periodStart: new Date(`${record.periodStart}T00:00:00.000Z`),
        opportunities: record.opportunities,
        completions: record.completions,
      }) ?? null,
  };
}

export function toRitualDto(
  record: RitualRecord,
  adherence: readonly AdherenceRecord[],
): RitualDtoShape {
  const own = adherence.filter((entry) => entry.ritualId === record.id);
  const latest = own[own.length - 1];
  return {
    id: record.id,
    name: record.name,
    areaKey: record.areaKey,
    cadence: record.cadence,
    targetAdherencePct: record.targetAdherencePct,
    externalPageId: record.externalPageId,
    latestAdherencePct: latest === undefined ? null : toAdherenceDto(latest).adherencePct,
  };
}

export function toReviewDto(record: ReviewRecord): ReviewDtoShape {
  return {
    id: record.id,
    cadence: record.cadence as ReviewDtoShape['cadence'],
    startedAt: iso(record.startedAt),
    completedAt: isoOrNull(record.completedAt),
    checklist: record.checklist,
    decisions: [...record.decisions],
    capacitySnapshot: record.capacitySnapshot,
    externalPageId: record.externalPageId,
  };
}

export function toEventDto(record: EventRecord): EventDtoShape {
  return {
    id: record.id,
    kind: record.kind as EventDtoShape['kind'],
    entityKind: record.entityKind,
    entityId: record.entityId,
    field: record.field,
    before: record.before ?? null,
    after: record.after ?? null,
    actor: record.actor,
    occurredAt: iso(record.occurredAt),
  };
}

export function toAdoptionDto(record: AdoptionRecord): AdoptionDtoShape {
  return {
    prismeId: record.prismeId,
    externalKind: record.externalKind as AdoptionDtoShape['externalKind'],
    externalId: record.externalId,
    matchRule: record.matchRule as AdoptionDtoShape['matchRule'],
    confidence: record.confidence as AdoptionDtoShape['confidence'],
    decidedBy: record.decidedBy,
    decidedAt: iso(record.decidedAt),
    bound: record.bound,
  };
}

/**
 * A candidate, for the queue.
 *
 * `title` is instance data and it is here on purpose: a human cannot work a
 * queue of identifiers. It is the reason this response is scoped to
 * `read:adoption` rather than being open to anything with a read token.
 */
export function toCandidateDto(record: AdoptionCandidateRecord): CandidateDtoShape {
  return {
    externalKind: record.externalKind as CandidateDtoShape['externalKind'],
    externalId: record.externalId,
    title: record.title,
    areaKey: record.areaKey,
    proposedKind: record.proposedKind as CandidateDtoShape['proposedKind'],
    reason: record.reason,
    matchRule: record.matchRule as CandidateDtoShape['matchRule'],
    confidence: record.confidence as CandidateDtoShape['confidence'],
    proposedId: record.proposedId,
    similarity: record.similarity,
    scannedAt: iso(record.scannedAt),
  };
}

export function toConflictDto(record: ConflictRecord): ConflictDtoShape {
  return {
    id: record.id,
    entityId: record.entityId,
    field: record.field,
    prismeValue: record.prismeValue,
    externalValue: record.externalValue,
    detectedAt: iso(record.detectedAt),
    resolution: record.resolution,
    actor: record.actor,
  };
}
