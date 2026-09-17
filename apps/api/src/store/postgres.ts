import type postgres from 'postgres';
import type {
  AdherenceRecord,
  AdoptionRecord,
  AppendEventInput,
  ApiStore,
  AreaMappingRecord,
  AreaRecord,
  AreaWeightRecord,
  CompletionRecord,
  ConflictRecord,
  CreateAreaInput,
  CreateInitiativeInput,
  EventRecord,
  InitiativeFilter,
  InitiativeRecord,
  KeyResultRecord,
  MeasurementRecord,
  ObjectiveRecord,
  Paged,
  PageRequest,
  ProjectRecord,
  ReviewRecord,
  RitualRecord,
  RollupRecord,
  ScoreRecord,
  SyncStateRecord,
  TakeawayRecord,
  TaskRecord,
  UpdateAreaInput,
  UpdateInitiativeInput,
} from './types.js';

/**
 * The store, in SQL.
 *
 * Every statement is a tagged template, which postgres.js turns into a
 * parameterised query — **no value is ever concatenated into SQL**
 * (docs/14-threat-model.md §5). Conditional filters are nested fragments rather
 * than string building, which is why a search term arrives as a parameter even
 * though it changes the shape of the `where` clause.
 *
 * Two details carried over from apps/sync/src/state/postgres.ts, for the same
 * reasons, found the same way — by running a pass against a real database:
 *
 *   - **Dates cross as text.** `to_char(col, 'YYYY-MM-DD')` on the way out,
 *     `${text}::date` on the way in. A deadline is a calendar fact in whole
 *     days; a driver handing back a `Date` at local midnight is an off-by-one
 *     that appears at 23:00 and is gone by morning.
 *   - **Timestamps are sent as ISO text.** `createDatabase` wraps the driver in
 *     Drizzle, and Drizzle replaces the shared client's `timestamptz`
 *     serializer with the identity function. A tagged template on the same
 *     client then hands the driver a `Date` where it wants a string, and the
 *     failure is a `TypeError` from inside the socket writer naming neither the
 *     column nor the statement.
 *
 * The `search` filter deliberately does not build a `like` pattern. `%` and `_`
 * in a user's search term would otherwise be wildcards they did not ask for —
 * harmless here, but the habit of shaping a pattern out of untrusted text is
 * the one worth not having.
 */

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

function stamp(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

function instant(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const at = new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(at.getTime())) {
    throw new Error('a timestamp column did not parse; the database schema and this code disagree');
  }
  return at;
}

function required(value: Date | string | null | undefined, column: string): Date {
  const parsed = instant(value);
  if (parsed === null) throw new Error(`${column} is NOT NULL but arrived empty`);
  return parsed;
}

/**
 * A `jsonb` column, read back.
 *
 * The driver hands `jsonb` over as **text**, not as a parsed value — so a
 * `factors` object arrives as the string `'{"costOfDelay":13}'` and every
 * property access on it silently yields `undefined`. Nothing in a type checker
 * sees it, because the row type says `Record<string, number>` and the driver
 * says `any`; it took a query against a real database to notice, which is the
 * same way apps/sync found its two date bugs.
 *
 * Accepting an already-parsed value too keeps this correct if a future driver
 * setting changes its mind.
 */
function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  const parsed: unknown = JSON.parse(value);
  return parsed === null ? fallback : (parsed as T);
}

function number(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

/** `numeric` arrives as a string from the driver; a share is a number. */
function decimal(value: string | number | null, fallback: number): number {
  return number(value) ?? fallback;
}

interface AreaRow {
  key: string;
  name: string;
  kind: 'area' | 'run' | 'signals';
  active: boolean;
  external_page_id: string | null;
  run_budget_hours_per_week: string | number | null;
}

function toArea(row: AreaRow): AreaRecord {
  return {
    key: row.key,
    name: row.name,
    kind: row.kind,
    active: row.active,
    externalPageId: row.external_page_id,
    runBudgetHoursPerWeek: number(row.run_budget_hours_per_week),
  };
}

interface InitiativeRow {
  id: string;
  title: string;
  area_key: string;
  project_id: string | null;
  status: string;
  value: number;
  time_criticality: number;
  risk: number;
  size: number;
  deadline: string | null;
  earliest_start: string | null;
  planned_start: string | null;
  planned_end: string | null;
  external_page_id: string | null;
  external_anchor_id: string | null;
  origin: 'created_in_prisme' | 'adopted';
  done_at: string | null;
  dropped_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  depends_on: string[] | null;
}

function toInitiative(row: InitiativeRow): InitiativeRecord {
  return {
    id: row.id,
    title: row.title,
    areaKey: row.area_key,
    projectId: row.project_id,
    status: row.status,
    value: row.value,
    timeCriticality: row.time_criticality,
    risk: row.risk,
    size: row.size,
    deadline: row.deadline,
    earliestStart: row.earliest_start,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    externalPageId: row.external_page_id,
    externalAnchorId: row.external_anchor_id,
    origin: row.origin,
    doneAt: row.done_at,
    droppedReason: row.dropped_reason,
    createdAt: required(row.created_at, 'initiative.created_at'),
    updatedAt: required(row.updated_at, 'initiative.updated_at'),
    dependsOn: row.depends_on ?? [],
  };
}

export function createPostgresStore(client: Sql): ApiStore {
  /** The initiative projection, reused by every read that returns one. */
  const initiativeColumns = client`
    i.id::text,
    i.title,
    i.area_key,
    i.project_id::text,
    i.status,
    i.value,
    i.time_criticality,
    i.risk,
    i.size,
    to_char(i.deadline, 'YYYY-MM-DD') as deadline,
    to_char(i.earliest_start, 'YYYY-MM-DD') as earliest_start,
    to_char(i.planned_start, 'YYYY-MM-DD') as planned_start,
    to_char(i.planned_end, 'YYYY-MM-DD') as planned_end,
    i.external_page_id,
    i.external_anchor_id,
    i.origin,
    to_char(i.done_at, 'YYYY-MM-DD') as done_at,
    i.dropped_reason,
    i.created_at,
    i.updated_at,
    (select array_agg(d.depends_on_id::text order by d.depends_on_id)
       from initiative_dependency d where d.initiative_id = i.id) as depends_on`;

  async function readInitiative(id: string): Promise<InitiativeRecord | undefined> {
    const rows = await client<InitiativeRow[]>`
      select ${initiativeColumns} from initiative i where i.id = ${id}::uuid`;
    const row = rows[0];
    return row === undefined ? undefined : toInitiative(row);
  }

  async function readProject(id: string): Promise<ProjectRecord | undefined> {
    const rows = await client<ProjectRow[]>`
      select ${projectColumns} from project p where p.id = ${id}::uuid`;
    const row = rows[0];
    return row === undefined ? undefined : toProject(row);
  }

  const projectColumns = client`
    p.id::text,
    p.name,
    p.area_key,
    p.status,
    to_char(p.deadline, 'YYYY-MM-DD') as deadline,
    p.sections,
    p.external_page_id,
    p.external_project_id,
    p.origin,
    p.created_at,
    p.updated_at,
    (select count(*) from initiative i where i.project_id = p.id) as initiative_count`;

  interface ProjectRow {
    id: string;
    name: string;
    area_key: string;
    status: string;
    deadline: string | null;
    sections: string[];
    external_page_id: string | null;
    external_project_id: string | null;
    origin: 'created_in_prisme' | 'adopted';
    created_at: Date | string;
    updated_at: Date | string;
    initiative_count: string | number;
  }

  function toProject(row: ProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      areaKey: row.area_key,
      status: row.status,
      deadline: row.deadline,
      sections: row.sections,
      externalPageId: row.external_page_id,
      externalProjectId: row.external_project_id,
      origin: row.origin,
      initiativeCount: Number(row.initiative_count),
      createdAt: required(row.created_at, 'project.created_at'),
      updatedAt: required(row.updated_at, 'project.updated_at'),
    };
  }

  /**
   * `progress_computed` for a key result comes from the initiatives that serve
   * it, not from an anchor subtree of its own.
   *
   * docs/10-model.md §7 defines it as "tasks done ÷ total", and a key result's
   * own anchor is bound by the reconciler in `entity_external_ref` rather than
   * in `task_mirror.anchor_for`, which references an initiative. The work that
   * serves the key result is where its tasks actually are — and it is the more
   * honest denominator anyway: a key result with no initiatives serving it has
   * nothing to compute from, which is what `null` says.
   */
  const keyResultColumns = client`
    k.id::text,
    k.objective_id::text,
    k.statement,
    k.target,
    k.unit,
    k.progress_self,
    k.external_anchor_id,
    k.created_at,
    (select array_agg(s.initiative_id::text order by s.initiative_id)
       from key_result_served_by s where s.key_result_id = k.id) as served_by,
    (select count(*) from key_result_measurement m where m.key_result_id = k.id)
      as measurement_count,
    (select count(*) from task_mirror t
       join key_result_served_by s on s.initiative_id = t.anchor_for
      where s.key_result_id = k.id and not t.is_anchor) as task_total,
    (select count(*) from task_mirror t
       join key_result_served_by s on s.initiative_id = t.anchor_for
      where s.key_result_id = k.id and not t.is_anchor and t.completed) as task_done`;

  return {
    areas: {
      async list(): Promise<readonly AreaRecord[]> {
        const rows = await client<AreaRow[]>`
          select key, name, kind, active, external_page_id, run_budget_hours_per_week
          from area order by key`;
        return rows.map(toArea);
      },

      async get(key: string): Promise<AreaRecord | undefined> {
        const rows = await client<AreaRow[]>`
          select key, name, kind, active, external_page_id, run_budget_hours_per_week
          from area where key = ${key}`;
        const row = rows[0];
        return row === undefined ? undefined : toArea(row);
      },

      async create(input: CreateAreaInput): Promise<AreaRecord> {
        return client.begin(async (tx: Tx) => {
          const rows = await tx<AreaRow[]>`
            insert into area (key, name, kind, active, external_page_id, run_budget_hours_per_week)
            values (${input.key}, ${input.name}, ${input.kind}, ${input.active},
                    ${input.externalPageId ?? null}, ${input.runBudgetHoursPerWeek ?? null})
            returning key, name, kind, active, external_page_id, run_budget_hours_per_week`;

          for (const mapping of input.mappings) {
            await tx`
              insert into area_mapping (area_key, external_project_id, external_section_id)
              values (${input.key}, ${mapping.externalProjectId}, ${mapping.externalSectionId ?? null})`;
          }

          const row = rows[0];
          if (row === undefined) throw new Error('the area insert returned no row');
          return toArea(row);
        });
      },

      async update(key: string, input: UpdateAreaInput): Promise<AreaRecord | undefined> {
        // `coalesce(${value}, column)` leaves a field alone when it was not
        // sent. An explicit null is a separate parameter, so "clear it" and
        // "do not touch it" stay distinguishable — which a single coalesce
        // cannot express, and a spread of the parsed body would erase.
        const rows = await client<AreaRow[]>`
          update area set
            name = coalesce(${input.name ?? null}, name),
            active = coalesce(${input.active ?? null}, active),
            external_page_id = case when ${input.externalPageId === undefined}
                                 then external_page_id else ${input.externalPageId ?? null} end,
            run_budget_hours_per_week = case when ${input.runBudgetHoursPerWeek === undefined}
                                 then run_budget_hours_per_week
                                 else ${input.runBudgetHoursPerWeek ?? null} end
          where key = ${key}
          returning key, name, kind, active, external_page_id, run_budget_hours_per_week`;
        const row = rows[0];
        return row === undefined ? undefined : toArea(row);
      },

      async mappings(): Promise<readonly AreaMappingRecord[]> {
        const rows = await client<
          { area_key: string; external_project_id: string; external_section_id: string | null }[]
        >`
          select area_key, external_project_id, external_section_id
          from area_mapping
          order by area_key, external_project_id, external_section_id nulls first`;
        return rows.map((row) => ({
          areaKey: row.area_key,
          externalProjectId: row.external_project_id,
          externalSectionId: row.external_section_id,
        }));
      },

      async replaceMappings(key, mappings): Promise<readonly AreaMappingRecord[]> {
        return client.begin(async (tx: Tx) => {
          await tx`delete from area_mapping where area_key = ${key}`;
          for (const mapping of mappings) {
            await tx`
              insert into area_mapping (area_key, external_project_id, external_section_id)
              values (${key}, ${mapping.externalProjectId}, ${mapping.externalSectionId ?? null})`;
          }
          const rows = await tx<
            { area_key: string; external_project_id: string; external_section_id: string | null }[]
          >`
            select area_key, external_project_id, external_section_id
            from area_mapping where area_key = ${key}
            order by external_project_id, external_section_id nulls first`;
          return rows.map((row) => ({
            areaKey: row.area_key,
            externalProjectId: row.external_project_id,
            externalSectionId: row.external_section_id,
          }));
        });
      },

      async weights(year?: number): Promise<readonly AreaWeightRecord[]> {
        const rows = await client<{ area_key: string; year: number; weight_pct: string }[]>`
          select area_key, year, weight_pct from area_weight
          ${year === undefined ? client`` : client`where year = ${year}`}
          order by year, area_key`;
        return rows.map((row) => ({
          areaKey: row.area_key,
          year: row.year,
          weightPct: decimal(row.weight_pct, 0),
        }));
      },

      async putWeight(areaKey: string, year: number, weightPct: number): Promise<number | null> {
        const rows = await client<{ previous: string | null }[]>`
          with prior as (
            select weight_pct from area_weight where area_key = ${areaKey} and year = ${year}
          ), upserted as (
            insert into area_weight (area_key, year, weight_pct)
            values (${areaKey}, ${year}, ${weightPct})
            on conflict (area_key, year) do update set weight_pct = excluded.weight_pct
            returning 1
          )
          select (select weight_pct from prior) as previous from upserted`;
        return number(rows[0]?.previous ?? null);
      },
    },

    initiatives: {
      async list(filter: InitiativeFilter): Promise<readonly InitiativeRecord[]> {
        const rows = await client<InitiativeRow[]>`
          select ${initiativeColumns}
          from initiative i
          where true
            ${
              filter.areaKeys === undefined
                ? client``
                : client`and i.area_key = any(${filter.areaKeys as string[]}::text[])`
            }
            ${
              filter.statuses === undefined
                ? client``
                : client`and i.status = any(${filter.statuses as string[]}::text[])`
            }
            ${
              filter.projectId === undefined
                ? client``
                : client`and i.project_id = ${filter.projectId}::uuid`
            }
            ${
              filter.hasDeadline === undefined
                ? client``
                : filter.hasDeadline
                  ? client`and i.deadline is not null`
                  : client`and i.deadline is null`
            }
            ${
              filter.search === undefined
                ? client``
                : client`and position(lower(${filter.search}) in lower(i.title)) > 0`
            }
          order by i.created_at, i.id`;
        return rows.map(toInitiative);
      },

      get: readInitiative,

      async create(input: CreateInitiativeInput): Promise<InitiativeRecord> {
        const id = await client.begin(async (tx: Tx) => {
          const rows = await tx<{ id: string }[]>`
            insert into initiative
              (title, area_key, project_id, status, value, time_criticality, risk, size,
               deadline, earliest_start, external_page_id, origin)
            values (${input.title}, ${input.areaKey}, ${input.projectId ?? null}::uuid,
                    ${input.status}, ${input.value}, ${input.timeCriticality}, ${input.risk},
                    ${input.size}, ${input.deadline ?? null}::date,
                    ${input.earliestStart ?? null}::date, ${input.externalPageId ?? null},
                    ${input.origin})
            returning id::text`;

          const created = rows[0];
          if (created === undefined) throw new Error('the initiative insert returned no row');

          for (const dependency of input.dependsOn) {
            await tx`
              insert into initiative_dependency (initiative_id, depends_on_id)
              values (${created.id}::uuid, ${dependency}::uuid)`;
          }
          return created.id;
        });

        const created = await readInitiative(id);
        if (created === undefined)
          throw new Error('the initiative vanished between insert and read');
        return created;
      },

      async update(
        id: string,
        input: UpdateInitiativeInput,
      ): Promise<InitiativeRecord | undefined> {
        const rows = await client<{ id: string }[]>`
          update initiative set
            title = coalesce(${input.title ?? null}, title),
            area_key = coalesce(${input.areaKey ?? null}, area_key),
            project_id = case when ${input.projectId === undefined}
                           then project_id else ${input.projectId ?? null}::uuid end,
            value = coalesce(${input.value ?? null}, value),
            time_criticality = coalesce(${input.timeCriticality ?? null}, time_criticality),
            risk = coalesce(${input.risk ?? null}, risk),
            size = coalesce(${input.size ?? null}, size),
            deadline = case when ${input.deadline === undefined}
                         then deadline else ${input.deadline ?? null}::date end,
            earliest_start = case when ${input.earliestStart === undefined}
                         then earliest_start else ${input.earliestStart ?? null}::date end,
            external_page_id = case when ${input.externalPageId === undefined}
                         then external_page_id else ${input.externalPageId ?? null} end,
            dropped_reason = case when ${input.droppedReason === undefined}
                         then dropped_reason else ${input.droppedReason ?? null} end,
            updated_at = now()
          where id = ${id}::uuid
          returning id::text`;
        if (rows[0] === undefined) return undefined;
        return readInitiative(id);
      },

      async setStatus(id: string, to: string, reason: string | undefined, at: Date): Promise<void> {
        // `done` carries the day it finished: the table refuses the status
        // without it, and a completion with no date is a KPI that cannot be
        // drawn. A drop carries its reason for the same kind of reason — an
        // unexplained drop is indistinguishable from a deletion.
        await client`
          update initiative set
            status = ${to},
            done_at = case
                        when ${to}::text = 'done' then coalesce(done_at, ${stamp(at)}::date)
                        else done_at
                      end,
            dropped_reason = case
                               when ${to}::text = 'dropped' then coalesce(${reason ?? null}, dropped_reason)
                               else dropped_reason
                             end,
            updated_at = now()
          where id = ${id}::uuid`;
      },

      async replaceDependencies(id: string, dependsOn: readonly string[]): Promise<void> {
        // One transaction, so a rejected cycle leaves the old set intact. The
        // acyclicity trigger fires per inserted edge and names the path.
        await client.begin(async (tx: Tx) => {
          await tx`delete from initiative_dependency where initiative_id = ${id}::uuid`;
          for (const dependency of dependsOn) {
            await tx`
              insert into initiative_dependency (initiative_id, depends_on_id)
              values (${id}::uuid, ${dependency}::uuid)`;
          }
        });
      },

      async latestScores(): Promise<readonly ScoreRecord[]> {
        const rows = await client<ScoreRow[]>`
          select distinct on (initiative_id)
                 initiative_id::text, method_id, method_version, score, factors, explain, computed_at
          from initiative_score
          where is_active_method
          order by initiative_id, computed_at desc`;
        return rows.map(toScore);
      },

      async scoreHistory(id: string, limit: number): Promise<readonly ScoreRecord[]> {
        const rows = await client<ScoreRow[]>`
          select initiative_id::text, method_id, method_version, score, factors, explain, computed_at
          from initiative_score
          where initiative_id = ${id}::uuid
          order by computed_at desc
          limit ${limit}`;
        return rows.map(toScore);
      },

      async saveScores(scores: readonly ScoreRecord[], activeMethodId: string): Promise<void> {
        // Append-only: there is no update path here, and the trigger would
        // refuse one anyway (ADR-0006).
        await client.begin(async (tx: Tx) => {
          for (const score of scores) {
            await tx`
              insert into initiative_score
                (initiative_id, method_id, method_version, score, factors, explain,
                 computed_at, is_active_method)
              values (${score.initiativeId}::uuid, ${score.methodId}, ${score.methodVersion},
                      ${score.score}, ${JSON.stringify(score.factors)}::jsonb, ${score.explain},
                      ${stamp(score.computedAt)}::timestamptz,
                      ${score.methodId === activeMethodId})`;
          }
        });
      },

      async rollups(): Promise<readonly RollupRecord[]> {
        const rows = await client<
          {
            anchor_for: string;
            total: string;
            completed: string;
            last_activity: Date | string | null;
          }[]
        >`
          select anchor_for::text,
                 count(*) as total,
                 count(*) filter (where completed) as completed,
                 max(completed_at) as last_activity
          from task_mirror
          where anchor_for is not null and not is_anchor
          group by anchor_for`;
        return rows.map((row) => ({
          initiativeId: row.anchor_for,
          totalTaskCount: Number(row.total),
          completedTaskCount: Number(row.completed),
          lastActivity: instant(row.last_activity),
        }));
      },

      async tasks(id: string): Promise<readonly TaskRecord[]> {
        const rows = await client<TaskRow[]>`
          select external_id, external_parent_id, is_anchor, completed, completed_at,
                 recorded_minutes, to_char(due, 'YYYY-MM-DD') as due, priority, observed_at
          from task_mirror
          where anchor_for = ${id}::uuid
          order by is_anchor desc, external_id`;
        return rows.map((row) => ({
          externalId: row.external_id,
          externalParentId: row.external_parent_id,
          isAnchor: row.is_anchor,
          completed: row.completed,
          completedAt: instant(row.completed_at),
          recordedMinutes: row.recorded_minutes,
          due: row.due,
          priority: row.priority,
          observedAt: required(row.observed_at, 'task_mirror.observed_at'),
        }));
      },

      async completions(since: Date): Promise<readonly CompletionRecord[]> {
        const rows = await client<
          {
            external_id: string;
            area_key: string;
            completed_at: Date | string;
            recorded_minutes: number | null;
          }[]
        >`
          select external_id, area_key, completed_at, recorded_minutes
          from task_mirror
          where completed
            and area_key is not null
            and completed_at is not null
            and completed_at > ${stamp(since)}::timestamptz
          order by completed_at`;
        return rows.map((row) => ({
          id: row.external_id,
          areaKey: row.area_key,
          completedAt: required(row.completed_at, 'task_mirror.completed_at'),
          recordedMinutes: row.recorded_minutes ?? undefined,
        }));
      },
    },

    projects: {
      async list(areaKey, page: PageRequest): Promise<Paged<ProjectRecord>> {
        const rows = await client<(ProjectRow & { total: string })[]>`
          select ${projectColumns}, count(*) over () as total
          from project p
          where true ${areaKey === undefined ? client`` : client`and p.area_key = ${areaKey}`}
          order by p.created_at, p.id
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toProject),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      get: readProject,

      async create(input): Promise<ProjectRecord> {
        const rows = await client<{ id: string }[]>`
          insert into project (name, area_key, status, deadline, sections, origin)
          values (${input.name}, ${input.areaKey}, ${input.status}, ${input.deadline ?? null}::date,
                  ${input.sections as string[]}::text[], 'created_in_prisme')
          returning id::text`;
        const created = rows[0];
        if (created === undefined) throw new Error('the project insert returned no row');
        const project = await readProject(created.id);
        if (project === undefined) throw new Error('the project vanished between insert and read');
        return project;
      },

      async update(id, input): Promise<ProjectRecord | undefined> {
        const rows = await client<{ id: string }[]>`
          update project set
            name = coalesce(${input.name ?? null}, name),
            area_key = coalesce(${input.areaKey ?? null}, area_key),
            status = coalesce(${input.status ?? null}, status),
            deadline = case when ${input.deadline === undefined}
                         then deadline else ${input.deadline ?? null}::date end,
            sections = coalesce(${(input.sections ?? null) as string[] | null}::text[], sections),
            updated_at = now()
          where id = ${id}::uuid
          returning id::text`;
        if (rows[0] === undefined) return undefined;
        return readProject(id);
      },
    },

    okr: {
      async listObjectives(filter, page: PageRequest): Promise<Paged<ObjectiveRecord>> {
        const rows = await client<(ObjectiveRow & { total: string })[]>`
          select id::text, title, type, period, area_key, status, external_page_id, created_at,
                 count(*) over () as total
          from objective
          where true
            ${filter.period === undefined ? client`` : client`and period = ${filter.period}`}
            ${filter.areaKey === undefined ? client`` : client`and area_key = ${filter.areaKey}`}
            ${filter.status === undefined ? client`` : client`and status = ${filter.status}`}
          order by period desc, created_at, id
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toObjective),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async getObjective(id: string): Promise<ObjectiveRecord | undefined> {
        const rows = await client<ObjectiveRow[]>`
          select id::text, title, type, period, area_key, status, external_page_id, created_at
          from objective where id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toObjective(row);
      },

      async createObjective(input): Promise<ObjectiveRecord> {
        const rows = await client<ObjectiveRow[]>`
          insert into objective (title, type, period, area_key, status, external_page_id)
          values (${input.title}, ${input.type}, ${input.period}, ${input.areaKey},
                  ${input.status}, ${input.externalPageId ?? null})
          returning id::text, title, type, period, area_key, status, external_page_id, created_at`;
        const row = rows[0];
        if (row === undefined) throw new Error('the objective insert returned no row');
        return toObjective(row);
      },

      async updateObjective(id, input): Promise<ObjectiveRecord | undefined> {
        const rows = await client<ObjectiveRow[]>`
          update objective set
            title = coalesce(${input.title ?? null}, title),
            status = coalesce(${input.status ?? null}, status),
            external_page_id = case when ${input.externalPageId === undefined}
                                then external_page_id else ${input.externalPageId ?? null} end
          where id = ${id}::uuid
          returning id::text, title, type, period, area_key, status, external_page_id, created_at`;
        const row = rows[0];
        return row === undefined ? undefined : toObjective(row);
      },

      async keyResults(objectiveIds: readonly string[]): Promise<readonly KeyResultRecord[]> {
        if (objectiveIds.length === 0) return [];
        const rows = await client<KeyResultRow[]>`
          select ${keyResultColumns}
          from key_result k
          where k.objective_id = any(${objectiveIds as string[]}::uuid[])
          order by k.created_at, k.id`;
        return rows.map(toKeyResult);
      },

      async getKeyResult(id: string): Promise<KeyResultRecord | undefined> {
        const rows = await client<KeyResultRow[]>`
          select ${keyResultColumns} from key_result k where k.id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toKeyResult(row);
      },

      async createKeyResult(objectiveId, input): Promise<KeyResultRecord> {
        const id = await client.begin(async (tx: Tx) => {
          const rows = await tx<{ id: string }[]>`
            insert into key_result (objective_id, statement, target, unit, progress_self)
            values (${objectiveId}::uuid, ${input.statement}, ${input.target}, ${input.unit},
                    ${input.progressSelf})
            returning id::text`;
          const created = rows[0];
          if (created === undefined) throw new Error('the key result insert returned no row');
          for (const initiativeId of input.servedBy) {
            await tx`
              insert into key_result_served_by (key_result_id, initiative_id)
              values (${created.id}::uuid, ${initiativeId}::uuid)`;
          }
          return created.id;
        });

        const rows = await client<KeyResultRow[]>`
          select ${keyResultColumns} from key_result k where k.id = ${id}::uuid`;
        const row = rows[0];
        if (row === undefined) throw new Error('the key result vanished between insert and read');
        return toKeyResult(row);
      },

      async updateKeyResult(id, input): Promise<KeyResultRecord | undefined> {
        const updated = await client.begin(async (tx: Tx) => {
          const rows = await tx<{ id: string }[]>`
            update key_result set
              statement = coalesce(${input.statement ?? null}, statement),
              target = coalesce(${input.target ?? null}, target),
              unit = coalesce(${input.unit ?? null}, unit),
              progress_self = coalesce(${input.progressSelf ?? null}, progress_self)
            where id = ${id}::uuid
            returning id::text`;
          if (rows[0] === undefined) return false;

          if (input.servedBy !== undefined) {
            await tx`delete from key_result_served_by where key_result_id = ${id}::uuid`;
            for (const initiativeId of input.servedBy) {
              await tx`
                insert into key_result_served_by (key_result_id, initiative_id)
                values (${id}::uuid, ${initiativeId}::uuid)`;
            }
          }
          return true;
        });

        if (!updated) return undefined;
        const rows = await client<KeyResultRow[]>`
          select ${keyResultColumns} from key_result k where k.id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toKeyResult(row);
      },

      async addMeasurement(keyResultId, value, observedAt, note): Promise<void> {
        await client`
          insert into key_result_measurement (key_result_id, observed_at, value, note)
          values (${keyResultId}::uuid, ${stamp(observedAt)}::timestamptz, ${value},
                  ${note ?? null})`;
      },

      async measurements(keyResultId: string): Promise<readonly MeasurementRecord[]> {
        const rows = await client<
          { observed_at: Date | string; value: number; note: string | null }[]
        >`
          select observed_at, value, note from key_result_measurement
          where key_result_id = ${keyResultId}::uuid
          order by observed_at`;
        return rows.map((row) => ({
          keyResultId,
          observedAt: required(row.observed_at, 'key_result_measurement.observed_at'),
          value: row.value,
          note: row.note,
        }));
      },
    },

    lanes: {
      async takeaways(filter, page: PageRequest): Promise<Paged<TakeawayRecord>> {
        const rows = await client<(TakeawayRow & { total: string })[]>`
          select id::text, kind, external_page_id, area_key, promoted_to::text, observed_at,
                 count(*) over () as total
          from takeaway
          where true
            ${filter.kind === undefined ? client`` : client`and kind = ${filter.kind}`}
            ${
              filter.promoted === undefined
                ? client``
                : filter.promoted
                  ? client`and promoted_to is not null`
                  : client`and promoted_to is null`
            }
          order by observed_at desc, id
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toTakeaway),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async getTakeaway(id: string): Promise<TakeawayRecord | undefined> {
        const rows = await client<TakeawayRow[]>`
          select id::text, kind, external_page_id, area_key, promoted_to::text, observed_at
          from takeaway where id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toTakeaway(row);
      },

      async promoteTakeaway(id: string, initiativeId: string): Promise<void> {
        // The link is prisme's; the takeaway itself is the document tool's and
        // is not touched (docs/11-ownership.md §7).
        await client`
          update takeaway set promoted_to = ${initiativeId}::uuid where id = ${id}::uuid`;
      },

      async rituals(): Promise<readonly RitualRecord[]> {
        const rows = await client<RitualRow[]>`
          select id::text, name, area_key, cadence, target_adherence_pct, external_page_id
          from ritual order by area_key, name`;
        return rows.map(toRitual);
      },

      async getRitual(id: string): Promise<RitualRecord | undefined> {
        const rows = await client<RitualRow[]>`
          select id::text, name, area_key, cadence, target_adherence_pct, external_page_id
          from ritual where id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toRitual(row);
      },

      async createRitual(input): Promise<RitualRecord> {
        const rows = await client<RitualRow[]>`
          insert into ritual (name, area_key, cadence, target_adherence_pct, external_page_id)
          values (${input.name}, ${input.areaKey}, ${input.cadence}, ${input.targetAdherencePct},
                  ${input.externalPageId ?? null})
          returning id::text, name, area_key, cadence, target_adherence_pct, external_page_id`;
        const row = rows[0];
        if (row === undefined) throw new Error('the ritual insert returned no row');
        return toRitual(row);
      },

      async updateRitual(id, input): Promise<RitualRecord | undefined> {
        const rows = await client<RitualRow[]>`
          update ritual set
            name = coalesce(${input.name ?? null}, name),
            cadence = coalesce(${input.cadence ?? null}, cadence),
            target_adherence_pct = coalesce(${input.targetAdherencePct ?? null}, target_adherence_pct),
            external_page_id = case when ${input.externalPageId === undefined}
                                then external_page_id else ${input.externalPageId ?? null} end
          where id = ${id}::uuid
          returning id::text, name, area_key, cadence, target_adherence_pct, external_page_id`;
        const row = rows[0];
        return row === undefined ? undefined : toRitual(row);
      },

      async adherence(ritualIds, from, to): Promise<readonly AdherenceRecord[]> {
        if (ritualIds.length === 0) return [];
        const rows = await client<
          {
            ritual_id: string;
            period_start: string;
            opportunities: number;
            completions: number;
          }[]
        >`
          select ritual_id::text,
                 to_char(period_start, 'YYYY-MM-DD') as period_start,
                 opportunities, completions
          from ritual_adherence
          where ritual_id = any(${ritualIds as string[]}::uuid[])
            ${from === undefined ? client`` : client`and period_start >= ${from}::date`}
            ${to === undefined ? client`` : client`and period_start <= ${to}::date`}
          order by ritual_id, period_start`;
        return rows.map((row) => ({
          ritualId: row.ritual_id,
          periodStart: row.period_start,
          opportunities: row.opportunities,
          completions: row.completions,
        }));
      },

      async recordAdherence(record: AdherenceRecord): Promise<void> {
        await client`
          insert into ritual_adherence (ritual_id, period_start, opportunities, completions)
          values (${record.ritualId}::uuid, ${record.periodStart}::date, ${record.opportunities},
                  ${record.completions})
          on conflict (ritual_id, period_start) do update set
            opportunities = excluded.opportunities,
            completions = excluded.completions`;
      },
    },

    ops: {
      async reviews(cadence, page: PageRequest): Promise<Paged<ReviewRecord>> {
        const rows = await client<(ReviewRow & { total: string })[]>`
          select id::text, cadence, started_at, completed_at, checklist, decisions,
                 capacity_snapshot, external_page_id, count(*) over () as total
          from review_session
          where true ${cadence === undefined ? client`` : client`and cadence = ${cadence}`}
          order by started_at desc, id
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toReview),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async getReview(id: string): Promise<ReviewRecord | undefined> {
        const rows = await client<ReviewRow[]>`
          select id::text, cadence, started_at, completed_at, checklist, decisions,
                 capacity_snapshot, external_page_id
          from review_session where id = ${id}::uuid`;
        const row = rows[0];
        return row === undefined ? undefined : toReview(row);
      },

      async openReview(cadence: string, startedAt: Date): Promise<ReviewRecord> {
        const rows = await client<ReviewRow[]>`
          insert into review_session (cadence, started_at)
          values (${cadence}, ${stamp(startedAt)}::timestamptz)
          returning id::text, cadence, started_at, completed_at, checklist, decisions,
                    capacity_snapshot, external_page_id`;
        const row = rows[0];
        if (row === undefined) throw new Error('the review insert returned no row');
        return toReview(row);
      },

      async updateReview(id, input): Promise<ReviewRecord | undefined> {
        const rows = await client<ReviewRow[]>`
          update review_session set
            checklist = coalesce(${
              input.checklist === undefined ? null : JSON.stringify(input.checklist)
            }::jsonb, checklist),
            decisions = coalesce(${(input.decisions ?? null) as string[] | null}::text[], decisions),
            capacity_snapshot = coalesce(${
              input.capacitySnapshot === undefined ? null : JSON.stringify(input.capacitySnapshot)
            }::jsonb, capacity_snapshot),
            external_page_id = case when ${input.externalPageId === undefined}
                                then external_page_id else ${input.externalPageId ?? null} end,
            completed_at = coalesce(${stamp(input.completedAt)}::timestamptz, completed_at)
          where id = ${id}::uuid
          returning id::text, cadence, started_at, completed_at, checklist, decisions,
                    capacity_snapshot, external_page_id`;
        const row = rows[0];
        return row === undefined ? undefined : toReview(row);
      },

      async events(filter, page: PageRequest): Promise<Paged<EventRecord>> {
        const rows = await client<(EventRow & { total: string })[]>`
          select id::text, kind, entity_kind, entity_id, field, before, after, actor, occurred_at,
                 count(*) over () as total
          from event_log
          where true
            ${filter.kind === undefined ? client`` : client`and kind = ${filter.kind}`}
            ${
              filter.entityKind === undefined
                ? client``
                : client`and entity_kind = ${filter.entityKind}`
            }
            ${filter.entityId === undefined ? client`` : client`and entity_id = ${filter.entityId}`}
            ${
              filter.from === undefined
                ? client``
                : client`and occurred_at >= ${stamp(filter.from)}::timestamptz`
            }
            ${
              filter.to === undefined
                ? client``
                : client`and occurred_at <= ${stamp(filter.to)}::timestamptz`
            }
          order by occurred_at desc, id desc
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            entityKind: row.entity_kind,
            entityId: row.entity_id,
            field: row.field,
            before: json<unknown>(row.before, null),
            after: json<unknown>(row.after, null),
            actor: row.actor,
            occurredAt: required(row.occurred_at, 'event_log.occurred_at'),
          })),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async appendEvent(input: AppendEventInput): Promise<void> {
        await client`
          insert into event_log
            (kind, entity_kind, entity_id, field, before, after, actor, occurred_at)
          values (${input.kind}, ${input.entityKind}, ${input.entityId}, ${input.field ?? null},
                  ${JSON.stringify(input.before ?? null)}::jsonb,
                  ${JSON.stringify(input.after ?? null)}::jsonb,
                  ${input.actor}, ${stamp(input.occurredAt)}::timestamptz)`;
      },

      async adoption(bound, page: PageRequest): Promise<Paged<AdoptionRecord>> {
        const rows = await client<(AdoptionRow & { total: string })[]>`
          select l.prisme_id, l.external_kind, l.external_id, l.match_rule, l.confidence,
                 l.decided_by, l.decided_at,
                 (r.external_id is not null) as bound,
                 count(*) over () as total
          from entity_link l
          left join entity_external_ref r
            on r.prisme_id = l.prisme_id
           and r.kind = l.external_kind
           and r.external_id = l.external_id
          where true
            ${
              bound === undefined
                ? client``
                : bound
                  ? client`and r.external_id is not null`
                  : client`and r.external_id is null`
            }
          order by l.decided_at desc, l.prisme_id, l.external_id
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toAdoption),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async decideAdoption(input): Promise<AdoptionRecord> {
        // `decided_by` is always `human` here: a decision that arrived through
        // an authenticated request is one somebody made. The table's check —
        // "only certainty is automatic" — is what stops an automatic fuzzy
        // match from ever being applied (docs/13-migration.md §3).
        const rows = await client<AdoptionRow[]>`
          insert into entity_link
            (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
          values (${input.prismeId}, ${input.externalKind}, ${input.externalId},
                  ${input.matchRule}, ${input.confidence}, 'human',
                  ${stamp(input.decidedAt)}::timestamptz)
          on conflict (prisme_id, external_kind, external_id) do update set
            match_rule = excluded.match_rule,
            confidence = excluded.confidence,
            decided_by = excluded.decided_by,
            decided_at = excluded.decided_at
          returning prisme_id, external_kind, external_id, match_rule, confidence, decided_by,
                    decided_at, false as bound`;
        const row = rows[0];
        if (row === undefined) throw new Error('the adoption decision returned no row');
        return toAdoption(row);
      },

      async conflicts(resolution, page: PageRequest): Promise<Paged<ConflictRecord>> {
        const rows = await client<(ConflictRow & { total: string })[]>`
          select id::text, entity_id, field, prisme_value, external_value, detected_at,
                 resolution, actor, count(*) over () as total
          from sync_conflict
          where true ${resolution === undefined ? client`` : client`and resolution = ${resolution}`}
          order by detected_at desc, id desc
          limit ${page.limit} offset ${page.offset}`;
        return {
          items: rows.map(toConflict),
          total: rows[0] === undefined ? 0 : Number(rows[0].total),
        };
      },

      async resolveConflict(id: string, resolution: string): Promise<ConflictRecord | undefined> {
        const rows = await client<ConflictRow[]>`
          update sync_conflict set resolution = ${resolution}, actor = 'human'
          where id = ${id}::bigint
          returning id::text, entity_id, field, prisme_value, external_value, detected_at,
                    resolution, actor`;
        const row = rows[0];
        return row === undefined ? undefined : toConflict(row);
      },

      async syncState(): Promise<SyncStateRecord> {
        const cursor = await client<
          {
            task_tool_token: string | null;
            doc_watermark: Date | string | null;
            last_full_pass_at: Date | string | null;
            updated_at: Date | string | null;
          }[]
        >`
          select task_tool_token, doc_watermark, last_full_pass_at, updated_at
          from sync_cursor where id = 'singleton'`;

        const conflicts = await client<{ count: string }[]>`
          select count(*) as count from sync_conflict where resolution = 'unresolved'`;

        const row = cursor[0];
        return {
          hasTaskToolCursor: row?.task_tool_token != null,
          documentWatermark: instant(row?.doc_watermark),
          lastFullPassAt: instant(row?.last_full_pass_at),
          updatedAt: instant(row?.updated_at),
          unresolvedConflicts: Number(conflicts[0]?.count ?? 0),
        };
      },
    },
  };

  // --- row shapes and their mappings ---------------------------------------
  // Declared after the returned object so the reads above stay the first thing
  // in the file; function declarations hoist, and these are all plumbing.

  interface ScoreRow {
    initiative_id: string;
    method_id: string;
    method_version: number;
    score: number;
    factors: unknown;
    explain: string;
    computed_at: Date | string;
  }

  function toScore(row: ScoreRow): ScoreRecord {
    return {
      initiativeId: row.initiative_id,
      methodId: row.method_id,
      methodVersion: row.method_version,
      score: row.score,
      factors: json<Record<string, number>>(row.factors, {}),
      explain: row.explain,
      computedAt: required(row.computed_at, 'initiative_score.computed_at'),
    };
  }

  interface TaskRow {
    external_id: string;
    external_parent_id: string | null;
    is_anchor: boolean;
    completed: boolean;
    completed_at: Date | string | null;
    recorded_minutes: number | null;
    due: string | null;
    priority: string | null;
    observed_at: Date | string;
  }

  interface ObjectiveRow {
    id: string;
    title: string;
    type: 'annual' | 'monthly';
    period: string;
    area_key: string;
    status: string;
    external_page_id: string | null;
    created_at: Date | string;
  }

  function toObjective(row: ObjectiveRow): ObjectiveRecord {
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      period: row.period,
      areaKey: row.area_key,
      status: row.status,
      externalPageId: row.external_page_id,
      createdAt: required(row.created_at, 'objective.created_at'),
    };
  }

  interface KeyResultRow {
    id: string;
    objective_id: string;
    statement: string;
    target: number;
    unit: string;
    progress_self: number;
    external_anchor_id: string | null;
    served_by: string[] | null;
    measurement_count: string;
    task_total: string;
    task_done: string;
    created_at: Date | string;
  }

  function toKeyResult(row: KeyResultRow): KeyResultRecord {
    return {
      id: row.id,
      objectiveId: row.objective_id,
      statement: row.statement,
      target: row.target,
      unit: row.unit,
      progressSelf: row.progress_self,
      externalAnchorId: row.external_anchor_id,
      servedBy: row.served_by ?? [],
      measurementCount: Number(row.measurement_count),
      taskTotal: Number(row.task_total),
      taskDone: Number(row.task_done),
      createdAt: required(row.created_at, 'key_result.created_at'),
    };
  }

  interface TakeawayRow {
    id: string;
    kind: 'principle' | 'action';
    external_page_id: string;
    area_key: string | null;
    promoted_to: string | null;
    observed_at: Date | string;
  }

  function toTakeaway(row: TakeawayRow): TakeawayRecord {
    return {
      id: row.id,
      kind: row.kind,
      externalPageId: row.external_page_id,
      areaKey: row.area_key,
      promotedTo: row.promoted_to,
      observedAt: required(row.observed_at, 'takeaway.observed_at'),
    };
  }

  interface RitualRow {
    id: string;
    name: string;
    area_key: string;
    cadence: 'daily' | 'weekly' | 'monthly';
    target_adherence_pct: number;
    external_page_id: string | null;
  }

  function toRitual(row: RitualRow): RitualRecord {
    return {
      id: row.id,
      name: row.name,
      areaKey: row.area_key,
      cadence: row.cadence,
      targetAdherencePct: row.target_adherence_pct,
      externalPageId: row.external_page_id,
    };
  }

  interface ReviewRow {
    id: string;
    cadence: string;
    started_at: Date | string;
    completed_at: Date | string | null;
    checklist: unknown;
    decisions: string[];
    capacity_snapshot: unknown;
    external_page_id: string | null;
  }

  function toReview(row: ReviewRow): ReviewRecord {
    return {
      id: row.id,
      cadence: row.cadence,
      startedAt: required(row.started_at, 'review_session.started_at'),
      completedAt: instant(row.completed_at),
      checklist: json<Record<string, boolean>>(row.checklist, {}),
      decisions: row.decisions,
      capacitySnapshot: json<Record<string, number>>(row.capacity_snapshot, {}),
      externalPageId: row.external_page_id,
    };
  }

  interface EventRow {
    id: string;
    kind: string;
    entity_kind: string;
    entity_id: string;
    field: string | null;
    before: unknown;
    after: unknown;
    actor: 'human' | 'agent' | 'sync';
    occurred_at: Date | string;
  }

  interface AdoptionRow {
    prisme_id: string;
    external_kind: string;
    external_id: string;
    match_rule: string;
    confidence: string;
    decided_by: 'auto' | 'human';
    decided_at: Date | string;
    bound: boolean;
  }

  function toAdoption(row: AdoptionRow): AdoptionRecord {
    return {
      prismeId: row.prisme_id,
      externalKind: row.external_kind,
      externalId: row.external_id,
      matchRule: row.match_rule,
      confidence: row.confidence,
      decidedBy: row.decided_by,
      decidedAt: required(row.decided_at, 'entity_link.decided_at'),
      bound: row.bound,
    };
  }

  interface ConflictRow {
    id: string;
    entity_id: string;
    field: string;
    prisme_value: string | null;
    external_value: string | null;
    detected_at: Date | string;
    resolution: 'prisme_wins' | 'external_wins' | 'unresolved';
    actor: 'sync' | 'human';
  }

  function toConflict(row: ConflictRow): ConflictRecord {
    return {
      id: row.id,
      entityId: row.entity_id,
      field: row.field,
      prismeValue: row.prisme_value,
      externalValue: row.external_value,
      detectedAt: required(row.detected_at, 'sync_conflict.detected_at'),
      resolution: row.resolution,
      actor: row.actor,
    };
  }
}
