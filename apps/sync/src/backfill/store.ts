import type postgres from 'postgres';
import type { AreaKey, AreaKind } from '@prisme/domain';
import { locationKey } from '../reconcile/types.js';
import type { BackfillStore } from './ports.js';
import type { Cursor } from './slices.js';
import type { AdherencePeriod, CapacityWeek, RitualRecord, StoredCompletion } from './types.js';

/**
 * The {@link BackfillStore} backed by PostgreSQL.
 *
 * The same two rules as `adoption/store.ts`, for the same reasons:
 *
 *   - **Every statement is a tagged template**, which postgres.js turns into a
 *     parameterised query. Nothing is concatenated into SQL, and everything
 *     here is third-party data from an external tool.
 *   - **Timestamps cross the boundary as text.** Drizzle replaces the shared
 *     client's `timestamptz` serializer with the identity function, so a tagged
 *     template on the same client must hand the driver a string. W04 found this
 *     by running it; the comment is here so nobody finds it that way twice.
 */

function stamp(at: Date): string {
  return at.toISOString();
}

/** Postgres returns `timestamptz` as a Date or a string depending on the driver's mood. */
function instant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

interface CompletionRow {
  readonly external_task_id: string;
  readonly completed_at: Date | string;
  readonly external_project_id: string | null;
  readonly external_section_id: string | null;
  readonly recorded_minutes: number | null;
  readonly duration_scale: string | null;
}

export function createBackfillStore(client: postgres.Sql): BackfillStore {
  return {
    async loadCursor(): Promise<Cursor | undefined> {
      const rows = await client<{ covered_from: Date | string; covered_through: Date | string }[]>`
        select covered_from, covered_through from backfill_cursor where id = 'singleton'`;

      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        coveredFrom: instant(row.covered_from),
        coveredThrough: instant(row.covered_through),
      };
    },

    /**
     * One window's rows and the cursor, in one transaction.
     *
     * `covered_from` uses `least` rather than the value handed in so that a run
     * extending the range backwards cannot move the start of coverage forwards
     * halfway through — the cursor's claim only ever widens within a run.
     */
    async recordSlice(completions: readonly StoredCompletion[], covers: Cursor): Promise<void> {
      await client.begin(async (tx) => {
        if (completions.length > 0) {
          // `unnest` with the column types spelled out, rather than the row-set
          // helper: `completed_at` is `timestamptz` and the driver hands
          // strings across, so the cast has to be somewhere. Here it is
          // visible, and it is also one round trip for the whole window.
          //
          // **The array crosses as `text[]`, and the cast to `timestamptz[]`
          // happens in SQL** — `cast(… as timestamptz[])`, never `::timestamptz[]`
          // on the parameter. `createDatabase` wraps the driver in Drizzle, and
          // Drizzle replaces the shared client's serializers for `date[]` and
          // `timestamptz[]` with the identity function; a JS array handed to
          // one of those reaches the socket writer as an array and the driver
          // raises a `TypeError` naming neither the column nor the statement.
          // `text[]` and `integer[]` are untouched, which is why only this
          // window insert and the two date-array writes below were affected.
          //
          // Found by running the integration suite against the client the
          // application actually builds — see `test-support/database.ts`.
          await tx`
            insert into completion_history
              (external_task_id, completed_at, external_project_id, external_section_id,
               recorded_minutes, duration_scale)
            select * from unnest(
              ${completions.map((c) => c.externalTaskId)}::text[],
              cast(${completions.map((c) => stamp(c.completedAt))}::text[] as timestamptz[]),
              ${completions.map((c) => c.externalProjectId ?? null)}::text[],
              ${completions.map((c) => c.externalSectionId ?? null)}::text[],
              ${completions.map((c) => c.recordedMinutes ?? null)}::integer[],
              ${completions.map((c) => c.durationScale ?? null)}::text[]
            )
            on conflict (external_task_id, completed_at) do update set
              external_project_id = excluded.external_project_id,
              external_section_id = excluded.external_section_id,
              recorded_minutes    = excluded.recorded_minutes,
              duration_scale      = excluded.duration_scale,
              fetched_at          = now()`;
        }

        await tx`
          insert into backfill_cursor (id, covered_from, covered_through, updated_at)
          values ('singleton', ${stamp(covers.coveredFrom)}::timestamptz,
                  ${stamp(covers.coveredThrough)}::timestamptz, now())
          on conflict (id) do update set
            covered_from    = least(backfill_cursor.covered_from, excluded.covered_from),
            covered_through = greatest(backfill_cursor.covered_through, excluded.covered_through),
            updated_at      = now()`;
      });
    },

    async loadCompletions(from: Date, to: Date): Promise<readonly StoredCompletion[]> {
      const rows = await client<CompletionRow[]>`
        select external_task_id, completed_at, external_project_id, external_section_id,
               recorded_minutes, duration_scale
        from completion_history
        where completed_at >= ${stamp(from)}::timestamptz
          and completed_at <  ${stamp(to)}::timestamptz
        order by completed_at, external_task_id`;

      return rows.map((row) => ({
        externalTaskId: row.external_task_id,
        completedAt: instant(row.completed_at),
        ...(row.external_project_id === null ? {} : { externalProjectId: row.external_project_id }),
        ...(row.external_section_id === null ? {} : { externalSectionId: row.external_section_id }),
        ...(row.recorded_minutes === null ? {} : { recordedMinutes: row.recorded_minutes }),
        ...(row.duration_scale === null
          ? {}
          : { durationScale: row.duration_scale as 'minute' | 'day' }),
      }));
    },

    async loadAreaMap() {
      const [mappings, areas] = await Promise.all([
        client<
          { area_key: string; external_project_id: string; external_section_id: string | null }[]
        >`
          select area_key, external_project_id, external_section_id from area_mapping`,
        client<{ key: string; kind: string }[]>`select key, kind from area`,
      ]);

      const areaByLocation = new Map<string, AreaKey>();
      for (const row of mappings) {
        areaByLocation.set(
          locationKey(row.external_project_id, row.external_section_id ?? undefined),
          row.area_key,
        );
      }

      const kindByArea = new Map<AreaKey, AreaKind>();
      for (const row of areas) kindByArea.set(row.key, row.kind as AreaKind);

      return { areaByLocation, kindByArea };
    },

    /**
     * Rituals, with the task each one is measured from.
     *
     * The join is `entity_external_ref`, which is the only structural answer to
     * "which recurring task is this habit". A left join rather than an inner
     * one: a ritual with no binding is not an error, it is a habit prisme
     * cannot measure yet, and the run reports it by name rather than dropping
     * it from the count.
     */
    async loadRituals(): Promise<readonly RitualRecord[]> {
      const rows = await client<
        {
          id: string;
          name: string;
          area_key: string;
          cadence: string;
          external_page_id: string | null;
          external_task_id: string | null;
        }[]
      >`
        select r.id::text as id, r.name, r.area_key, r.cadence, r.external_page_id,
               ref.external_id as external_task_id
        from ritual r
        left join entity_external_ref ref
          on ref.prisme_id = r.id::text and ref.kind = 'task'
        order by r.id`;

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        areaKey: row.area_key,
        cadence: row.cadence as RitualRecord['cadence'],
        ...(row.external_task_id === null ? {} : { externalTaskId: row.external_task_id }),
        ...(row.external_page_id === null ? {} : { externalPageId: row.external_page_id }),
      }));
    },

    /**
     * Delete the range, then insert. One transaction.
     *
     * Delete-then-insert rather than upsert-and-prune, for the reason the
     * adoption mirror is replaced the same way: a row that survives because
     * nothing overwrote it describes a week that may no longer have any
     * completions in it at all.
     */
    async replaceCapacityWeeks(
      rows: readonly CapacityWeek[],
      fromWeek: string,
      toWeek: string,
    ): Promise<void> {
      await client.begin(async (tx) => {
        await tx`
          delete from capacity_week
          where week_start >= ${fromWeek}::date
            and week_start <  ${toWeek}::date`;

        if (rows.length === 0) return;

        await tx`
          insert into capacity_week
            (week_start, area_key, completions, minutes,
             minutes_recorded, minutes_declared, minutes_default)
          select * from unnest(
            cast(${rows.map((row) => row.weekStart)}::text[] as date[]),
            ${rows.map((row) => row.areaKey)}::text[],
            ${rows.map((row) => row.completions)}::integer[],
            ${rows.map((row) => row.minutes)}::integer[],
            ${rows.map((row) => row.minutesBySource.recorded)}::integer[],
            ${rows.map((row) => row.minutesBySource.declared)}::integer[],
            ${rows.map((row) => row.minutesBySource.default)}::integer[]
          )`;
      });
    },

    async recordAdherence(periods: readonly AdherencePeriod[]): Promise<void> {
      if (periods.length === 0) return;

      await client`
        insert into ritual_adherence (ritual_id, period_start, opportunities, completions)
        select * from unnest(
          ${periods.map((period) => period.ritualId)}::uuid[],
          cast(${periods.map((period) => period.periodStart)}::text[] as date[]),
          ${periods.map((period) => period.opportunities)}::integer[],
          ${periods.map((period) => period.completions)}::integer[]
        )
        on conflict (ritual_id, period_start) do update set
          opportunities = excluded.opportunities,
          completions   = excluded.completions`;
    },
  };
}
