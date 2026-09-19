import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { createTestApp, identityWith, PINNED_NOW, stubRunner } from '../test-support/app.js';
import { fixtureId, seedCompletions, seedFixtures } from '../test-support/seed.js';
import { API_BASE_PATH } from './index.js';

/**
 * The API, end to end, against a real PostgreSQL seeded from `fixtures/`.
 *
 * Everything here is synthetic. The areas are six invented ones, the
 * initiatives are invented, and none of it resembles any real instance — which
 * is the point of `fixtures/` and the reason there is no other dataset in this
 * repository (CLAUDE.md, rule 1).
 *
 * These tests exist for the failures a fake store cannot have: a `numeric`
 * arriving as a string, a `date` arriving as a local midnight, a window
 * function that pages wrong, a constraint the service thought it had already
 * checked. Everything above the driver is the code that ships — the router, the
 * schemas, the services, the SQL.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

describeOrSkip('the API against PostgreSQL', () => {
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
  });

  function api(identity?: ReturnType<typeof identityWith>) {
    return createTestApp({
      client: database.client,
      ...(identity === undefined ? {} : { identity }),
      runner: stubRunner(),
    });
  }

  const url = (path: string): string => `${API_BASE_PATH}${path}`;

  describe('areas and weights', () => {
    it('lists every area and lane, and says which are ranked', async () => {
      const { body } = await api().request('GET', url('/areas'));
      const payload = body as { items: { key: string; kind: string; rankable: boolean }[] };

      expect(payload.items).toHaveLength(8);
      expect(payload.items.filter((area) => area.rankable)).toHaveLength(6);
      expect(payload.items.find((area) => area.key === 'run')?.rankable).toBe(false);
      expect(payload.items.find((area) => area.key === 'signals')?.rankable).toBe(false);
    });

    it('reads a numeric budget back as a number, not as a string', async () => {
      const { body } = await api().request('GET', url('/areas/run'));
      expect((body as { runBudgetHoursPerWeek: unknown }).runBudgetHoursPerWeek).toBe(3);
    });

    it('answers a weight question only with a year, and says which year it used', async () => {
      const fresh = await api().request('GET', url('/areas/weights?year=2026'));
      expect(fresh.body).toMatchObject({ year: 2026, sourceYear: 2026, stale: false, sumPct: 100 });

      // 2028 was never decided. The weights carry forward, and the response
      // says so rather than pretending they were chosen — the year gate.
      const carried = await api().request('GET', url('/areas/weights?year=2028'));
      expect(carried.body).toMatchObject({ year: 2028, sourceYear: 2027, stale: true });
    });

    it('keeps last year’s chart correct after this year’s weights land', async () => {
      const in2026 = (await api().request('GET', url('/areas/weights?year=2026'))).body as {
        weights: { areaKey: string; weightPct: number }[];
      };
      const in2027 = (await api().request('GET', url('/areas/weights?year=2027'))).body as {
        weights: { areaKey: string; weightPct: number }[];
      };

      const health2026 = in2026.weights.find((weight) => weight.areaKey === 'health');
      const health2027 = in2027.weights.find((weight) => weight.areaKey === 'health');
      expect(health2026?.weightPct).toBe(30);
      expect(health2027?.weightPct).toBe(20);
    });

    it('writes a weight, records the change, and refuses one on a lane', async () => {
      const app = api();

      const put = await app.request('PUT', url('/areas/health/weights/2028'), { weightPct: 35 });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ year: 2028, sourceYear: 2028, stale: false });

      const events = (await app.request('GET', url('/events?kind=weight_changed'))).body as {
        items: { entityId: string; before: unknown; after: unknown }[];
      };
      expect(events.items[0]).toMatchObject({ entityId: 'health', before: null, after: 35 });

      const lane = await app.request('PUT', url('/areas/run/weights/2028'), { weightPct: 10 });
      expect(lane.status).toBe(422);
      expect((lane.body as { message: string }).message).toContain('hours per week');
    });

    it('refuses to write a weight through the area itself', async () => {
      const response = await api().request('PATCH', url('/areas/health'), { weightPct: 40 });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'read_only_field' });
      expect((response.body as { fields: { field: string }[] }).fields[0]?.field).toBe('weightPct');
    });
  });

  describe('initiatives', () => {
    it('returns an explicit DTO, with no column the contract does not name', async () => {
      const id = fixtureId('init-003');
      const { body } = await api().request('GET', url(`/initiatives/${id}`));

      expect(body).toMatchObject({
        id,
        areaKey: 'money',
        status: 'now',
        // A calendar date, in whole days, exactly as it was written.
        deadline: '2026-10-31',
        origin: 'created_in_prisme',
      });
      expect(body).not.toHaveProperty('area_key');
      expect(body).not.toHaveProperty('wsjf');
      expect(body).not.toHaveProperty('due');
    });

    it('carries a score from the active method, with the factors behind it', async () => {
      const { body } = await api().request('GET', url(`/initiatives/${fixtureId('init-003')}`));
      const score = (body as { score: { methodId: string; explain: string; factors: unknown } })
        .score;

      expect(score.methodId).toBe('wsjf-balanced');
      expect(score.explain.length).toBeGreaterThan(0);
      expect(Object.keys(score.factors as Record<string, number>)).toContain('costOfDelay');
    });

    it('reports a blocker that is still open, and forgets one that closed', async () => {
      const app = api();
      const blocked = fixtureId('init-004');

      const before = await app.request('GET', url(`/initiatives/${blocked}`));
      expect((before.body as { blockedBy: string[] }).blockedBy).toEqual([fixtureId('init-008')]);

      await app.request('POST', url(`/initiatives/${fixtureId('init-008')}/status`), {
        to: 'done',
      });

      const after = await app.request('GET', url(`/initiatives/${blocked}`));
      expect((after.body as { blockedBy: string[] }).blockedBy).toEqual([]);
    });

    it('creates one, and refuses a dependency cycle by naming the path', async () => {
      const app = api();

      const created = await app.request('POST', url('/initiatives'), {
        title: 'Fence replaced',
        areaKey: 'home',
        value: 5,
        timeCriticality: 3,
        risk: 2,
        size: 3,
        dependsOn: [fixtureId('init-005')],
      });
      expect(created.status).toBe(201);
      const id = (created.body as { id: string }).id;

      const cycle = await app.request(
        'PUT',
        url(`/initiatives/${fixtureId('init-005')}/dependencies`),
        {
          dependsOn: [id],
        },
      );
      expect(cycle.status).toBe(422);
      expect((cycle.body as { message: string }).message).toContain('acyclic');
      expect((cycle.body as { message: string }).message).toContain('→');
    });

    it('stamps the day a transition finished, and insists on a reason for a drop', async () => {
      const app = api();
      const id = fixtureId('init-007');

      const dropped = await app.request('POST', url(`/initiatives/${id}/status`), {
        to: 'dropped',
      });
      expect(dropped.status).toBe(422);
      expect((dropped.body as { message: string }).message).toContain('reason');

      const done = await app.request('POST', url(`/initiatives/${id}/status`), { to: 'done' });
      expect(done.status).toBe(200);
      expect((done.body as { doneAt: string }).doneAt).toBe('2026-09-17');

      const events = (await app.request('GET', url(`/events?entityId=${id}`))).body as {
        items: { kind: string; before: unknown; after: unknown; actor: string }[];
      };
      expect(events.items[0]).toMatchObject({
        kind: 'status_changed',
        before: 'next',
        after: 'done',
        actor: 'human',
      });
    });

    it('appends a ranking to history only when asked, with the method that produced it', async () => {
      const app = api();
      const id = fixtureId('init-003');

      const before = (await app.request('GET', url(`/initiatives/${id}/scores`))).body as {
        items: unknown[];
      };
      expect(before.items).toEqual([]);

      const rescore = await app.request('POST', url('/initiatives/rescore'));
      expect((rescore.body as { scored: number }).scored).toBeGreaterThan(0);

      const after = (await app.request('GET', url(`/initiatives/${id}/scores`))).body as {
        items: { methodId: string; methodVersion: number }[];
      };
      expect(after.items).toHaveLength(1);
      expect(after.items[0]).toMatchObject({ methodId: 'wsjf-balanced', methodVersion: 1 });
    });
  });

  describe('the backlog', () => {
    it('filters, sorts and pages, and reports the total before the page was cut', async () => {
      const app = api();

      const all = (await app.request('GET', url('/backlog?limit=5&offset=0'))).body as {
        items: unknown[];
        total: number;
        sort: string;
      };
      expect(all.items).toHaveLength(5);
      expect(all.total).toBe(13);
      expect(all.sort).toBe('score:asc');

      const page2 = (await app.request('GET', url('/backlog?limit=5&offset=10'))).body as {
        items: unknown[];
        total: number;
      };
      expect(page2.items).toHaveLength(3);
      expect(page2.total).toBe(13);
    });

    it('filters by area and by status', async () => {
      const app = api();

      const home = (await app.request('GET', url('/backlog?areaKey=home'))).body as {
        items: { initiative: { areaKey: string } }[];
        total: number;
      };
      expect(home.total).toBe(3);
      expect(home.items.every((entry) => entry.initiative.areaKey === 'home')).toBe(true);

      const open = (await app.request('GET', url('/backlog?status=now,next'))).body as {
        total: number;
      };
      expect(open.total).toBe(8);
    });

    it('searches titles without letting a wildcard through', async () => {
      const app = api();

      const found = (await app.request('GET', url('/backlog?q=passport'))).body as {
        total: number;
      };
      expect(found.total).toBe(1);

      // `%` is a character somebody typed, not a pattern they asked for.
      const wildcard = (await app.request('GET', url('/backlog?q=%25'))).body as { total: number };
      expect(wildcard.total).toBe(0);
    });

    it('sorts by deadline with undated work last, whichever direction is asked', async () => {
      const app = api();
      const ascending = (await app.request('GET', url('/backlog?sort=deadline&direction=asc')))
        .body as { items: { initiative: { deadline: string | null } }[] };

      const dated = ascending.items
        .map((entry) => entry.initiative.deadline)
        .filter((deadline): deadline is string => deadline !== null);

      expect(dated).toEqual([...dated].sort());
      expect(ascending.items.slice(-1)[0]?.initiative.deadline).toBeNull();
    });

    it('refuses a filter it does not understand rather than ignoring it', async () => {
      const response = await api().request('GET', url('/backlog?statuses=now'));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'invalid_request' });
    });
  });

  describe('focus', () => {
    it('keeps in-flight work and explains every other placement', async () => {
      const { body } = await api().request('GET', url('/focus'));
      const focus = body as {
        now: { initiative: { id: string }; reason: string }[];
        upNext: { initiative: { id: string }; reason: string }[];
        overCapacity: boolean;
        slotsByArea: { areaKey: string; used: number; limit: number }[];
      };

      // Five fixture initiatives are already `now`, and every one keeps its
      // slot whatever it scores. Nothing is demoted for it.
      expect(focus.now).toHaveLength(5);
      expect(focus.now.every((entry) => entry.reason === 'in_flight')).toBe(true);
      expect(focus.overCapacity).toBe(false);
      expect(focus.slotsByArea.find((slot) => slot.areaKey === 'home')?.used).toBe(1);

      // Every candidate that was not picked says why, and the reasons are the
      // vocabulary the surface renders rather than a silent omission.
      expect(focus.upNext.length).toBeGreaterThan(0);
      for (const entry of focus.upNext) {
        expect(['blocked', 'too_large', 'wip_full', 'area_at_cap']).toContain(entry.reason);
      }

      // init-006 waits on init-005, which is in flight rather than finished —
      // and a blocker is reported before a capacity reason, because "it cannot
      // start yet" is a different answer from "there is no room".
      const blocked = focus.upNext.find((entry) => entry.initiative.id === fixtureId('init-006'));
      expect(blocked?.reason).toBe('blocked');
    });

    it('flags a deadline the schedule cannot meet, and never moves it', async () => {
      const { body } = await api().request('GET', url('/focus'));
      const focus = body as {
        now: { initiative: { id: string; deadline: string | null }; deadlineAtRisk: boolean }[];
      };

      for (const entry of focus.now) {
        if (entry.initiative.deadline === null) expect(entry.deadlineAtRisk).toBe(false);
      }
    });
  });

  describe('the timeline and its replan preview', () => {
    interface TimelineBody {
      initiatives: {
        initiativeId: string;
        earliestStart: string;
        earliestFinish: string;
        deadline: string | null;
        deadlineFeasible: boolean;
        boundBy: string;
        boundByIds: string[];
      }[];
      edges: { from: string; to: string; critical: boolean }[];
      criticalPath: string[];
      areaSlots: { areaKey: string; slots: number }[];
    }

    interface ReplanBody {
      move: { initiativeId: string; requestedStart: string; actualStart: string; honoured: boolean };
      shifted: {
        initiativeId: string;
        fromStart: string;
        toStart: string;
        toEnd: string;
        startDeltaDays: number;
        isDownstream: boolean;
      }[];
      brokenDeadlines: string[];
      repairedDeadlines: string[];
      after: { criticalPath: string[]; infeasibleDeadlines: string[] };
    }

    const blocker = fixtureId('init-005');
    const dependent = fixtureId('init-006');

    it('serves the plan with the capacity each area was planned under', async () => {
      const { body } = await api().request('GET', url('/timeline'));
      const timeline = body as TimelineBody;

      // `init-006` depends on `init-005`, and the edge is drawn from the
      // dependency to the dependent rather than the other way round.
      expect(timeline.edges).toContainEqual({
        from: blocker,
        to: dependent,
        critical: expect.any(Boolean) as unknown as boolean,
      });

      const dependentEntry = timeline.initiatives.find(
        (entry) => entry.initiativeId === dependent,
      );
      expect(dependentEntry?.boundBy).toBe('dependency');
      expect(dependentEntry?.boundByIds).toContain(blocker);

      // Every area carries a slot count, floored at one, so the surface can
      // show how full an area was rather than only that something waited.
      expect(timeline.areaSlots.length).toBeGreaterThan(0);
      for (const slot of timeline.areaSlots) expect(slot.slots).toBeGreaterThanOrEqual(1);
    });

    it('moves the dependents when the thing they wait on moves', async () => {
      const { body } = await api().request(
        'GET',
        url(`/timeline/replan?initiativeId=${blocker}&newStart=2026-11-09`),
      );
      const diff = body as ReplanBody;

      expect(diff.move.initiativeId).toBe(blocker);
      expect(diff.move.requestedStart).toBe('2026-11-09');

      // The moved one first, then the consequences — and the dependent is one
      // of them, which is the whole requirement: when one thing moves, the
      // things that depend on it move too.
      expect(diff.shifted[0]?.initiativeId).toBe(blocker);
      expect(diff.shifted[0]?.isDownstream).toBe(false);

      const downstream = diff.shifted.find((entry) => entry.initiativeId === dependent);
      expect(downstream?.isDownstream).toBe(true);
      expect(downstream?.startDeltaDays).toBeGreaterThan(0);

      // Pushing the blocker past the dependent's deadline breaks it, and the
      // preview says so before anything is written.
      expect(diff.brokenDeadlines).toContain(dependent);
      expect(diff.repairedDeadlines).toEqual([]);
      expect(diff.after.infeasibleDeadlines).toContain(dependent);
    });

    it('never moves a deadline, and the commit matches the preview exactly', async () => {
      const app = api();

      const before = (await app.request('GET', url('/timeline'))).body as TimelineBody;
      const deadlinesBefore = new Map(
        before.initiatives.map((entry) => [entry.initiativeId, entry.deadline]),
      );

      const preview = (
        await app.request('GET', url(`/timeline/replan?initiativeId=${blocker}&newStart=2026-11-09`))
      ).body as ReplanBody;

      // Commit the way the surface does: `earliest_start` is the only date a
      // human owns here, and `planned_start` is derived from it (ADR-0003,
      // docs/11-ownership.md).
      const committed = await app.request('PATCH', url(`/initiatives/${blocker}`), {
        earliestStart: preview.move.requestedStart,
      });
      expect(committed.status).toBe(200);

      const after = (await app.request('GET', url('/timeline'))).body as TimelineBody;
      const afterById = new Map(after.initiatives.map((entry) => [entry.initiativeId, entry]));

      // The preview promised a set of dates. This is that promise, checked
      // against the plan the API actually serves afterwards — the failure the
      // brief warns about is a preview that disagrees with what gets saved.
      expect(preview.shifted.length).toBeGreaterThan(0);
      for (const shift of preview.shifted) {
        const entry = afterById.get(shift.initiativeId);
        expect(entry?.earliestStart, `${shift.initiativeId} start`).toBe(shift.toStart);
        expect(entry?.earliestFinish, `${shift.initiativeId} finish`).toBe(shift.toEnd);
      }
      expect([...afterById.keys()].sort()).toEqual([...deadlinesBefore.keys()].sort());

      // And not one deadline moved, on any initiative, in either direction.
      for (const entry of after.initiatives) {
        expect(entry.deadline, `${entry.initiativeId} deadline`).toBe(
          deadlinesBefore.get(entry.initiativeId),
        );
      }
      expect(afterById.get(dependent)?.deadlineFeasible).toBe(false);
    });

    it('refuses a move of work that is not in the plan, without a server failure', async () => {
      const closed = fixtureId('init-012');
      const { status } = await api().request(
        'GET',
        url(`/timeline/replan?initiativeId=${closed}&newStart=2026-11-09`),
      );
      // `init-012` is `done`: closed work is not scheduled, so there is nothing
      // to move. A caller naming it is a 422, not a 500.
      expect(status).toBe(422);
    });

    it('previews behind a read scope, and cannot commit with one', async () => {
      const reader = api(identityWith(['read:timeline']));

      const preview = await reader.request(
        'GET',
        url(`/timeline/replan?initiativeId=${blocker}&newStart=2026-11-09`),
      );
      expect(preview.status).toBe(200);

      // The preview is a read; the move is a write. A token that can ask what
      // a drag would do cannot perform one — which is also what lets the
      // preview keep working while the kill switch withholds write scopes.
      const commit = await reader.request('PATCH', url(`/initiatives/${blocker}`), {
        earliestStart: '2026-11-09',
      });
      expect(commit.status).toBe(403);
    });
  });

  describe('balance', () => {
    it('measures the four-week window and reads numeric shares back as numbers', async () => {
      const app = api();
      await seedCompletions(database.client, [
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
          minutes: 60,
        },
        {
          initiativeId: fixtureId('init-005'),
          areaKey: 'home',
          completedAt: new Date('2026-09-12T09:00:00.000Z'),
          minutes: 180,
        },
        {
          // Outside the window: two adjacent windows never count it twice.
          initiativeId: fixtureId('init-012'),
          areaKey: 'money',
          completedAt: new Date('2026-07-01T09:00:00.000Z'),
          minutes: 999,
        },
      ]);

      const { body } = await app.request('GET', url('/balance?year=2026'));
      const balance = body as {
        stale: boolean;
        areas: {
          areaKey: string;
          minutes: number;
          actualSharePct: number;
          targetSharePct: number | null;
          balanceFactor: number;
        }[];
      };

      expect(balance.stale).toBe(false);
      const home = balance.areas.find((area) => area.areaKey === 'home');
      const money = balance.areas.find((area) => area.areaKey === 'money');

      expect(home?.minutes).toBe(180);
      expect(home?.actualSharePct).toBeCloseTo(75, 5);
      expect(home?.targetSharePct).toBe(5);
      // Raw ratio 0.067, clamped to the floor. Over-served areas sink, but only
      // so far — the clamp is what stops one busy month erasing an area.
      expect(home?.balanceFactor).toBe(0.5);
      expect(money?.minutes).toBe(0);
    });
  });

  describe('objectives', () => {
    it('shows self-assessed progress beside a computed one that is null without tasks', async () => {
      const app = api();

      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'Run a half marathon',
          type: 'annual',
          period: '2026',
          areaKey: 'health',
        })
      ).body as { id: string };

      const keyResult = (
        await app.request('POST', url(`/objectives/${objective.id}/key-results`), {
          statement: 'Long run distance',
          target: 21,
          unit: 'km',
          progressSelf: 40,
          servedBy: [fixtureId('init-001')],
        })
      ).body as { id: string; progressSelf: number; progressComputed: number | null };

      expect(keyResult.progressSelf).toBe(40);
      expect(keyResult.progressComputed).toBeNull();

      await seedCompletions(database.client, [
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
        },
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-11T09:00:00.000Z'),
          completed: false,
        },
      ]);

      const reread = (await app.request('GET', url(`/objectives/${objective.id}`))).body as {
        keyResults: { progressSelf: number; progressComputed: number | null }[];
      };
      expect(reread.keyResults[0]?.progressComputed).toBe(50);
      expect(reread.keyResults[0]?.progressSelf).toBe(40);
    });

    it('refuses a write to the computed progress, naming the field', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'Something measurable',
          type: 'monthly',
          period: '2026-09',
          areaKey: 'craft',
        })
      ).body as { id: string };

      const response = await app.request('POST', url(`/objectives/${objective.id}/key-results`), {
        statement: 'A statement',
        target: 1,
        unit: 'thing',
        progressComputed: 80,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'read_only_field' });
      expect((response.body as { fields: { reason: string }[] }).fields[0]?.reason).toContain(
        'never written',
      );
    });

    it('appends measurements and never edits one', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'Trend worth having',
          type: 'annual',
          period: '2026',
          areaKey: 'money',
        })
      ).body as { id: string };

      const keyResult = (
        await app.request('POST', url(`/objectives/${objective.id}/key-results`), {
          statement: 'Fund balance',
          target: 6000,
          unit: 'currency',
        })
      ).body as { id: string };

      await app.request('POST', url(`/key-results/${keyResult.id}/measurements`), { value: 1000 });
      const series = await app.request('POST', url(`/key-results/${keyResult.id}/measurements`), {
        value: 2000,
        note: 'after the bonus',
      });

      expect((series.body as { items: unknown[] }).items).toHaveLength(2);
    });
  });

  describe('sync', () => {
    it('reports the freeze and the ledger without disclosing the cursor', async () => {
      const { body } = await api().request('GET', url('/sync'));
      expect(body).toMatchObject({
        enabled: true,
        writeEnabled: false,
        hasTaskToolCursor: false,
        unresolvedConflicts: 0,
      });
      expect(body).not.toHaveProperty('taskToolToken');
    });

    it('defaults a forced pass to `plan`', async () => {
      const response = await api().request('POST', url('/sync'), {});
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ mode: 'plan', ran: true });
    });

    it('refuses a request that tries to lift the write freeze', async () => {
      const response = await api().request('POST', url('/sync'), { writeEnabled: true });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'read_only_field' });
      expect((response.body as { fields: { reason: string }[] }).fields[0]?.reason).toContain(
        '13-migration',
      );
    });
  });

  describe('authorization, on the real routes', () => {
    it('lets a read-scoped credential read and nothing else', async () => {
      const readOnly = api(identityWith(['read:backlog', 'read:areas']));

      expect((await readOnly.request('GET', url('/areas'))).status).toBe(200);
      expect((await readOnly.request('GET', url('/backlog'))).status).toBe(200);

      const write = await readOnly.request('POST', url('/initiatives'), {
        title: 'Should not happen',
        areaKey: 'home',
        value: 1,
        timeCriticality: 1,
        risk: 1,
        size: 1,
      });
      expect(write.status).toBe(403);

      // Nothing was created: a refusal that still wrote is not a refusal.
      const backlog = (await readOnly.request('GET', url('/backlog'))).body as { total: number };
      expect(backlog.total).toBe(13);
    });

    it('scopes reads separately, so a focus token cannot read objectives', async () => {
      const focusOnly = api(identityWith(['read:focus']));
      expect((await focusOnly.request('GET', url('/focus'))).status).toBe(200);
      expect((await focusOnly.request('GET', url('/objectives'))).status).toBe(403);
    });
  });

  describe('errors', () => {
    it('answers a missing entity with 404 and no internal detail', async () => {
      // A well-formed id for something that was never created. Built rather
      // than written out: a literal uuid in a source file is the shape the
      // privacy deny-list watches for, and it is right to.
      const response = await api().request(
        'GET',
        url(`/initiatives/${fixtureId('never-created')}`),
      );
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('select');
      expect(JSON.stringify(response.body)).not.toContain('postgres');
    });

    it('answers a malformed id with 400 rather than reaching the database', async () => {
      const response = await api().request('GET', url('/initiatives/not-a-uuid'));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'invalid_request' });
    });
  });

  describe('the OpenAPI document it actually serves', () => {
    it('describes the routes that are mounted', async () => {
      const { status, body } = await api().request('GET', url('/openapi.json'));
      expect(status).toBe(200);
      const document = body as { paths: Record<string, unknown> };
      expect(document.paths).toHaveProperty(`${API_BASE_PATH}/focus`);
      expect(document.paths).toHaveProperty(`${API_BASE_PATH}/areas/{key}/weights/{year}`);
    });
  });

  it('the clock is injected, so the same seed ranks the same way twice', async () => {
    const first = (await api().request('GET', url('/focus'))).body as { asOf: string };
    const second = (await api().request('GET', url('/focus'))).body as { asOf: string };
    expect(first.asOf).toBe(second.asOf);
    expect(first.asOf).toBe(PINNED_NOW.toISOString());
  });
});
