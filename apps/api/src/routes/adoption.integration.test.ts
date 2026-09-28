import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { endedDigest } from '../services/adoption-queue.js';
import { createPostgresStore } from '../store/postgres.js';
import { createTestApp, identityWith, stubRunner } from '../test-support/app.js';
import { seedFixtures } from '../test-support/seed.js';
import { API_BASE_PATH } from './index.js';

/**
 * The adoption queue against a real PostgreSQL.
 *
 * Everything here is synthetic — invented titles, invented external ids, and a
 * fixture area list that resembles no real instance (CLAUDE.md, rule 1).
 *
 * These tests exist for the properties a fake store cannot have, and they are
 * the ones this workstream is about:
 *
 *   - **Adopting never creates outward**, and the entity it does create carries
 *     `origin = 'adopted'` — which the database then refuses to let change.
 *   - **Ignore is permanent**, enforced by a trigger rather than by a promise.
 *   - **The queue converges**: every decision removes a row, and a re-read never
 *     brings it back.
 *   - `numeric` similarity arriving as a string, which is the shape of bug W05
 *     found twice.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

describeOrSkip('the adoption queue against PostgreSQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate();
    await seedFixtures(database.client);
    await seedCandidates();
  });

  /**
   * Four candidates: one of each adoptable kind that can be created, one that
   * cannot, and one the classifier left in place.
   */
  async function seedCandidates(): Promise<void> {
    const area = (
      await database.client<{ key: string }[]>`
      select key from area where kind = 'area' order by key limit 1`
    )[0];
    const areaKey = area?.key;
    const at = new Date('2026-09-19T09:00:00Z').toISOString();

    await database.client`
      insert into adoption_candidate
        (external_kind, external_id, title, area_key, proposed_kind, reason,
         match_rule, confidence, proposed_id, similarity, scanned_at)
      values
        ('task', 'ext-initiative', 'Rebuild the garden shed', ${areaKey ?? null}, 'initiative',
         'a parent task with subtasks, in a mapped area', 'exact_title', 'high', 'i-guess', null,
         ${at}::timestamptz),
        ('project', 'ext-project', 'House renovation', ${areaKey ?? null}, 'project',
         'a dedicated project with sections', null, null, null, null, ${at}::timestamptz),
        ('page', 'ext-kr', 'Run 1000km', ${areaKey ?? null}, 'key_result',
         'held in the objectives store', 'fuzzy_title', 'low', 'k-guess', 0.871,
         ${at}::timestamptz),
        ('task', 'ext-unmapped', 'Somewhere else entirely', null, 'initiative',
         'a parent task with subtasks, in a mapped area', null, null, null, null,
         ${at}::timestamptz)`;
  }

  function api(identity?: ReturnType<typeof identityWith>) {
    return createTestApp({
      client: database.client,
      ...(identity === undefined ? {} : { identity }),
      runner: stubRunner(),
    });
  }

  const url = (path: string): string => `${API_BASE_PATH}${path}`;

  interface QueueBody {
    items: {
      externalId: string;
      proposedKind: string;
      similarity: number | null;
      matchRule: string | null;
    }[];
    total: number;
  }

  describe('reading the queue', () => {
    it('lists the candidates, confident proposals first', async () => {
      const { status, body } = await api().request('GET', url('/adoption/queue'));
      expect(status).toBe(200);

      const payload = body as QueueBody;
      expect(payload.total).toBe(4);
      // exact_title, then fuzzy_title, then the two with no proposal by id.
      expect(payload.items.map((item) => item.externalId)).toEqual([
        'ext-initiative',
        'ext-kr',
        'ext-project',
        'ext-unmapped',
      ]);
    });

    it('reads a numeric similarity back as a number, not a string', async () => {
      // `numeric` arrives from the driver as text. `Number(null)` is 0, so an
      // unscored candidate would otherwise report a perfect 0.000 similarity.
      const { body } = await api().request('GET', url('/adoption/queue'));
      const payload = body as QueueBody;

      const fuzzy = payload.items.find((item) => item.externalId === 'ext-kr');
      expect(fuzzy?.similarity).toBe(0.871);
      expect(typeof fuzzy?.similarity).toBe('number');

      const unscored = payload.items.find((item) => item.externalId === 'ext-project');
      expect(unscored?.similarity).toBeNull();
    });

    it('filters by area and by kind', async () => {
      const { body } = await api().request('GET', url('/adoption/queue?kind=project'));
      const payload = body as QueueBody;
      expect(payload.items.map((item) => item.externalId)).toEqual(['ext-project']);
    });
  });

  describe('dates, sources and the counts beside each filter', () => {
    interface FilteredBody {
      items: {
        externalId: string;
        sourceRole: string | null;
        startsOn: string | null;
        endsOn: string | null;
        period: string;
      }[];
      total: number;
      today: string;
      facets: {
        when: Record<string, number>;
        source: { key: string; count: number }[];
        area: { key: string | null; count: number }[];
      };
    }

    /**
     * Three pages from two stores, dated against the pinned clock: one period
     * long over, one running, one not started — plus the four undated rows the
     * suite seeds. Invented titles.
     */
    beforeEach(async () => {
      const at = new Date('2026-09-19T09:00:00Z').toISOString();
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason,
           scanned_at, source_role, starts_on, ends_on)
        values
          ('page', 'ext-ended', 'An invented goal from long ago', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2024-01-01', '2024-12-31'),
          ('page', 'ext-running', 'An invented goal for this year', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2026-01-01', '2026-12-31'),
          ('page', 'ext-later', 'An invented habit that starts later', null, 'ritual',
           'held in the processes store', ${at}::timestamptz, 'processes_db',
           '2099-01-01', '2099-01-01')`;
    });

    const queue = async (query = ''): Promise<FilteredBody> =>
      (await api().request('GET', url(`/adoption/queue${query}`))).body as FilteredBody;

    it('leaves out what has ended by default, and counts it', async () => {
      const payload = await queue();
      const ids = payload.items.map((item) => item.externalId);
      expect(ids).not.toContain('ext-ended');
      expect(ids).toContain('ext-running');
      expect(payload.total).toBe(6);
      expect(payload.facets.when).toMatchObject({ open: 6, ended: 1, all: 7, current: 1 });
    });

    it('says which period each row is in, and reads the dates back as days', async () => {
      const payload = await queue('?when=all');
      const byId = new Map(payload.items.map((item) => [item.externalId, item]));
      expect(byId.get('ext-ended')).toMatchObject({
        period: 'ended',
        startsOn: '2024-01-01',
        endsOn: '2024-12-31',
        sourceRole: 'objectives_db',
      });
      expect(byId.get('ext-later')?.period).toBe('upcoming');
      expect(byId.get('ext-initiative')).toMatchObject({ period: 'undated', sourceRole: null });
      expect(payload.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('shows only the ended ones when asked', async () => {
      const payload = await queue('?when=ended');
      expect(payload.items.map((item) => item.externalId)).toEqual(['ext-ended']);
    });

    it('filters by the store a page came from, and by the task tool’s kind', async () => {
      const objectives = await queue('?source=objectives_db&when=all');
      expect(objectives.items.map((item) => item.externalId).sort()).toEqual([
        'ext-ended',
        'ext-running',
      ]);
      const tasks = await queue('?source=task');
      expect(tasks.items.map((item) => item.externalId).sort()).toEqual([
        'ext-initiative',
        'ext-unmapped',
      ]);
      // The source counts respect the date filter: the ended goal is not counted.
      expect(objectives.facets.source).toContainEqual({ key: 'objectives_db', count: 2 });
      expect(tasks.facets.source).toContainEqual({ key: 'objectives_db', count: 1 });
    });

    it('filters to the candidates outside every mapped area', async () => {
      const payload = await queue('?areaKey=_none');
      expect(payload.items.map((item) => item.externalId).sort()).toEqual([
        'ext-later',
        'ext-running',
        'ext-unmapped',
      ]);
      expect(payload.facets.area).toContainEqual({ key: null, count: 3 });
    });

    it('refuses a period it does not know', async () => {
      const response = await api().request('GET', url('/adoption/queue?when=someday'));
      expect(response.status).toBe(400);
    });
  });

  /**
   * The bulk ignore of ended candidates. The test app's clock is pinned to
   * 2026-09-17 in UTC, so "ended" means a period whose last day is the 16th or
   * earlier. Invented titles and identifiers throughout.
   */
  describe('ignoring every ended candidate at once', () => {
    interface EndedView {
      total: number;
      items: { externalId: string }[];
      facets: { when: Record<string, number> };
      ignoreEnded: { count: number; digest: string };
    }

    const decidedAt = new Date('2026-09-10T09:00:00Z').toISOString();

    beforeEach(async () => {
      const area = (
        await database.client<{ key: string }[]>`
        select key from area where kind = 'area' order by key limit 1`
      )[0];
      const at = new Date('2026-09-17T06:00:00Z').toISOString();
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason,
           scanned_at, source_role, starts_on, ends_on)
        values
          ('page', 'ext-old-goal', 'An invented goal from two years ago', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2024-01-01', '2024-12-31'),
          ('page', 'ext-old-habit', 'An invented habit that stopped', null, 'ritual',
           'held in the processes store', ${at}::timestamptz, 'processes_db',
           '2025-01-01', '2025-06-30'),
          ('task', 'ext-old-task', 'An invented task that ran out', ${area?.key ?? null},
           'initiative', 'a parent task with subtasks, in a mapped area', ${at}::timestamptz,
           null, '2025-02-01', '2025-02-28'),
          ('page', 'ext-ends-today', 'An invented goal whose last day is today', null,
           'objective', 'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2026-09-01', '2026-09-17'),
          ('page', 'ext-this-year', 'An invented goal for this year', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2026-01-01', '2026-12-31'),
          ('page', 'ext-next-year', 'An invented goal for next year', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2027-01-01', '2027-12-31'),
          ('page', 'ext-old-linked', 'An invented goal already linked', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2024-01-01', '2024-12-31'),
          ('page', 'ext-old-ignored', 'An invented goal already ignored', null, 'objective',
           'held in the objectives store', ${at}::timestamptz, 'objectives_db',
           '2024-01-01', '2024-12-31')`;
      await database.client`
        insert into entity_link
          (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
        values ('k-invented', 'page', 'ext-old-linked', 'manual', 'manual', 'human',
                ${decidedAt}::timestamptz)`;
      await database.client`
        insert into adoption_ignore (external_kind, external_id, reason, decided_by, decided_at)
        values ('page', 'ext-old-ignored', 'the first decision', 'human',
                ${decidedAt}::timestamptz)`;
    });

    const view = async (query = '?when=ended'): Promise<EndedView> =>
      (await api().request('GET', url(`/adoption/queue${query}`))).body as EndedView;

    const ignoreEnded = (body: unknown) =>
      api().request('POST', url('/adoption/ignore-ended'), body);

    const ignoredIds = async (): Promise<string[]> =>
      (
        await database.client<{ external_id: string }[]>`
          select external_id from adoption_ignore order by external_id`
      ).map((row) => row.external_id);

    it('offers what the Ended filter shows, and nothing linked or ignored', async () => {
      const shown = await view();
      expect(shown.items.map((item) => item.externalId).sort()).toEqual([
        'ext-old-goal',
        'ext-old-habit',
        'ext-old-task',
      ]);
      expect(shown.ignoreEnded.count).toBe(3);
      expect(shown.ignoreEnded.count).toBe(shown.facets.when['ended']);
      expect(shown.ignoreEnded.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // The same offer rides on the default view, which is hiding the same three.
      const open = await view('');
      expect(open.ignoreEnded).toEqual(shown.ignoreEnded);
    });

    it('ignores exactly those, in one decision, and leaves every other row alone', async () => {
      const shown = await view();
      const { status, body } = await ignoreEnded({ expected: shown.ignoreEnded });
      expect(status).toBe(200);
      expect(body).toEqual({ ignored: 3, today: '2026-09-17' });

      const rows = await database.client<
        { external_id: string; reason: string; decided_by: string; decided_at: Date }[]
      >`
        select external_id, reason, decided_by, decided_at from adoption_ignore
        where external_id in ('ext-old-goal', 'ext-old-habit', 'ext-old-task')`;
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((row) => row.decided_by))).toEqual(new Set(['human']));
      expect(new Set(rows.map((row) => new Date(row.decided_at).toISOString()))).toEqual(
        new Set(['2026-09-17T09:00:00.000Z']),
      );
      for (const row of rows) expect(row.reason).toMatch(/in bulk.*ended before 2026-09-17/);

      // Nothing that has not ended was touched — the one ending today included.
      expect(await ignoredIds()).toEqual([
        'ext-old-goal',
        'ext-old-habit',
        'ext-old-ignored',
        'ext-old-task',
      ]);
      const after = await view('?when=all');
      expect(after.items.map((item) => item.externalId)).toEqual(
        expect.arrayContaining(['ext-ends-today', 'ext-this-year', 'ext-next-year']),
      );
      expect(after.facets.when['ended']).toBe(0);

      // The earlier ignore keeps its own reason.
      const first = await database.client<{ reason: string }[]>`
        select reason from adoption_ignore where external_id = 'ext-old-ignored'`;
      expect(first[0]?.reason).toBe('the first decision');
    });

    it('records each one in the event log, as a single ignore does', async () => {
      const shown = await view();
      await ignoreEnded({ expected: shown.ignoreEnded });

      const events = await database.client<
        { entity_id: string; field: string; actor: string; after: { ignored: boolean } }[]
      >`
        select entity_id, field, actor, after from event_log
        where kind = 'adoption_decision' order by entity_id`;
      expect(events.map((event) => event.entity_id)).toEqual([
        'ext-old-goal',
        'ext-old-habit',
        'ext-old-task',
      ]);
      for (const event of events) {
        expect(event).toMatchObject({ field: 'ignore', actor: 'human' });
        expect(event.after.ignored).toBe(true);
      }
    });

    it('respects the source and area filters', async () => {
      const objectives = await view('?when=ended&source=objectives_db');
      expect(objectives.ignoreEnded.count).toBe(1);
      const { status, body } = await ignoreEnded({
        source: 'objectives_db',
        expected: objectives.ignoreEnded,
      });
      expect(status).toBe(200);
      expect(body).toMatchObject({ ignored: 1 });
      expect(await ignoredIds()).toEqual(['ext-old-goal', 'ext-old-ignored']);

      const unmapped = await view('?when=ended&areaKey=_none');
      expect(unmapped.ignoreEnded.count).toBe(1);
      await ignoreEnded({ areaKey: '_none', expected: unmapped.ignoreEnded });
      expect(await ignoredIds()).toEqual(['ext-old-goal', 'ext-old-habit', 'ext-old-ignored']);
    });

    it('refuses a stale view: a rescan in between moves the set, and nothing is ignored', async () => {
      const shown = await view();

      // What a rescan does to the mirror: one more entry has ended since.
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason,
           scanned_at, source_role, starts_on, ends_on)
        values ('page', 'ext-found-later', 'An invented goal the rescan found', null,
                'key_result', 'held in the objectives store', now(), 'objectives_db',
                '2023-01-01', '2023-12-31')`;

      const { status, body } = await ignoreEnded({ expected: shown.ignoreEnded });
      expect(status).toBe(409);
      expect((body as { error: string }).error).toBe('conflict');
      expect((body as { message: string }).message).toMatch(/showed 3 ended, and 4 match now/);
      expect(await ignoredIds()).toEqual(['ext-old-ignored']);
    });

    it('refuses a view whose count still matches and whose rows do not', async () => {
      const shown = await view();
      // Same number, another set: one left the mirror and another arrived.
      await database.client`delete from adoption_candidate where external_id = 'ext-old-habit'`;
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason,
           scanned_at, source_role, starts_on, ends_on)
        values ('page', 'ext-swapped-in', 'An invented goal swapped in', null,
                'key_result', 'held in the objectives store', now(), 'objectives_db',
                '2023-01-01', '2023-12-31')`;
      expect((await view()).ignoreEnded.count).toBe(3);

      const { status, body } = await ignoreEnded({ expected: shown.ignoreEnded });
      expect(status).toBe(409);
      expect((body as { message: string }).message).toMatch(/not the same ones/);
      expect(await ignoredIds()).toEqual(['ext-old-ignored']);
    });

    it('refuses a view drawn yesterday, once the day turning over has ended another entry', async () => {
      const shown = await view();
      // The next day in the instance's timezone: the goal whose last day was
      // the 17th has ended too, so the set the page showed is not the set now.
      const tomorrow = createTestApp({
        client: database.client,
        runner: stubRunner(),
        now: new Date('2026-09-18T09:00:00Z'),
      });
      const { status, body } = await tomorrow.request('POST', url('/adoption/ignore-ended'), {
        expected: shown.ignoreEnded,
      });
      expect(status).toBe(409);
      expect((body as { message: string }).message).toMatch(/showed 3 ended, and 4 match now/);
      expect(await ignoredIds()).toEqual(['ext-old-ignored']);
    });

    it('cannot be replayed: once the set is ignored, the same confirmation is stale', async () => {
      const shown = await view();
      expect((await ignoreEnded({ expected: shown.ignoreEnded })).status).toBe(200);
      const again = await ignoreEnded({ expected: shown.ignoreEnded });
      expect(again.status).toBe(409);
    });

    describe('never reaches a candidate that has not ended', () => {
      it('refuses a body that names candidates or a period, and ignores nothing', async () => {
        const shown = await view();
        for (const field of [
          { externalIds: ['ext-this-year'] },
          { candidates: [{ externalKind: 'page', externalId: 'ext-this-year' }] },
          { when: 'all' },
        ]) {
          const { status, body } = await ignoreEnded({ ...field, expected: shown.ignoreEnded });
          expect(status).toBe(400);
          expect((body as { error: string }).error).toBe('read_only_field');
        }
        expect(await ignoredIds()).toEqual(['ext-old-ignored']);
      });

      it('refuses a digest forged over rows that have not ended, even with the right count', async () => {
        // A client that knows how the digest is built, naming a running goal and
        // the one whose last day is today beside an ended one.
        const forged = endedDigest([
          { externalKind: 'page', externalId: 'ext-this-year' },
          { externalKind: 'page', externalId: 'ext-ends-today' },
          { externalKind: 'page', externalId: 'ext-old-goal' },
        ]);
        const { status } = await ignoreEnded({ expected: { count: 3, digest: forged } });
        expect(status).toBe(409);
        expect(await ignoredIds()).toEqual(['ext-old-ignored']);
      });

      it('is refused by the store itself, all or nothing, when handed one that has not ended', async () => {
        // Below the service: the write re-checks the period, and one row that
        // fails it rolls the whole set back.
        const store = createPostgresStore(database.client);
        const outcome = await store.ops.ignoreEndedCandidates({
          candidates: [
            { externalKind: 'page', externalId: 'ext-old-goal' },
            { externalKind: 'page', externalId: 'ext-ends-today' },
          ],
          endedBefore: '2026-09-17',
          reason: 'an invented bulk ignore',
          actor: 'human',
          decidedAt: new Date('2026-09-17T09:00:00Z'),
        });
        expect(outcome).toEqual({ ok: false });
        expect(await ignoredIds()).toEqual(['ext-old-ignored']);
        const events = await database.client`
          select 1 from event_log where kind = 'adoption_decision'`;
        expect(events).toHaveLength(0);
      });

      it('is refused by the store for a linked candidate too', async () => {
        const store = createPostgresStore(database.client);
        const outcome = await store.ops.ignoreEndedCandidates({
          candidates: [{ externalKind: 'page', externalId: 'ext-old-linked' }],
          endedBefore: '2026-09-17',
          reason: 'an invented bulk ignore',
          actor: 'human',
          decidedAt: new Date('2026-09-17T09:00:00Z'),
        });
        expect(outcome).toEqual({ ok: false });
        expect(await ignoredIds()).toEqual(['ext-old-ignored']);
      });
    });

    it('refuses an empty confirmation: there is nothing to confirm', async () => {
      const { status } = await ignoreEnded({
        source: 'project',
        expected: { count: 0, digest: endedDigest([]) },
      });
      expect(status).toBe(400);
    });

    it('needs write:adoption', async () => {
      const shown = await view();
      const response = await api(identityWith(['read:adoption'])).request(
        'POST',
        url('/adoption/ignore-ended'),
        { expected: shown.ignoreEnded },
      );
      expect(response.status).toBe(403);
      expect(await ignoredIds()).toEqual(['ext-old-ignored']);
    });
  });

  describe('adopting', () => {
    it('creates one entity with origin adopted, and links it — and nothing more', async () => {
      const { status, body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });
      expect(status).toBe(201);

      const decision = body as { prismeId: string; bound: boolean };
      // Linked but **not bound**: binding `entity_external_ref` is the
      // reconciler's `adopt` action, so guard 1 has one writer.
      expect(decision.bound).toBe(false);

      const rows = await database.client<{ origin: string; title: string; status: string }[]>`
        select origin, title, status from initiative where id = ${decision.prismeId}::uuid`;
      expect(rows[0]).toMatchObject({ origin: 'adopted', title: 'Rebuild the garden shed' });

      const refs = await database.client`
        select 1 from entity_external_ref where prisme_id = ${decision.prismeId}`;
      expect(refs).toHaveLength(0);
    });

    it('produces an entity the database refuses to turn into a created one', async () => {
      // Guard 2, at the database. `origin` is immutable after insert, so an
      // adopted entity cannot later become one that produces a `create`.
      const { body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });
      const { prismeId } = body as { prismeId: string };

      await expect(
        database.client`
          update initiative set origin = 'created_in_prisme' where id = ${prismeId}::uuid`,
      ).rejects.toThrow(/origin is immutable/);
    });

    it('adopts a project without touching anything outward', async () => {
      const { status, body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'project',
        externalId: 'ext-project',
      });
      expect(status).toBe(201);

      const { prismeId } = body as { prismeId: string };
      const rows = await database.client<{ origin: string; status: string }[]>`
        select origin, status from project where id = ${prismeId}::uuid`;
      expect(rows[0]).toMatchObject({ origin: 'adopted', status: 'active' });
    });

    it('refuses a key result, whose objective and target no candidate carries, and says why', async () => {
      // `ext-kr` is also the shape of a row mirrored before 0017, when every
      // objectives page was proposed as a key result: refused until a rescan.
      const { status, body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'page',
        externalId: 'ext-kr',
      });
      expect(status).toBe(400);
      expect((body as { message: string }).message).toMatch(
        /merge it onto a key result that already exists/,
      );
    });

    describe('an objectives page (ADR-0033, amended)', () => {
      /** A page of the objectives store, in an area, with the period its dates name. */
      async function seedObjective(
        externalId: string,
        startsOn: string | null,
        endsOn: string | null,
      ): Promise<string> {
        const areaKey = (
          await database.client<{ key: string }[]>`
            select key from area where kind = 'area' order by key limit 1`
        )[0]?.key as string;
        await database.client`
          insert into adoption_candidate
            (external_kind, external_id, title, area_key, proposed_kind, reason, scanned_at,
             source_role, starts_on, ends_on)
          values ('page', ${externalId}, 'Be fitter this year', ${areaKey}, 'objective',
                  'held in the objectives store',
                  ${new Date('2026-09-19T09:00:00Z').toISOString()}::timestamptz,
                  'objectives_db', ${startsOn}, ${endsOn})`;
        return areaKey;
      }

      const counts = async () => {
        const [row] = await database.client<
          { objectives: string; links: string; initiatives: string; projects: string }[]
        >`
          select (select count(*) from objective) as objectives,
                 (select count(*) from entity_link) as links,
                 (select count(*) from initiative) as initiatives,
                 (select count(*) from project) as projects`;
        return row;
      };

      it('becomes an annual objective linked to its page — and nothing more', async () => {
        const areaKey = await seedObjective('ext-objective', '2026-01-01', '2026-12-31');
        const before = await counts();

        const { status, body } = await api().request('POST', url('/adoption/adopt'), {
          externalKind: 'page',
          externalId: 'ext-objective',
        });
        expect(status).toBe(201);
        const { prismeId, bound } = body as { prismeId: string; bound: boolean };
        expect(bound).toBe(false);

        const rows = await database.client`
          select title, type, period, area_key, status, external_page_id
          from objective where id = ${prismeId}::uuid`;
        expect(rows[0]).toEqual({
          title: 'Be fitter this year',
          type: 'annual',
          period: '2026',
          area_key: areaKey,
          status: 'active',
          external_page_id: 'ext-objective',
        });

        // One objective and its link: no initiative, no project, and nothing
        // bound — the reconciler reads no objective, so nothing is planned outward.
        expect(await counts()).toEqual({
          ...before,
          objectives: String(Number(before?.objectives) + 1),
          links: String(Number(before?.links) + 1),
        });
        const refs = await database.client`
          select 1 from entity_external_ref where prisme_id = ${prismeId}`;
        expect(refs).toHaveLength(0);
      });

      it('becomes a monthly objective for exactly one calendar month', async () => {
        await seedObjective('ext-objective', '2026-02-01', '2026-02-28');
        const { status, body } = await api().request('POST', url('/adoption/adopt'), {
          externalKind: 'page',
          externalId: 'ext-objective',
        });
        expect(status).toBe(201);
        const rows = await database.client`
          select type, period from objective
          where id = ${(body as { prismeId: string }).prismeId}::uuid`;
        expect(rows[0]).toEqual({ type: 'monthly', period: '2026-02' });
      });

      it('is a draft while its period has not started, on the instance’s day', async () => {
        // The clock is pinned to 2026-09-17: next year and next month have not
        // started, so neither is work under way yet.
        await seedObjective('ext-next-year', '2027-01-01', '2027-12-31');
        await seedObjective('ext-next-month', '2026-10-01', '2026-10-31');
        await seedObjective('ext-this-month', '2026-09-01', '2026-09-30');
        await seedObjective('ext-next-month-too', '2026-10-01', '2026-10-31');

        const statusOf = async (externalId: string, app = api()) => {
          const { status, body } = await app.request('POST', url('/adoption/adopt'), {
            externalKind: 'page',
            externalId,
          });
          expect(status).toBe(201);
          const rows = await database.client<{ status: string }[]>`
            select status from objective
            where id = ${(body as { prismeId: string }).prismeId}::uuid`;
          return rows[0]?.status;
        };

        expect(await statusOf('ext-next-year')).toBe('draft');
        expect(await statusOf('ext-next-month')).toBe('draft');
        expect(await statusOf('ext-this-month')).toBe('active');

        // On the first day of its period, the same page is under way.
        const firstDay = createTestApp({
          client: database.client,
          runner: stubRunner(),
          now: new Date('2026-10-01T09:00:00Z'),
        });
        expect(await statusOf('ext-next-month-too', firstDay)).toBe('active');
      });

      it('refuses any other span, says why, and inserts nothing', async () => {
        await seedObjective('ext-quarter', '2026-01-01', '2026-03-31');
        await seedObjective('ext-undated', null, null);
        const before = await counts();

        for (const externalId of ['ext-quarter', 'ext-undated']) {
          const { status, body } = await api().request('POST', url('/adoption/adopt'), {
            externalKind: 'page',
            externalId,
          });
          expect(status).toBe(400);
          expect((body as { message: string }).message).toMatch(/exactly one calendar year/);
        }
        expect(await counts()).toEqual(before);
      });

      it('refuses a caller that tries to choose the type or the period', async () => {
        await seedObjective('ext-objective', '2026-01-01', '2026-12-31');
        const { status, body } = await api().request('POST', url('/adoption/adopt'), {
          externalKind: 'page',
          externalId: 'ext-objective',
          period: '2027',
        });
        expect(status).toBe(400);
        expect(JSON.stringify(body)).toContain('period');
      });

      it('leaves the queue once adopted', async () => {
        await seedObjective('ext-objective', '2026-01-01', '2026-12-31');
        await api().request('POST', url('/adoption/adopt'), {
          externalKind: 'page',
          externalId: 'ext-objective',
        });
        const { body } = await api().request('GET', url('/adoption/queue?when=all'));
        expect((body as QueueBody).items.map((item) => item.externalId)).not.toContain(
          'ext-objective',
        );
      });
    });

    it('names on every row why Adopt would refuse it — and the write agrees, row by row', async () => {
      // The queue and the write read one rule (`adoptRefusal`). Asked of every
      // row the queue shows, the write must refuse exactly the rows the queue
      // said it would, and adopt the rest.
      const areaKey = (
        await database.client<{ key: string }[]>`
          select key from area where kind = 'area' order by key limit 1`
      )[0]?.key as string;
      const at = new Date('2026-09-19T09:00:00Z').toISOString();
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason, scanned_at,
           source_role, starts_on, ends_on)
        values
          ('page', 'ext-goal-year', 'An invented goal', ${areaKey}, 'objective', 'held',
           ${at}::timestamptz, 'objectives_db', '2026-01-01', '2026-12-31'),
          ('page', 'ext-goal-odd', 'An invented goal', ${areaKey}, 'objective', 'held',
           ${at}::timestamptz, 'objectives_db', '2026-04-01', '2026-06-30'),
          ('page', 'ext-goal-nowhere', 'An invented goal', null, 'objective', 'held',
           ${at}::timestamptz, 'objectives_db', '2026-01-01', '2026-12-31'),
          ('page', 'ext-habit', 'An invented habit', ${areaKey}, 'ritual', 'held',
           ${at}::timestamptz, 'processes_db', null, null),
          ('page', 'ext-action', 'An invented action', ${areaKey}, 'initiative', 'held',
           ${at}::timestamptz, 'takeaways_db', null, null)`;

      const { body } = await api().request('GET', url('/adoption/queue?when=all'));
      const rows = (
        body as {
          items: { externalKind: string; externalId: string; adoptRefusal: string | null }[];
        }
      ).items;
      expect(Object.fromEntries(rows.map((row) => [row.externalId, row.adoptRefusal]))).toEqual({
        'ext-initiative': null,
        'ext-project': null,
        'ext-kr': 'needs_objective',
        'ext-unmapped': 'no_area',
        'ext-goal-year': null,
        'ext-goal-odd': 'period_not_calendar',
        'ext-goal-nowhere': 'no_area',
        'ext-habit': 'needs_cadence',
        'ext-action': 'promote_takeaway',
      });

      for (const row of rows) {
        const { status } = await api().request('POST', url('/adoption/adopt'), {
          externalKind: row.externalKind,
          externalId: row.externalId,
        });
        expect({ row: row.externalId, status }).toEqual({
          row: row.externalId,
          status: row.adoptRefusal === null ? 201 : 400,
        });
      }
    });

    describe('an action takeaway (ADR-0033)', () => {
      /**
       * A takeaway page proposed as an initiative, in an area now that its
       * store's area column gave it one — the row #115 made adoptable, and the
       * one this refusal closes. `sourceRole: null` is a row scanned before
       * 0015, which the predicate must refuse all the same.
       */
      async function seedTakeaway(externalId: string, sourceRole: string | null): Promise<string> {
        const areaKey = (
          await database.client<{ key: string }[]>`
            select key from area where kind = 'area' order by key limit 1`
        )[0]?.key as string;
        await database.client`
          insert into adoption_candidate
            (external_kind, external_id, title, area_key, proposed_kind, reason, scanned_at,
             source_role)
          values ('page', ${externalId}, 'Fix the garden gate', ${areaKey}, 'initiative',
                  'an actionable takeaway — promoted, not copied',
                  ${new Date('2026-09-19T09:00:00Z').toISOString()}::timestamptz, ${sourceRole})`;
        return areaKey;
      }

      const counts = async () => {
        const [row] = await database.client<
          { initiatives: string; links: string; decisions: string }[]
        >`
          select (select count(*) from initiative) as initiatives,
                 (select count(*) from entity_link) as links,
                 (select count(*) from event_log where kind = 'adoption_decision') as decisions`;
        return row;
      };

      it('is refused, and pointed at the Inbox', async () => {
        await seedTakeaway('ext-takeaway', 'takeaways_db');
        const { status, body } = await api().request('POST', url('/adoption/adopt'), {
          externalKind: 'page',
          externalId: 'ext-takeaway',
        });
        expect(status).toBe(400);
        expect((body as { message: string }).message).toMatch(/promote it from the Inbox/);
      });

      it('inserts no initiative, no link and no decision — whichever store it came from', async () => {
        // Adversarial: the refusal must come before the insert, not after it,
        // and must not depend on the store being recorded on the row.
        await seedTakeaway('ext-takeaway', 'takeaways_db');
        await seedTakeaway('ext-takeaway-old', null);
        const before = await counts();

        for (const externalId of ['ext-takeaway', 'ext-takeaway-old']) {
          const { status } = await api().request('POST', url('/adoption/adopt'), {
            externalKind: 'page',
            externalId,
          });
          expect(status).toBe(400);
        }

        expect(await counts()).toEqual(before);
        const adopted = await database.client`
          select 1 from initiative where origin = 'adopted' and title = 'Fix the garden gate'`;
        expect(adopted).toHaveLength(0);
      });

      it('can still be merged onto the initiative its promotion made', async () => {
        const areaKey = await seedTakeaway('ext-takeaway', 'takeaways_db');
        const [promoted] = await database.client<{ id: string }[]>`
          insert into initiative (title, area_key, status, value, time_criticality, risk, size,
                                  origin)
          values ('Fix the garden gate', ${areaKey}, 'inbox', 3, 3, 3, 3, 'created_in_prisme')
          returning id::text`;

        const merged = await api().request('POST', url('/adoption/decisions'), {
          prismeId: (promoted as { id: string }).id,
          externalKind: 'page',
          externalId: 'ext-takeaway',
          matchRule: 'manual',
          confidence: 'manual',
        });
        expect(merged.status).toBeLessThan(300);

        const queue = (await api().request('GET', url('/adoption/queue?when=all'))).body as {
          items: { externalId: string }[];
        };
        expect(queue.items.map((item) => item.externalId)).not.toContain('ext-takeaway');
      });
    });

    it('refuses a candidate outside every mapped area', async () => {
      // An entity belonging to no area cannot be allocated to, and allocation
      // comes before ranking.
      const { status, body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-unmapped',
      });
      expect(status).toBe(400);
      expect((body as { message: string }).message).toMatch(/mapped area/);
    });

    it('is a 404 for a candidate that is not there', async () => {
      const { status } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-nothing',
      });
      expect(status).toBe(404);
    });

    it('removes the row from the queue and never brings it back', async () => {
      await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });

      for (let pass = 0; pass < 3; pass += 1) {
        const { body } = await api().request('GET', url('/adoption/queue'));
        const payload = body as QueueBody;
        expect(payload.items.map((item) => item.externalId)).not.toContain('ext-initiative');
        expect(payload.total).toBe(3);
      }
    });
  });

  describe('merging a processes page onto a ritual', () => {
    /**
     * A ritual defined on Rituals, and the processes row proposed against it —
     * the only way a ritual comes out of the queue, since *Adopt* refuses one.
     */
    async function seedRitual(page: string | null): Promise<{ ritualId: string }> {
      const areaKey = (
        await database.client<{ key: string }[]>`
          select key from area where kind = 'area' order by key limit 1`
      )[0]?.key as string;
      const [ritual] = await database.client<{ id: string }[]>`
        insert into ritual (name, area_key, cadence, target_adherence_pct, external_page_id)
        values ('Morning stretch', ${areaKey}, 'daily', 80, ${page})
        returning id::text`;
      const ritualId = (ritual as { id: string }).id;
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason, match_rule,
           confidence, proposed_id, scanned_at, source_role)
        values ('page', 'ext-process', 'Morning stretch', ${areaKey}, 'ritual',
                'held in the processes store — a habit with adherence to measure',
                'exact_title', 'high', ${ritualId},
                ${new Date('2026-09-19T09:00:00Z').toISOString()}::timestamptz, 'processes_db')`;
      return { ritualId };
    }

    const link = (ritualId: string, externalKind = 'page', externalId = 'ext-process') =>
      api().request('POST', url('/adoption/decisions'), {
        prismeId: ritualId,
        externalKind,
        externalId,
        matchRule: 'exact_title',
        confidence: 'high',
      });

    const pageOf = async (ritualId: string): Promise<string | null> =>
      (
        await database.client<{ external_page_id: string | null }[]>`
          select external_page_id from ritual where id = ${ritualId}::uuid`
      )[0]?.external_page_id ?? null;

    const queued = async (): Promise<string[]> =>
      (
        (await api().request('GET', url('/adoption/queue?when=all'))).body as {
          items: { externalId: string }[];
        }
      ).items.map((item) => item.externalId);

    it('makes the page the ritual’s process page, and takes the row off the queue', async () => {
      const { ritualId } = await seedRitual(null);

      const { status } = await link(ritualId);

      expect(status).toBeLessThan(300);
      expect(await pageOf(ritualId)).toBe('ext-process');
      expect(await queued()).not.toContain('ext-process');
    });

    it('accepts the page the ritual already names, however its identifier is written', async () => {
      // One page, written bare on the ritual and dashed on the row. Built at
      // run time: the privacy scan refuses an identifier-shaped literal.
      const bare = 'ab'.repeat(16);
      const dashed = [0, 8, 12, 16, 20]
        .map((start, index, starts) => bare.slice(start, starts[index + 1]))
        .join('-');
      const { ritualId } = await seedRitual(bare);
      await database.client`
        update adoption_candidate set external_id = ${dashed} where external_id = 'ext-process'`;

      const { status } = await link(ritualId, 'page', dashed);

      expect(status).toBeLessThan(300);
      // Compared as one page, and left as it was written.
      expect(await pageOf(ritualId)).toBe(bare);
      expect(await queued()).not.toContain(dashed);
    });

    it('refuses a ritual that names another page, and writes nothing', async () => {
      const { ritualId } = await seedRitual('ext-other-process');
      const before = await database.client<{ links: string; decisions: string }[]>`
        select (select count(*) from entity_link) as links,
               (select count(*) from event_log where kind = 'adoption_decision') as decisions`;

      const { status, body } = await link(ritualId);

      expect(status).toBe(409);
      expect((body as { message: string }).message).toMatch(/another process page/);
      expect(await pageOf(ritualId)).toBe('ext-other-process');
      const after = await database.client<{ links: string; decisions: string }[]>`
        select (select count(*) from entity_link) as links,
               (select count(*) from event_log where kind = 'adoption_decision') as decisions`;
      expect(after).toEqual(before);
      expect(await queued()).toContain('ext-process');
    });

    it('leaves the ritual’s page alone when what is linked is not a page', async () => {
      const { ritualId } = await seedRitual(null);

      const { status } = await link(ritualId, 'task', 'ext-initiative');

      expect(status).toBeLessThan(300);
      expect(await pageOf(ritualId)).toBeNull();
    });
  });

  describe('ignoring', () => {
    it('removes the row from the queue, permanently', async () => {
      const { status } = await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
        reason: 'not work, a reminder',
      });
      expect(status).toBe(200);

      const { body } = await api().request('GET', url('/adoption/queue'));
      expect((body as QueueBody).total).toBe(3);
    });

    it('survives a re-scan that finds the same object again', async () => {
      // The convergence property, at the database: the scan replaces the mirror
      // wholesale, and the ignore is in a different table that it never touches.
      await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });

      await database.client`delete from adoption_candidate`;
      await seedCandidates();

      const { body } = await api().request('GET', url('/adoption/queue'));
      const payload = body as QueueBody;
      expect(payload.items.map((item) => item.externalId)).not.toContain('ext-initiative');
      expect(payload.total).toBe(3);
    });

    it('is refused by the database when something tries to undo it', async () => {
      await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });

      await expect(
        database.client`delete from adoption_ignore where external_id = 'ext-initiative'`,
      ).rejects.toThrow(/an ignore is permanent/);
      await expect(
        database.client`update adoption_ignore set reason = 'changed my mind'`,
      ).rejects.toThrow(/an ignore is permanent/);
    });

    it('leaves the first decision alone when the same item is ignored twice', async () => {
      await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
        reason: 'first',
      });
      const { status } = await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
        reason: 'second',
      });
      expect(status).toBe(200);

      const rows = await database.client<{ reason: string }[]>`
        select reason from adoption_ignore where external_id = 'ext-initiative'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe('first');
    });
  });

  describe('every decision reaches the event log', () => {
    it('records the adopt and the ignore against the external object', async () => {
      await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });
      await api().request('POST', url('/adoption/ignore'), {
        externalKind: 'project',
        externalId: 'ext-project',
      });

      const rows = await database.client<{ entity_id: string; field: string }[]>`
        select entity_id, field from event_log
        where kind = 'adoption_decision' order by field`;
      expect(rows).toEqual([
        { entity_id: 'ext-initiative', field: 'adopt' },
        { entity_id: 'ext-project', field: 'ignore' },
      ]);
    });
  });

  describe('authorization', () => {
    it('refuses a read-scoped identity on both write paths', async () => {
      const reader = identityWith(['read:adoption']);
      const adopt = await api(reader).request('POST', url('/adoption/adopt'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });
      const ignore = await api(reader).request('POST', url('/adoption/ignore'), {
        externalKind: 'task',
        externalId: 'ext-initiative',
      });
      expect(adopt.status).toBe(403);
      expect(ignore.status).toBe(403);
    });
  });
  describe('a rescan', () => {
    it('answers with counts, and never with the report and its titles', async () => {
      const response = await api().request('POST', url('/adoption/scan'), {});
      expect(response.status).toBe(200);
      expect(Object.keys(response.body as object).sort()).toEqual([
        'certain',
        'queued',
        'ran',
        'scannedAt',
      ]);
    });

    it('needs write:adoption', async () => {
      const response = await api(identityWith(['read:adoption'])).request(
        'POST',
        url('/adoption/scan'),
        {},
      );
      expect(response.status).toBe(403);
    });
  });
});
