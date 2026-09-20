import { ConnectorError } from '../errors.js';
import { executeJson, type RequestOptions } from '../http/request.js';
import { createRefusingTransport, type Transport } from '../http/transport.js';
import type { ConnectorMetrics } from '../metrics.js';
import { parseOrThrow } from '../parse.js';
import { mapCompletion, mapLabel, mapProject, mapSection, mapTask } from './map.js';
import type { Completion, SyncResult, TaskChange, TaskSnapshot, TaskToolClient } from './types.js';
import { wireCompletedResponseSchema, wireSyncResponseSchema } from './wire.js';
import type { RetryPolicy } from '../http/backoff.js';
import { trimTrailing } from '../util/trim.js';

/**
 * The live task-tool client.
 *
 * Incremental by default, because that is what runs every fifteen minutes; the
 * full fetch is the daily pass that answers *did we miss something?*
 * (docs/16-sync.md §2). Both go through the same endpoint, which is why
 * {@link TaskSnapshot} and {@link SyncResult} carry the same token: the full
 * pass advances the incremental cursor rather than forking it, so a full pass
 * can never leave the incremental path reading from a stale position.
 *
 * Nothing here writes. The write path, idempotency keys and the reconciler
 * belong to W04.
 */

/** No workspace appears in this URL; it is the tool's public API host, and it is overridable. */
export const DEFAULT_TASK_TOOL_BASE_URL = 'https://api.todoist.com';

/** The token that means "send me everything". */
const FULL_SYNC_TOKEN = '*';

const RESOURCE_TYPES = ['items', 'projects', 'sections', 'labels'] as const;

/** One page of completion history. The tool's own maximum. */
const COMPLETION_PAGE_SIZE = 200;

/**
 * A bound on paging, so a tool that keeps saying "there is more" cannot spin
 * forever inside a pass that is holding the advisory lock.
 */
const MAX_COMPLETION_PAGES = 50;

export interface TaskToolClientOptions {
  /** The integration token. Held here, logged nowhere (docs/14-threat-model.md §1, A1). */
  readonly token: string;
  readonly baseUrl?: string | undefined;
  readonly transport?: Transport | undefined;
  readonly retry?: RetryPolicy | undefined;
  readonly metrics?: ConnectorMetrics | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => Date) | undefined;
}

export function createTaskToolClient(options: TaskToolClientOptions): TaskToolClient {
  const baseUrl = trimTrailing(options.baseUrl ?? DEFAULT_TASK_TOOL_BASE_URL, '/');
  const transport = options.transport ?? createRefusingTransport('task');

  const requestOptions = (operation: string): RequestOptions => ({
    tool: 'task',
    operation,
    transport,
    retry: options.retry,
    metrics: options.metrics,
    sleep: options.sleep,
    random: options.random,
    now: options.now,
  });

  const post = async (path: string, form: URLSearchParams, operation: string): Promise<unknown> =>
    executeJson(
      {
        method: 'POST',
        url: `${baseUrl}${path}`,
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      requestOptions(operation),
    );

  const sync = async (token: string, operation: string) => {
    const form = new URLSearchParams({
      sync_token: token,
      resource_types: JSON.stringify(RESOURCE_TYPES),
    });
    const body = await post('/sync/v9/sync', form, operation);
    return parseOrThrow(wireSyncResponseSchema, body, {
      tool: 'task',
      operation,
      shape: 'sync response',
    });
  };

  return {
    async syncIncremental(token?: string): Promise<SyncResult> {
      const operation = token === undefined ? 'sync (first run)' : 'sync incremental';
      const response = await sync(token ?? FULL_SYNC_TOKEN, operation);

      const changes: TaskChange[] = [];
      for (const project of response.projects ?? []) {
        changes.push({
          kind: 'project',
          deleted: project.is_deleted,
          project: mapProject(project),
        });
      }
      for (const section of response.sections ?? []) {
        changes.push({
          kind: 'section',
          deleted: section.is_deleted,
          section: mapSection(section),
        });
      }
      for (const label of response.labels ?? []) {
        changes.push({ kind: 'label', deleted: label.is_deleted, label: mapLabel(label) });
      }
      for (const item of response.items ?? []) {
        changes.push({ kind: 'task', deleted: item.is_deleted, task: mapTask(item, operation) });
      }

      return { changes, token: response.sync_token };
    },

    async fetchAll(): Promise<TaskSnapshot> {
      const operation = 'full fetch';
      const response = await sync(FULL_SYNC_TOKEN, operation);

      // A deleted object in a full pass is an object that no longer exists.
      // Carrying it forward would make the drift count permanent.
      return {
        token: response.sync_token,
        projects: (response.projects ?? []).filter((p) => !p.is_deleted).map(mapProject),
        sections: (response.sections ?? []).filter((s) => !s.is_deleted).map(mapSection),
        labels: (response.labels ?? []).filter((l) => !l.is_deleted).map(mapLabel),
        tasks: (response.items ?? [])
          .filter((item) => !item.is_deleted)
          .map((item) => mapTask(item, operation)),
      };
    },

    async fetchCompletions(since: Date, until?: Date): Promise<Completion[]> {
      const operation = 'fetch completions';
      const completions: Completion[] = [];

      for (let page = 0; page < MAX_COMPLETION_PAGES; page += 1) {
        const form = new URLSearchParams({
          since: since.toISOString(),
          limit: String(COMPLETION_PAGE_SIZE),
          offset: String(page * COMPLETION_PAGE_SIZE),
          ...(until === undefined ? {} : { until: until.toISOString() }),
        });
        const body = await post('/sync/v9/completed/get_all', form, operation);
        const response = parseOrThrow(wireCompletedResponseSchema, body, {
          tool: 'task',
          operation,
          shape: 'completion history',
        });

        for (const item of response.items) completions.push(mapCompletion(item, operation));
        if (response.items.length < COMPLETION_PAGE_SIZE) return completions;
      }

      throw new ConnectorError(
        'pagination',
        `completion history did not end after ${String(MAX_COMPLETION_PAGES)} pages; refusing to keep paging while holding the pass — narrow the window with "until"`,
        { tool: 'task', operation },
      );
    },
  };
}
