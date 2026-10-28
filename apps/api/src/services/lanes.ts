import type { z } from 'zod';
import { isConnectorError } from '@prisme/connectors';
import type { RecurringTasksDto } from '../dto/lanes.js';
import { ApiError, notFound } from '../http/errors.js';
import type { ApiStore, PageRequest, RitualWriteOutcome } from '../store/types.js';
import type { ExternalDirectory } from '../sync/directory.js';
import {
  toAdherenceDto,
  toRitualDto,
  toTakeawayDto,
  type AdherenceDtoShape,
  type RitualDtoShape,
  type TakeawayDtoShape,
} from './convert.js';
import type { InitiativeDtoShape } from './convert.js';
import type { WorkService } from './work.js';

export type RecurringTasksShape = z.infer<typeof RecurringTasksDto>;

/**
 * Takeaways and rituals — the lanes, and the reading pipeline.
 *
 * **Promotion links; it does not copy.** A takeaway belongs to the document
 * tool outright (docs/11-ownership.md §7), so promoting one creates an
 * initiative, records the link on prisme's side, and leaves the takeaway
 * untouched. The initiative's title is written by the person promoting it
 * rather than copied across, which is not an oversight: a takeaway is phrased
 * as an idea and an initiative has to be phrased as a result.
 *
 * A **principle** cannot be promoted at all. It never enters the backlog — it
 * surfaces as context during the review of its area — and refusing it here is
 * the executable form of that rule rather than a note in a document.
 */

export interface LaneService {
  takeaways(
    filter: { kind?: string | undefined; promoted?: boolean | undefined },
    page: PageRequest,
  ): Promise<{ items: TakeawayDtoShape[]; total: number }>;
  /**
   * One takeaway, or `not_found`.
   *
   * Added by W06 so that `promote_takeaway`'s **dry run** can tell the caller a
   * principle will be refused, rather than showing a diff that then fails on
   * execution. A dry run that cannot see the refusal is not a preview of the
   * write.
   */
  getTakeaway(id: string): Promise<TakeawayDtoShape>;
  promote(
    id: string,
    input: {
      title: string;
      areaKey: string;
      value: number;
      timeCriticality: number;
      risk: number;
      size: number;
    },
    now: Date,
  ): Promise<InitiativeDtoShape>;

  rituals(now: Date): Promise<{ items: RitualDtoShape[] }>;
  createRitual(
    input: {
      name: string;
      areaKey: string;
      cadence: string;
      targetAdherencePct: number;
      externalPageId?: string | undefined;
      externalTaskId?: string | undefined;
    },
    now: Date,
  ): Promise<RitualDtoShape>;
  updateRitual(
    id: string,
    input: {
      name?: string | undefined;
      cadence?: string | undefined;
      targetAdherencePct?: number | undefined;
      externalPageId?: string | null | undefined;
      externalTaskId?: string | null | undefined;
    },
    now: Date,
  ): Promise<RitualDtoShape>;
  /** What a ritual's task is picked from: the task tool's open recurring tasks (S2). */
  recurringTasks(): Promise<RecurringTasksShape>;
  adherence(
    id: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<{ ritualId: string; targetAdherencePct: number; items: AdherenceDtoShape[] }>;
  recordAdherence(
    id: string,
    input: { periodStart: string; opportunities: number; completions: number },
  ): Promise<{ ritualId: string; targetAdherencePct: number; items: AdherenceDtoShape[] }>;
}

/**
 * The answer to a ritual write, or the refusal as an error.
 *
 * A task another entity holds is a `409`: the request was well formed, and
 * what it asks for collides with a binding that exists (guard 1).
 */
function written(
  outcome: RitualWriteOutcome,
  id: string | undefined,
): RitualWriteOutcome & {
  ok: true;
} {
  if (outcome.ok) return outcome;
  if (outcome.refusal === 'not_found') throw notFound('ritual', id ?? '');
  throw new ApiError(
    'conflict',
    'that task already belongs to something else in prisme — an initiative, a key result or ' +
      'another ritual — and one task cannot measure two things',
  );
}

export function createLaneService(
  store: ApiStore,
  work: WorkService,
  directory: ExternalDirectory,
): LaneService {
  async function seriesOf(
    id: string,
    from?: string,
    to?: string,
  ): Promise<{ ritualId: string; targetAdherencePct: number; items: AdherenceDtoShape[] }> {
    const ritual = await store.lanes.getRitual(id);
    if (ritual === undefined) throw notFound('ritual', id);
    const records = await store.lanes.adherence([id], from, to);
    return {
      ritualId: id,
      targetAdherencePct: ritual.targetAdherencePct,
      items: records.map(toAdherenceDto),
    };
  }

  return {
    async takeaways(filter, page) {
      const paged = await store.lanes.takeaways(filter, page);
      return { items: paged.items.map(toTakeawayDto), total: paged.total };
    },

    async getTakeaway(id): Promise<TakeawayDtoShape> {
      const takeaway = await store.lanes.getTakeaway(id);
      if (takeaway === undefined) throw notFound('takeaway', id);
      return toTakeawayDto(takeaway);
    },

    async promote(id, input, now): Promise<InitiativeDtoShape> {
      const takeaway = await store.lanes.getTakeaway(id);
      if (takeaway === undefined) throw notFound('takeaway', id);

      if (takeaway.kind !== 'action') {
        throw new ApiError(
          'unprocessable',
          'a principle never enters the backlog; it surfaces as context when its area is reviewed',
        );
      }
      if (takeaway.promotedTo !== null) {
        throw new ApiError(
          'conflict',
          'this takeaway has already been promoted, and promoting it twice would duplicate the work',
        );
      }

      const initiative = await work.create(
        {
          title: input.title,
          areaKey: input.areaKey,
          status: 'inbox',
          value: input.value,
          timeCriticality: input.timeCriticality,
          risk: input.risk,
          size: input.size,
          dependsOn: [],
        },
        now,
      );

      await store.lanes.promoteTakeaway(id, initiative.id);
      return initiative;
    },

    async rituals(now): Promise<{ items: RitualDtoShape[] }> {
      const records = await store.lanes.rituals();
      const adherence = await store.lanes.adherence(records.map((record) => record.id));
      return { items: records.map((record) => toRitualDto(record, adherence, now)) };
    },

    async createRitual(input, now): Promise<RitualDtoShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);
      const created = written(await store.lanes.createRitual({ ...input, at: now }), undefined);
      return toRitualDto(created.record, [], now);
    },

    async updateRitual(id, input, now): Promise<RitualDtoShape> {
      const updated = written(await store.lanes.updateRitual(id, { ...input, at: now }), id);
      const adherence = await store.lanes.adherence([id]);
      return toRitualDto(updated.record, adherence, now);
    },

    /**
     * Read live, like the locations an area is mapped from: the open recurring
     * tasks, each with the area its location maps to and whatever in prisme
     * already holds it. When the tool cannot be read the list is empty and
     * `failure` says why — the ritual keeps the task it has, by identifier.
     */
    async recurringTasks(): Promise<RecurringTasksShape> {
      let tasks;
      try {
        tasks = await directory.recurringTasks();
      } catch (error) {
        return { items: [], failure: isConnectorError(error) ? error.failure : 'unavailable' };
      }

      const [mappings, holders] = await Promise.all([
        store.areas.mappings(),
        store.lanes.taskHolders(tasks.map((task) => task.externalId)),
      ]);
      // A section's mapping outranks its project's, as attribution reads them.
      const areaOf = (projectId: string, sectionId: string | undefined): string | null =>
        (sectionId === undefined
          ? undefined
          : mappings.find(
              (m) => m.externalProjectId === projectId && m.externalSectionId === sectionId,
            )?.areaKey) ??
        mappings.find((m) => m.externalProjectId === projectId && m.externalSectionId === null)
          ?.areaKey ??
        null;
      const holderOf = new Map(holders.map((holder) => [holder.externalId, holder]));

      return {
        failure: null,
        items: [...tasks]
          .sort(
            (left, right) =>
              left.title.localeCompare(right.title) ||
              left.externalId.localeCompare(right.externalId),
          )
          .map((task) => {
            const holder = holderOf.get(task.externalId);
            return {
              id: task.externalId,
              title: task.title,
              areaKey: areaOf(task.projectId, task.sectionId),
              heldBy:
                holder === undefined ? null : { kind: holder.prismeKind, id: holder.prismeId },
            };
          }),
      };
    },

    adherence: seriesOf,

    async recordAdherence(id, input) {
      const ritual = await store.lanes.getRitual(id);
      if (ritual === undefined) throw notFound('ritual', id);
      if (ritual.externalTaskId !== null) {
        // The capacity refresh rewrites its window from the task's completions,
        // so a period recorded here would be overwritten without a word.
        throw new ApiError(
          'conflict',
          'this ritual is measured from its recurring task, and the next pass would overwrite ' +
            'a period recorded by hand — complete the task instead, or untie it through ' +
            'PATCH /rituals/{id}',
        );
      }
      await store.lanes.recordAdherence({ ritualId: id, ...input });
      return seriesOf(id);
    },
  };
}
