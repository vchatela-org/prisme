import type postgres from 'postgres';
import {
  homeLocation,
  type CalendarDate,
  type InitiativeId,
  type InitiativeStatus,
  type Origin,
} from '@prisme/domain';
import { anchorPriorities } from '../reconcile/priority.js';
import { rollupFromCounts } from '../reconcile/subtree.js';
import {
  lastAppliedKey,
  locationKey,
  type DesiredAnchor,
  type DesiredState,
  type LastAppliedIndex,
  type LastAppliedWrite,
  type ConflictRecord,
  type Rollup,
} from '../reconcile/types.js';
import type {
  BindRefInput,
  CaptureInput,
  PassOutcome,
  ReconcilerStore,
  SyncCursor,
  SyncEvent,
} from '../apply/ports.js';
import { recordPassOutcome } from './run-state.js';

/**
 * The {@link ReconcilerStore} backed by PostgreSQL.
 *
 * Everything the reconciler knows about prisme's own state is read here and
 * written here. Three things are worth reading the file for:
 *
 *   - **Every statement is a tagged template**, which postgres.js turns into a
 *     parameterised query — no value is ever concatenated into SQL
 *     (docs/14-threat-model.md §5). The same style as `packages/db/src/lock.ts`
 *     and `health.ts`; `packages/db/src/schema` is deliberately empty and
 *     belongs to another workstream, so there are no Drizzle tables to build a
 *     query from yet.
 *   - **Dates cross the boundary as text.** `deadline` is a calendar fact in
 *     whole days, and letting a driver hand back a `Date` at local midnight is
 *     how an off-by-one appears at 23:00 and is gone by morning.
 *   - **A binding is one transaction.** The reference, the initiative's anchor
 *     id and the adoption decision commit together or not at all; a half-bound
 *     entity is the state guard 1 exists to prevent.
 */

/**
 * The estimates a captured initiative starts with.
 *
 * The intent channel says *make this an initiative* and nothing about how big
 * or how valuable it is, but the four numbers are not nullable — an initiative
 * without them cannot be scored at all. The middle of the scale is the least
 * wrong placeholder: it ranks the item in the middle of the inbox, where a
 * human triages it at the next review and replaces every one of these.
 */
const CAPTURE_ESTIMATE = 3;

/**
 * A timestamp, as text.
 *
 * `createDatabase` wraps the driver in Drizzle, and Drizzle **replaces the
 * shared client's serializer for `timestamptz` with the identity function** —
 * it formats its own dates and expects to. Any tagged-template query on the
 * same client then hands the driver a `Date` where it wants a string, and the
 * failure is a `TypeError` from deep inside the socket writer that names
 * neither the column nor the statement.
 *
 * Sending ISO-8601 text keeps this file independent of that. Found by running a
 * pass against a real database; nothing in a type checker or a unit test with a
 * fake store could have shown it.
 */
function stamp(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

/**
 * A timestamp, read back.
 *
 * The other half of {@link stamp}: Drizzle replaces the *parser* for
 * `timestamptz` too, so a column that is a `Date` in the driver's own hands
 * arrives here as PostgreSQL's text form. Accepting both keeps this file
 * correct whether or not something else on the shared client has changed its
 * mind about dates.
 */
function instant(value: Date | string | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  // `2026-09-17 09:05:00+00` — a space for the separator and a two-digit offset.
  const at = new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(at.getTime())) {
    throw new Error('a timestamp column did not parse; the database schema and this code disagree');
  }
  return at;
}

interface InitiativeRow {
  readonly id: string;
  readonly title: string;
  readonly area_key: string;
  readonly status: InitiativeStatus;
  readonly origin: Origin;
  readonly deadline: string | null;
  readonly project_id: string | null;
  readonly external_anchor_id: string | null;
}

interface MappingRow {
  readonly area_key: string;
  readonly external_project_id: string;
  readonly external_section_id: string | null;
  readonly is_home: boolean;
}

interface MirrorRow {
  readonly anchor_for: string;
  readonly total: string;
  readonly completed: string;
  readonly last_activity: Date | string | null;
}

/** The client `@prisme/db` hands out. Tagged templates, parameterised by the driver. */
type Sql = postgres.Sql;

/** The same interface inside a transaction — what `begin` hands its callback. */
type Tx = postgres.TransactionSql;

export function createPostgresStore(client: Sql): ReconcilerStore {
  return {
    async loadDesired(): Promise<DesiredState> {
      const initiatives = await client<InitiativeRow[]>`
        select id::text,
               title,
               area_key,
               status,
               origin,
               to_char(deadline, 'YYYY-MM-DD') as deadline,
               project_id::text,
               external_anchor_id
        from initiative
        order by id`;

      const mappings = await client<MappingRow[]>`
        select area_key, external_project_id, external_section_id, is_home
        from area_mapping
        order by area_key, external_project_id, external_section_id nulls first`;

      const projects = await client<
        { id: string; external_project_id: string | null; sections: string[] }[]
      >`
        select id::text, external_project_id, sections
        from project`;

      // The ranking the active scoring method produced, most recent row per
      // initiative. Scores are append-only (ADR-0006), so "latest" is a
      // `distinct on`, never an update.
      const ranking = await client<{ initiative_id: string; score: number }[]>`
        select distinct on (initiative_id) initiative_id::text, score
        from initiative_score
        where is_active_method
        order by initiative_id, computed_at desc`;

      // A decided adoption that has not been bound yet — W12 writes these.
      const pending = await client<{ prisme_id: string; external_id: string }[]>`
        select l.prisme_id, l.external_id
        from entity_link l
        left join entity_external_ref r
          on r.prisme_id = l.prisme_id
         and r.kind = l.external_kind
         and r.external_id = l.external_id
        where l.external_kind = 'task'
          and r.external_id is null
        order by l.prisme_id, l.external_id`;

      const mirror = await client<MirrorRow[]>`
        select anchor_for::text,
               count(*) as total,
               count(*) filter (where completed) as completed,
               max(completed_at) as last_activity
        from task_mirror
        where anchor_for is not null and not is_anchor
        group by anchor_for`;

      const areaByLocation = new Map<string, string>();
      for (const row of mappings) {
        const key = locationKey(row.external_project_id, row.external_section_id ?? undefined);
        areaByLocation.set(key, row.area_key);
      }

      // Where an anchor is created: the area's home, by the one rule the
      // capture flow uses too (`homeLocation`, packages/domain).
      const shapes = mappings.map((row) => ({
        areaKey: row.area_key,
        externalProjectId: row.external_project_id,
        externalSectionId: row.external_section_id,
        isHome: row.is_home,
      }));
      const locationByArea = new Map<string, { projectId: string; sectionId?: string }>();
      for (const areaKey of new Set(shapes.map((shape) => shape.areaKey))) {
        const home = homeLocation(areaKey, shapes);
        if (home === undefined) continue;
        locationByArea.set(areaKey, {
          projectId: home.externalProjectId,
          ...(home.externalSectionId === null ? {} : { sectionId: home.externalSectionId }),
        });
      }

      const projectLocation = new Map<string, { projectId: string }>();
      for (const row of projects) {
        if (row.external_project_id !== null) {
          projectLocation.set(row.id, { projectId: row.external_project_id });
        }
      }

      const rollupByInitiative = new Map<string, Rollup>();
      for (const row of mirror) {
        rollupByInitiative.set(
          row.anchor_for,
          rollupFromCounts(Number(row.total), Number(row.completed), instant(row.last_activity)),
        );
      }

      const pendingByInitiative = new Map<string, string>();
      for (const row of pending) {
        if (!pendingByInitiative.has(row.prisme_id)) {
          pendingByInitiative.set(row.prisme_id, row.external_id);
        }
      }

      const priorities = anchorPriorities(
        initiatives.map((row) => ({ id: row.id, status: row.status })),
        [...ranking]
          .sort((left, right) => right.score - left.score)
          .map((row) => row.initiative_id),
      );

      const anchors: DesiredAnchor[] = initiatives.map((row) => {
        const fromProject =
          row.project_id === null ? undefined : projectLocation.get(row.project_id);
        const location = fromProject ?? locationByArea.get(row.area_key);

        return {
          initiativeId: row.id,
          title: row.title,
          areaKey: row.area_key,
          status: row.status,
          origin: row.origin,
          priority: priorities.get(row.id) ?? 'lowest',
          ...(row.deadline === null ? {} : { deadline: row.deadline as CalendarDate }),
          ...(location === undefined
            ? {}
            : { location, locationSource: fromProject === undefined ? 'area' : 'project' }),
          ...(row.external_anchor_id === null ? {} : { externalAnchorId: row.external_anchor_id }),
          ...(pendingByInitiative.has(row.id)
            ? { pendingExternalId: pendingByInitiative.get(row.id) as string }
            : {}),
          ...(rollupByInitiative.has(row.id)
            ? { rollup: rollupByInitiative.get(row.id) as Rollup }
            : {}),
        };
      });

      return { anchors, areaByLocation };
    },

    async loadLastApplied(): Promise<LastAppliedIndex> {
      const rows = await client<
        {
          entity_kind: string;
          entity_id: string;
          field: string;
          value: string | null;
          applied_at: Date | string;
        }[]
      >`select entity_kind, entity_id, field, value, applied_at from last_applied`;

      return new Map(
        rows.map((row) => [
          lastAppliedKey(row.entity_kind, row.entity_id, row.field),
          {
            entityKind: row.entity_kind,
            entityId: row.entity_id,
            field: row.field,
            value: row.value,
            // Only the value takes part in the overwrite guard; the timestamp
            // is for a human reading the table.
            appliedAt: instant(row.applied_at) ?? new Date(0),
          },
        ]),
      );
    },

    async loadCursor(): Promise<SyncCursor> {
      const rows = await client<
        {
          task_tool_token: string | null;
          doc_watermark: Date | string | null;
          last_full_pass_at: Date | string | null;
        }[]
      >`select task_tool_token, doc_watermark, last_full_pass_at from sync_cursor where id = 'singleton'`;

      const row = rows[0];
      if (row === undefined) return {};
      const watermark = instant(row.doc_watermark);
      const lastFullPass = instant(row.last_full_pass_at);
      return {
        ...(row.task_tool_token === null ? {} : { taskToolToken: row.task_tool_token }),
        ...(watermark === undefined ? {} : { docWatermark: watermark }),
        ...(lastFullPass === undefined ? {} : { lastFullPassAt: lastFullPass }),
      };
    },

    async saveCursor(cursor: SyncCursor): Promise<void> {
      await client`
        insert into sync_cursor (id, task_tool_token, doc_watermark, last_full_pass_at, updated_at)
        values ('singleton',
                ${cursor.taskToolToken ?? null},
                ${stamp(cursor.docWatermark)}::timestamptz,
                ${stamp(cursor.lastFullPassAt)}::timestamptz,
                now())
        on conflict (id) do update set
          task_tool_token = excluded.task_tool_token,
          doc_watermark = excluded.doc_watermark,
          last_full_pass_at = excluded.last_full_pass_at,
          updated_at = now()`;
    },

    async bindExternalRef(input: BindRefInput): Promise<void> {
      await client.begin(async (tx: Tx) => {
        await tx`
          insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
          values (${input.initiativeId}, 'initiative', 'task', ${input.externalId})
          on conflict do nothing`;

        await tx`
          update initiative
          set external_anchor_id = ${input.externalId}, updated_at = now()
          where id = ${input.initiativeId}::uuid`;

        if (input.link !== undefined) {
          await tx`
            insert into entity_link
              (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
            values (${input.initiativeId}, 'task', ${input.externalId}, ${input.link.matchRule},
                    ${input.link.confidence}, ${input.link.decidedBy}, ${stamp(input.at)}::timestamptz)
            on conflict do nothing`;
        }
      });
    },

    async captureInitiative(input: CaptureInput): Promise<InitiativeId> {
      const rows = await client<{ id: string }[]>`
        insert into initiative
          (title, area_key, status, value, time_criticality, risk, size, origin, deadline)
        values (${input.title}, ${input.areaKey}, 'inbox',
                ${CAPTURE_ESTIMATE}, ${CAPTURE_ESTIMATE}, ${CAPTURE_ESTIMATE}, ${CAPTURE_ESTIMATE},
                'adopted', ${input.deadline ?? null}::date)
        returning id::text`;

      const created = rows[0];
      if (created === undefined) {
        throw new Error(
          'the capture inserted no initiative; refusing to bind a reference to nothing',
        );
      }
      return created.id;
    },

    async adoptDeadline(input): Promise<void> {
      // `deadline is null` repeats the planner's rule where the row is: a
      // deadline prisme already holds is a decision, and is never replaced.
      await client`
        update initiative
        set deadline = ${input.deadline}::date, updated_at = now()
        where id = ${input.initiativeId}::uuid and deadline is null`;
    },

    async setStatus(input): Promise<void> {
      // `done` carries the day it finished — the table refuses the status
      // without it, and a completion with no date is a KPI that cannot be drawn.
      await client`
        update initiative
        set status = ${input.to},
            done_at = case
                        when ${input.to}::text = 'done' then coalesce(done_at, ${stamp(input.at)}::date)
                        else done_at
                      end,
            updated_at = now()
        where id = ${input.initiativeId}::uuid`;
    },

    async recordRollup(input): Promise<void> {
      await client.begin(async (tx: Tx) => {
        const mirrored = [
          { task: input.anchorTask, isAnchor: true },
          ...input.subtree.map((task) => ({ task, isAnchor: false })),
        ];

        for (const { task, isAnchor } of mirrored) {
          await tx`
            insert into task_mirror
              (external_id, external_parent_id, anchor_for, area_key, is_anchor, completed,
               completed_at, recorded_minutes, due, priority, observed_at)
            values (${task.externalId}, ${task.parentId ?? null}, ${input.initiativeId}::uuid,
                    ${input.areaKey}, ${isAnchor}, ${task.completed},
                    ${stamp(task.completedAt)}::timestamptz,
                    ${task.recordedMinutes ?? null}, ${task.due?.date ?? null}, ${task.priority},
                    ${stamp(input.at)}::timestamptz)
            on conflict (external_id) do update set
              external_parent_id = excluded.external_parent_id,
              anchor_for = excluded.anchor_for,
              area_key = excluded.area_key,
              is_anchor = excluded.is_anchor,
              completed = excluded.completed,
              completed_at = excluded.completed_at,
              recorded_minutes = excluded.recorded_minutes,
              due = excluded.due,
              priority = excluded.priority,
              observed_at = excluded.observed_at`;
        }

        // Subtasks that left the subtree stop counting towards this initiative.
        const present = input.subtree.map((task) => task.externalId);
        await tx`
          delete from task_mirror
          where anchor_for = ${input.initiativeId}::uuid
            and not is_anchor
            and not (external_id = any (${present}::text[]))`;
      });
    },

    async recordLastApplied(writes: readonly LastAppliedWrite[], at: Date): Promise<void> {
      for (const write of writes) {
        await client`
          insert into last_applied (entity_kind, entity_id, field, value, applied_at)
          values (${write.entityKind}, ${write.entityId}, ${write.field}, ${write.value},
                  ${stamp(at)}::timestamptz)
          on conflict (entity_kind, entity_id, field) do update set
            value = excluded.value,
            applied_at = excluded.applied_at`;
      }
    },

    async recordConflict(conflict: ConflictRecord, at: Date): Promise<void> {
      await client`
        insert into sync_conflict
          (entity_id, field, prisme_value, external_value, detected_at, resolution, actor)
        values (${conflict.entityId}, ${conflict.field}, ${conflict.prismeValue},
                ${conflict.externalValue}, ${stamp(at)}::timestamptz, ${conflict.resolution}, 'sync')`;
    },

    async recordEvent(event: SyncEvent): Promise<void> {
      await client`
        insert into event_log (kind, entity_kind, entity_id, field, before, after, actor, occurred_at)
        values (${event.kind}, ${event.entityKind}, ${event.entityId}, ${event.field ?? null},
                ${JSON.stringify(event.before ?? null)}::jsonb,
                ${JSON.stringify(event.after ?? null)}::jsonb,
                'sync', ${stamp(event.occurredAt)}::timestamptz)`;
    },

    /**
     * The pass's own outcome. See `./run-state.ts` for why it is written at
     * all: a CronJob pod is never scraped, so the only way these two numbers
     * reach Prometheus is the API republishing them from here.
     */
    async recordPassOutcome(outcome: PassOutcome): Promise<void> {
      await recordPassOutcome(client, outcome);
    },
  };
}
