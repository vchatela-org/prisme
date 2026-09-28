import {
  canCreate,
  docIdKey,
  isConnectorError,
  isReadable,
  ROLE_ACCESS,
  ROLE_KEYS,
  ROLE_SHAPE,
  type RoleKey,
} from '@prisme/connectors';
import type { z } from 'zod';
import type {
  areaPagesDto,
  bindingDto,
  bindingListDto,
  taskLocationsDto,
} from '../dto/settings.js';
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
 * ## A page store's check reads its templates too
 *
 * Every role names a data source since ADR-0030, page stores included, and a
 * page store is only half-described by its title: what makes it addressable is
 * that its database holds at least one template (ADR-0030 rule 5). So its check
 * lists them, and keeps their names and the default mark — no identifier, since
 * a creation resolves its template from the live list. **An empty list is not a
 * failed check.** The binding is right; the database is one template away from
 * working, and the screen says that rather than "not readable". A binding that
 * names a page, as ADR-0025's did, fails as `wrong_kind` when the tool lets
 * that be seen.
 *
 * ## A read store's check lists its date properties
 *
 * So the adoption queue can be told which of them says when an entry's period
 * runs (`date_property`), chosen from a list rather than typed. A re-check
 * keeps the choice while the store still holds a date property of that name,
 * and drops it once it does not: a name that no longer resolves would date
 * nothing, silently. A failed check keeps it — the store was not read, so
 * nothing is known to have changed.
 *
 * ## …and its relation properties, for its area column
 *
 * The same shape, for ADR-0033: one relation property may be chosen as the
 * store's **area column** (`area_property`), and the adoption scan reads each
 * entry's area from it. Chosen from the list, carried across a re-check by the
 * same rule as the date. The page each area is recognised by is picked from the
 * Life areas store's entries, which {@link SettingsService.areaPages} lists.
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
export type AreaPagesShape = z.infer<typeof areaPagesDto>;

export interface SettingsService {
  listBindings(): Promise<BindingListShape>;
  putBinding(role: RoleKey, externalId: string | null, now: Date): Promise<BindingShape>;
  checkBindings(now: Date): Promise<BindingListShape>;
  /** Choose, or clear, the date property the adoption queue reads for this store. */
  setDateProperty(role: RoleKey, property: string | null): Promise<BindingShape>;
  /** Choose, or clear, the relation property the adoption scan reads areas from (ADR-0033). */
  setAreaProperty(role: RoleKey, property: string | null): Promise<BindingShape>;
  taskLocations(): Promise<TaskLocationsShape>;
  /** The Life areas store's entries, to pick an area's own page from (ADR-0033). */
  areaPages(): Promise<AreaPagesShape>;
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
    templates:
      record?.templates?.map((template) => ({
        name: template.name,
        isDefault: template.isDefault,
      })) ?? null,
    dateProperty: record?.dateProperty ?? null,
    dateProperties: record?.dateProperties ? [...record.dateProperties] : null,
    areaProperty: record?.areaProperty ?? null,
    relationProperties: record?.relationProperties ? [...record.relationProperties] : null,
  };
}

/**
 * The column a binding keeps after a check found `found` — its date column,
 * and by the same rule its area column (ADR-0033).
 *
 * Kept while the store still has a property of that name and type; dropped
 * once it does not. `null` found means the check did not read the schema,
 * which says nothing about the property, so the choice stands.
 */
export function carriedDateProperty(
  previous: string | null,
  found: readonly string[] | null,
): string | null {
  if (previous === null || found === null) return previous;
  return found.includes(previous) ? previous : null;
}

/** A failure a screen can explain, and nothing a log line would need redacting. */
function failureKind(error: unknown): string {
  return isConnectorError(error) ? error.failure : 'unavailable';
}

export function createSettingsService(
  store: ApiStore,
  directory: ExternalDirectory,
): SettingsService {
  async function checked(
    role: RoleKey,
    externalId: string,
    now: Date,
    previous: RoleBindingRecord | undefined,
  ): Promise<RoleBindingRecord> {
    let described;
    try {
      described = await directory.describe(externalId, ROLE_SHAPE[role]);
    } catch (error) {
      return {
        role,
        externalId,
        title: null,
        linkId: null,
        checkedAt: now,
        checkError: failureKind(error),
        templates: null,
        dateProperty: previous?.dateProperty ?? null,
        dateProperties: null,
        areaProperty: previous?.areaProperty ?? null,
        relationProperties: null,
      };
    }

    // Only a store prisme reads has entries to date, or to place in an area.
    const dateProperties = isReadable(role) ? (described.dateProperties ?? null) : null;
    const relationProperties = isReadable(role) ? (described.relationProperties ?? null) : null;
    const found = {
      role,
      externalId: described.externalId,
      title: described.title === '' ? null : described.title,
      linkId: described.linkId,
      checkedAt: now,
      dateProperty: carriedDateProperty(previous?.dateProperty ?? null, dateProperties),
      dateProperties,
      areaProperty: carriedDateProperty(previous?.areaProperty ?? null, relationProperties),
      relationProperties,
    };
    if (!canCreate(role)) return { ...found, checkError: null, templates: null };

    try {
      const templates = await directory.templates(role, described.externalId);
      return {
        ...found,
        checkError: null,
        templates: templates.map((template) => ({
          name: template.name,
          isDefault: template.isDefault,
        })),
      };
    } catch (error) {
      // The store answered and its templates did not: a failed check, with
      // what was found kept, rather than a store reported as holding none.
      return { ...found, checkError: failureKind(error), templates: null };
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

      const existing = await store.bindings.list();
      const record = await checked(
        role,
        externalId,
        now,
        existing.find((other) => other.role === role),
      );
      const holder = existing.find(
        (other) => other.role !== role && other.externalId === record.externalId,
      );
      // Two roles may share a store (ADR-0025 says so for page stores), but a
      // *read* role sharing with a *create* role means prisme would add entries
      // to a database it also reads as, say, takeaways. That is a
      // configuration nobody means; it is refused by name.
      if (
        holder !== undefined &&
        ROLE_ACCESS[role] !== ROLE_ACCESS[holder.role as RoleKey] &&
        (ROLE_ACCESS[role] === 'create' || ROLE_ACCESS[holder.role as RoleKey] === 'create')
      ) {
        throw new ApiError(
          'conflict',
          `${holder.role} already names this store, and one role reads it while the other creates in it — give page creation a database of its own`,
        );
      }

      await store.bindings.put(record);
      return toBindingDto(role, record);
    },

    async checkBindings(now): Promise<BindingListShape> {
      for (const record of await store.bindings.list()) {
        if (!(ROLE_KEYS as readonly string[]).includes(record.role)) continue;
        const role = record.role as RoleKey;
        const result = await checked(role, record.externalId, now, record);
        // A re-check never rewrites the identifier: resolving a pasted database
        // is a decision made when a person saves, not one a button makes later.
        await store.bindings.put({ ...result, externalId: record.externalId });
      }
      return list();
    },

    async setDateProperty(role, property): Promise<BindingShape> {
      const record = (await store.bindings.list()).find((binding) => binding.role === role);
      if (record === undefined) {
        throw new ApiError(
          'conflict',
          `${role} is not bound — bind the store before choosing its date`,
        );
      }
      if (!isReadable(role)) {
        throw new ApiError('unprocessable', `${role} is not a store prisme reads entries from`);
      }
      // Chosen from what the last check found, never typed: a name that is not
      // one of the store's date properties would date nothing, and nothing would
      // say so.
      if (property !== null && !(record.dateProperties ?? []).includes(property)) {
        throw new ApiError(
          'unprocessable',
          'that is not one of this store’s date properties — check the binding to refresh the list',
        );
      }

      await store.bindings.setDateProperty(role, property);
      return toBindingDto(role, { ...record, dateProperty: property });
    },

    async setAreaProperty(role, property): Promise<BindingShape> {
      const record = (await store.bindings.list()).find((binding) => binding.role === role);
      if (record === undefined) {
        throw new ApiError(
          'conflict',
          `${role} is not bound — bind the store before choosing its area column`,
        );
      }
      if (!isReadable(role)) {
        throw new ApiError('unprocessable', `${role} is not a store prisme reads entries from`);
      }
      // Chosen from what the last check found, never typed — the date column's
      // reasoning: a name that is not one of the store's relation properties
      // would place nothing in an area, and nothing would say so.
      if (property !== null && !(record.relationProperties ?? []).includes(property)) {
        throw new ApiError(
          'unprocessable',
          'that is not one of this store’s relation properties — check the binding to refresh the list',
        );
      }

      await store.bindings.setAreaProperty(role, property);
      return toBindingDto(role, { ...record, areaProperty: property });
    },

    async areaPages(): Promise<AreaPagesShape> {
      const binding = (await store.bindings.list()).find((record) => record.role === 'areas_db');
      if (binding === undefined) return { bound: false, failure: null, pages: [] };

      let entries;
      try {
        entries = await directory.areaPages(binding.externalId);
      } catch (error) {
        // An answer rather than an error, as for the task tool's locations: the
        // screen still shows the page an area already has, by identifier.
        return { bound: true, failure: failureKind(error), pages: [] };
      }

      // Which area already names each page, compared the way the scan compares
      // them — so the screen can say so rather than offer a choice the API
      // would refuse.
      const holder = new Map<string, string>();
      for (const area of await store.areas.list()) {
        if (area.externalPageId !== null) holder.set(docIdKey(area.externalPageId), area.key);
      }

      return {
        bound: true,
        failure: null,
        pages: [...entries]
          .sort(
            (left, right) =>
              left.title.localeCompare(right.title) ||
              left.externalId.localeCompare(right.externalId),
          )
          .map((entry) => ({
            id: entry.externalId,
            title: entry.title,
            heldBy: holder.get(docIdKey(entry.externalId)) ?? null,
          })),
      };
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
