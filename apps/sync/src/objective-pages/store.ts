import type postgres from 'postgres';
import type { ObjectiveType } from '@prisme/domain';
import { createPostgresStore } from '../state/postgres.js';
import { lastAppliedKey, type LastAppliedIndex } from '../reconcile/types.js';
import { OBJECTIVE_PAGE } from './plan.js';
import type { ObjectivePageStore } from './run.js';

type Sql = postgres.Sql;

/**
 * The objective-pages pass's side of PostgreSQL (ADR-0034).
 *
 * Three reads of its own — the objectives store's date column, the objectives
 * with a linked page, and what was last written into those pages — and the
 * three writes it shares with the task-tool half, taken from the reconciler's
 * store rather than written twice: `last_applied`, the conflict ledger and the
 * event log mean the same thing whichever tool the value went to.
 */
export function createObjectivePageStore(client: Sql): ObjectivePageStore {
  const shared = createPostgresStore(client);

  return {
    async loadDateColumn(): Promise<string | undefined> {
      const rows = await client<{ date_property: string | null }[]>`
        select date_property from role_binding where role = 'objectives_db'`;
      return rows[0]?.date_property ?? undefined;
    },

    async loadLinkedObjectives() {
      const rows = await client<
        {
          id: string;
          title: string;
          type: ObjectiveType;
          period: string;
          external_page_id: string;
        }[]
      >`
        select id::text, title, type, period, external_page_id
        from objective
        where external_page_id is not null and btrim(external_page_id) <> ''
        order by id`;
      return rows.map((row) => ({
        objectiveId: row.id,
        title: row.title,
        type: row.type,
        period: row.period,
        pageId: row.external_page_id,
      }));
    },

    async loadLastApplied(): Promise<LastAppliedIndex> {
      const rows = await client<
        { entity_id: string; field: string; value: string | null; applied_at: Date | string }[]
      >`
        select entity_id, field, value, applied_at from last_applied
        where entity_kind = ${OBJECTIVE_PAGE}`;
      return new Map(
        rows.map((row) => [
          lastAppliedKey(OBJECTIVE_PAGE, row.entity_id, row.field),
          {
            entityKind: OBJECTIVE_PAGE,
            entityId: row.entity_id,
            field: row.field,
            value: row.value,
            appliedAt: row.applied_at instanceof Date ? row.applied_at : new Date(row.applied_at),
          },
        ]),
      );
    },

    recordLastApplied: (writes, at) => shared.recordLastApplied(writes, at),
    recordConflict: (conflict, at) => shared.recordConflict(conflict, at),
    recordEvent: (event) => shared.recordEvent(event),
  };
}
