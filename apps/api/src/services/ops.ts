import type { z } from 'zod';
import {
  CANDIDATE_SELECTION_LIMITS,
  SCHEDULE_DEFAULTS,
  type AdoptRefusal,
  type Registry,
} from '@prisme/domain';
import type { adoptionQueuePageDto, settingsDto, syncRunDto, syncStatusDto } from '../dto/ops.js';
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
import {
  calendarDayIn,
  endedSelection,
  periodOf,
  queueView,
  type EndedFilter,
  type QueueFilter,
} from './adoption-queue.js';
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

/**
 * The API's sentence for each refusal, addressed to an API client — so it
 * names the endpoint to use instead. The screen words the same codes for a
 * person, from the queue row's `adoptRefusal`.
 */
const ADOPT_REFUSAL_MESSAGES: Readonly<Record<AdoptRefusal, string>> = {
  promote_takeaway:
    'an action takeaway is promoted, not adopted — promote it from the Inbox, which creates an ' +
    'initiative that gets its task; to link this row to the initiative a promotion already made, ' +
    'merge it through POST /adoption/decisions',
  needs_objective:
    'adopting a key result needs values no candidate carries (its objective, and a target) — ' +
    'merge it onto a key result that already exists, through POST /adoption/decisions',
  needs_cadence:
    'adopting a ritual needs values no candidate carries (a cadence, and a target) — merge it ' +
    'onto a ritual that already exists, through POST /adoption/decisions',
  not_adoptable: 'this kind stays where it is: adopting it would make no prisme entity',
  no_area:
    'this candidate sits outside every mapped area, and an entity belonging to no area cannot be ' +
    'allocated to — give it an area first (a task-tool location on Settings → Areas, or the ' +
    "store's area column on Settings → Notion), then rescan",
  period_not_calendar:
    "an objective's dates must cover exactly one calendar year (annual) or one calendar month " +
    "(monthly) — correct the page's dates in the document tool and rescan, or create the " +
    'objective and merge this row onto it',
};
export type SyncStatusShape = z.infer<typeof syncStatusDto>;
export type SyncRunShape = z.infer<typeof syncRunDto>;
/** The queue page without the paging echo, which the route adds. */
export type QueuePageShape = Omit<z.infer<typeof adoptionQueuePageDto>, 'limit' | 'offset'>;

export interface OpsConfig {
  readonly timezone: string;
  readonly version: string;
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
  /** Delete an open session and everything recorded in it. A closed one is refused. */
  discardReview(id: string): Promise<ReviewDtoShape>;

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

  adoptionQueue(filter: QueueFilter, page: PageRequest, now: Date): Promise<QueuePageShape>;
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
  /**
   * Ignore every ended candidate under `filter`, permanently — refused with a
   * 409 unless the set is still the one `expected` names.
   */
  ignoreEnded(
    filter: EndedFilter,
    expected: { readonly count: number; readonly digest: string },
    identity: Identity,
    now: Date,
  ): Promise<{ ignored: number; today: string }>;

  conflicts(
    resolution: string | undefined,
    page: PageRequest,
  ): Promise<{ items: ConflictDtoShape[]; total: number }>;
  resolveConflict(id: string, resolution: string): Promise<ConflictDtoShape>;

  settings(): SettingsShape;
  syncStatus(): Promise<SyncStatusShape>;
  runSync(mode: 'plan' | 'apply', full: boolean): Promise<SyncRunShape>;
  /** Re-read both tools into the adoption queue. prisme's own tables only. */
  scanAdoption(
    now: Date,
  ): Promise<{ ran: boolean; queued: number; certain: number; scannedAt: string }>;
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

    // Only an open session can go. A closed one carries a snapshot and the
    // decisions it was closed on, and those are history — deleting them would
    // rewrite what a review decided, which the snapshot exists to prevent.
    async discardReview(id: string): Promise<ReviewDtoShape> {
      const discarded = await store.ops.discardOpenReview(id);
      if (discarded !== undefined) return toReviewDto(discarded);
      if ((await store.ops.getReview(id)) === undefined) throw notFound('review session', id);
      throw new ApiError(
        'conflict',
        'that review session is closed; only an open one is discarded',
      );
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
      if (!decided.ok) {
        throw new ApiError(
          'conflict',
          'this ritual already names another process page, and linking a page to a ritual ' +
            'makes it that page — change or clear it through PATCH /rituals/{id}, then link ' +
            'this one; or ignore this row',
        );
      }
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
      return toAdoptionDto(decided.record);
    },

    // The whole undecided set, then one pure function filters, counts and pages
    // it — so a count beside a filter and the rows it shows cannot disagree.
    async adoptionQueue(filter, page, now) {
      const everything = await store.ops.adoptionQueue({});
      const today = calendarDayIn(config.timezone, now);
      const view = queueView(everything.items, filter, today, page);
      const ended = endedSelection(everything.items, filter, today);
      return {
        items: view.items.map((record) => ({
          ...toCandidateDto(record),
          period: periodOf(record, today),
        })),
        total: view.total,
        today,
        facets: {
          when: view.facets.when,
          source: [...view.facets.source],
          area: [...view.facets.area],
        },
        ignoreEnded: { count: ended.count, digest: ended.digest },
      };
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
      const outcome = await store.ops.adoptCandidate({
        ...input,
        today: calendarDayIn(config.timezone, now),
        decidedAt: now,
      });
      if (outcome === undefined) throw notFound('adoption candidate', input.externalId);
      if (!outcome.ok) {
        throw new ApiError('invalid_request', ADOPT_REFUSAL_MESSAGES[outcome.refusal]);
      }

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

    /**
     * Ignore every ended candidate the caller was shown, or nothing.
     *
     * The set is computed here, from the whole undecided queue, by the same
     * function that counts the *Ended* filter — the request carries filters and
     * what it was shown, never an identifier. It is written only if it is still
     * exactly what was shown: a rescan, a decision taken elsewhere or the date
     * turning over all move the digest, and the answer is then a 409 and not a
     * best effort. A replay is refused the same way, since the set it named is
     * gone once ignored.
     */
    async ignoreEnded(filter, expected, identity, now) {
      const everything = await store.ops.adoptionQueue({});
      const today = calendarDayIn(config.timezone, now);
      const selection = endedSelection(everything.items, filter, today);

      if (selection.count !== expected.count || selection.digest !== expected.digest) {
        const moved =
          selection.count === expected.count
            ? 'as many match now, but not the same ones'
            : `${String(selection.count)} match now`;
        throw new ApiError(
          'conflict',
          `the queue has changed since it was shown: it showed ${String(expected.count)} ended, and ${moved}. Nothing was ignored; read the queue again and confirm what it shows`,
        );
      }

      const outcome = await store.ops.ignoreEndedCandidates({
        candidates: selection.candidates.map((candidate) => ({
          externalKind: candidate.externalKind,
          externalId: candidate.externalId,
        })),
        endedBefore: today,
        reason: `ignored in bulk with every other ended entry in view: its period ended before ${today}`,
        actor: identity.kind,
        decidedAt: now,
      });
      if (!outcome.ok) {
        throw new ApiError(
          'conflict',
          'the queue changed while the ignore was being written. Nothing was ignored; read the queue again and confirm what it shows',
        );
      }
      return { ignored: outcome.ignored, today };
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
        version: config.version,
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

    async scanAdoption(now) {
      const result = await runner.scanAdoption();
      return { ...result, scannedAt: now.toISOString() };
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
