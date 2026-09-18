import { ApiError, notFound } from '../http/errors.js';
import type { ApiStore, PageRequest } from '../store/types.js';
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

  rituals(): Promise<{ items: RitualDtoShape[] }>;
  createRitual(input: {
    name: string;
    areaKey: string;
    cadence: string;
    targetAdherencePct: number;
    externalPageId?: string | undefined;
  }): Promise<RitualDtoShape>;
  updateRitual(
    id: string,
    input: {
      name?: string | undefined;
      cadence?: string | undefined;
      targetAdherencePct?: number | undefined;
      externalPageId?: string | null | undefined;
    },
  ): Promise<RitualDtoShape>;
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

export function createLaneService(store: ApiStore, work: WorkService): LaneService {
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

    async rituals(): Promise<{ items: RitualDtoShape[] }> {
      const records = await store.lanes.rituals();
      const adherence = await store.lanes.adherence(records.map((record) => record.id));
      return { items: records.map((record) => toRitualDto(record, adherence)) };
    },

    async createRitual(input): Promise<RitualDtoShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);
      const created = await store.lanes.createRitual(input);
      return toRitualDto(created, []);
    },

    async updateRitual(id, input): Promise<RitualDtoShape> {
      const updated = await store.lanes.updateRitual(id, input);
      if (updated === undefined) throw notFound('ritual', id);
      const adherence = await store.lanes.adherence([id]);
      return toRitualDto(updated, adherence);
    },

    adherence: seriesOf,

    async recordAdherence(id, input) {
      const ritual = await store.lanes.getRitual(id);
      if (ritual === undefined) throw notFound('ritual', id);
      await store.lanes.recordAdherence({ ritualId: id, ...input });
      return seriesOf(id);
    },
  };
}
