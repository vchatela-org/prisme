import { idempotencyKey } from '@prisme/connectors/write';
import type { z } from 'zod';
import type {
  captureDto,
  creationIntentDto,
  ExternalRequest,
  searchMatchDto,
} from '../dto/create.js';
import { ApiError, notFound } from '../http/errors.js';
import type {
  ApiStore,
  CaptureRecord,
  CreationIntentRecord,
  IntentEntityKind,
  PageRequest,
  Paged,
} from '../store/types.js';
import {
  locationForArea,
  planCapture,
  planPage,
  planProject,
  rankMatches,
  type PlannedIntent,
  type SearchCandidate,
} from './create-plan.js';

/**
 * The three creation flows (W15).
 *
 * ## Nothing here writes outward
 *
 * Not one method in this file can reach an external API, and that is the
 * shape of the workstream rather than an omission. Creating across two SaaS
 * tools is not atomic — there is no transaction spanning them — so the brief's
 * instruction is to **create in prisme first, record the intended external
 * references as pending, and let the reconciler converge the rest**.
 *
 * So this service writes rows: an entity, and a `creation_intent` per external
 * object it decided should exist. The converge pass in `apps/sync/src/create`
 * is the only thing that sends a command, and it holds the advisory lock while
 * it does. Two consequences worth being explicit about:
 *
 *   - **The write freeze covers these flows for free.** A frozen deployment
 *     accumulates intents and creates nothing, because the object the converge
 *     pass holds cannot reach an API (`createFrozenCreationWriter`).
 *   - **A creation request is fast and cannot half-succeed.** It is one
 *     database transaction. What it returns is what prisme now believes, and
 *     the external half is visible as pending rather than as a spinner.
 *
 * ## The anchor is not in the ledger
 *
 * A new *initiative*'s anchor task has no intent, deliberately. The reconciler
 * already derives it: it emits a `create_anchor` for exactly
 * `origin = created_in_prisme AND external_anchor_id IS NULL` (ADR-0010 guard
 * 2), which is level-triggered and needs no record of intention. Putting it in
 * the ledger as well would be two systems deciding to make one task, which is
 * how one task becomes two.
 *
 * The ledger holds precisely what the planner **cannot** derive from an
 * entity's own fields: a page, which is optional and so cannot be inferred
 * from `external_page_id IS NULL` (ADR-0011); a task-tool project and its
 * sections; and a capture's task, which belongs to no initiative at all.
 */

export type CaptureShape = z.infer<typeof captureDto>;
export type CreationIntentShape = z.infer<typeof creationIntentDto>;
export type SearchMatchShape = z.infer<typeof searchMatchDto>;

export interface CreateServiceConfig {
  readonly baseUrl: string;
  /** The label a capture's task carries. **Never** the anchor label. */
  readonly captureLabel: string;
}

export interface CreateCaptureRequest {
  readonly title: string;
  readonly areaKey: string;
  readonly page: ExternalRequest;
}

export interface PromoteCaptureRequest {
  readonly title: string;
  readonly areaKey?: string | undefined;
  readonly projectId?: string | undefined;
  readonly value: number;
  readonly timeCriticality: number;
  readonly risk: number;
  readonly size: number;
}

export interface ProjectStructureRequest {
  readonly taskProject: ExternalRequest;
  readonly page: ExternalRequest;
}

export interface CreateService {
  listCaptures(promoted: boolean | undefined, page: PageRequest): Promise<Paged<CaptureShape>>;
  getCapture(id: string): Promise<CaptureShape>;
  capture(input: CreateCaptureRequest): Promise<CaptureShape>;
  promote(id: string, input: PromoteCaptureRequest, now: Date): Promise<string>;

  /** ADR-0011's *create page*, for an entity that already exists. */
  requestPage(
    kind: IntentEntityKind,
    entityId: string,
    title: string,
  ): Promise<CreationIntentShape>;
  /** ADR-0019's structure, for a project that already exists. */
  requestProjectStructure(
    projectId: string,
    name: string,
    sections: readonly string[],
    input: ProjectStructureRequest,
    now: Date,
  ): Promise<readonly CreationIntentShape[]>;
  /** ADR-0011's third state, for either kind of external object. */
  link(
    kind: IntentEntityKind,
    entityId: string,
    objectKind: 'page' | 'project' | 'task',
    externalId: string,
    now: Date,
  ): Promise<void>;

  intents(
    filter: {
      state?: 'pending' | 'satisfied' | 'failed' | undefined;
      entityId?: string | undefined;
    },
    page: PageRequest,
  ): Promise<Paged<CreationIntentShape>>;
  retry(id: string): Promise<CreationIntentShape>;

  search(query: string): Promise<{
    query: string;
    worthReading: boolean;
    matches: readonly SearchMatchShape[];
  }>;
}

function toCaptureDto(record: CaptureRecord): CaptureShape {
  return {
    id: record.id,
    title: record.title,
    areaKey: record.areaKey,
    externalProjectId: record.externalProjectId,
    externalSectionId: record.externalSectionId,
    externalTaskId: record.externalTaskId,
    promotedTo: record.promotedTo,
    promotedAt: record.promotedAt === null ? null : record.promotedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The ledger row, without its draft.
 *
 * `draft` carries a real title and a real external location, and nothing on a
 * screen needs it — the entity it belongs to has the title already. A field
 * nobody reads cannot reach a log line or a screenshot (docs/17-privacy.md).
 */
function toIntentDto(record: CreationIntentRecord): CreationIntentShape {
  return {
    id: record.id,
    entityKind: record.entityKind,
    entityId: record.entityId,
    tool: record.tool,
    objectKind: record.objectKind,
    ordinal: record.ordinal,
    state: record.state,
    externalId: record.externalId,
    attempts: record.attempts,
    lastError: record.lastError,
    requires: record.requires,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createCreateService(store: ApiStore, config: CreateServiceConfig): CreateService {
  /**
   * The idempotency key for one ledger slot.
   *
   * Derived from the slot — entity, object kind, ordinal — and **not** from a
   * run id, which is the opposite of the reconciler's rule and deliberately
   * so: a creation is one logical write that outlives a pass, so every retry
   * for the rest of the intent's life must carry this same value. That is what
   * makes "the writer succeeded and the process died before recording the id"
   * recoverable rather than a duplicate. `packages/db/migrations/0007` says the
   * same thing beside the column.
   */
  const keyFor = (slot: string): string =>
    idempotencyKey({ runId: 'creation-intent', operation: 'create', subject: slot });

  /**
   * Bind an object that already exists. A closure rather than a method, so a
   * caller that destructures the service does not lose it — `this` inside an
   * object literal is exactly the kind of binding that works until somebody
   * writes `const { requestProjectStructure } = services.create`.
   */
  async function bind(
    kind: IntentEntityKind,
    entityId: string,
    objectKind: 'page' | 'project' | 'task',
    externalId: string,
    now: Date,
  ): Promise<void> {
    const outcome = await store.creations.linkExternal({
      entityKind: kind,
      entityId,
      objectKind,
      externalId,
      at: now,
    });
    if (!outcome.ok) throw new ApiError('conflict', outcome.reason);
  }

  return {
    async listCaptures(promoted, page): Promise<Paged<CaptureShape>> {
      const result = await store.creations.listCaptures({ promoted }, page);
      return { items: result.items.map(toCaptureDto), total: result.total };
    },

    async getCapture(id: string): Promise<CaptureShape> {
      const record = await store.creations.getCapture(id);
      if (record === undefined) throw notFound('capture', id);
      return toCaptureDto(record);
    },

    async capture(input: CreateCaptureRequest): Promise<CaptureShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);

      const mappings = await store.areas.mappings();
      const location = locationForArea(input.areaKey, mappings);
      if (location === undefined) {
        /*
         * No mapping means prisme does not know where in the task tool this
         * area's work lives. Defaulting to somewhere would put a capture in an
         * unrelated project, which is worse than refusing — and the refusal
         * names the one thing that fixes it.
         */
        throw new ApiError(
          'unprocessable',
          `${input.areaKey} is mapped to no location in the task tool, so there is nowhere to put the task — set a mapping with PUT /areas/${input.areaKey}/mappings`,
        );
      }

      /*
       * The plan is a *function* of the new id, run inside the store's
       * transaction. The intents carry a backlink containing the capture's
       * own id, so they cannot be planned before the row exists — and
       * planning them after it commits is how a capture ends up with no
       * intent behind it, which a real run produced twice before this was
       * a closure.
       */
      const record = await store.creations.createCapture({
        title: input.title,
        areaKey: input.areaKey,
        externalProjectId: location.externalProjectId,
        externalSectionId: location.externalSectionId,
        intentsFor: (captureId): readonly PlannedIntent[] =>
          planCapture({
            captureId,
            title: input.title,
            location,
            baseUrl: config.baseUrl,
            captureLabel: config.captureLabel,
            page: input.page,
          }),
        keyFor,
      });

      return toCaptureDto(record);
    },

    async promote(id: string, input: PromoteCaptureRequest, now: Date): Promise<string> {
      const outcome = await store.creations.promoteCapture({
        captureId: id,
        title: input.title,
        areaKey: input.areaKey,
        projectId: input.projectId,
        value: input.value,
        timeCriticality: input.timeCriticality,
        risk: input.risk,
        size: input.size,
        at: now,
      });

      if (outcome === undefined) throw notFound('capture', id);
      if (!outcome.ok) throw new ApiError('conflict', outcome.reason);
      return outcome.initiativeId;
    },

    async requestPage(kind, entityId, title): Promise<CreationIntentShape> {
      const written = await store.creations.recordIntents({
        entityKind: kind,
        entityId,
        intents: [planPage({ entityKind: kind, entityId, title, baseUrl: config.baseUrl })],
        keyFor,
      });
      const intent = written[0];
      if (intent === undefined) throw new Error('recording a page intent returned no row');
      return toIntentDto(intent);
    },

    /**
     * A project's structure: link what already exists, plan what does not.
     *
     * The two modes are handled in one call because they are one decision per
     * object and a caller should not have to sequence them. Linking happens
     * first: the sections' converge step reads the project's
     * `external_project_id`, and a link is what sets it when the project is
     * not being created.
     */
    async requestProjectStructure(projectId, name, sections, input, now) {
      if (input.taskProject.mode === 'link') {
        await bind('project', projectId, 'project', input.taskProject.externalId, now);
      }
      if (input.page.mode === 'link') {
        await bind('project', projectId, 'page', input.page.externalId, now);
      }

      const planned = planProject({
        projectId,
        name,
        sections,
        baseUrl: config.baseUrl,
        taskProject: input.taskProject,
        page: input.page,
      });

      if (planned.length === 0) return [];

      const written = await store.creations.recordIntents({
        entityKind: 'project',
        entityId: projectId,
        intents: planned,
        keyFor,
      });
      return written.map(toIntentDto);
    },

    link: bind,

    async intents(filter, page): Promise<Paged<CreationIntentShape>> {
      const result = await store.creations.intents(filter, page);
      return { items: result.items.map(toIntentDto), total: result.total };
    },

    async retry(id: string): Promise<CreationIntentShape> {
      const record = await store.creations.retryIntent(id);
      if (record === undefined) {
        /*
         * Either it does not exist, or it is not failed. One message for both,
         * because the distinction is not one the caller can act on
         * differently: in each case there is nothing here to retry.
         */
        throw new ApiError(
          'conflict',
          'no failed creation with that id — a pending one is already queued and a satisfied one is done',
        );
      }
      return toIntentDto(record);
    },

    /**
     * Search before create (scope item 4).
     *
     * Both sources in one request, ranked by one matcher. Doing it in the
     * browser would mean two round trips and a second implementation of the
     * ranking — which would then disagree with the adoption queue's about the
     * same pair of titles, and the two surfaces would propose different things.
     *
     * ## Nothing is pre-filtered in SQL
     *
     * The first version passed the query to `initiatives.list({ search })`,
     * which is a case-insensitive **substring** match. That quietly made the
     * fuzzy matcher useless for the only source it was filtered on: typing
     * `Passport renewed 2027` matched no substring, so the initiative called
     * `Passport renewed` was never a candidate and the search returned
     * nothing at all. A near-match is precisely what is *not* a substring,
     * which is the whole reason the matcher exists.
     *
     * So every source is read whole and ranked in one place. It is a personal
     * instance — hundreds of rows, not millions — and the other three lists
     * were already read whole, so this also makes the four consistent.
     */
    async search(query: string) {
      const [initiatives, projects, captures, queue] = await Promise.all([
        store.initiatives.list({}),
        store.projects.list(undefined, { limit: 200, offset: 0 }),
        store.creations.listCaptures({ promoted: false }, { limit: 200, offset: 0 }),
        store.ops.adoptionQueue({}, { limit: 200, offset: 0 }),
      ]);

      const candidates: SearchCandidate[] = [
        ...initiatives.map((item) => ({
          source: 'existing' as const,
          kind: 'initiative' as const,
          prismeId: item.id,
          externalId: item.externalAnchorId,
          title: item.title,
          areaKey: item.areaKey,
        })),
        ...projects.items.map((item) => ({
          source: 'existing' as const,
          kind: 'project' as const,
          prismeId: item.id,
          externalId: item.externalProjectId,
          title: item.name,
          areaKey: item.areaKey,
        })),
        ...captures.items.map((item) => ({
          source: 'existing' as const,
          kind: 'capture' as const,
          prismeId: item.id,
          externalId: item.externalTaskId,
          title: item.title,
          areaKey: item.areaKey,
        })),
        ...queue.items.map((item): SearchCandidate => ({
          source: 'adoptable',
          // The queue's kinds are the external vocabulary — `page`, `task`,
          // `project`, `section`. Only the first two ever reach a person
          // deciding whether to create something, so the rest fold into
          // `task` rather than widening the search DTO with kinds no flow
          // can act on.
          kind: item.externalKind === 'page' ? 'page' : 'task',
          prismeId: null,
          externalId: item.externalId,
          title: item.title,
          areaKey: item.areaKey,
        })),
      ];

      const ranked = rankMatches(query, candidates);
      return {
        query,
        worthReading: ranked.worthReading,
        matches: ranked.matches.map((match) => ({
          source: match.source,
          kind: match.kind,
          prismeId: match.prismeId,
          externalId: match.externalId,
          title: match.title,
          areaKey: match.areaKey,
          similarity: Math.round(match.similarity * 1000) / 1000,
          suggests: match.suggests,
        })),
      };
    },
  };
}
