import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { createTestApp, identityWith, PINNED_NOW, stubRunner } from '../test-support/app.js';
import { fixtureId, seedFixtures } from '../test-support/seed.js';
import type { Identity } from '../http/authorize.js';
import type { SyncRunResult } from '../sync/port.js';
import { MCP_PATH } from './mount.js';

/**
 * The real tools, end to end, against a real PostgreSQL seeded from
 * `fixtures/`.
 *
 * Everything here is synthetic — the areas are invented, the initiatives are
 * invented, and none of it resembles any instance (CLAUDE.md, rule 1). The
 * confirmation service is the real one on the real `confirmation_token` table,
 * because the properties that matter are SQL's: consumption is a single
 * `UPDATE … RETURNING`, and "used exactly once" is a claim about that statement
 * rather than about the TypeScript around it.
 *
 * `server.test.ts` covers the machinery with invented tools. This file covers
 * the things a fake cannot have: a plan derived from real rows going stale
 * because a real row moved, and a diff that must hash identically twice in a
 * row even though everything it was computed from came back through a driver.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

interface McpEnvelope {
  readonly applied: boolean;
  readonly plan: { summary: string; changes: unknown[]; warnings: string[]; creates: number };
  readonly confirmation: { token: string; expiresAt: string } | null;
  readonly result: Record<string, unknown> | null;
}

describeOrSkip('the MCP surface against PostgreSQL', () => {
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

  function harness(options?: { identity?: Identity; sync?: SyncRunResult }) {
    const test = createTestApp({
      client: database.client,
      ...(options?.identity === undefined ? {} : { identity: options.identity }),
      runner: options?.sync === undefined ? stubRunner() : stubRunner(options.sync),
    });

    async function post(body: unknown): Promise<{ status: number; body: unknown }> {
      const response = await test.app.request(MCP_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      };
    }

    async function call(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      const { body } = await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      const envelope = body as { result?: Record<string, unknown>; error?: unknown };
      if (envelope.result === undefined) {
        throw new Error(`tools/call answered a protocol error: ${JSON.stringify(envelope.error)}`);
      }
      return envelope.result;
    }

    /** The structured half of a successful tool result. */
    async function read(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
      const result = await call(name, args);
      expect(result['isError'], JSON.stringify(result)).toBe(false);
      return result['structuredContent'];
    }

    /** A write tool's envelope, asserting it was not a tool-level refusal. */
    async function write(name: string, args: Record<string, unknown> = {}): Promise<McpEnvelope> {
      return (await read(name, args)) as McpEnvelope;
    }

    return { test, post, call, read, write, services: test.services };
  }

  /**
   * One takeaway, invented here.
   *
   * `fixtures/` seeds none — the lanes arrive through the connectors rather
   * than through the initiative fixtures — and the promotion rules are the part
   * of W06 most worth proving against a real table. Everything about it is
   * synthetic: an invented page id under a fixture area.
   */
  async function seedTakeaway(kind: 'principle' | 'action'): Promise<string> {
    const rows = await database.client<{ id: string }[]>`
      INSERT INTO takeaway (kind, external_page_id, area_key)
      VALUES (${kind}, ${`synthetic-page-${kind}`}, 'health')
      RETURNING id`;
    return (rows[0] as { id: string }).id;
  }

  describe('the read tools answer questions, small', () => {
    it('answers what to work on now, with the reason each item is there', async () => {
      const focus = (await harness().read('focus_now')) as {
        now: { id: string; title: string; reason: string; blockedBy: string[] }[];
        method: { id: string; version: number };
        slotsByArea: unknown[];
      };

      expect(focus.method.id).toBe('wsjf-balanced');
      expect(focus.now.length).toBeGreaterThan(0);
      for (const row of focus.now) {
        expect(row.reason).toBeTruthy();
        // The projection, asserted: no full initiative object, no rollup, no
        // external ids. An agent reading 200 of these should not pay for them.
        expect(row).not.toHaveProperty('rollup');
        expect(row).not.toHaveProperty('externalPageId');
        expect(row).not.toHaveProperty('createdAt');
      }
    });

    it('pages the backlog well below the REST cap', async () => {
      const page = (await harness().read('list_initiatives', { limit: 3 })) as {
        items: unknown[];
        total: number;
        limit: number;
      };
      expect(page.limit).toBe(3);
      expect(page.items).toHaveLength(3);
      expect(page.total).toBeGreaterThan(3);
    });

    it('refuses a page larger than a tool should ever return', async () => {
      const { body } = await harness().post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_initiatives', arguments: { limit: 500 } },
      });
      expect(body).toHaveProperty('error');
    });

    it('explains a score with every intermediate the method used', async () => {
      const test = harness();
      // A ranking has to have been persisted before there is history to read.
      await test.services.work.rescore(identityWith(['write:initiative']), PINNED_NOW);

      const explained = (await test.read('explain_score', {
        initiativeId: fixtureId('init-001'),
      })) as {
        score: { factors: Record<string, number>; explain: string; methodVersion: number } | null;
        history: unknown[];
      };

      expect(explained.score).not.toBeNull();
      expect(Object.keys(explained.score?.factors ?? {}).length).toBeGreaterThan(0);
      expect(explained.score?.explain).toBeTruthy();
      expect(explained.history.length).toBeGreaterThan(0);
    });

    it('reads declared against observed capacity for a year', async () => {
      const balance = (await harness().read('area_balance', { year: 2026 })) as {
        weightYear: number;
        areas: { areaKey: string; balanceFactor: number }[];
      };
      expect(balance.weightYear).toBe(2026);
      expect(balance.areas.length).toBeGreaterThan(0);
    });
  });

  describe('a write tool is a dry run until a human has seen the diff', () => {
    it('captures nothing on the first call, and exactly one thing on the second', async () => {
      const test = harness();
      const before = (await test.read('list_initiatives', { limit: 50 })) as { total: number };

      const dry = await test.write('capture', {
        title: 'a synthetic captured result',
        areaKey: 'health',
      });

      expect(dry.applied).toBe(false);
      expect(dry.plan.creates).toBe(1);
      expect(dry.confirmation).not.toBeNull();

      const midway = (await test.read('list_initiatives', { limit: 50 })) as { total: number };
      expect(midway.total, 'the dry run created something').toBe(before.total);

      const applied = await test.write('capture', {
        title: 'a synthetic captured result',
        areaKey: 'health',
        confirmationToken: dry.confirmation?.token,
      });

      expect(applied.applied).toBe(true);
      expect((applied.result as { status: string }).status).toBe('inbox');

      const after = (await test.read('list_initiatives', { limit: 50 })) as { total: number };
      expect(after.total).toBe(before.total + 1);
    });

    it('re-derives the same diff twice running, so an honest confirmation works', async () => {
      // The trap this guards: anything clock-dependent in a plan makes every
      // confirmation stale on arrival, and "the plan has changed" becomes the
      // normal answer rather than the alarming one.
      const test = harness();
      const dry = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
      });

      const applied = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
        confirmationToken: dry.confirmation?.token,
      });

      expect(applied.applied).toBe(true);
      expect((applied.result as { status: string }).status).toBe('later');
    });

    it('refuses the confirmation once the initiative it described has moved', async () => {
      const test = harness();
      const dry = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
      });
      expect(dry.confirmation).not.toBeNull();

      // Somebody else — the UI, the reconciler, a second agent — moves the row
      // the diff was computed from.
      await test.services.work.transition(
        fixtureId('init-004'),
        'waiting',
        undefined,
        identityWith(['write:initiative']),
        PINNED_NOW,
      );

      const stale = await test.call('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
        confirmationToken: dry.confirmation?.token,
      });

      expect(stale['isError']).toBe(true);
      expect(JSON.stringify(stale)).toContain('the plan has changed');

      const now = await test.services.work.get(fixtureId('init-004'), PINNED_NOW);
      expect(now.status, 'a stale confirmation still wrote').toBe('waiting');
    });

    it('spends a confirmation exactly once, against the real table', async () => {
      const test = harness();
      const dry = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
      });
      const token = dry.confirmation?.token;

      const first = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
        confirmationToken: token,
      });
      expect(first.applied).toBe(true);

      const replay = await test.call('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
        confirmationToken: token,
      });
      expect(replay['isError']).toBe(true);
    });

    it('records the status change in the event log with the right actor', async () => {
      const test = harness({ identity: identityWith(['write:initiative', 'read:reviews']) });
      const dry = await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
      });
      await test.write('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'later',
        confirmationToken: dry.confirmation?.token,
      });

      const events = await test.services.ops.events(
        { entityId: fixtureId('init-004'), kind: 'status_changed' },
        { limit: 10, offset: 0 },
      );

      expect(events.items).toHaveLength(1);
      expect(events.items[0]?.after).toBe('later');
      // The column is a three-value check constraint, so it carries the actor
      // *kind*. Which credential it was lives on the consumed confirmation row.
      expect(events.items[0]?.actor).toBe('human');
    });

    it('names the confirmation row that authorised the write', async () => {
      const test = harness();
      const dry = await test.write('capture', {
        title: 'a synthetic audited capture',
        areaKey: 'health',
      });
      await test.write('capture', {
        title: 'a synthetic audited capture',
        areaKey: 'health',
        confirmationToken: dry.confirmation?.token,
      });

      const rows = await database.client<
        { operation: string; subject: string; consumed_at: Date | null }[]
      >`SELECT operation, subject, consumed_at FROM confirmation_token`;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.operation).toBe('mcp:capture');
      expect(rows[0]?.subject).toBe('fixture-subject');
      expect(rows[0]?.consumed_at, 'the confirmation was not consumed').not.toBeNull();
    });
  });

  describe('the dry run shows the refusal', () => {
    it('warns about an existing initiative with the same title before creating a second', async () => {
      const test = harness();
      const existing = await test.services.work.get(fixtureId('init-001'), PINNED_NOW);

      const dry = await test.write('capture', {
        title: existing.title,
        areaKey: existing.areaKey,
      });

      expect(dry.plan.warnings.join(' ')).toContain('already carry this exact title');
    });

    it('refuses to promote a principle while planning, not while executing', async () => {
      const test = harness();
      // `fixtures/` seeds no takeaways, so this one is written here. Synthetic
      // in the same way everything in `fixtures/` is: an invented page id under
      // an invented area, resembling nothing (CLAUDE.md, rule 1).
      const principle = await seedTakeaway('principle');

      const refused = await test.call('promote_takeaway', {
        takeawayId: principle,
        title: 'a synthetic promoted result',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
      });

      expect(refused['isError']).toBe(true);
      expect(JSON.stringify(refused)).toContain('never enters the backlog');
    });

    it('promotes an action takeaway by linking it, and refuses to do so twice', async () => {
      const test = harness();
      const takeawayId = await seedTakeaway('action');

      const args = {
        takeawayId,
        title: 'a synthetic promoted result',
        areaKey: 'health',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
      };

      const dry = await test.write('promote_takeaway', args);
      expect(dry.plan.creates).toBe(1);

      const applied = await test.write('promote_takeaway', {
        ...args,
        confirmationToken: dry.confirmation?.token,
      });
      expect(applied.applied).toBe(true);

      // It links, it does not copy: the takeaway is still there, now bound to
      // the initiative, and its own row was not rewritten.
      const takeaway = await test.services.lanes.getTakeaway(takeawayId);
      expect(takeaway.promotedTo).toBe((applied.result as { id: string }).id);
      expect(takeaway.kind).toBe('action');

      // And a second promotion is refused while planning, before a human is
      // asked to confirm work that would be duplicated.
      const second = await test.call('promote_takeaway', args);
      expect(second['isError']).toBe(true);
      expect(JSON.stringify(second)).toContain('already been promoted');
    });

    it('refuses a drop with no reason before anyone confirms it', async () => {
      const refused = await harness().call('set_status', {
        initiativeId: fixtureId('init-004'),
        to: 'dropped',
      });
      expect(refused['isError']).toBe(true);
      expect(JSON.stringify(refused)).toContain('needs a reason');
    });

    it('answers a missing initiative as something the agent can act on', async () => {
      const missing = await harness().call('explain_score', {
        // Derived rather than written out: a literal uuid in this repository is
        // what the privacy deny-list refuses, because a workspace id is one.
        initiativeId: fixtureId('no-such-initiative'),
      });
      expect(missing['isError']).toBe(true);
    });
  });

  describe('proposing a whole now set', () => {
    it('shows every promotion and every demotion as one diff, then applies it', async () => {
      const test = harness();
      const focus = (await test.read('focus_now')) as { now: { id: string }[] };
      const keep = focus.now[0]?.id;
      if (keep === undefined) throw new Error('the fixtures produce an empty now set');

      const dry = await test.write('propose_now_set', { initiativeIds: [keep] });

      // Everything else that was `now` comes back to `next`, and it is visible
      // as one change list rather than as a sequence of separate calls.
      expect(dry.applied).toBe(false);
      expect(dry.plan.changes.length).toBeGreaterThan(0);

      const applied = await test.write('propose_now_set', {
        initiativeIds: [keep],
        confirmationToken: dry.confirmation?.token,
      });

      expect(applied.applied).toBe(true);
      const result = applied.result as { promoted: string[]; demoted: string[] };
      expect([...result.promoted, ...result.demoted].length).toBeGreaterThan(0);

      const after = await test.services.work.get(keep, PINNED_NOW);
      expect(after.status).toBe('now');
    });

    it('refuses the whole set when one id does not exist, changing nothing', async () => {
      const test = harness();
      const focus = (await test.read('focus_now')) as { now: { id: string }[] };
      const real = focus.now[0]?.id;
      if (real === undefined) throw new Error('the fixtures produce an empty now set');

      const refused = await test.call('propose_now_set', {
        initiativeIds: [real, fixtureId('no-such-initiative')],
      });
      expect(refused['isError']).toBe(true);
    });
  });

  describe('the reconciler pair', () => {
    const REFUSED_PLAN: SyncRunResult = {
      mode: 'plan',
      ran: true,
      full: false,
      startedAt: new Date('2026-09-18T09:00:00.000Z'),
      finishedAt: new Date('2026-09-18T09:00:01.000Z'),
      counts: { create: 2, adopt: 0, update: 1, skip: 9, review: 0, conflict: 0 },
      applied: null,
      conflicts: null,
      refused: 'the write freeze is on',
      failures: 0,
      drift: 0,
      report: 'a synthetic plan',
    };

    it('previews a plan without issuing anything to confirm', async () => {
      const preview = (await harness({ sync: REFUSED_PLAN }).read('plan_preview')) as {
        counts: Record<string, number>;
        refused: string | null;
      };
      // `plan_preview` is a read: it hands back the plan and nothing to execute.
      expect(preview.counts['create']).toBe(2);
      expect(preview.refused).toBe('the write freeze is on');
    });

    it('surfaces a create count and a refusal in the diff `apply` asks you to confirm', async () => {
      const dry = await harness({ sync: REFUSED_PLAN }).write('apply');

      expect(dry.applied).toBe(false);
      const warnings = dry.plan.warnings.join(' ');
      expect(warnings).toContain('would be refused');
      // ADR-0010 guard 3, in front of the human at the moment of deciding.
      expect(warnings).toContain('create 2 object');
    });

    it('does not put the pass timestamps in the diff it hashes', async () => {
      // Two passes a second apart must hash the same, or no `apply` could ever
      // be confirmed. The stub returns a fixed result; the assertion is that
      // the confirmation issued against it verifies.
      const test = harness({ sync: REFUSED_PLAN });
      const dry = await test.write('apply');
      const applied = await test.write('apply', { confirmationToken: dry.confirmation?.token });
      expect(applied.applied).toBe(true);
    });
  });

  describe('scopes reach the tools', () => {
    it('lets a read-only credential list only the tools it can call', async () => {
      const { body } = await harness({
        identity: identityWith(['read:focus', 'read:backlog', 'read:meta']),
      }).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

      const tools = (body as { result: { tools: { name: string }[] } }).result.tools.map(
        (tool) => tool.name,
      );
      expect(tools).toContain('focus_now');
      expect(tools).not.toContain('capture');
      expect(tools).not.toContain('apply');
    });

    it('refuses a write tool to a read-only credential before it plans anything', async () => {
      const test = harness({ identity: identityWith(['read:focus', 'read:backlog', 'read:meta']) });
      const response = await test.post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'capture',
          arguments: { title: 'a synthetic refused capture', areaKey: 'health' },
        },
      });

      expect(response.status).toBe(403);
      const rows = await database.client`SELECT count(*)::int AS n FROM confirmation_token`;
      expect((rows[0] as { n: number }).n, 'a refused call still issued a confirmation').toBe(0);
    });
  });
});
