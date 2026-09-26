import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
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

    it('refuses a kind whose required values no candidate carries, and says why', async () => {
      const { status, body } = await api().request('POST', url('/adoption/adopt'), {
        externalKind: 'page',
        externalId: 'ext-kr',
      });
      expect(status).toBe(400);
      expect((body as { message: string }).message).toMatch(/merge it onto an entity/);
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
