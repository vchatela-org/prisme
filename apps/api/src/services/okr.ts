import { isObjectiveOpen, periodMatchesType, type ObjectiveStatus } from '@prisme/domain';
import type { Identity } from '../http/authorize.js';
import { ApiError, notFound } from '../http/errors.js';
import type { ApiStore, PageRequest } from '../store/types.js';
import {
  toKeyResultDto,
  toMeasurementDto,
  toObjectiveDto,
  type KeyResultDtoShape,
  type MeasurementDtoShape,
  type ObjectiveDtoShape,
} from './convert.js';

/**
 * Objectives and key results.
 *
 * The one rule this service exists to hold: **`progressSelf` is writable and
 * `progressComputed` is not** (ADR-0013). There is no endpoint that sets a
 * computed progress and no way to make one number follow the other, because the
 * divergence between them is the whole signal — self far below computed means
 * the tasks were the wrong tasks, self far above means the breakdown is stale,
 * and both low late in a period is an objective at risk, honestly.
 *
 * Measurements are append-only for the same reason the event log is: a key
 * result with one current number has no trend, and a trend is what a monthly
 * review is actually reading.
 */

export interface ObjectiveService {
  list(
    filter: {
      period?: string | undefined;
      areaKey?: string | undefined;
      status?: string | undefined;
    },
    page: PageRequest,
  ): Promise<{ items: ObjectiveDtoShape[]; total: number }>;
  get(id: string): Promise<ObjectiveDtoShape>;
  create(input: {
    title: string;
    type: 'annual' | 'monthly';
    period: string;
    areaKey: string;
    status: string;
    externalPageId?: string | undefined;
  }): Promise<ObjectiveDtoShape>;
  update(
    id: string,
    input: {
      title?: string | undefined;
      status?: string | undefined;
      externalPageId?: string | null | undefined;
      type?: 'annual' | 'monthly' | undefined;
      period?: string | undefined;
    },
    identity: Identity,
    now: Date,
  ): Promise<ObjectiveDtoShape>;

  createKeyResult(
    objectiveId: string,
    input: {
      statement: string;
      target: number;
      unit: string;
      progressSelf: number;
      servedBy: readonly string[];
    },
  ): Promise<KeyResultDtoShape>;
  updateKeyResult(
    id: string,
    input: {
      statement?: string | undefined;
      target?: number | undefined;
      unit?: string | undefined;
      progressSelf?: number | undefined;
      servedBy?: readonly string[] | undefined;
    },
  ): Promise<KeyResultDtoShape>;
  addMeasurement(
    keyResultId: string,
    value: number,
    observedAt: Date,
    note: string | undefined,
  ): Promise<{ keyResultId: string; items: MeasurementDtoShape[] }>;
  measurements(keyResultId: string): Promise<{ keyResultId: string; items: MeasurementDtoShape[] }>;
}

export function createObjectiveService(store: ApiStore): ObjectiveService {
  async function objectiveOrThrow(id: string): Promise<ObjectiveDtoShape> {
    const record = await store.okr.getObjective(id);
    if (record === undefined) throw notFound('objective', id);
    const keyResults = await store.okr.keyResults([id]);
    return toObjectiveDto(record, keyResults);
  }

  async function keyResultOrThrow(id: string): Promise<KeyResultDtoShape> {
    const record = await store.okr.getKeyResult(id);
    if (record === undefined) throw notFound('key result', id);
    return toKeyResultDto(record);
  }

  async function measurementsOf(
    keyResultId: string,
  ): Promise<{ keyResultId: string; items: MeasurementDtoShape[] }> {
    const records = await store.okr.measurements(keyResultId);
    return { keyResultId, items: records.map(toMeasurementDto) };
  }

  return {
    async list(filter, page) {
      const paged = await store.okr.listObjectives(filter, page);
      const keyResults = await store.okr.keyResults(paged.items.map((record) => record.id));
      return {
        items: paged.items.map((record) => toObjectiveDto(record, keyResults)),
        total: paged.total,
      };
    },

    get: objectiveOrThrow,

    async create(input): Promise<ObjectiveDtoShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);
      const created = await store.okr.createObjective(input);
      return toObjectiveDto(created, []);
    },

    /**
     * Title, status, page link — and, for an open objective, its period
     * (ADR-0034).
     *
     * A period moves only while the objective is **open**, judged by its status
     * before this request: a met, missed or dropped objective was judged
     * against its period, and moving it afterwards would rewrite that judgement
     * rather than correct a plan. The pair is checked as it will be — a
     * monthly objective moved a month sends only `period` — and each move is
     * written to the event log, so the objective's history keeps where it was.
     * The page's date column is not written here: the next sync pass does it,
     * level-triggered, like every other outward write.
     */
    async update(id, input, identity, now): Promise<ObjectiveDtoShape> {
      const moving = input.type !== undefined || input.period !== undefined;
      const before = moving ? await store.okr.getObjective(id) : undefined;

      if (moving) {
        if (before === undefined) throw notFound('objective', id);
        const type = input.type ?? before.type;
        const period = input.period ?? before.period;
        if (!isObjectiveOpen(before.status as ObjectiveStatus)) {
          throw new ApiError(
            'conflict',
            `a ${before.status} objective keeps the period it was judged against; only a draft or active one can move`,
          );
        }
        if (!periodMatchesType(type, period)) {
          throw new ApiError(
            'unprocessable',
            'an annual objective takes a YYYY period and a monthly one takes YYYY-MM',
          );
        }
      }

      const updated = await store.okr.updateObjective(id, input);
      if (updated === undefined) throw notFound('objective', id);

      if (
        before !== undefined &&
        (updated.type !== before.type || updated.period !== before.period)
      ) {
        await store.ops.appendEvent({
          kind: 'period_changed',
          entityKind: 'objective',
          entityId: id,
          field: 'period',
          before: { type: before.type, period: before.period },
          after: { type: updated.type, period: updated.period },
          actor: identity.kind,
          occurredAt: now,
        });
      }

      return objectiveOrThrow(id);
    },

    async createKeyResult(objectiveId, input): Promise<KeyResultDtoShape> {
      const objective = await store.okr.getObjective(objectiveId);
      if (objective === undefined) throw notFound('objective', objectiveId);

      for (const initiativeId of input.servedBy) {
        const initiative = await store.initiatives.get(initiativeId);
        if (initiative === undefined) throw notFound('initiative', initiativeId);
      }

      const created = await store.okr.createKeyResult(objectiveId, input);
      return toKeyResultDto(created);
    },

    async updateKeyResult(id, input): Promise<KeyResultDtoShape> {
      for (const initiativeId of input.servedBy ?? []) {
        const initiative = await store.initiatives.get(initiativeId);
        if (initiative === undefined) throw notFound('initiative', initiativeId);
      }
      const updated = await store.okr.updateKeyResult(id, input);
      if (updated === undefined) throw notFound('key result', id);
      return keyResultOrThrow(id);
    },

    async addMeasurement(keyResultId, value, observedAt, note) {
      const keyResult = await store.okr.getKeyResult(keyResultId);
      if (keyResult === undefined) throw notFound('key result', keyResultId);
      if (!Number.isFinite(value)) {
        throw new ApiError('unprocessable', 'a measurement must be a finite number');
      }
      await store.okr.addMeasurement(keyResultId, value, observedAt, note);
      return measurementsOf(keyResultId);
    },

    measurements: measurementsOf,
  };
}
