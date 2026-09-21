import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { createAdoptionStore } from './store.js';
import type { Candidate } from './types.js';

/**
 * The adoption store, against a real PostgreSQL.
 *
 * Every assertion here is about something a fake store cannot get wrong. The
 * union in `loadTargets` either produces four kinds or it does not; `numeric`
 * either survives the round trip or arrives as a string; `replaceCandidates`
 * either commits as one statement or leaves half a scan behind. W04 and W05
 * each found two bugs this way that nothing in a type checker could see, and
 * this file exists because the SQL below decides what a real backlog *is*.
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

/**
 * Every table, children first — never `cascade`.
 *
 * The same list as `apps/api/src/test-support/database.ts`, and duplicated
 * rather than shared because the two applications have no test package between
 * them. It is the whole list rather than only the tables this suite writes:
 * `area` is referenced by a dozen others, so a partial `truncate` is refused
 * outright — which is the foreign keys working, and the first thing this suite
 * found.
 */
const TABLES = [
  'confirmation_token',
  // W15's two (migration 0007). `creation_intent` references itself and
  // `capture` references both `area` and `initiative`, so both come first.
  'creation_intent',
  'capture',
  // W13's three (migration 0006). `capacity_week` references `area`, so leaving
  // it out makes this `truncate` refuse the whole statement rather than merely
  // leaving rows behind.
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

function candidateOf(
  overrides: Partial<Candidate['object']> = {},
  proposal?: Candidate['proposal'],
) {
  return {
    object: {
      kind: 'task' as const,
      externalId: 'ext-1',
      title: 'Rebuild the garden shed',
      areaKey: 'home',
      closed: false,
      ...overrides,
    },
    classification: { kind: 'initiative' as const, reason: 'a parent task with subtasks' },
    ...(proposal === undefined ? {} : { proposal }),
  } satisfies Candidate;
}

describeOrSkip('the adoption store against PostgreSQL', () => {
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
    // `truncate` as the schema owner: `adoption_ignore` refuses a DELETE, and
    // so do the append-only tables. A reset needs a privilege the application
    // role does not have, which is the guard working.
    await database.truncate(TABLES);
    await seed();
  });

  async function seed(): Promise<void> {
    await client`
      insert into area (key, name, kind) values
        ('home', 'Home', 'area'),
        ('signals', 'Signals', 'signals')`;
    await client`
      insert into area_mapping (area_key, external_project_id, external_section_id) values
        ('home', 'p-home', null),
        ('signals', 'p-home', 's-noise')`;
  }

  const store = () => createAdoptionStore(client);

  describe('loadTargets', () => {
    it('returns an unbound entity of every matchable kind', async () => {
      const [initiative] = await client<{ id: string }[]>`
        insert into initiative (title, area_key, status, value, time_criticality, risk, size, origin)
        values ('Rebuild the garden shed', 'home', 'next', 3, 3, 3, 3, 'created_in_prisme')
        returning id::text`;
      await client`
        insert into project (name, area_key, status, origin)
        values ('House renovation', 'home', 'active', 'adopted')`;
      const [objective] = await client<{ id: string }[]>`
        insert into objective (title, type, period, area_key, status)
        values ('Be fitter', 'annual', '2026', 'home', 'active')
        returning id::text`;
      await client`
        insert into key_result (objective_id, statement, target, unit)
        values (${(objective as { id: string }).id}::uuid, 'Run 1000km', 1000, 'km')`;
      await client`
        insert into ritual (name, area_key, cadence, target_adherence_pct)
        values ('Weekly review', 'home', 'weekly', 80)`;

      const targets = await store().loadTargets();
      expect([...targets].map((target) => target.kind).sort()).toEqual([
        'initiative',
        'key_result',
        'project',
        'ritual',
      ]);
      expect(targets.find((target) => target.kind === 'initiative')).toMatchObject({
        prismeId: (initiative as { id: string }).id,
        title: 'Rebuild the garden shed',
        areaKey: 'home',
        closed: false,
      });
    });

    it('excludes an entity that is already bound — guard 1 would refuse a second binding', async () => {
      const [row] = await client<{ id: string }[]>`
        insert into initiative (title, area_key, status, value, time_criticality, risk, size, origin)
        values ('Already bound', 'home', 'next', 3, 3, 3, 3, 'adopted')
        returning id::text`;
      const id = (row as { id: string }).id;
      await client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${id}, 'initiative', 'task', 'ext-bound')`;

      expect(await store().loadTargets()).toEqual([]);
    });

    it('keeps a finished entity as a target — closed matches closed', async () => {
      // Dropping them would leave every finished piece of work looking like a
      // new candidate, forever.
      await client`
        insert into initiative
          (title, area_key, status, value, time_criticality, risk, size, origin, done_at)
        values ('Finished last year', 'home', 'done', 3, 3, 3, 3, 'adopted', '2026-01-04')`;

      const targets = await store().loadTargets();
      expect(targets).toHaveLength(1);
      expect(targets[0]?.closed).toBe(true);
    });
  });

  describe('loadAuditable', () => {
    it('reports provenance and boundness for the entities that carry an origin', async () => {
      const [row] = await client<{ id: string }[]>`
        insert into initiative (title, area_key, status, value, time_criticality, risk, size, origin)
        values ('Created here', 'home', 'next', 3, 3, 3, 3, 'created_in_prisme')
        returning id::text`;
      await client`
        insert into project (name, area_key, status, origin)
        values ('Adopted project', 'home', 'active', 'adopted')`;

      const entities = await store().loadAuditable();
      expect(entities).toHaveLength(2);
      expect(entities.find((entity) => entity.prismeId === (row as { id: string }).id)).toEqual({
        prismeId: (row as { id: string }).id,
        kind: 'initiative',
        origin: 'created_in_prisme',
        bound: false,
      });
    });
  });

  describe('loadDecided', () => {
    it('reads both halves of what a human has settled', async () => {
      await client`
        insert into entity_link
          (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
        values ('i-1', 'task', 'ext-linked', 'manual', 'manual', 'human', now())`;
      await client`
        insert into adoption_ignore (external_kind, external_id, decided_at)
        values ('task', 'ext-ignored', now())`;

      const decided = await store().loadDecided();
      expect([...decided.linked]).toEqual(['task:ext-linked']);
      expect([...decided.ignored]).toEqual(['task:ext-ignored']);
    });
  });

  describe('loadAreaMap', () => {
    it('keys locations the same way the planner does, and carries each lane', async () => {
      const map = await store().loadAreaMap();
      expect(map.areaByLocation.get('p-home/')).toBe('home');
      expect(map.areaByLocation.get('p-home/s-noise')).toBe('signals');
      expect(map.laneByArea.get('signals')).toBe('signals');
      expect(map.laneByArea.get('home')).toBe('area');
    });
  });

  describe('replaceCandidates', () => {
    const at = new Date('2026-09-19T09:00:00Z');

    it('writes a whole candidate, proposal and all', async () => {
      await store().replaceCandidates(
        [
          candidateOf(
            { externalId: 'ext-fuzzy' },
            {
              rule: 'fuzzy_title',
              confidence: 'low',
              prismeId: 'i-9',
              similarity: 0.871,
            },
          ),
        ],
        at,
      );

      const rows = await client<
        { external_id: string; similarity: string | null; match_rule: string; scanned_at: Date }[]
      >`select external_id, similarity, match_rule, scanned_at from adoption_candidate`;
      expect(rows).toHaveLength(1);
      // `numeric` round-trips as text; the value has to survive it exactly.
      expect(Number(rows[0]?.similarity)).toBe(0.871);
      expect(rows[0]?.match_rule).toBe('fuzzy_title');
    });

    it('replaces wholesale, so a candidate for a vanished object does not survive', async () => {
      await store().replaceCandidates([candidateOf({ externalId: 'ext-gone' })], at);
      await store().replaceCandidates([candidateOf({ externalId: 'ext-still-here' })], at);

      const rows = await client<{ external_id: string }[]>`
        select external_id from adoption_candidate`;
      expect(rows.map((row) => row.external_id)).toEqual(['ext-still-here']);
    });

    it('empties the mirror when a scan finds nothing', async () => {
      await store().replaceCandidates([candidateOf()], at);
      await store().replaceCandidates([], at);
      expect(await client`select 1 from adoption_candidate`).toHaveLength(0);
    });

    it('leaves the previous answer intact when a scan fails half way', async () => {
      // One transaction: a failed write must not leave half a new mirror. The
      // second call violates the area foreign key, so it rolls back.
      await store().replaceCandidates([candidateOf({ externalId: 'ext-first' })], at);

      await expect(
        store().replaceCandidates(
          [
            candidateOf({ externalId: 'ext-ok' }),
            candidateOf({ externalId: 'ext-bad', areaKey: 'no-such-area' }),
          ],
          at,
        ),
      ).rejects.toThrow();

      const rows = await client<{ external_id: string }[]>`
        select external_id from adoption_candidate`;
      expect(rows.map((row) => row.external_id)).toEqual(['ext-first']);
    });

    it('accepts a candidate outside every mapped area', async () => {
      // Not an error: an object no area covers is a finding the report shows,
      // and a scan that refused to record it would hide the finding.
      await store().replaceCandidates([candidateOf({ areaKey: undefined })], at);
      const rows = await client<{ area_key: string | null }[]>`
        select area_key from adoption_candidate`;
      expect(rows[0]?.area_key).toBeNull();
    });

    it('refuses half a proposal, at the database', async () => {
      await expect(
        client`
          insert into adoption_candidate
            (external_kind, external_id, title, proposed_kind, reason, match_rule, scanned_at)
          values ('task', 'ext-half', 'Half a proposal', 'initiative', 'test', 'exact_title', now())`,
      ).rejects.toThrow(/proposal_is_whole_or_absent/);
    });

    it('refuses a similarity on a rule that is not fuzzy', async () => {
      await expect(
        client`
          insert into adoption_candidate
            (external_kind, external_id, title, proposed_kind, reason,
             match_rule, confidence, proposed_id, similarity, scanned_at)
          values ('task', 'ext-odd', 'Exact with a score', 'initiative', 'test',
                  'exact_title', 'high', 'i-1', 0.9, now())`,
      ).rejects.toThrow(/similarity_belongs_to_a_fuzzy_proposal/);
    });
  });
});
