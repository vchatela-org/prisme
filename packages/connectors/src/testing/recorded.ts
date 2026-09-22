import { createDocToolClient } from '../doc-tool/client.js';
import type { DocToolClient } from '../doc-tool/types.js';
import { createRoleBindings, ROLE_KEYS, type RoleBindings } from '../role-key.js';
import { createTaskToolClient } from '../task-tool/client.js';
import type { TaskToolClient } from '../task-tool/types.js';
import { createFixtureTransport, type FixtureTransport } from './fixture-transport.js';

/**
 * Recorded-fixture implementations of both clients — the second half of the
 * W03 contract ("both are interfaces with a recorded-fixture implementation
 * for tests").
 *
 * They are **the real clients over a recorded transport**, not a second
 * implementation of the interface. That distinction is the whole value: a
 * hand-written fake would satisfy the interface and prove nothing about the
 * schemas, the mapping, the pagination or the hashing, and it would keep
 * passing for months after the wire format moved underneath it.
 */

const RECORDED_TOKEN = 'recorded-fixture-token';

/** Bindings whose identifiers are obviously synthetic, for tests and dry runs. */
export function createRecordedBindings(): RoleBindings {
  return createRoleBindings(ROLE_KEYS.map((role) => ({ role, externalId: `recorded-${role}` })));
}

export interface RecordedTaskToolFixture {
  /** The response to a `*` sync token. */
  readonly fullSync: unknown;
  /** The response to any other token. Falls back to `fullSync`. */
  readonly incrementalSync?: unknown;
  /**
   * Pages of completion history, reached by following `next_cursor`. Each page
   * but the last must carry one; the last must not.
   */
  readonly completions?: readonly unknown[];
}

export interface RecordedClient<T> {
  readonly client: T;
  readonly transport: FixtureTransport;
}

export function createRecordedTaskToolClient(
  fixture: RecordedTaskToolFixture,
): RecordedClient<TaskToolClient> {
  const pages = fixture.completions ?? [{ items: [] }];

  /**
   * Which page a cursor handed out by an earlier page selects.
   *
   * The pages are reached *through their cursors*, not by counting requests.
   * That distinction is the test: a client that ignores `next_cursor` is served
   * page one again — and, with `limit` bounded, page one for ever — instead of
   * being handed the next page and looking correct.
   */
  const nextByCursor = new Map<string, number>();

  const transport = createFixtureTransport([
    {
      matches: (request) => request.url.includes('/tasks/completed/by_completion_date'),
      respond: (request) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        // An unknown cursor lands past the last page, so the run ends rather
        // than paging the same page until the bound trips.
        const index = cursor === null ? 0 : (nextByCursor.get(cursor) ?? pages.length);
        const body: unknown = pages[index] ?? { items: [] };
        const emitted =
          typeof body === 'object' && body !== null
            ? (body as { next_cursor?: unknown }).next_cursor
            : undefined;
        if (typeof emitted === 'string') nextByCursor.set(emitted, index + 1);
        return { body: JSON.stringify(body) };
      },
    },
    {
      matches: (request) => request.url.includes('/sync'),
      respond: (request) => {
        // Parsed rather than pattern-matched: the form encoder leaves `*`
        // unescaped, and a substring check for `%2A` silently served the
        // incremental fixture to every full pass.
        const isFull = new URLSearchParams(request.body ?? '').get('sync_token') === '*';
        const body = isFull ? fixture.fullSync : (fixture.incrementalSync ?? fixture.fullSync);
        return { body: JSON.stringify(body) };
      },
    },
  ]);

  return {
    transport,
    client: createTaskToolClient({ token: RECORDED_TOKEN, transport: transport.transport }),
  };
}

export interface RecordedDocToolFixture {
  /** Query responses, served in order as the client follows `next_cursor`. */
  readonly queryPages: readonly unknown[];
  /** The response to `GET /pages/{id}`. */
  readonly page?: unknown;
  /** Block-children responses, keyed by the parent whose children were asked for. */
  readonly blocksByParent?: Readonly<Record<string, unknown>>;
}

const EMPTY_LIST = { object: 'list', results: [], next_cursor: null, has_more: false };

export function createRecordedDocToolClient(
  fixture: RecordedDocToolFixture,
): RecordedClient<DocToolClient> {
  let queryPage = 0;

  const transport = createFixtureTransport([
    {
      matches: (request) => request.url.includes('/query'),
      respond: () => {
        const body = fixture.queryPages[Math.min(queryPage, fixture.queryPages.length - 1)];
        queryPage += 1;
        return { body: JSON.stringify(body ?? EMPTY_LIST) };
      },
    },
    {
      matches: (request) => request.url.includes('/blocks/'),
      respond: (request) => {
        const parentId = decodeURIComponent(
          /\/blocks\/([^/]+)\/children/.exec(request.url)?.[1] ?? '',
        );
        const body = (fixture.blocksByParent ?? {})[parentId] ?? EMPTY_LIST;
        return { body: JSON.stringify(body) };
      },
    },
    {
      matches: (request) => request.url.includes('/pages/'),
      respond: () => ({ body: JSON.stringify(fixture.page ?? {}) }),
    },
  ]);

  return {
    transport,
    client: createDocToolClient({
      token: RECORDED_TOKEN,
      bindings: createRecordedBindings(),
      transport: transport.transport,
    }),
  };
}
