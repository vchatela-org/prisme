import type postgres from 'postgres';
import type { CreationStore } from './ports.js';
import type {
  EntityRefs,
  Intent,
  IntentEntityKind,
  IntentObjectKind,
  IntentState,
} from './types.js';

/**
 * The {@link CreationStore} backed by PostgreSQL.
 *
 * The same two rules as every other store here: tagged templates only, and
 * timestamps cross as text because Drizzle replaces the shared client's
 * `timestamptz` serializer with the identity function (W04 found that by
 * running it).
 *
 * One rule is specific to this table, and it is the whole point of it:
 * **`recordSatisfied` is a transaction over three writes.** The ledger row,
 * the entity's own reference column, and `entity_external_ref`. Each on its
 * own is a lie — the intent alone leaves the entity unbound, the column alone
 * leaves guard 1 unable to refuse a second binding, the ref alone leaves the
 * ledger about to make a second object.
 */

type Tx = postgres.TransactionSql;

function stamp(at: Date): string {
  return at.toISOString();
}

interface IntentRow {
  readonly id: string;
  readonly entity_kind: IntentEntityKind;
  readonly entity_id: string;
  readonly tool: 'task' | 'document';
  readonly object_kind: IntentObjectKind;
  readonly ordinal: number;
  readonly draft: unknown;
  readonly idempotency_key: string;
  readonly state: IntentState;
  readonly external_id: string | null;
  readonly requires: string | null;
  readonly attempts: number;
}

/** `jsonb` arrives as text from this driver — the bug W05 found twice. */
function draftOf(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'string') return value as Record<string, unknown>;
  const parsed: unknown = JSON.parse(value);
  return parsed === null || typeof parsed !== 'object' ? {} : (parsed as Record<string, unknown>);
}

function toIntent(row: IntentRow): Intent {
  return {
    id: row.id,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    tool: row.tool,
    objectKind: row.object_kind,
    ordinal: Number(row.ordinal),
    draft: draftOf(row.draft),
    idempotencyKey: row.idempotency_key,
    state: row.state,
    ...(row.external_id === null ? {} : { externalId: row.external_id }),
    ...(row.requires === null ? {} : { requires: row.requires }),
    attempts: Number(row.attempts),
  };
}

/** Where a satisfied creation's reference belongs, per entity and object kind. */
const REFERENCE_COLUMN: Readonly<Record<string, { table: string; column: string } | undefined>> = {
  'capture:task': { table: 'capture', column: 'external_task_id' },
  'initiative:page': { table: 'initiative', column: 'external_page_id' },
  'project:project': { table: 'project', column: 'external_project_id' },
  'project:page': { table: 'project', column: 'external_page_id' },
  // A section belongs to a project but is not *the* project's reference:
  // prisme holds an ordered list of section names and no column per section,
  // so the binding lives only in `entity_external_ref`.
  'project:section': undefined,
};

export function createCreationStore(client: postgres.Sql): CreationStore {
  return {
    async loadOutstanding(): Promise<readonly Intent[]> {
      /*
       * Outstanding rows **and their prerequisites**, satisfied or not. The
       * ordering function needs to read a prerequisite's state and external
       * id; loading only the unsatisfied ones would make every section whose
       * project succeeded look like it waits on something that vanished.
       */
      const rows = await client<IntentRow[]>`
        select id::text, entity_kind, entity_id::text, tool, object_kind, ordinal,
               draft, idempotency_key::text, state, external_id, requires::text, attempts
          from creation_intent
         where state <> 'satisfied'
            or id in (select requires from creation_intent
                       where requires is not null and state <> 'satisfied')
         order by created_at, ordinal, id`;
      return rows.map(toIntent);
    },

    async loadEntityRefs(entityIds): Promise<ReadonlyMap<string, EntityRefs>> {
      if (entityIds.length === 0) return new Map();

      const rows = await client<{ id: string; external_project_id: string | null }[]>`
        select id::text, external_project_id
          from project
         where id = any(${entityIds as string[]}::uuid[])`;

      return new Map(
        rows.map((row) => [
          row.id,
          row.external_project_id === null
            ? {}
            : ({ externalProjectId: row.external_project_id } satisfies EntityRefs),
        ]),
      );
    },

    async recordSatisfied(input): Promise<void> {
      await client.begin(async (tx: Tx) => {
        const rows = await tx<
          { entity_kind: IntentEntityKind; entity_id: string; object_kind: IntentObjectKind }[]
        >`
          update creation_intent
             set state = 'satisfied', external_id = ${input.externalId},
                 attempts = attempts + 1, last_error = null, updated_at = now()
           where id = ${input.intentId}::uuid
          returning entity_kind, entity_id::text, object_kind`;

        const row = rows[0];
        if (row === undefined) {
          throw new Error('the intent vanished between planning and recording its result');
        }

        // Guard 1's row. No `on conflict`: if this object is already bound to
        // something else the transaction must fail, and the intent stay
        // unsatisfied, rather than two entities claiming one object.
        await tx`
          insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
          values (${row.entity_id}, ${row.entity_kind}, ${row.object_kind}, ${input.externalId})
          on conflict (prisme_id, kind, external_id) do nothing`;

        const slot = REFERENCE_COLUMN[`${row.entity_kind}:${row.object_kind}`];
        if (slot !== undefined) {
          await tx`
            update ${tx(slot.table)}
               set ${tx(slot.column)} = ${input.externalId},
                   updated_at = ${stamp(input.at)}::timestamptz
             where id = ${row.entity_id}::uuid`;
        }
      });
    },

    async recordFailed(input): Promise<void> {
      await client`
        update creation_intent
           set state = 'failed', last_error = ${input.reason}, attempts = attempts + 1,
               updated_at = ${stamp(input.at)}::timestamptz
         where id = ${input.intentId}::uuid`;
    },
  };
}
