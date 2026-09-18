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
    },
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

    async update(id, input): Promise<ObjectiveDtoShape> {
      const updated = await store.okr.updateObjective(id, input);
      if (updated === undefined) throw notFound('objective', id);
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
