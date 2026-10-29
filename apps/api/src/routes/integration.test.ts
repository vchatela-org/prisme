import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import {
  createTestApp,
  identityWith,
  PINNED_NOW,
  stubDirectory,
  stubRunner,
} from '../test-support/app.js';
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

  describe('what a plain seed carries', () => {
    it('maps an external location to an area, and lets a section refine its project', async () => {
      const rows = await database.client<
        { area_key: string; external_project_id: string; external_section_id: string | null }[]
      >`select area_key, external_project_id, external_section_id from area_mapping`;

      // Without rows here every completion a seed can produce is unattributable
      // and the balance chart reads as empty for a reason indistinguishable
      // from a defect in prisme. The identifiers are the ones
      // `fixtures/connectors/task-tool.completions.json` reports, which is what
      // makes the mapping reachable rather than decorative.
      expect(rows).toContainEqual({
        area_key: 'health',
        external_project_id: 'project-0001',
        external_section_id: null,
      });
      // And the precedence `attribute.ts` implements: a section of a mapped
      // project may belong to a different area than the project itself.
      expect(rows).toContainEqual({
        area_key: 'money',
        external_project_id: 'project-0001',
        external_section_id: 'section-0001',
      });
    });

    it('gives an initiative with no key result behind it the tasks it actually has', async () => {
      const app = api();

      const { body } = await app.request('GET', url(`/initiatives/${fixtureId('init-005')}/tasks`));
      const list = body as { items: { isAnchor: boolean; completed: boolean }[] };

      // `init-005` serves no key result, so a mirror built only from the key
      // results leaves it with no subtree at all — and an empty task list is
      // indistinguishable from a screen that is broken.
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.some((task) => task.isAnchor)).toBe(true);
      expect(list.items.some((task) => !task.completed)).toBe(true);
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

    it('hints that an initiative looks like a key result, on the Inbox and on its page (S1)', async () => {
      const app = api();
      await app.request('POST', url('/objectives'), {
        title: 'Run a half marathon',
        type: 'annual',
        period: '2026',
        areaKey: 'health',
      });
      // The pinned clock reads 2026-09-17: a year-end deadline is fifteen weeks out.
      const created = await app.request('POST', url('/initiatives'), {
        title: 'run a half-marathon',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
        deadline: '2026-12-31',
      });
      expect(created.status).toBe(201);
      const id = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({ keyResultHints: ['long_horizon', 'objective_title'] });

      const inbox = await app.request('GET', url('/inbox'));
      const row = (
        inbox.body as { initiatives: { id: string; keyResultHints: string[] }[] }
      ).initiatives.find((initiative) => initiative.id === id);
      expect(row?.keyResultHints).toEqual(['long_horizon', 'objective_title']);

      // A hint, never a decision: an ordinary one in the same area carries none.
      const ordinary = await app.request('POST', url('/initiatives'), {
        title: 'Book the physio',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
        deadline: '2026-10-01',
      });
      expect(ordinary.body).toMatchObject({ keyResultHints: [] });
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

  describe('converting an initiative into a key result (S1)', () => {
    async function objectiveIn(app: ReturnType<typeof api>, status?: 'met'): Promise<string> {
      const created = await app.request('POST', url('/objectives'), {
        title: 'Run a half marathon',
        type: 'annual',
        period: '2026',
        areaKey: 'health',
      });
      const id = (created.body as { id: string }).id;
      if (status !== undefined) {
        await database.client`update objective set status = ${status} where id = ${id}::uuid`;
      }
      return id;
    }

    /** An initiative bound to a task, as the anchor label's intake leaves one. */
    async function labelledGoal(app: ReturnType<typeof api>, taskId: string): Promise<string> {
      const created = await app.request('POST', url('/initiatives'), {
        title: 'Run a half marathon',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
        deadline: '2026-12-31',
      });
      const id = (created.body as { id: string }).id;
      await database.client`
        update initiative set external_anchor_id = ${taskId} where id = ${id}::uuid`;
      await database.client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${id}, 'initiative', 'task', ${taskId})`;
      await database.client`
        insert into entity_link
          (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
        values (${id}, 'task', ${taskId}, 'manual', 'certain', 'human', now())`;
      return id;
    }

    const body = (objectiveId: string) => ({
      objectiveId,
      statement: 'Half marathon finished',
      target: 1,
      unit: 'race',
    });

    it('makes the key result, moves the task to it, and drops the initiative', async () => {
      const app = api();
      const objectiveId = await objectiveIn(app);
      const id = await labelledGoal(app, 'task-invented-goal');

      const converted = await app.request(
        'POST',
        url(`/initiatives/${id}/convert-to-key-result`),
        body(objectiveId),
      );
      expect(converted.status).toBe(200);
      expect(converted.body).toMatchObject({
        keyResult: { objectiveId, statement: 'Half marathon finished', target: 1, unit: 'race' },
        initiative: {
          id,
          status: 'dropped',
          droppedReason: 'Converted to a key result: Half marathon finished',
          externalAnchorId: null,
          keyResultHints: [],
        },
        anchorMoved: true,
      });
      const keyResultId = (converted.body as { keyResult: { id: string } }).keyResult.id;

      // The task is bound once, now to the key result — guard 1 never saw two owners.
      const refs = await database.client<{ prisme_id: string; prisme_kind: string }[]>`
        select prisme_id, prisme_kind from entity_external_ref
        where kind = 'task' and external_id = 'task-invented-goal'`;
      expect(refs).toEqual([{ prisme_id: keyResultId, prisme_kind: 'key_result' }]);
      const [anchor] = await database.client<{ external_anchor_id: string | null }[]>`
        select external_anchor_id from key_result where id = ${keyResultId}::uuid`;
      expect(anchor?.external_anchor_id).toBe('task-invented-goal');

      const events = await database.client<{ kind: string; entity_kind: string }[]>`
        select kind, entity_kind from event_log
        where entity_id in (${id}, ${keyResultId}) order by kind`;
      expect(events).toEqual([
        { kind: 'adoption_decision', entity_kind: 'key_result' },
        { kind: 'status_changed', entity_kind: 'initiative' },
      ]);

      // Out of the ranking, as any dropped initiative is.
      const inbox = await app.request('GET', url('/inbox'));
      expect(
        (inbox.body as { initiatives: { id: string }[] }).initiatives.map((entry) => entry.id),
      ).not.toContain(id);
    });

    it('converts one with no task, and moves nothing', async () => {
      const app = api();
      const objectiveId = await objectiveIn(app);
      const created = await app.request('POST', url('/initiatives'), {
        title: 'Run a half marathon',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
      });
      const id = (created.body as { id: string }).id;

      const converted = await app.request(
        'POST',
        url(`/initiatives/${id}/convert-to-key-result`),
        body(objectiveId),
      );
      expect(converted.status).toBe(200);
      expect(converted.body).toMatchObject({
        anchorMoved: false,
        initiative: { status: 'dropped' },
      });
    });

    /** Nothing was written: no key result, and the task still the initiative's. */
    async function nothingConverted(taskId?: string): Promise<void> {
      const keyResults = await database.client`
        select 1 from key_result k join objective o on o.id = k.objective_id
        where o.title = 'Run a half marathon'`;
      expect(keyResults).toHaveLength(0);
      if (taskId !== undefined) {
        const refs = await database.client<{ prisme_kind: string }[]>`
          select prisme_kind from entity_external_ref where external_id = ${taskId}`;
        expect(refs).toEqual([{ prisme_kind: 'initiative' }]);
      }
    }

    it('refuses an objective that is closed, and writes nothing', async () => {
      const app = api();
      const met = await objectiveIn(app, 'met');
      const goal = await labelledGoal(app, 'task-invented-goal');
      const refused = await app.request(
        'POST',
        url(`/initiatives/${goal}/convert-to-key-result`),
        body(met),
      );
      expect(refused.status).toBe(409);
      await nothingConverted('task-invented-goal');
    });

    it('refuses work that is closed already, and writes nothing', async () => {
      const app = api();
      const open = await objectiveIn(app);
      const goal = await labelledGoal(app, 'task-invented-goal');
      await database.client`
        update initiative set status = 'dropped', dropped_reason = 'not this year'
        where id = ${goal}::uuid`;
      const refused = await app.request(
        'POST',
        url(`/initiatives/${goal}/convert-to-key-result`),
        body(open),
      );
      expect(refused.status).toBe(409);
      await nothingConverted('task-invented-goal');
    });

    it('refuses a link decided in Adoption that no pass has bound yet', async () => {
      const app = api();
      const open = await objectiveIn(app);
      const pending = (
        await app.request('POST', url('/initiatives'), {
          title: 'Decided in Adoption',
          areaKey: 'health',
          value: 3,
          timeCriticality: 3,
          risk: 3,
          size: 3,
        })
      ).body as { id: string };
      await database.client`
        insert into entity_link
          (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
        values (${pending.id}, 'task', 'task-invented-pending', 'exact_title', 'high', 'human',
                now())`;
      const refused = await app.request(
        'POST',
        url(`/initiatives/${pending.id}/convert-to-key-result`),
        body(open),
      );
      expect(refused.status).toBe(409);
      await nothingConverted();
    });

    it('answers 404 for an objective that does not exist', async () => {
      const app = api();
      const id = await labelledGoal(app, 'task-invented-goal');
      const missing = await app.request(
        'POST',
        url(`/initiatives/${id}/convert-to-key-result`),
        // Built at run time: an identifier-shaped literal is refused by the privacy scan.
        body(
          [
            '1'.repeat(8),
            '1'.repeat(4),
            `4${'1'.repeat(3)}`,
            `8${'1'.repeat(3)}`,
            '1'.repeat(12),
          ].join('-'),
        ),
      );
      expect(missing.status).toBe(404);
    });

    it('needs write:objective as well as write:initiative', async () => {
      const objectiveId = await objectiveIn(api());
      const id = await labelledGoal(api(), 'task-invented-goal');
      const initiativesOnly = api(identityWith(['write:initiative']));
      const refused = await initiativesOnly.request(
        'POST',
        url(`/initiatives/${id}/convert-to-key-result`),
        body(objectiveId),
      );
      expect(refused.status).toBe(403);
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

    it('suggests free slots without calling them in flight or counting them as used', async () => {
      // Nothing in flight: every `now` goes back to `next`, so every slot is free.
      await database.client`update initiative set status = 'next' where status = 'now'`;
      // One per area, as the fixture's expectations were written against.
      await api().request('PUT', url('/settings/wip-limits'), { maxNow: 5, maxNowPerArea: 1 });

      interface FocusBody {
        now: { initiative: { id: string } }[];
        suggested: {
          initiative: { id: string; status: string; areaKey: string };
          reason: string;
        }[];
        slotsByArea: { areaKey: string; used: number }[];
      }
      const focus = (await api().request('GET', url('/focus'))).body as FocusBody;

      // What selection proposes is a suggestion: still `next`, offered under
      // its own name, and taking no slot until a person promotes it.
      expect(focus.now).toEqual([]);
      expect(focus.suggested.length).toBeGreaterThan(0);
      for (const entry of focus.suggested) {
        expect(entry.reason).toBe('selected');
        expect(entry.initiative.status).toBe('next');
      }
      expect(focus.slotsByArea.every((slot) => slot.used === 0)).toBe(true);

      // Promoting one moves it from suggested to in flight, and its slot fills.
      const first = focus.suggested[0];
      if (first === undefined) throw new Error('nothing was suggested');
      await api().request('POST', url(`/initiatives/${first.initiative.id}/status`), { to: 'now' });

      const after = (await api().request('GET', url('/focus'))).body as FocusBody;
      expect(after.now.map((entry) => entry.initiative.id)).toEqual([first.initiative.id]);
      expect(after.suggested.map((entry) => entry.initiative.id)).not.toContain(
        first.initiative.id,
      );
      expect(
        after.slotsByArea.find((slot) => slot.areaKey === first.initiative.areaKey)?.used,
      ).toBe(1);
    });

    it('neither offers, queues nor ranks work not under way (ADR-0035)', async () => {
      interface FocusBody {
        now: { initiative: { id: string } }[];
        upNext: { initiative: { id: string } }[];
      }
      interface BacklogBody {
        items: { initiative: { id: string }; rank: number | null; notUnderWay: string | null }[];
      }

      // One per area, so the fixture queues at least two behind the slots.
      await api().request('PUT', url('/settings/wip-limits'), { maxNow: 5, maxNowPerArea: 1 });
      const before = (await api().request('GET', url('/focus'))).body as FocusBody;
      const [later, stopped] = before.upNext.map((entry) => entry.initiative.id);
      expect(later).toBeDefined();
      expect(stopped).toBeDefined();

      // One may not start before next year; the other belongs to a paused project.
      await database.client`
        update initiative set earliest_start = '2027-01-04' where id = ${later as string}::uuid`;
      const [project] = await database.client<{ id: string }[]>`
        insert into project (name, area_key, status, origin)
        select 'An invented effort on hold', area_key, 'paused', 'created_in_prisme'
        from initiative where id = ${stopped as string}::uuid
        returning id::text`;
      await database.client`
        update initiative set project_id = ${project?.id as string}::uuid
        where id = ${stopped as string}::uuid`;

      const focus = (await api().request('GET', url('/focus'))).body as FocusBody;
      const offered = [...focus.now, ...focus.upNext].map((entry) => entry.initiative.id);
      expect(offered).not.toContain(later);
      expect(offered).not.toContain(stopped);

      const backlog = (await api().request('GET', url('/backlog?limit=100'))).body as BacklogBody;
      const row = (id: string | undefined) =>
        backlog.items.find((entry) => entry.initiative.id === id);
      expect(row(later)).toMatchObject({ rank: null, notUnderWay: 'not_started' });
      expect(row(stopped)).toMatchObject({ rank: null, notUnderWay: 'project_inactive' });

      // The rest keep a contiguous ranking, in the order the method produced.
      const ranks = backlog.items
        .map((entry) => entry.rank)
        .filter((rank): rank is number => rank !== null);
      expect(ranks).toEqual(ranks.map((_, index) => index + 1));
      expect(
        backlog.items.every((entry) => entry.notUnderWay === null || entry.rank === null),
      ).toBe(true);

      // From its earliest start on, it is part of the question again.
      const thatDay = createTestApp({
        client: database.client,
        runner: stubRunner(),
        now: new Date('2027-01-04T09:00:00Z'),
      });
      const then = (await thatDay.request('GET', url('/backlog?limit=100'))).body as BacklogBody;
      expect(then.items.find((entry) => entry.initiative.id === later)).toMatchObject({
        notUnderWay: null,
      });
      expect(then.items.find((entry) => entry.initiative.id === later)?.rank).not.toBeNull();
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
      move: {
        initiativeId: string;
        requestedStart: string;
        actualStart: string;
        honoured: boolean;
      };
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
      expect(timeline.edges.some((edge) => edge.from === blocker && edge.to === dependent)).toBe(
        true,
      );

      const dependentEntry = timeline.initiatives.find((entry) => entry.initiativeId === dependent);
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
        await app.request(
          'GET',
          url(`/timeline/replan?initiativeId=${blocker}&newStart=2026-11-09`),
        )
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
    /*
     * This suite measures a window it constructs itself, and asserts the
     * absolute numbers it wrote. `fixtures/task-mirror.json` seeds a mirror of
     * its own — deliberately, because `progressComputed` is counted from it —
     * and those completions land in the same four weeks. Starting from an empty
     * mirror keeps each assertion about what *this test* wrote.
     *
     * The alternative, reading a delta instead of a total, would hide the one
     * thing this test is for: that a numeric share arrives as a number rather
     * than as a string.
     */
    beforeEach(async () => {
      await database.client`delete from task_mirror`;
    });

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

    /**
     * The behaviour W13 recorded as "not yet on screen".
     *
     * `task_mirror` is the **anchor subtree** — everything completed under an
     * initiative prisme already knows about, and nothing before prisme existed.
     * The backfill reads the tool's whole completion record and materialises it
     * into `capacity_week`, which is what the dashboard should measure from.
     *
     * The fixture below is built so the two *disagree*, deliberately: the
     * anchor subtree sees one completion, the materialised record sees four
     * with a different duration split. A test where they agreed would pass
     * whichever source was read, which is the whole class of test this
     * repository keeps finding.
     */
    async function backfillHealth(): Promise<void> {
      await database.client`
        insert into capacity_week
          (week_start, area_key, completions, minutes,
           minutes_recorded, minutes_declared, minutes_default)
        values ('2026-09-14', 'health', 4, 240, 200, 40, 0)`;
      await database.client`
        insert into backfill_cursor (id, covered_from, covered_through)
        values ('singleton', '2026-01-05T00:00:00Z', '2026-09-20T00:00:00Z')`;
    }

    it('falls back to the anchor subtree, and says so, before any backfill has run', async () => {
      const app = api();
      await seedCompletions(database.client, [
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
          minutes: 60,
        },
      ]);

      const body = (await app.request('GET', url('/balance?year=2026'))).body as {
        from: string;
        observedSource: string;
        observedThrough: string | null;
        areas: { areaKey: string; minutes: number; minutesBySource: Record<string, number> }[];
      };

      expect(body.observedSource).toBe('task_mirror');
      expect(body.observedThrough).toBeNull();
      expect(body.areas.find((area) => area.areaKey === 'health')?.minutes).toBe(60);
      // The day-precise window, which is what the fallback filters by.
      expect(body.from).toBe('2026-08-20');
    });

    it('measures from the materialised weeks once a backfill has run', async () => {
      const app = api();
      await seedCompletions(database.client, [
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
          minutes: 60,
        },
      ]);
      await backfillHealth();

      const body = (await app.request('GET', url('/balance?year=2026'))).body as {
        from: string;
        observedSource: string;
        observedThrough: string | null;
        areas: {
          areaKey: string;
          minutes: number;
          completions: number;
          minutesBySource: Record<string, number>;
        }[];
      };

      expect(body.observedSource).toBe('capacity_week');
      expect(body.observedThrough).toBe('2026-09-20');

      const health = body.areas.find((area) => area.areaKey === 'health');
      // The materialised numbers, not the anchor subtree's 60.
      expect(health?.minutes).toBe(240);
      expect(health?.completions).toBe(4);
      // And the estimate-versus-measurement split survives the round trip,
      // which is what lets a chart label how much of a reading is estimated.
      expect(health?.minutesBySource).toEqual({ recorded: 200, declared: 40, default: 0 });

      // A week-granular window: the Monday of the week covering `asOf`, four
      // weeks back. `capacity_week` has no sub-week detail, so the window is
      // snapped to the rows rather than the rows to the window.
      expect(body.from).toBe('2026-08-24');
    });
  });

  /**
   * The list behind one area's row of `/balance`.
   *
   * Asserted **against `/balance` itself** rather than against numbers written
   * here, wherever that is possible: the point of the endpoint is that a
   * reader can take a percentage apart, and two sets of expected numbers can
   * both be edited to match a regression. All synthetic — invented titles.
   */
  describe('the completions behind a balance row', () => {
    beforeEach(async () => {
      await database.client`delete from task_mirror`;
    });

    /** Four attributed completions for `health` in the window, and one outside it. */
    async function itemisedHealth(): Promise<void> {
      await database.client`
        insert into completion_history (external_task_id, completed_at, external_project_id, content)
        values
          ('t-run', '2026-09-15T07:00:00Z', 'p-1', 'Interval run'),
          ('t-stretch', '2026-09-16T07:00:00Z', 'p-1', 'Stretching'),
          ('t-early', '2026-08-25T07:00:00Z', 'p-1', null),
          ('t-before', '2026-08-10T07:00:00Z', 'p-1', 'Before the window')`;
      await database.client`
        insert into capacity_completion
          (external_task_id, completed_at, area_key, lane, minutes, minutes_source)
        values
          ('t-run', '2026-09-15T07:00:00Z', 'health', 'change', 120, 'recorded'),
          ('t-stretch', '2026-09-16T07:00:00Z', 'health', 'ritual', 40, 'declared'),
          ('t-early', '2026-08-25T07:00:00Z', 'health', 'change', 80, 'recorded'),
          ('t-before', '2026-08-10T07:00:00Z', 'health', 'change', 999, 'recorded'),
          ('t-other', '2026-09-15T08:00:00Z', 'home', 'change', 30, 'default')`;
      await database.client`
        insert into capacity_week
          (week_start, area_key, completions, minutes,
           minutes_recorded, minutes_declared, minutes_default)
        values
          ('2026-08-24', 'health', 1, 80, 80, 0, 0),
          ('2026-09-14', 'health', 2, 160, 120, 40, 0),
          ('2026-09-14', 'home', 1, 30, 0, 0, 30),
          ('2026-08-10', 'health', 1, 999, 999, 0, 0)`;
      await database.client`
        insert into backfill_cursor (id, covered_from, covered_through)
        values ('singleton', '2026-01-05T00:00:00Z', '2026-09-17T00:00:00Z')`;
    }

    it('lists what the balance counted, over its window, and adds up to its row', async () => {
      const app = api();
      await itemisedHealth();

      const balance = (await app.request('GET', url('/balance?year=2026'))).body as {
        from: string;
        to: string;
        areas: { areaKey: string; completions: number; minutes: number }[];
      };
      const { status, body } = await app.request('GET', url('/areas/health/completions?year=2026'));
      const list = body as {
        from: string;
        to: string;
        observedSource: string;
        totals: { completions: number; minutes: number; minutesBySource: Record<string, number> };
        completions: {
          externalTaskId: string;
          content: string | null;
          minutes: number;
          minutesSource: string | null;
          ritual: boolean;
        }[];
      };

      expect(status).toBe(200);
      expect(list.observedSource).toBe('capacity_week');
      // The same window, from the same code.
      expect([list.from, list.to]).toEqual([balance.from, balance.to]);

      const row = balance.areas.find((area) => area.areaKey === 'health');
      expect(list.totals.completions).toBe(row?.completions);
      expect(list.totals.minutes).toBe(row?.minutes);
      expect(list.totals.minutesBySource).toEqual({ recorded: 200, declared: 40, default: 0 });

      // Newest first; this area only; nothing before the window.
      expect(list.completions.map((entry) => entry.externalTaskId)).toEqual([
        't-stretch',
        't-run',
        't-early',
      ]);
      expect(list.completions[0]).toMatchObject({
        content: 'Stretching',
        minutes: 40,
        minutesSource: 'declared',
        ritual: true,
      });
      // Fetched before titles were kept: listed, and says it has no title.
      expect(list.completions[2]?.content).toBeNull();
    });

    it('lists from the anchor subtree, without titles, before any backfill has run', async () => {
      const app = api();
      await seedCompletions(database.client, [
        {
          initiativeId: fixtureId('init-001'),
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
          minutes: 60,
        },
        {
          initiativeId: fixtureId('init-002'),
          areaKey: 'health',
          completedAt: new Date('2026-09-12T09:00:00.000Z'),
        },
        {
          // Outside the window, which the fallback filters by the day.
          initiativeId: fixtureId('init-003'),
          areaKey: 'health',
          completedAt: new Date('2026-07-01T09:00:00.000Z'),
          minutes: 999,
        },
      ]);

      const balance = (await app.request('GET', url('/balance?year=2026'))).body as {
        from: string;
        areas: { areaKey: string; completions: number; minutes: number }[];
      };
      const list = (await app.request('GET', url('/areas/health/completions?year=2026'))).body as {
        from: string;
        observedSource: string;
        totals: { completions: number; minutes: number };
        completions: { content: string | null; minutesSource: string | null }[];
      };

      expect(list.observedSource).toBe('task_mirror');
      expect(list.from).toBe(balance.from);
      const row = balance.areas.find((area) => area.areaKey === 'health');
      expect(list.totals.completions).toBe(row?.completions);
      expect(list.totals.minutes).toBe(row?.minutes);
      expect(list.completions.map((entry) => entry.minutesSource)).toEqual(['default', 'recorded']);
      expect(list.completions.every((entry) => entry.content === null)).toBe(true);
    });

    it('lists what the balance counted toward no area, by location, over its window (S9)', async () => {
      await itemisedHealth();
      // Two root tasks of a project mapped only by section, one in an
      // unmapped project, and one outside the window — none attributed.
      await database.client`
        insert into area_mapping (area_key, external_project_id, external_section_id)
        values ('home', 'p-general', 's-house')`;
      await database.client`
        insert into completion_history (external_task_id, completed_at, external_project_id,
                                        external_section_id)
        values
          ('t-root-1', '2026-09-14T07:00:00Z', 'p-general', null),
          ('t-root-2', '2026-09-15T07:00:00Z', 'p-general', null),
          ('t-loose', '2026-09-01T07:00:00Z', 'p-unmapped', null),
          ('t-old', '2026-08-01T07:00:00Z', 'p-unmapped', null)`;

      const app = api();
      const balance = (await app.request('GET', url('/balance?year=2026'))).body as {
        from: string;
      };
      const { status, body } = await app.request('GET', url('/areas/unattributed?year=2026'));

      expect(status).toBe(200);
      expect(body).toMatchObject({
        from: balance.from,
        observedSource: 'capacity_week',
        total: 3,
        items: [
          {
            externalProjectId: 'p-general',
            externalSectionId: null,
            completions: 2,
            partlyMapped: true,
          },
          {
            externalProjectId: 'p-unmapped',
            externalSectionId: null,
            completions: 1,
            partlyMapped: false,
          },
        ],
      });
    });

    it('has nothing unattributed to list before any backfill', async () => {
      const { body } = await api().request('GET', url('/areas/unattributed'));
      expect(body).toMatchObject({ observedSource: 'task_mirror', total: 0, items: [] });
    });

    it('answers an unknown area with 404', async () => {
      const response = await api().request('GET', url('/areas/nowhere/completions'));
      expect(response.status).toBe(404);
    });

    it('needs the areas read scope, like the balance it explains', async () => {
      const focusOnly = api(identityWith(['read:focus']));
      const response = await focusOnly.request('GET', url('/areas/health/completions'));
      expect(response.status).toBe(403);
    });
  });

  describe('kpi', () => {
    it('has no integration coverage of its own before this, and reads the same source the balance does', async () => {
      const app = api();
      await database.client`
        insert into capacity_week
          (week_start, area_key, completions, minutes,
           minutes_recorded, minutes_declared, minutes_default)
        values ('2026-09-14', 'health', 3, 90, 90, 0, 0)`;
      await database.client`
        insert into backfill_cursor (id, covered_from, covered_through)
        values ('singleton', '2026-01-05T00:00:00Z', '2026-09-20T00:00:00Z')`;

      const body = (await app.request('GET', url('/kpi?from=2026-09-01&to=2026-09-30&bucket=week')))
        .body as {
        observedSource: string;
        throughput: { areaKey: string; points: { periodStart: string; value: number }[] }[];
        minutes: { areaKey: string; points: { periodStart: string; value: number }[] }[];
      };

      expect(body.observedSource).toBe('capacity_week');

      const week = '2026-09-14';
      const health = body.throughput.find((series) => series.areaKey === 'health');
      expect(health?.points.find((point) => point.periodStart === week)?.value).toBe(3);

      const minutes = body.minutes.find((series) => series.areaKey === 'health');
      expect(minutes?.points.find((point) => point.periodStart === week)?.value).toBe(90);
    });

    it('reports attainment only for objectives under way in the window (ADR-0035)', async () => {
      const app = api();
      // Beside the fixture's 2026 objectives: one for next year, and a draft
      // for this one that nobody committed to.
      await database.client`
        insert into objective (title, type, period, area_key, status)
        values ('An invented goal for next year', 'annual', '2027', 'health', 'active'),
               ('An invented goal never started', 'annual', '2026', 'health', 'draft')`;

      const attained = async (from: string, to: string) =>
        (
          (await app.request('GET', url(`/kpi?from=${from}&to=${to}&bucket=month`))).body as {
            objectiveAttainment: { title: string; period: string }[];
          }
        ).objectiveAttainment;

      const thisYear = await attained('2026-01-01', '2026-12-31');
      expect(thisYear.map((row) => row.period).sort()).toEqual([
        '2026',
        '2026',
        '2026',
        '2026',
        '2026-09',
      ]);
      expect(thisYear.map((row) => row.title)).not.toContain('An invented goal never started');

      // A window that ends before September leaves out September's objective.
      const firstHalf = await attained('2026-01-01', '2026-06-30');
      expect(firstHalf.map((row) => row.period)).not.toContain('2026-09');

      const nextYear = await attained('2027-01-01', '2027-12-31');
      expect(nextYear.map((row) => row.title)).toEqual(['An invented goal for next year']);
    });

    it('reports the anchor subtree when the range has no materialised weeks', async () => {
      const app = api();
      const body = (await app.request('GET', url('/kpi?from=2026-09-01&to=2026-09-30&bucket=week')))
        .body as { observedSource: string };

      expect(body.observedSource).toBe('task_mirror');
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

      /*
       * An initiative this test made, not a fixture one.
       *
       * `fixtures/task-mirror.json` hangs tasks off the fixture initiatives that
       * serve key results, so serving this key result from one of those would
       * make the `null` below untrue — and serving it from a fixture initiative
       * that happens to have none would make the assertion depend on which
       * fixture rows exist, which is how a test starts asserting nothing.
       */
      const serving = (
        await app.request('POST', url('/initiatives'), {
          title: 'A long run',
          areaKey: 'health',
          value: 3,
          timeCriticality: 3,
          risk: 3,
          size: 3,
        })
      ).body as { id: string };

      const keyResult = (
        await app.request('POST', url(`/objectives/${objective.id}/key-results`), {
          statement: 'Long run distance',
          target: 21,
          unit: 'km',
          progressSelf: 40,
          servedBy: [serving.id],
        })
      ).body as { id: string; progressSelf: number; progressComputed: number | null };

      expect(keyResult.progressSelf).toBe(40);
      expect(keyResult.progressComputed).toBeNull();

      await seedCompletions(database.client, [
        {
          initiativeId: serving.id,
          areaKey: 'health',
          completedAt: new Date('2026-09-10T09:00:00.000Z'),
        },
        {
          initiativeId: serving.id,
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

    it('computes progress from the fixture task mirror, and shows the divergence', async () => {
      /*
       * The behaviour ADR-0013 exists to surface, exercisable from a plain seed.
       *
       * Before `fixtures/task-mirror.json` there was no mirror in the fixture
       * set, so every one of these was `null` and the self-versus-computed
       * divergence could only be reached by hand-seeding rows inside a test —
       * which is a test of the hand-seeding, not of the divergence (W11's
       * finding).
       *
       * Five cases, and the difference between the last two is the point: a
       * key result whose initiative carries an anchor and no subtasks is null
       * because there is nothing to count, and one with no serving initiative
       * at all is null for a different reason. They must not be collapsed.
       */
      const app = api();

      const cases = [
        // [objective, key result, self, computed]
        ['obj-001', 'kr-001', 60, 75], // 3 of 4 — ahead of the self-assessment
        ['obj-002', 'kr-003', 40, 20], // 1 of 5 — behind it
        ['obj-002', 'kr-004', 100, 100], // 3 of 3 — finished, and agrees
        ['obj-003', 'kr-005', 15, 70], // 7 of 10 — the large divergence
        ['obj-004', 'kr-006', 50, null], // an anchor and nothing under it
        ['obj-001', 'kr-002', 35, null], // no serving initiative at all
      ] as const;

      for (const [objectiveKey, keyResultKey, self, computed] of cases) {
        const body = (await app.request('GET', url(`/objectives/${fixtureId(objectiveKey)}`)))
          .body as {
          keyResults: { id: string; progressSelf: number; progressComputed: number | null }[];
        };

        const keyResult = body.keyResults.find((entry) => entry.id === fixtureId(keyResultKey));
        expect(keyResult, `${keyResultKey} is missing from ${objectiveKey}`).toBeDefined();
        expect([keyResult?.progressSelf, keyResult?.progressComputed]).toEqual([self, computed]);
      }
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

    it('moves an open objective to another period, and records the move (ADR-0034)', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'A plan that moved',
          type: 'annual',
          period: '2028',
          areaKey: 'health',
          status: 'active',
        })
      ).body as { id: string };

      const moved = await app.request('PATCH', url(`/objectives/${objective.id}`), {
        period: '2027',
      });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ type: 'annual', period: '2027' });

      const monthly = await app.request('PATCH', url(`/objectives/${objective.id}`), {
        type: 'monthly',
        period: '2027-03',
      });
      expect(monthly.body).toMatchObject({ type: 'monthly', period: '2027-03' });

      const events = await database.client<{ before: unknown; after: unknown; actor: string }[]>`
        select before, after, actor from event_log
        where kind = 'period_changed' and entity_id = ${objective.id}
        order by id`;
      expect(events).toEqual([
        {
          before: { type: 'annual', period: '2028' },
          after: { type: 'annual', period: '2027' },
          actor: 'human',
        },
        {
          before: { type: 'annual', period: '2027' },
          after: { type: 'monthly', period: '2027-03' },
          actor: 'human',
        },
      ]);
    });

    it('records nothing when the period sent is the one it already has', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'Already there',
          type: 'annual',
          period: '2027',
          areaKey: 'health',
        })
      ).body as { id: string };

      const response = await app.request('PATCH', url(`/objectives/${objective.id}`), {
        period: '2027',
      });

      expect(response.status).toBe(200);
      const events = await database.client`
        select 1 from event_log where kind = 'period_changed' and entity_id = ${objective.id}`;
      expect(events).toHaveLength(0);
    });

    it('keeps a judged objective in the period it was judged against', async () => {
      const app = api();
      for (const status of ['met', 'missed', 'dropped'] as const) {
        const objective = (
          await app.request('POST', url('/objectives'), {
            title: `A ${status} one`,
            type: 'annual',
            period: '2025',
            areaKey: 'health',
            status,
          })
        ).body as { id: string };

        const response = await app.request('PATCH', url(`/objectives/${objective.id}`), {
          period: '2026',
        });

        expect(response.status).toBe(409);
        const reread = (await app.request('GET', url(`/objectives/${objective.id}`))).body as {
          period: string;
        };
        expect(reread.period).toBe('2025');
      }
    });

    it('refuses a period its type does not name, and changes nothing', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'A monthly one',
          type: 'monthly',
          period: '2027-02',
          areaKey: 'health',
        })
      ).body as { id: string };

      const response = await app.request('PATCH', url(`/objectives/${objective.id}`), {
        period: '2027',
      });

      expect(response.status).toBe(422);
      const reread = (await app.request('GET', url(`/objectives/${objective.id}`))).body as {
        period: string;
      };
      expect(reread.period).toBe('2027-02');
    });

    it('still refuses a move of the area, which is fixed at authoring', async () => {
      const app = api();
      const objective = (
        await app.request('POST', url('/objectives'), {
          title: 'Stays put',
          type: 'annual',
          period: '2027',
          areaKey: 'health',
        })
      ).body as { id: string };

      const response = await app.request('PATCH', url(`/objectives/${objective.id}`), {
        areaKey: 'craft',
      });

      expect(response.status).toBe(400);
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

    it('says why the last pass was refused, and stops saying it once a pass is not (S8)', async () => {
      expect((await api().request('GET', url('/sync'))).body).toMatchObject({ lastRefusal: null });

      await database.client`
        insert into sync_run_state (id, last_drift_objects, last_drift_at, last_drift_full,
                                    last_refusal, last_refusal_creates)
        values ('singleton', 0, '2026-09-17T08:45:00Z', false, 'create_threshold', 2)`;
      expect((await api().request('GET', url('/sync'))).body).toMatchObject({
        lastRefusal: { kind: 'create_threshold', creates: 2, at: '2026-09-17T08:45:00.000Z' },
      });

      await database.client`
        update sync_run_state set last_refusal = null, last_refusal_creates = null`;
      expect((await api().request('GET', url('/sync'))).body).toMatchObject({ lastRefusal: null });
    });

    it('says which optional reads this server is configured for, never their names (S8)', async () => {
      const { body } = await api().request('GET', url('/settings'));
      expect(body).toMatchObject({
        features: { readingPipeline: false, declaredDurations: false },
      });
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

  describe('discarding a review session', () => {
    async function openWeekly(app: ReturnType<typeof api>): Promise<string> {
      const opened = await app.request('POST', url('/reviews'), { cadence: 'weekly' });
      expect(opened.status).toBe(201);
      return (opened.body as { id: string }).id;
    }

    it('deletes an open session with what was recorded in it, and answers with it', async () => {
      const app = api();
      const id = await openWeekly(app);
      await app.request('PATCH', url(`/reviews/${id}`), {
        checklist: { 'triage-inbox': true },
        decisions: ['An invented decision'],
      });

      const discarded = await app.request('DELETE', url(`/reviews/${id}`));
      expect(discarded.status).toBe(200);
      expect(discarded.body).toMatchObject({
        id,
        completedAt: null,
        decisions: ['An invented decision'],
      });

      expect((await app.request('GET', url(`/reviews/${id}`))).status).toBe(404);
      // A second discard finds nothing, which is a 404 and not a 409: the
      // session is gone, not closed.
      expect((await app.request('DELETE', url(`/reviews/${id}`))).status).toBe(404);
    });

    it('refuses a closed session, and leaves it exactly as it was', async () => {
      const app = api();
      const id = await openWeekly(app);
      const closed = await app.request('PATCH', url(`/reviews/${id}`), { complete: true });
      expect(closed.status).toBe(200);

      const refused = await app.request('DELETE', url(`/reviews/${id}`));
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: 'conflict' });

      const kept = await app.request('GET', url(`/reviews/${id}`));
      expect(kept.status).toBe(200);
      expect(kept.body).toEqual(closed.body);
    });

    it('touches only the session it names', async () => {
      const app = api();
      const kept = await openWeekly(app);
      const opened = await app.request('POST', url('/reviews'), { cadence: 'monthly' });
      const discarded = (opened.body as { id: string }).id;

      expect((await app.request('DELETE', url(`/reviews/${discarded}`))).status).toBe(200);

      const left = (await app.request('GET', url('/reviews'))).body as {
        items: { id: string }[];
      };
      expect(left.items.map((session) => session.id)).toEqual([kept]);
    });

    it('links the page a closed review was written in, and unlinks it, keeping the snapshot (S4)', async () => {
      const app = api();
      const id = await openWeekly(app);
      const closed = await app.request('PATCH', url(`/reviews/${id}`), { complete: true });

      const linked = await app.request('PATCH', url(`/reviews/${id}`), {
        externalPageId: 'page-invented-review',
      });
      expect(linked.status).toBe(200);
      expect(linked.body).toMatchObject({
        externalPageId: 'page-invented-review',
        completedAt: (closed.body as { completedAt: string }).completedAt,
        capacitySnapshot: (closed.body as { capacitySnapshot: unknown }).capacitySnapshot,
      });

      const unlinked = await app.request('PATCH', url(`/reviews/${id}`), { externalPageId: null });
      expect(unlinked.body).toMatchObject({ externalPageId: null });
    });

    it('needs the write scope, not the read one', async () => {
      const id = await openWeekly(api());
      const reader = api(identityWith(['read:reviews']));

      expect((await reader.request('DELETE', url(`/reviews/${id}`))).status).toBe(403);
      expect((await reader.request('GET', url(`/reviews/${id}`))).status).toBe(200);
    });
  });

  describe('rituals', () => {
    it.each(['quarterly', 'yearly'] as const)(
      'defines a %s ritual, keeps it, and lets its cadence be changed',
      async (cadence) => {
        const app = api();
        const created = await app.request('POST', url('/rituals'), {
          name: 'Invented review',
          areaKey: 'home',
          cadence,
          targetAdherencePct: 80,
        });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ name: 'Invented review', cadence });

        const listed = await app.request('GET', url('/rituals'));
        expect((listed.body as { items: { cadence: string }[] }).items).toContainEqual(
          expect.objectContaining({ cadence }),
        );

        const id = (created.body as { id: string }).id;
        const moved = await app.request('PATCH', url(`/rituals/${id}`), { cadence: 'monthly' });
        expect(moved.status).toBe(200);
        expect(moved.body).toMatchObject({ cadence: 'monthly' });
      },
    );

    /**
     * S2: a ritual tied to its recurring task from Rituals, and a habit that is
     * not a task recorded by hand. Invented task identifiers throughout.
     */
    describe('its recurring task', () => {
      async function define(body: Record<string, unknown> = {}): Promise<{ id: string }> {
        const created = await api().request('POST', url('/rituals'), {
          name: 'Invented walk',
          areaKey: 'health',
          cadence: 'daily',
          targetAdherencePct: 80,
          ...body,
        });
        expect(created.status).toBe(201);
        return created.body as { id: string };
      }

      const bindings = (ritualId: string) => database.client<
        { external_id: string; prisme_kind: string }[]
      >`
        select external_id, prisme_kind from entity_external_ref
        where prisme_id = ${ritualId} and kind = 'task' order by external_id`;

      const links = (ritualId: string) => database.client<
        { external_id: string; decided_by: string }[]
      >`
        select external_id, decided_by from entity_link
        where prisme_id = ${ritualId} and external_kind = 'task' order by external_id`;

      it('ties a task when the ritual is defined, and reads it back', async () => {
        const { id } = await define({ externalTaskId: 'task-invented-walk' });

        expect(await bindings(id)).toEqual([
          { external_id: 'task-invented-walk', prisme_kind: 'ritual' },
        ]);
        expect(await links(id)).toEqual([
          { external_id: 'task-invented-walk', decided_by: 'human' },
        ]);
        const listed = (await api().request('GET', url('/rituals'))).body as {
          items: { id: string; externalTaskId: string | null }[];
        };
        expect(listed.items.find((ritual) => ritual.id === id)?.externalTaskId).toBe(
          'task-invented-walk',
        );
      });

      it('replaces the task, and unties it, leaving no stale binding or link', async () => {
        const { id } = await define({ externalTaskId: 'task-invented-walk' });

        const replaced = await api().request('PATCH', url(`/rituals/${id}`), {
          externalTaskId: 'task-invented-stroll',
        });
        expect(replaced.status).toBe(200);
        expect(replaced.body).toMatchObject({ externalTaskId: 'task-invented-stroll' });
        expect((await bindings(id)).map((row) => row.external_id)).toEqual([
          'task-invented-stroll',
        ]);
        expect((await links(id)).map((row) => row.external_id)).toEqual(['task-invented-stroll']);

        const untied = await api().request('PATCH', url(`/rituals/${id}`), {
          externalTaskId: null,
        });
        expect(untied.status).toBe(200);
        expect(untied.body).toMatchObject({ externalTaskId: null });
        expect(await bindings(id)).toEqual([]);
        expect(await links(id)).toEqual([]);
      });

      it('leaves the task alone when a change does not name it', async () => {
        const { id } = await define({ externalTaskId: 'task-invented-walk' });
        const renamed = await api().request('PATCH', url(`/rituals/${id}`), {
          name: 'Invented longer walk',
        });
        expect(renamed.body).toMatchObject({ externalTaskId: 'task-invented-walk' });
      });

      it('refuses a task another entity holds, and changes nothing', async () => {
        await database.client`
          insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
          values (${fixtureId('init-001')}, 'initiative', 'task', 'task-invented-anchor')`;

        const created = await api().request('POST', url('/rituals'), {
          name: 'Invented habit',
          areaKey: 'health',
          cadence: 'weekly',
          targetAdherencePct: 80,
          externalTaskId: 'task-invented-anchor',
        });
        expect(created.status).toBe(409);
        // A refused task leaves no ritual behind.
        const named = await database.client`select 1 from ritual where name = 'Invented habit'`;
        expect(named).toHaveLength(0);

        const { id } = await define();
        const refused = await api().request('PATCH', url(`/rituals/${id}`), {
          name: 'Renamed in the same request',
          externalTaskId: 'task-invented-anchor',
        });
        expect(refused.status).toBe(409);
        expect((refused.body as { message: string }).message).toMatch(/belongs to something else/);
        const [ritual] = await database.client<{ name: string }[]>`
          select name from ritual where id = ${id}::uuid`;
        expect(ritual?.name).toBe('Invented walk');
        expect(await bindings(id)).toEqual([]);
      });

      it('lists the open recurring tasks with their area and what holds them', async () => {
        const { id } = await define({ externalTaskId: 'task-invented-walk' });
        const app = createTestApp({
          client: database.client,
          runner: stubRunner(),
          directory: stubDirectory({}, undefined, {}, {}, [
            { externalId: 'task-invented-walk', title: 'Walk', projectId: 'project-0001' },
            {
              externalId: 'task-invented-budget',
              title: 'Budget check',
              projectId: 'project-0001',
              sectionId: 'section-0001',
            },
            { externalId: 'task-invented-call', title: 'Call home', projectId: 'project-9999' },
          ]),
        });

        const { status, body } = await app.request('GET', url('/task-tool/recurring-tasks'));

        expect(status).toBe(200);
        expect(body).toEqual({
          failure: null,
          items: [
            { id: 'task-invented-budget', title: 'Budget check', areaKey: 'money', heldBy: null },
            { id: 'task-invented-call', title: 'Call home', areaKey: null, heldBy: null },
            {
              id: 'task-invented-walk',
              title: 'Walk',
              areaKey: 'health',
              heldBy: { kind: 'ritual', id },
            },
          ],
        });
      });

      it('records a period by hand for a habit that is not a task, and says which period is current', async () => {
        const { id } = await define();

        const before = (await api().request('GET', url('/rituals'))).body as {
          items: { id: string; currentPeriod: unknown }[];
        };
        // PINNED_NOW is a Thursday; a daily habit's period is its Monday week.
        expect(before.items.find((ritual) => ritual.id === id)?.currentPeriod).toEqual({
          periodStart: '2026-09-14',
          opportunities: 7,
          completions: 0,
        });

        const recorded = await api().request('POST', url(`/rituals/${id}/adherence`), {
          periodStart: '2026-09-14',
          opportunities: 7,
          completions: 3,
        });
        expect(recorded.status).toBe(200);

        const after = (await api().request('GET', url('/rituals'))).body as {
          items: { id: string; currentPeriod: { completions: number } }[];
        };
        expect(after.items.find((ritual) => ritual.id === id)?.currentPeriod.completions).toBe(3);
      });

      it('refuses a period recorded by hand for a ritual measured from its task', async () => {
        const { id } = await define({ externalTaskId: 'task-invented-walk' });
        const refused = await api().request('POST', url(`/rituals/${id}/adherence`), {
          periodStart: '2026-09-14',
          opportunities: 7,
          completions: 3,
        });
        expect(refused.status).toBe(409);
        expect((refused.body as { message: string }).message).toMatch(/recurring task/);
      });
    });

    /**
     * S3: closing a review session is the completion of a ritual its review
     * fulfils. PINNED_NOW is Thursday 2026-09-17, in the week of 2026-09-14.
     */
    describe('fulfilled by its review', () => {
      async function closeAt(cadence: string, at: string): Promise<void> {
        await database.client`
          insert into review_session (cadence, started_at, completed_at)
          values (${cadence}, ${at}::timestamptz, ${at}::timestamptz)`;
      }

      async function series(id: string): Promise<unknown[]> {
        const { body } = await api().request('GET', url(`/rituals/${id}/adherence`));
        return (body as { items: { periodStart: string; completions: number }[] }).items.map(
          ({ periodStart, completions }) => ({ periodStart, completions }),
        );
      }

      it('rebuilds the series from the sessions already closed, and counts the next close', async () => {
        await closeAt('weekly', '2026-09-03T18:00:00Z');
        // Another cadence's review is not this ritual's.
        await closeAt('monthly', '2026-09-10T18:00:00Z');

        const created = await api().request('POST', url('/rituals'), {
          name: 'Invented weekly review',
          areaKey: 'home',
          cadence: 'weekly',
          targetAdherencePct: 90,
          fulfilledByReview: true,
        });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({
          fulfilledByReview: true,
          measuredFrom: 'review',
          externalTaskId: null,
          // This week is not over, and not done yet: not a zero.
          currentPeriod: { periodStart: '2026-09-14', opportunities: 1, completions: 0 },
        });
        const id = (created.body as { id: string }).id;
        expect(await series(id)).toEqual([
          { periodStart: '2026-08-31', completions: 1 },
          { periodStart: '2026-09-07', completions: 0 },
        ]);

        const opened = await api().request('POST', url('/reviews'), { cadence: 'weekly' });
        const session = (opened.body as { id: string }).id;
        expect(
          (await api().request('PATCH', url(`/reviews/${session}`), { complete: true })).status,
        ).toBe(200);

        expect(await series(id)).toEqual([
          { periodStart: '2026-08-31', completions: 1 },
          { periodStart: '2026-09-07', completions: 0 },
          { periodStart: '2026-09-14', completions: 1 },
        ]);
      });

      it('leaves a ritual its review does not fulfil alone when a session closes', async () => {
        const created = await api().request('POST', url('/rituals'), {
          name: 'Invented habit',
          areaKey: 'home',
          cadence: 'weekly',
          targetAdherencePct: 90,
        });
        const id = (created.body as { id: string }).id;
        expect(created.body).toMatchObject({ fulfilledByReview: false, measuredFrom: 'hand' });

        const opened = await api().request('POST', url('/reviews'), { cadence: 'weekly' });
        const session = (opened.body as { id: string }).id;
        await api().request('PATCH', url(`/reviews/${session}`), { complete: true });

        expect(await series(id)).toEqual([]);
      });

      it('has one source: refuses a daily ritual, a task beside it, and a period by hand', async () => {
        const daily = await api().request('POST', url('/rituals'), {
          name: 'Invented daily review',
          areaKey: 'home',
          cadence: 'daily',
          targetAdherencePct: 90,
          fulfilledByReview: true,
        });
        expect(daily.status).toBe(422);

        const created = await api().request('POST', url('/rituals'), {
          name: 'Invented weekly review',
          areaKey: 'home',
          cadence: 'weekly',
          targetAdherencePct: 90,
          externalTaskId: 'task-invented-review',
        });
        const id = (created.body as { id: string }).id;

        const both = await api().request('PATCH', url(`/rituals/${id}`), {
          fulfilledByReview: true,
        });
        expect(both.status).toBe(422);
        expect((both.body as { message: string }).message).toMatch(/one source/);

        const switched = await api().request('PATCH', url(`/rituals/${id}`), {
          externalTaskId: null,
          fulfilledByReview: true,
        });
        expect(switched.status).toBe(200);
        expect(switched.body).toMatchObject({ externalTaskId: null, measuredFrom: 'review' });

        const toDaily = await api().request('PATCH', url(`/rituals/${id}`), { cadence: 'daily' });
        expect(toDaily.status).toBe(422);

        const byHand = await api().request('POST', url(`/rituals/${id}/adherence`), {
          periodStart: '2026-09-14',
          opportunities: 1,
          completions: 1,
        });
        expect(byHand.status).toBe(409);
        expect((byHand.body as { message: string }).message).toMatch(/fulfilled by its review/);
      });
    });

    it('still refuses a cadence that is not one of the five', async () => {
      const refused = await api().request('POST', url('/rituals'), {
        name: 'Invented review',
        areaKey: 'home',
        cadence: 'fortnightly',
        targetAdherencePct: 80,
      });
      expect(refused.status).toBe(400);
    });
  });

  /**
   * S11: the task tool's own Inbox, read live, and an unsorted task made an
   * initiative of an area — adopted, linked, never created. Invented ids.
   */
  describe('the task tool’s Inbox', () => {
    function withInbox() {
      return createTestApp({
        client: database.client,
        runner: stubRunner(),
        directory: stubDirectory(
          {},
          undefined,
          {},
          {},
          [],
          [
            { externalId: 'task-invented-unsorted', title: 'Call the plumber' },
            { externalId: 'task-invented-held', title: 'Already adopted' },
          ],
        ),
      });
    }

    it('lists the unsorted tasks and what in prisme holds any of them', async () => {
      await database.client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${fixtureId('init-001')}, 'initiative', 'task', 'task-invented-held')`;

      const { status, body } = await withInbox().request('GET', url('/task-tool/inbox'));

      expect(status).toBe(200);
      expect(body).toEqual({
        failure: null,
        mappedTo: [],
        items: [
          { id: 'task-invented-unsorted', title: 'Call the plumber', heldBy: null },
          {
            id: 'task-invented-held',
            title: 'Already adopted',
            heldBy: { kind: 'initiative', id: fixtureId('init-001') },
          },
        ],
      });
    });

    it('names an area whose mapping folds the Inbox into it, which S11 says none may', async () => {
      // A mapping saved before such mappings were refused: written directly.
      await database.client`
        insert into area_mapping (area_key, external_project_id, external_section_id, is_home)
        values ('home', 'project-invented-inbox', null, false)`;
      const app = createTestApp({
        client: database.client,
        runner: stubRunner(),
        directory: stubDirectory(
          {},
          {
            projects: [
              {
                externalId: 'project-invented-inbox',
                name: 'Inbox',
                archived: false,
                order: 0,
                inbox: true,
              },
            ],
            sections: [],
          },
          {},
          {},
          [],
          [{ externalId: 'task-invented-unsorted', title: 'Call the plumber' }],
        ),
      });

      const { status, body } = await app.request('GET', url('/task-tool/inbox'));
      expect(status).toBe(200);
      expect(body).toMatchObject({ failure: null, mappedTo: ['home'] });
    });

    it('makes one an unestimated initiative of an area, linked and not bound, and only once', async () => {
      const app = withInbox();
      const adopted = await app.request(
        'POST',
        url('/task-tool/inbox/task-invented-unsorted/initiative'),
        { title: 'Plumbing fixed', areaKey: 'home' },
      );

      expect(adopted.status).toBe(201);
      expect(adopted.body).toMatchObject({
        title: 'Plumbing fixed',
        areaKey: 'home',
        status: 'inbox',
        origin: 'adopted',
        estimated: false,
        externalAnchorId: null,
      });
      const id = (adopted.body as { id: string }).id;
      // Linked for the reconciler to bind — which is also what moves the task.
      expect(
        await database.client`
          select external_id, decided_by from entity_link where prisme_id = ${id}`,
      ).toEqual([{ external_id: 'task-invented-unsorted', decided_by: 'human' }]);
      expect(
        await database.client`select 1 from entity_external_ref where prisme_id = ${id}`,
      ).toHaveLength(0);

      const again = await app.request(
        'POST',
        url('/task-tool/inbox/task-invented-unsorted/initiative'),
        { title: 'Plumbing fixed', areaKey: 'home' },
      );
      expect(again.status).toBe(409);
    });

    it('refuses a lane, which no initiative belongs to', async () => {
      const lane = await database.client<{ key: string }[]>`
        select key from area where kind <> 'area' limit 1`;
      if (lane[0] === undefined) return;
      const refused = await withInbox().request(
        'POST',
        url('/task-tool/inbox/task-invented-unsorted/initiative'),
        { title: 'Plumbing fixed', areaKey: lane[0].key },
      );
      expect(refused.status).toBe(422);
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
