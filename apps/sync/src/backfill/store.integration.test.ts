import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';

import { createBackfillStore } from './store.js';
import type { CapacityWeek, StoredCompletion } from './types.js';

/**
 * The backfill store, against a real PostgreSQL.
 *
 * Everything asserted here is something an in-memory fake cannot get wrong.
 * `completion_history`'s primary key either makes a re-fetch idempotent or it
 * does not; `unnest` with `::timestamptz[]` either survives the driver or
 * arrives as text; `replaceCapacityWeeks` either deletes its range in the same
 * transaction as the insert or leaves half a recomputation behind; and
 * `ritual_adherence`'s CHECK either refuses an over-completion or silently
 * stores a 114% week. W04, W05 and W14 each found bugs this way that no type
 * checker could see.
 *
 * The connection comes from `test-support/database.ts`, which builds it
 * through `createDatabase` — the same constructor `main.ts` uses — so a
 * serializer difference between this suite and production is a failing test
 * rather than a production surprise.
 *
 * Skips loudly without a database, and throws in CI — a suite that skips itself
 * is a suite that has stopped running while still reporting green.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

/** Every table, children first — never `cascade`. The same list as the adoption suite, plus 0006's. */
const TABLES = [
  'confirmation_token',
  // W15's two (migration 0007). `creation_intent` references itself and
  // `capture` references both `area` and `initiative`, so both come first.
  'creation_intent',
  'capture',
  'capacity_week',
  'completion_history',
  'backfill_cursor',
  'adoption_candidate',
  'adoption_ignore',
  'api_token',
  'sync_conflict',
  'last_applied',
  'entity_link',
  'entity_external_ref',
  'event_log',
  'review_session',
  'ritual_adherence',
  'ritual',
  'takeaway',
  'key_result_measurement',
  'key_result_served_by',
  'key_result',
  'objective',
  'task_mirror',
  'initiative_score',
  'initiative_dependency',
  'initiative',
  'project',
  'area_mapping',
  'area_weight',
  'area',
  'sync_cursor',
] as const;

const AT = (iso: string): Date => new Date(iso);

function completion(overrides: Partial<StoredCompletion> = {}): StoredCompletion {
  return {
    externalTaskId: 't-1',
    completedAt: AT('2026-09-08T09:00:00Z'),
    externalProjectId: 'p-home',
    ...overrides,
  };
}

function week(overrides: Partial<CapacityWeek> = {}): CapacityWeek {
  return {
    weekStart: '2026-09-07',
    areaKey: 'home',
    completions: 2,
    minutes: 50,
    minutesBySource: { recorded: 30, declared: 0, default: 20 },
    ...overrides,
  };
}

describeOrSkip('the backfill store against PostgreSQL', () => {
  let database: SyncTestDatabase;
  let client: postgres.Sql;

  beforeAll(async () => {
    database = await openTestDatabase();
    client = database.client;
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate(TABLES);
    await client`
      insert into area (key, name, kind) values
        ('home', 'Home', 'area'),
        ('noise', 'Noise', 'signals')`;
    await client`
      insert into area_mapping (area_key, external_project_id, external_section_id) values
        ('home', 'p-home', null),
        ('noise', 'p-home', 's-noise')`;
  });

  const store = () => createBackfillStore(client);

  describe('the cursor', () => {
    it('is absent before anything has ever run', async () => {
      expect(await store().loadCursor()).toBeUndefined();
    });

    it('round-trips as instants, not as strings', async () => {
      await store().recordSlice([], {
        coveredFrom: AT('2024-01-01T00:00:00Z'),
        coveredThrough: AT('2026-09-20T00:00:00Z'),
      });

      const cursor = await store().loadCursor();
      expect(cursor?.coveredFrom).toBeInstanceOf(Date);
      expect(cursor?.coveredFrom.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(cursor?.coveredThrough.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    });

    /**
     * The claim only ever widens. A later slice must not pull the start of
     * coverage forwards, and an out-of-order write must not pull the end back:
     * either would let a run resume past a window nothing read.
     */
    it('widens rather than replaces', async () => {
      await store().recordSlice([], {
        coveredFrom: AT('2025-01-01T00:00:00Z'),
        coveredThrough: AT('2026-01-01T00:00:00Z'),
      });
      await store().recordSlice([], {
        coveredFrom: AT('2026-06-01T00:00:00Z'),
        coveredThrough: AT('2026-09-01T00:00:00Z'),
      });

      const cursor = await store().loadCursor();
      expect(cursor?.coveredFrom.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(cursor?.coveredThrough.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    it('stays a single row however many slices land', async () => {
      for (let index = 0; index < 5; index += 1) {
        await store().recordSlice([], {
          coveredFrom: AT('2026-01-01T00:00:00Z'),
          coveredThrough: AT(`2026-0${String(index + 2)}-01T00:00:00Z`),
        });
      }

      const rows = await client<{ count: string }[]>`select count(*) from backfill_cursor`;
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('recording completions', () => {
    it('stores a window and reads it back with its location and duration intact', async () => {
      await store().recordSlice(
        [
          completion({ recordedMinutes: 45, durationScale: 'minute' }),
          completion({
            externalTaskId: 't-2',
            externalSectionId: 's-noise',
            durationScale: 'day',
          }),
        ],
        { coveredFrom: AT('2026-09-01T00:00:00Z'), coveredThrough: AT('2026-09-30T00:00:00Z') },
      );

      const stored = await store().loadCompletions(
        AT('2026-09-01T00:00:00Z'),
        AT('2026-09-30T00:00:00Z'),
      );

      expect(stored).toHaveLength(2);
      expect(stored[0]?.completedAt).toBeInstanceOf(Date);
      expect(stored[0]).toMatchObject({
        externalTaskId: 't-1',
        externalProjectId: 'p-home',
        recordedMinutes: 45,
        durationScale: 'minute',
      });
      expect(stored[1]).toMatchObject({ externalSectionId: 's-noise', durationScale: 'day' });
      expect(stored[1]?.recordedMinutes).toBeUndefined();
    });

    /**
     * **The double-count test, at the level where it is actually guaranteed.**
     * The pure pass cannot double-count because the table's primary key is the
     * identity of a completion — so this asserts the key, not the caller.
     */
    it('cannot store the same completion twice', async () => {
      const covers = {
        coveredFrom: AT('2026-09-01T00:00:00Z'),
        coveredThrough: AT('2026-09-30T00:00:00Z'),
      };
      await store().recordSlice(
        [completion({ recordedMinutes: 45, durationScale: 'minute' })],
        covers,
      );
      await store().recordSlice(
        [completion({ recordedMinutes: 45, durationScale: 'minute' })],
        covers,
      );

      const rows = await client<{ count: string }[]>`select count(*) from completion_history`;
      expect(rows[0]?.count).toBe('1');
    });

    it('lets a re-fetch correct what the tool said, rather than adding a row', async () => {
      const covers = {
        coveredFrom: AT('2026-09-01T00:00:00Z'),
        coveredThrough: AT('2026-09-30T00:00:00Z'),
      };
      await store().recordSlice([completion()], covers);
      await store().recordSlice(
        [completion({ recordedMinutes: 90, durationScale: 'minute' })],
        covers,
      );

      const stored = await store().loadCompletions(
        AT('2026-09-01T00:00:00Z'),
        AT('2026-09-30T00:00:00Z'),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.recordedMinutes).toBe(90);
    });

    /**
     * The same recurring task completes many times. If the key were the task,
     * a year of a daily habit would collapse to one row — and the adherence
     * series would be a flat line at one.
     */
    it('keeps every completion of one recurring task', async () => {
      await store().recordSlice(
        [
          completion({ completedAt: AT('2026-09-08T09:00:00Z') }),
          completion({ completedAt: AT('2026-09-09T09:00:00Z') }),
          completion({ completedAt: AT('2026-09-10T09:00:00Z') }),
        ],
        { coveredFrom: AT('2026-09-01T00:00:00Z'), coveredThrough: AT('2026-09-30T00:00:00Z') },
      );

      const stored = await store().loadCompletions(
        AT('2026-09-01T00:00:00Z'),
        AT('2026-09-30T00:00:00Z'),
      );
      expect(stored).toHaveLength(3);
    });

    it('reads a half-open range, so two adjacent windows never return the same row', async () => {
      await store().recordSlice(
        [
          completion({ completedAt: AT('2026-09-07T00:00:00Z') }),
          completion({ externalTaskId: 't-2', completedAt: AT('2026-09-14T00:00:00Z') }),
        ],
        { coveredFrom: AT('2026-09-01T00:00:00Z'), coveredThrough: AT('2026-09-30T00:00:00Z') },
      );

      const first = await store().loadCompletions(
        AT('2026-09-07T00:00:00Z'),
        AT('2026-09-14T00:00:00Z'),
      );
      const second = await store().loadCompletions(
        AT('2026-09-14T00:00:00Z'),
        AT('2026-09-21T00:00:00Z'),
      );

      expect(first.map((row) => row.externalTaskId)).toEqual(['t-1']);
      expect(second.map((row) => row.externalTaskId)).toEqual(['t-2']);
    });
  });

  describe('the area map', () => {
    it('reads mappings and kinds, with a section keyed apart from its project', async () => {
      const map = await store().loadAreaMap();

      expect(map.areaByLocation.get('p-home/')).toBe('home');
      expect(map.areaByLocation.get('p-home/s-noise')).toBe('noise');
      expect(map.kindByArea.get('home')).toBe('area');
      expect(map.kindByArea.get('noise')).toBe('signals');
    });
  });

  describe('rituals', () => {
    async function insertRitual(name: string, cadence: string): Promise<string> {
      const rows = await client<{ id: string }[]>`
        insert into ritual (name, area_key, cadence, target_adherence_pct, external_page_id)
        values (${name}, 'home', ${cadence}, 80, 'page-1')
        returning id::text as id`;
      return rows[0]?.id as string;
    }

    it('returns a ritual with the task bound to it', async () => {
      const id = await insertRitual('Invented habit', 'weekly');
      await client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${id}, 'ritual', 'task', 't-ritual')`;

      const rituals = await store().loadRituals();
      expect(rituals).toHaveLength(1);
      expect(rituals[0]).toMatchObject({
        id,
        cadence: 'weekly',
        externalTaskId: 't-ritual',
        externalPageId: 'page-1',
      });
    });

    /** A left join: a habit prisme cannot measure is still a habit it must report. */
    it('returns a ritual with no binding rather than dropping it', async () => {
      await insertRitual('Unbound habit', 'daily');

      const rituals = await store().loadRituals();
      expect(rituals).toHaveLength(1);
      expect(rituals[0]?.externalTaskId).toBeUndefined();
    });

    it('does not mistake a page binding for a task binding', async () => {
      const id = await insertRitual('Invented habit', 'monthly');
      await client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${id}, 'ritual', 'page', 'page-1')`;

      const rituals = await store().loadRituals();
      expect(rituals[0]?.externalTaskId).toBeUndefined();
    });
  });

  describe('materialised weeks', () => {
    it('writes rows whose minutes are their sources, which the table checks', async () => {
      await store().replaceCapacityWeeks([week()], '2026-08-31', '2026-10-05');

      const rows = await client<
        { week_start: string; minutes: number; minutes_default: number }[]
      >`select to_char(week_start, 'YYYY-MM-DD') as week_start, minutes, minutes_default
        from capacity_week`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ week_start: '2026-09-07', minutes: 50, minutes_default: 20 });
    });

    it('refuses a row whose minutes do not add up', async () => {
      await expect(
        client`
          insert into capacity_week
            (week_start, area_key, completions, minutes, minutes_recorded, minutes_declared, minutes_default)
          values ('2026-09-07'::date, 'home', 1, 99, 1, 1, 1)`,
      ).rejects.toThrow(/minutes_are_the_sum_of_their_sources/);
    });

    /**
     * Level-triggered. A week whose only completion was deleted in the task
     * tool must lose its row; an upsert would leave it there forever, and the
     * chart would keep showing work that no longer exists.
     */
    it('replaces the range wholesale, dropping a week that no longer has rows', async () => {
      await store().replaceCapacityWeeks(
        [
          week(),
          week({
            weekStart: '2026-09-14',
            minutes: 10,
            minutesBySource: { recorded: 10, declared: 0, default: 0 },
          }),
        ],
        '2026-08-31',
        '2026-10-05',
      );
      await store().replaceCapacityWeeks([week()], '2026-08-31', '2026-10-05');

      const rows = await client<{ week_start: string }[]>`
        select to_char(week_start, 'YYYY-MM-DD') as week_start from capacity_week order by week_start`;
      expect(rows.map((row) => row.week_start)).toEqual(['2026-09-07']);
    });

    it('leaves weeks outside the replaced range alone', async () => {
      await store().replaceCapacityWeeks(
        [week({ weekStart: '2026-08-24' })],
        '2026-08-24',
        '2026-08-31',
      );
      await store().replaceCapacityWeeks([week()], '2026-08-31', '2026-10-05');

      const rows = await client<{ week_start: string }[]>`
        select to_char(week_start, 'YYYY-MM-DD') as week_start from capacity_week order by week_start`;
      expect(rows.map((row) => row.week_start)).toEqual(['2026-08-24', '2026-09-07']);
    });

    /**
     * The defect a real second run found: `weeklyCapacity` buckets by Monday,
     * so a covered range starting on a Sunday produces a row for the Monday
     * before it. When the bounds were the covered *instants*, that row was
     * outside the delete and inside the insert, and the second run collided
     * here. Both bounds now come from `startOfWeek`.
     */
    it('deletes the week a mid-week range begins in, so a re-run does not collide', async () => {
      await store().replaceCapacityWeeks(
        [week({ weekStart: '2026-08-31' })],
        '2026-08-31',
        '2026-10-05',
      );

      await expect(
        store().replaceCapacityWeeks(
          [week({ weekStart: '2026-08-31' })],
          '2026-08-31',
          '2026-10-05',
        ),
      ).resolves.toBeUndefined();

      const rows = await client<{ count: string }[]>`select count(*) from capacity_week`;
      expect(rows[0]?.count).toBe('1');
    });

    it('refuses a week for an area that does not exist', async () => {
      await expect(
        store().replaceCapacityWeeks(
          [week({ areaKey: 'nonexistent' })],
          '2026-08-31',
          '2026-10-05',
        ),
      ).rejects.toThrow(/area_key/);
    });
  });

  describe('adherence', () => {
    async function ritualId(): Promise<string> {
      const rows = await client<{ id: string }[]>`
        insert into ritual (name, area_key, cadence, target_adherence_pct)
        values ('Invented habit', 'home', 'daily', 80)
        returning id::text as id`;
      return rows[0]?.id as string;
    }

    it('writes a series and rewrites it in place on a second run', async () => {
      const id = await ritualId();

      await store().recordAdherence([
        { ritualId: id, periodStart: '2026-09-07', opportunities: 7, completions: 3, excess: 0 },
      ]);
      await store().recordAdherence([
        { ritualId: id, periodStart: '2026-09-07', opportunities: 7, completions: 5, excess: 0 },
      ]);

      const rows = await client<{ completions: number }[]>`
        select completions from ritual_adherence`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.completions).toBe(5);
    });

    /**
     * The clamp is the pure code's job, and this is the proof it has to do it:
     * the table refuses an unclamped row outright rather than storing a 114%
     * week.
     */
    it('is refused by the database if the clamp were ever removed', async () => {
      const id = await ritualId();

      await expect(
        store().recordAdherence([
          { ritualId: id, periodStart: '2026-09-07', opportunities: 1, completions: 3, excess: 0 },
        ]),
      ).rejects.toThrow(/adherence_cannot_exceed_opportunity/);
    });
  });
});
