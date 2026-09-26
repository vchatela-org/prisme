import {
  isConnectorError,
  ROLE_ACCESS,
  ROLE_KEYS,
  ROLE_SHAPE,
  type RoleKey,
} from '@prisme/connectors';
import type { z } from 'zod';
import type { bindingDto, bindingListDto, taskLocationsDto } from '../dto/settings.js';
import { ApiError } from '../http/errors.js';
import type { ApiStore, RoleBindingRecord } from '../store/types.js';
import type { ExternalDirectory } from '../sync/directory.js';

/**
 * The Settings screens' service: role bindings, and where work can live.
 *
 * ## A binding is saved even when its check fails
 *
 * The commonest reason a check fails is that the store has not been shared with
 * the integration yet — the tool enforces that on its side, and the order a
 * person does the two things in is theirs. Refusing the save would make them do
 * it in the one order the screen happens to like. So the identifier is stored,
 * the failure is stored beside it as a failure *kind*, and the overview shows a
 * binding that is set and not yet readable, which is the truth.
 *
 * What a successful check changes is the identifier itself, in one case: a
 * database pasted where a data source is wanted is resolved to the data source
 * inside it, because that is what prisme queries and nobody can see its id.
 *
 * ## Nothing upstream reaches the caller
 *
 * A connector error's message can carry the identifier it was about. What is
 * stored and returned is `error.failure` — `refused`, `invalid_token` — which a
 * screen can turn into advice and which names nothing (docs/17-privacy.md §1).
 */

export type BindingShape = z.infer<typeof bindingDto>;
export type BindingListShape = z.infer<typeof bindingListDto>;
export type TaskLocationsShape = z.infer<typeof taskLocationsDto>;

export interface SettingsService {
  listBindings(): Promise<BindingListShape>;
  putBinding(role: RoleKey, externalId: string | null, now: Date): Promise<BindingShape>;
  checkBindings(now: Date): Promise<BindingListShape>;
  taskLocations(): Promise<TaskLocationsShape>;
}

function toBindingDto(role: RoleKey, record: RoleBindingRecord | undefined): BindingShape {
  return {
    role,
    shape: ROLE_SHAPE[role],
    access: ROLE_ACCESS[role],
    bound: record !== undefined,
    externalId: record?.externalId ?? null,
    title: record?.title ?? null,
    linkId: record?.linkId ?? null,
    checkedAt: record?.checkedAt?.toISOString() ?? null,
    checkError: record?.checkError ?? null,
  };
}

/** A failure a screen can explain, and nothing a log line would need redacting. */
function failureKind(error: unknown): string {
  return isConnectorError(error) ? error.failure : 'unavailable';
}

export function createSettingsService(
  store: ApiStore,
  directory: ExternalDirectory,
): SettingsService {
  async function checked(role: RoleKey, externalId: string, now: Date): Promise<RoleBindingRecord> {
    try {
      const described = await directory.describe(externalId, ROLE_SHAPE[role]);
      return {
        role,
        externalId: described.externalId,
        title: described.title === '' ? null : described.title,
        linkId: described.linkId,
        checkedAt: now,
        checkError: null,
      };
    } catch (error) {
      return {
        role,
        externalId,
        title: null,
        linkId: null,
        checkedAt: now,
        checkError: failureKind(error),
      };
    }
  }

  async function list(): Promise<BindingListShape> {
    const records = new Map((await store.bindings.list()).map((record) => [record.role, record]));
    // Every role, bound or not: an unbound role is a gap the screen has to be
    // able to show, and a list of only the bound ones would hide it.
    return { items: ROLE_KEYS.map((role) => toBindingDto(role, records.get(role))) };
  }

  return {
    listBindings: list,

    async putBinding(role, externalId, now): Promise<BindingShape> {
      if (externalId === null) {
        await store.bindings.remove(role);
        return toBindingDto(role, undefined);
      }

      const record = await checked(role, externalId, now);
      const holder = (await store.bindings.list()).find(
        (other) => other.role !== role && other.externalId === record.externalId,
      );
      // Two roles may share a store (ADR-0025 says so for page stores), but a
      // *read* role sharing with a *create* role means prisme would create pages
      // inside a database it also reads as, say, takeaways. That is a
      // configuration nobody means; it is refused by name.
      if (
        holder !== undefined &&
        ROLE_ACCESS[role] !== ROLE_ACCESS[holder.role as RoleKey] &&
        (ROLE_ACCESS[role] === 'create' || ROLE_ACCESS[holder.role as RoleKey] === 'create')
      ) {
        throw new ApiError(
          'conflict',
          `${holder.role} already names this store, and one role reads it while the other creates in it — give page creation a location of its own`,
        );
      }

      await store.bindings.put(record);
      return toBindingDto(role, record);
    },

    async checkBindings(now): Promise<BindingListShape> {
      for (const record of await store.bindings.list()) {
        if (!(ROLE_KEYS as readonly string[]).includes(record.role)) continue;
        const role = record.role as RoleKey;
        const result = await checked(role, record.externalId, now);
        // A re-check never rewrites the identifier: resolving a pasted database
        // is a decision made when a person saves, not one a button makes later.
        await store.bindings.put({ ...result, externalId: record.externalId });
      }
      return list();
    },

    async taskLocations(): Promise<TaskLocationsShape> {
      let locations;
      try {
        locations = await directory.taskLocations();
      } catch (error) {
        // An answer rather than an error: the overview still renders every
        // mapping by identifier, and says why the names are missing.
        return { projects: [], failure: failureKind(error) };
      }

      const byOrder = <T extends { order: number; name: string }>(left: T, right: T): number =>
        left.order - right.order || left.name.localeCompare(right.name);

      return {
        failure: null,
        projects: [...locations.projects].sort(byOrder).map((project) => ({
          id: project.externalId,
          name: project.name,
          parentId: project.parentId ?? null,
          archived: project.archived,
          sections: locations.sections
            .filter((section) => section.projectId === project.externalId)
            .sort(byOrder)
            .map((section) => ({
              id: section.externalId,
              name: section.name,
              archived: section.archived,
            })),
        })),
      };
    },
  };
}
