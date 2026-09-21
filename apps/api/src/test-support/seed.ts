import { readFileSync } from 'node:fs';
import type postgres from 'postgres';

/**
 * The synthetic dataset, loaded into a real database.
 *
 * **`fixtures/` is the only data allowed here** (CLAUDE.md, rule 1). Not "the
 * preferred data" — the only data. The riskiest moment in this whole repository
 * is an agent debugging against a live instance and pasting a real title into a
 * test, and this file exists so that reaching for one is never convenient.
 *
 * Fixture ids are readable (`init-004`, `health`) and the database wants uuids,
 * so ids are **derived deterministically** from the fixture id rather than
 * generated. A test can therefore name an initiative by the id it reads in
 * `fixtures/initiatives.json` — and two runs produce the same uuids, which is
 * what makes a failure reproducible.
 */

interface AreaFixture {
  key: string;
  name: string;
  kind: 'area' | 'run' | 'signals';
  runBudgetHoursPerWeek?: number;
}

interface WeightFixture {
  areaKey: string;
  year: number;
  weightPct: number;
}

interface InitiativeFixture {
  id: string;
  title: string;
  areaKey: string;
  status: string;
  value: number;
  timeCriticality: number;
  risk: number;
  size: number;
  deadline: string | null;
  dependsOn: string[];
  origin: 'created_in_prisme' | 'adopted';
  doneAt?: string;
  droppedReason?: string;
}

interface MeasurementFixture {
  at: string;
  value: number;
  note?: string;
}

interface KeyResultFixture {
  id: string;
  statement: string;
  target: number;
  unit: string;
  progressSelf: number;
  servedBy: string[];
  measurements?: MeasurementFixture[];
}

interface ObjectiveFixture {
  id: string;
  title: string;
  type: 'annual' | 'monthly';
  period: string;
  areaKey: string;
  status: string;
  keyResults: KeyResultFixture[];
}

interface TaskMirrorFixture {
  externalId: string;
  initiativeId: string;
  areaKey: string;
  isAnchor?: boolean;
  completed?: boolean;
  completedAt?: string | null;
  recordedMinutes?: number | null;
}

/**
 * A fixture id as a uuid, by construction rather than by lookup.
 *
 * Version 4 in shape, deterministic in fact — which is the point: a random uuid
 * would make a failing assertion impossible to quote, and a lookup table would
 * be one more thing to keep in step with the fixtures.
 */
export function fixtureId(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const digits = hash.toString(16).padStart(8, '0');
  const tail = key
    .split('')
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(12, '0')
    .slice(0, 12);
  return `${digits}-0000-4000-8000-${tail}`;
}

function readFixture<T>(name: string): T {
  const path = new URL(`../../../../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export interface SeedResult {
  readonly areaKeys: readonly string[];
  readonly initiativeIds: ReadonlyMap<string, string>;
  readonly objectiveIds: ReadonlyMap<string, string>;
  readonly keyResultIds: ReadonlyMap<string, string>;
}

export async function seedFixtures(client: postgres.Sql): Promise<SeedResult> {
  const areas = readFixture<{ areas: AreaFixture[]; areaWeights: WeightFixture[] }>('areas.json');
  const initiatives = readFixture<{ initiatives: InitiativeFixture[] }>('initiatives.json');
  const objectives = readFixture<{ objectives: ObjectiveFixture[] }>('objectives.json');
  const mirror = readFixture<{ tasks: TaskMirrorFixture[] }>('task-mirror.json');

  const ids = new Map<string, string>();
  for (const initiative of initiatives.initiatives)
    ids.set(initiative.id, fixtureId(initiative.id));

  const objectiveIds = new Map<string, string>();
  const keyResultIds = new Map<string, string>();
  for (const objective of objectives.objectives) {
    objectiveIds.set(objective.id, fixtureId(objective.id));
    for (const keyResult of objective.keyResults)
      keyResultIds.set(keyResult.id, fixtureId(keyResult.id));
  }

  await client.begin(async (tx) => {
    for (const area of areas.areas) {
      await tx`
        insert into area (key, name, kind, active, run_budget_hours_per_week)
        values (${area.key}, ${area.name}, ${area.kind}, true,
                ${area.runBudgetHoursPerWeek ?? null})`;
    }

    for (const weight of areas.areaWeights) {
      await tx`
        insert into area_weight (area_key, year, weight_pct)
        values (${weight.areaKey}, ${weight.year}, ${weight.weightPct})`;
    }

    // Two passes: every initiative exists before any dependency references one,
    // and the acyclicity trigger walks only edges that are already there.
    for (const initiative of initiatives.initiatives) {
      await tx`
        insert into initiative
          (id, title, area_key, status, value, time_criticality, risk, size, deadline,
           origin, done_at, dropped_reason)
        values (${ids.get(initiative.id) as string}::uuid, ${initiative.title},
                ${initiative.areaKey}, ${initiative.status}, ${initiative.value},
                ${initiative.timeCriticality}, ${initiative.risk}, ${initiative.size},
                ${initiative.deadline}::date, ${initiative.origin},
                ${initiative.doneAt ?? null}::date, ${initiative.droppedReason ?? null})`;
    }

    for (const initiative of initiatives.initiatives) {
      for (const dependency of initiative.dependsOn) {
        await tx`
          insert into initiative_dependency (initiative_id, depends_on_id)
          values (${ids.get(initiative.id) as string}::uuid, ${ids.get(dependency) as string}::uuid)`;
      }
    }

    /*
     * The task mirror, under the initiatives the key results are served by.
     *
     * `progressComputed` (ADR-0013) is counted from these rows and from nothing
     * else — `task_total` and `task_done` are subqueries against `task_mirror`,
     * joined through `key_result_served_by` on the anchor. Until this fixture
     * existed, `fixtures/` carried no mirror at all, so **every key result from
     * a plain seed reported a computed progress of null** and the
     * self-versus-computed divergence the model exists to surface could only be
     * exercised by hand-seeding rows in a test (W11's finding).
     *
     * The anchor rows are inserted too, deliberately: the counting rule
     * excludes `is_anchor`, and a fixture that omitted them would never
     * exercise that exclusion.
     *
     * **This widens what every suite sees**, which is the cost of the fixture
     * and not a side effect of it: `task_mirror` also feeds the four-week
     * capacity window and the initiative detail's task list. The alternative —
     * a mirror a test could opt into — would leave the divergence unreachable
     * from a plain seed, which is the whole finding.
     */
    for (const task of mirror.tasks) {
      const initiativeId = ids.get(task.initiativeId);
      // A fixture that names an initiative which does not exist is a broken
      // fixture, not a row to skip quietly — the same rule as `servedBy`.
      if (initiativeId === undefined) {
        throw new Error(
          `fixtures/task-mirror.json: ${task.externalId} hangs off ${task.initiativeId}, which is not in initiatives.json`,
        );
      }
      await tx`
        insert into task_mirror
          (external_id, anchor_for, area_key, is_anchor, completed, completed_at, recorded_minutes)
        values (${task.externalId}, ${initiativeId}::uuid, ${task.areaKey},
                ${task.isAnchor ?? false}, ${task.completed ?? false},
                ${task.completedAt ?? null}::timestamptz, ${task.recordedMinutes ?? null})`;
    }

    // Objectives last: a key result's `servedBy` references an initiative, so
    // every initiative has to exist first.
    //
    // Until W11 nothing loaded `fixtures/objectives.json` at all, and the three
    // statuses it carried — `in_progress`, `at_risk`, `not_started` — were none
    // of the five the schema's CHECK constraint allows. A fixture no code path
    // reads is a fixture that drifts from the model silently, which is what had
    // happened.
    for (const objective of objectives.objectives) {
      await tx`
        insert into objective (id, title, type, period, area_key, status)
        values (${objectiveIds.get(objective.id) as string}::uuid, ${objective.title},
                ${objective.type}, ${objective.period}, ${objective.areaKey},
                ${objective.status})`;

      for (const keyResult of objective.keyResults) {
        await tx`
          insert into key_result (id, objective_id, statement, target, unit, progress_self)
          values (${keyResultIds.get(keyResult.id) as string}::uuid,
                  ${objectiveIds.get(objective.id) as string}::uuid,
                  ${keyResult.statement}, ${keyResult.target}, ${keyResult.unit},
                  ${keyResult.progressSelf})`;

        for (const initiativeKey of keyResult.servedBy) {
          const initiativeId = ids.get(initiativeKey);
          // A fixture that names an initiative which does not exist is a
          // broken fixture, not a link to skip quietly.
          if (initiativeId === undefined) {
            throw new Error(
              `fixtures/objectives.json: ${keyResult.id} is served by ${initiativeKey}, which is not in initiatives.json`,
            );
          }
          await tx`
            insert into key_result_served_by (key_result_id, initiative_id)
            values (${keyResultIds.get(keyResult.id) as string}::uuid, ${initiativeId}::uuid)`;
        }

        for (const measurement of keyResult.measurements ?? []) {
          await tx`
            insert into key_result_measurement (key_result_id, observed_at, value, note)
            values (${keyResultIds.get(keyResult.id) as string}::uuid,
                    ${measurement.at}::timestamptz, ${measurement.value},
                    ${measurement.note ?? null})`;
        }
      }
    }
  });

  return {
    areaKeys: areas.areas.map((area) => area.key),
    initiativeIds: ids,
    objectiveIds,
    keyResultIds,
  };
}

/**
 * Completed tasks beneath an initiative's anchor, so capacity has something to
 * measure.
 *
 * `fixtures/` carries no task mirror — the task tool's side is recorded as
 * connector responses, not as prisme rows — so the shape is built here from
 * fixture initiatives. Nothing about it is real, and nothing about it is meant
 * to resemble a real workspace.
 */
export async function seedCompletions(
  client: postgres.Sql,
  entries: readonly {
    initiativeId: string;
    areaKey: string;
    completedAt: Date;
    minutes?: number;
    completed?: boolean;
  }[],
): Promise<void> {
  let sequence = 0;
  for (const entry of entries) {
    sequence += 1;
    const completed = entry.completed ?? true;
    await client`
      insert into task_mirror
        (external_id, external_parent_id, anchor_for, area_key, is_anchor, completed,
         completed_at, recorded_minutes)
      values (${`fixture-task-${String(sequence)}`}, null, ${entry.initiativeId}::uuid,
              ${entry.areaKey}, false, ${completed},
              ${completed ? entry.completedAt.toISOString() : null}::timestamptz,
              ${entry.minutes ?? null})`;
  }
}
