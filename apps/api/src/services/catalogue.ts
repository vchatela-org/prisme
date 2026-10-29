import type { z } from 'zod';
import { docIdKey } from '@prisme/connectors';
import { resolveWeights, type AreaWeight, type Year } from '@prisme/domain';
import type { areaListDto, areaWeightsDto } from '../dto/area.js';
import { ApiError, notFound } from '../http/errors.js';
import type { ApiStore, AreaMappingInput, PageRequest } from '../store/types.js';
import type { Identity } from '../http/authorize.js';
import type { ExternalDirectory } from '../sync/directory.js';
import { toAreaDto, toProjectDto, type AreaDtoShape, type ProjectDtoShape } from './convert.js';

/**
 * Areas, their year weights, and projects — the containers everything else
 * hangs from.
 *
 * The weight endpoints carry the load-bearing rule. A weight is **fixed for a
 * whole calendar year**, decided at the yearly review, and read-only in between
 * (ADR-0007). There is no "current weight" here and no endpoint that would let
 * one be inferred: `GET /areas/weights` takes a year, and the response says
 * which year the numbers actually came from and whether that was the year asked
 * for. A surface that renders the numbers and drops `stale` has quietly
 * restored the silence that lets an annual decision slide for eighteen months.
 */

export type AreaListShape = z.infer<typeof areaListDto>;
export type AreaWeightsShape = z.infer<typeof areaWeightsDto>;

export interface CatalogueService {
  listAreas(): Promise<AreaListShape>;
  getArea(key: string): Promise<AreaDtoShape>;
  createArea(input: CreateAreaRequest): Promise<AreaDtoShape>;
  updateArea(key: string, input: UpdateAreaRequest): Promise<AreaDtoShape>;
  replaceMappings(key: string, mappings: readonly AreaMappingInput[]): Promise<AreaDtoShape>;
  weights(year: number): Promise<AreaWeightsShape>;
  putWeight(
    key: string,
    year: number,
    weightPct: number,
    identity: Identity,
    now: Date,
  ): Promise<AreaWeightsShape>;

  listProjects(
    areaKey: string | undefined,
    page: PageRequest,
  ): Promise<{ items: ProjectDtoShape[]; total: number }>;
  getProject(id: string): Promise<ProjectDtoShape>;
  createProject(input: CreateProjectRequest): Promise<ProjectDtoShape>;
  updateProject(id: string, input: UpdateProjectRequest): Promise<ProjectDtoShape>;
}

export interface CreateAreaRequest {
  readonly key: string;
  readonly name: string;
  readonly kind: 'area' | 'run' | 'signals';
  readonly active: boolean;
  readonly externalPageId?: string | undefined;
  readonly runBudgetHoursPerWeek?: number | undefined;
  readonly colorSlot?: number | undefined;
  readonly mappings: readonly AreaMappingInput[];
}

export interface UpdateAreaRequest {
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
  readonly externalPageId?: string | null | undefined;
  readonly runBudgetHoursPerWeek?: number | null | undefined;
  readonly colorSlot?: number | null | undefined;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly areaKey: string;
  readonly status: string;
  readonly deadline?: string | undefined;
  readonly sections: readonly string[];
}

export interface UpdateProjectRequest {
  readonly name?: string | undefined;
  readonly areaKey?: string | undefined;
  readonly status?: string | undefined;
  readonly deadline?: string | null | undefined;
  readonly sections?: readonly string[] | undefined;
}

/**
 * The task tool's own Inbox belongs to no area (S11).
 *
 * It is where unsorted work waits, and prisme's whole answer to it — *Unsorted
 * in Todoist*, and *Make it an initiative* moving the task into an area — rests
 * on the Inbox being in none. Mapped to an area, its completions are counted as
 * that area's work whatever they were, and as the area's home it is where new
 * work for the area would be created: back into the unsorted pile.
 *
 * So a mapping that names it is refused, as home or not. The Inbox is
 * recognised the way the tool marks it (`inbox_project`), read live. When the
 * tool cannot be read the save goes through: the check is a guard on a
 * configuration screen, and refusing every mapping during an outage would block
 * the rest of it. Settings marks a mapping that names the Inbox as soon as the
 * locations can be read again, so one saved then does not stay unseen.
 */
const INBOX_REFUSAL =
  'that is the task tool’s Inbox, which belongs to no area — sort its tasks into an area’s ' +
  'project in the task tool, or make one an initiative from prisme’s Inbox (Unsorted in Todoist)';

async function inboxProjectId(directory: ExternalDirectory): Promise<string | undefined> {
  try {
    const locations = await directory.taskLocations();
    return locations.projects.find((project) => project.inbox === true)?.externalId;
  } catch {
    return undefined;
  }
}

export function createCatalogueService(
  store: ApiStore,
  directory: ExternalDirectory,
): CatalogueService {
  async function assertNoInbox(mappings: readonly AreaMappingInput[] | undefined): Promise<void> {
    if (mappings === undefined || mappings.length === 0) return;
    const inbox = await inboxProjectId(directory);
    if (inbox === undefined) return;
    if (mappings.some((mapping) => mapping.externalProjectId === inbox)) {
      throw new ApiError('unprocessable', INBOX_REFUSAL);
    }
  }

  async function areaOrThrow(key: string): Promise<AreaDtoShape> {
    const [record, mappings] = await Promise.all([store.areas.get(key), store.areas.mappings()]);
    if (record === undefined) throw notFound('area', key);
    return toAreaDto(record, mappings);
  }

  /**
   * One page names one area (ADR-0033).
   *
   * A relation to a page two areas both claim resolves to neither, so saving
   * the second claim would quietly take the first area's entries away from it.
   * Refused by name instead. Compared through `docIdKey`, because one page is
   * written dashed or bare depending on where it was copied from.
   */
  async function assertPageIsFree(key: string, pageId: string | null | undefined): Promise<void> {
    if (pageId === null || pageId === undefined) return;
    const wanted = docIdKey(pageId);
    const holder = (await store.areas.list()).find(
      (area) =>
        area.key !== key &&
        area.externalPageId !== null &&
        docIdKey(area.externalPageId) === wanted,
    );
    if (holder !== undefined) {
      throw new ApiError(
        'conflict',
        `that page is already ${holder.key}'s own page — one page names one area`,
      );
    }
  }

  async function weightsFor(year: number): Promise<AreaWeightsShape> {
    const [records, areas] = await Promise.all([store.areas.weights(), store.areas.list()]);
    const weights: AreaWeight[] = records.map((record) => ({
      areaKey: record.areaKey,
      year: record.year as Year,
      weightPct: record.weightPct,
    }));

    const resolved = resolveWeights(weights, year as Year);
    const rankable = new Set(
      areas.filter((area) => area.kind === 'area' && area.active).map((area) => area.key),
    );

    let sumPct = 0;
    const inForce: { areaKey: string; year: number; weightPct: number }[] = [];
    // Sorted explicitly: a Map's iteration order is a fact about insertion, not
    // about the domain, and a list that reorders between two identical requests
    // is a list nobody trusts.
    const ordered = [...resolved.weightPctByArea].sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
    );

    for (const [areaKey, weightPct] of ordered) {
      inForce.push({ areaKey, year: resolved.sourceYear ?? year, weightPct });
      if (rankable.has(areaKey)) sumPct += weightPct;
    }

    return {
      year,
      sourceYear: resolved.sourceYear ?? null,
      stale: resolved.stale,
      sumPct,
      weights: inForce,
    };
  }

  return {
    async listAreas(): Promise<AreaListShape> {
      const [records, mappings] = await Promise.all([store.areas.list(), store.areas.mappings()]);
      return { items: records.map((record) => toAreaDto(record, mappings)) };
    },

    getArea: areaOrThrow,

    async createArea(input: CreateAreaRequest): Promise<AreaDtoShape> {
      const existing = await store.areas.get(input.key);
      if (existing !== undefined) {
        throw new ApiError('conflict', `an area with the key ${input.key} already exists`);
      }
      await assertPageIsFree(input.key, input.externalPageId);
      await assertNoInbox(input.mappings);
      await store.areas.create(input);
      return areaOrThrow(input.key);
    },

    async updateArea(key: string, input: UpdateAreaRequest): Promise<AreaDtoShape> {
      await assertPageIsFree(key, input.externalPageId);
      const updated = await store.areas.update(key, input);
      if (updated === undefined) throw notFound('area', key);
      return areaOrThrow(key);
    },

    async replaceMappings(key, mappings): Promise<AreaDtoShape> {
      const existing = await store.areas.get(key);
      if (existing === undefined) throw notFound('area', key);
      await assertNoInbox(mappings);
      await store.areas.replaceMappings(key, mappings);
      return areaOrThrow(key);
    },

    weights: weightsFor,

    async putWeight(key, year, weightPct, identity, now): Promise<AreaWeightsShape> {
      const area = await store.areas.get(key);
      if (area === undefined) throw notFound('area', key);

      if (area.kind !== 'area') {
        // Run is budgeted in hours per week and Signals is counted as volume.
        // Giving either a percentage share would put a lane back into the
        // allocation it was deliberately taken out of (ADR-0014).
        throw new ApiError(
          'unprocessable',
          `${key} is a ${area.kind} lane: Run is budgeted in hours per week and Signals carries no share at all`,
        );
      }

      const previous = await store.areas.putWeight(key, year, weightPct);

      // A weight change is one of the six things the event log records, and it
      // is the one a year-review chart is drawn from (docs/10-model.md §10).
      await store.ops.appendEvent({
        kind: 'weight_changed',
        entityKind: 'area',
        entityId: key,
        field: `weight_pct:${String(year)}`,
        before: previous,
        after: weightPct,
        actor: identity.kind,
        occurredAt: now,
      });

      return weightsFor(year);
    },

    async listProjects(areaKey, page): Promise<{ items: ProjectDtoShape[]; total: number }> {
      const paged = await store.projects.list(areaKey, page);
      return { items: paged.items.map(toProjectDto), total: paged.total };
    },

    async getProject(id: string): Promise<ProjectDtoShape> {
      const record = await store.projects.get(id);
      if (record === undefined) throw notFound('project', id);
      return toProjectDto(record);
    },

    async createProject(input: CreateProjectRequest): Promise<ProjectDtoShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);
      return toProjectDto(await store.projects.create(input));
    },

    async updateProject(id: string, input: UpdateProjectRequest): Promise<ProjectDtoShape> {
      const record = await store.projects.update(id, input);
      if (record === undefined) throw notFound('project', id);
      return toProjectDto(record);
    },
  };
}
