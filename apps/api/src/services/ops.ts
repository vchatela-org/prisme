import type { z } from 'zod';
import { CANDIDATE_SELECTION_LIMITS, SCHEDULE_DEFAULTS, type Registry } from '@prisme/domain';
import type { settingsDto, syncRunDto, syncStatusDto } from '../dto/ops.js';
import { ApiError, notFound } from '../http/errors.js';
import type { Identity } from '../http/authorize.js';
import type { ApiStore, PageRequest } from '../store/types.js';
import type { SyncRunner } from '../sync/port.js';
import {
  toAdoptionDto,
  toCandidateDto,
  toConflictDto,
  toEventDto,
  toReviewDto,
  type AdoptionDtoShape,
  type CandidateDtoShape,
  type ConflictDtoShape,
  type EventDtoShape,
  type ReviewDtoShape,
} from './convert.js';
import type { MeasureService } from './measure.js';

/**
 * Reviews, the event log, the adoption ledger, settings and reconciliation.
 *
 * Closing a review is the one operation here with a side effect worth naming:
 * it takes a **capacity snapshot** at that moment and stores it on the session.
 * A review whose numbers are recomputed when it is reopened is a review that
 * quietly rewrites its own history, and the point of a session is to record
 * what was true when the decision was made (docs/10-model.md §10).
 */

export type SettingsShape = z.infer<typeof settingsDto>;
export type SyncStatusShape = z.infer<typeof syncStatusDto>;
export type SyncRunShape = z.infer<typeof syncRunDto>;

export interface OpsConfig {
  readonly timezone: string;
  readonly capacityWindowWeeks: number;
  readonly defaultTaskMinutes: number;
  readonly concurrentInitiatives: number;
  readonly workingWeekdays: readonly number[];
  readonly sync: {
    readonly enabled: boolean;
    readonly writeEnabled: boolean;
    readonly createThreshold: number;
    readonly windowStart: number;
    readonly windowEnd: number;
  };
}

export interface OpsService {
  reviews(
    cadence: string | undefined,
    page: PageRequest,
  ): Promise<{ items: ReviewDtoShape[]; total: number }>;
  getReview(id: string): Promise<ReviewDtoShape>;
  openReview(cadence: string, now: Date): Promise<ReviewDtoShape>;
  updateReview(
    id: string,
    input: {
      checklist?: Readonly<Record<string, boolean>> | undefined;
      decisions?: readonly string[] | undefined;
      externalPageId?: string | null | undefined;
      complete?: boolean | undefined;
    },
    now: Date,
  ): Promise<ReviewDtoShape>;

  events(
    filter: {
      kind?: string | undefined;
      entityKind?: string | undefined;
      entityId?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    },
    page: PageRequest,
  ): Promise<{ items: EventDtoShape[]; total: number }>;

  adoption(
    bound: boolean | undefined,
    page: PageRequest,
  ): Promise<{ items: AdoptionDtoShape[]; total: number }>;
  decideAdoption(
    input: {
      prismeId: string;
      externalKind: string;
      externalId: string;
      matchRule: string;
      confidence: string;
    },
    identity: Identity,
    now: Date,
  ): Promise<AdoptionDtoShape>;

  adoptionQueue(
    filter: { areaKey?: string | undefined; kind?: string | undefined },
    page: PageRequest,
  ): Promise<{ items: CandidateDtoShape[]; total: number }>;
  adoptCandidate(
    input: { externalKind: string; externalId: string },
    identity: Identity,
    now: Date,
  ): Promise<AdoptionDtoShape>;
  ignoreCandidate(
    input: { externalKind: string; externalId: string; reason?: string | undefined },
    identity: Identity,
    now: Date,
  ): Promise<CandidateDtoShape>;

  conflicts(
    resolution: string | undefined,
    page: PageRequest,
  ): Promise<{ items: ConflictDtoShape[]; total: number }>;
  resolveConflict(id: string, resolution: string): Promise<ConflictDtoShape>;

  settings(): SettingsShape;
  syncStatus(): Promise<SyncStatusShape>;
  runSync(mode: 'plan' | 'apply', full: boolean): Promise<SyncRunShape>;
}

export function createOpsService(
  store: ApiStore,
  registry: Registry,
  measure: MeasureService,
  runner: SyncRunner,
  config: OpsConfig,
): OpsService {
  async function reviewOrThrow(id: string): Promise<ReviewDtoShape> {
    const record = await store.ops.getReview(id);
    if (record === undefined) throw notFound('review session', id);
    return toReviewDto(record);
  }

  return {
    async reviews(cadence, page) {
      const paged = await store.ops.reviews(cadence, page);
      return { items: paged.items.map(toReviewDto), total: paged.total };
    },

    getReview: reviewOrThrow,

    async openReview(cadence: string, now: Date): Promise<ReviewDtoShape> {
      return toReviewDto(await store.ops.openReview(cadence, now));
    },

    async updateReview(id, input, now): Promise<ReviewDtoShape> {
      const existing = await store.ops.getReview(id);
      if (existing === undefined) throw notFound('review session', id);

      // Closing takes the snapshot. Reopening does not retake it: what the
      // review saw is part of what the review decided.
      let capacitySnapshot: Record<string, number> | undefined;
      let completedAt: Date | undefined;
      if (input.complete === true && existing.completedAt === null) {
        const balance = await measure.balance(now.getUTCFullYear(), undefined, now);
        capacitySnapshot = Object.fromEntries(
          balance.areas.map((area) => [area.areaKey, area.actualSharePct]),
        );
        completedAt = now;
      }

      const updated = await store.ops.updateReview(id, {
        checklist: input.checklist,
        decisions: input.decisions,
        externalPageId: input.externalPageId,
        ...(completedAt === undefined ? {} : { completedAt }),
        ...(capacitySnapshot === undefined ? {} : { capacitySnapshot }),
      });
      if (updated === undefined) throw notFound('review session', id);
      return toReviewDto(updated);
    },

    async events(filter, page) {
      const paged = await store.ops.events(filter, page);
      return { items: paged.items.map(toEventDto), total: paged.total };
    },

    async adoption(bound, page) {
      const paged = await store.ops.adoption(bound, page);
      return { items: paged.items.map(toAdoptionDto), total: paged.total };
    },

    async decideAdoption(input, identity, now): Promise<AdoptionDtoShape> {
      const decided = await store.ops.decideAdoption({ ...input, decidedAt: now });
      await store.ops.appendEvent({
        kind: 'adoption_decision',
        entityKind: input.externalKind,
        entityId: input.externalId,
        field: 'link',
        before: null,
        after: { prismeId: input.prismeId, confidence: input.confidence },
        actor: identity.kind,
        occurredAt: now,
      });
      return toAdoptionDto(decided);
    },

    async adoptionQueue(filter, page) {
      const paged = await store.ops.adoptionQueue(filter, page);
      return { items: paged.items.map(toCandidateDto), total: paged.total };
    },

    /**
     * Adopt: a linked entity, and nothing outward.
     *
     * The event is recorded against the **external** object rather than the new
     * entity, because that is the thing whose history a person is reconstructing
     * when they ask "where did this come from" — and it is the identifier that
     * existed before prisme did.
     */
    async adoptCandidate(input, identity, now): Promise<AdoptionDtoShape> {
      const outcome = await store.ops.adoptCandidate({ ...input, decidedAt: now });
      if (outcome === undefined) throw notFound('adoption candidate', input.externalId);
      if (!outcome.ok) throw new ApiError('invalid_request', outcome.reason);

      await store.ops.appendEvent({
        kind: 'adoption_decision',
        entityKind: input.externalKind,
        entityId: input.externalId,
        field: 'adopt',
        before: null,
        after: { prismeId: outcome.prismeId, kind: outcome.kind, origin: 'adopted' },
        actor: identity.kind,
        occurredAt: now,
      });
      return toAdoptionDto(outcome.record);
    },

    /** Ignore: permanently, and in the event log, because it is a decision. */
    async ignoreCandidate(input, identity, now): Promise<CandidateDtoShape> {
      const ignored = await store.ops.ignoreCandidate({
        externalKind: input.externalKind,
        externalId: input.externalId,
        reason: input.reason,
        decidedAt: now,
      });
      if (ignored === undefined) throw notFound('adoption candidate', input.externalId);

      await store.ops.appendEvent({
        kind: 'adoption_decision',
        entityKind: input.externalKind,
        entityId: input.externalId,
        field: 'ignore',
        before: null,
        after: { ignored: true, ...(input.reason === undefined ? {} : { reason: input.reason }) },
        actor: identity.kind,
        occurredAt: now,
      });
      return toCandidateDto(ignored);
    },

    async conflicts(resolution, page) {
      const paged = await store.ops.conflicts(resolution, page);
      return { items: paged.items.map(toConflictDto), total: paged.total };
    },

    async resolveConflict(id: string, resolution: string): Promise<ConflictDtoShape> {
      const resolved = await store.ops.resolveConflict(id, resolution);
      if (resolved === undefined) throw notFound('conflict', id);
      return toConflictDto(resolved);
    },

    settings(): SettingsShape {
      const active = registry.activeMethod();
      return {
        timezone: config.timezone,
        scoring: {
          activeMethodId: active.id,
          activeMethodVersion: active.version,
          shadowMethodIds: registry.listShadow().map((method) => method.id),
        },
        capacity: {
          windowWeeks: config.capacityWindowWeeks,
          defaultTaskMinutes: config.defaultTaskMinutes,
          balanceClamp: [0.5, 2],
        },
        selection: {
          maxNow: CANDIDATE_SELECTION_LIMITS.maxNow,
          maxNowPerArea: CANDIDATE_SELECTION_LIMITS.maxNowPerArea,
          openQuestion:
            'OQ-2 is open: one `now` per area and five overall are candidates, to be chosen at the first review',
        },
        schedule: {
          concurrentInitiatives: config.concurrentInitiatives,
          workingWeekdays: [...config.workingWeekdays],
        },
        sync: { ...config.sync },
      };
    },

    async syncStatus(): Promise<SyncStatusShape> {
      const state = await store.ops.syncState();
      return {
        enabled: config.sync.enabled,
        writeEnabled: config.sync.writeEnabled,
        createThreshold: config.sync.createThreshold,
        hasTaskToolCursor: state.hasTaskToolCursor,
        documentWatermark: state.documentWatermark?.toISOString() ?? null,
        lastFullPassAt: state.lastFullPassAt?.toISOString() ?? null,
        unresolvedConflicts: state.unresolvedConflicts,
        lastRunAt: state.updatedAt?.toISOString() ?? null,
      };
    },

    async runSync(mode, full): Promise<SyncRunShape> {
      const result = await runner.run({ mode, full });
      return {
        mode: result.mode,
        ran: result.ran,
        full: result.full,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        counts: result.counts,
        applied: result.applied,
        conflicts: result.conflicts,
        refused: result.refused,
        failures: result.failures,
        drift: result.drift,
        report: result.report,
      };
    },
  };
}

/** Re-exported so a caller can build an `OpsConfig` without importing the domain. */
export const DEFAULT_WORKING_WEEKDAYS = SCHEDULE_DEFAULTS.workingWeekdays;
