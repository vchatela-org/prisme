import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_TEXT, type ExternalTask } from '@prisme/connectors';
import {
  createPostgresStore as createReconcilerStore,
  DEFAULT_ANCHOR_LABEL,
  DEFAULT_STATUS_REQUEST_PREFIX,
  plan,
} from '@prisme/sync';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { createTestApp, identityWith, stubRunner } from '../test-support/app.js';
import { seedFixtures } from '../test-support/seed.js';
import { API_BASE_PATH } from './index.js';

/**
 * The creation flows against a real PostgreSQL.
 *
 * Everything here is synthetic: invented titles, invented external ids, and
 * the fixture area list, which resembles no real instance (CLAUDE.md, rule 1).
 *
 * These are the properties a fake store cannot have, and every one of them is
 * in W15's definition of done:
 *
 *   - **Promotion reuses the capture's task.** The initiative is written with
 *     `external_anchor_id` already set, so ADR-0010 guard 2 refuses a create
 *     for it — asserted against the column, not against a mock.
 *   - **One external object binds once.** `entity_external_ref`'s unique index
 *     is what refuses a second link, and the promotion path has to *move* a
 *     binding through it without ever holding two.
 *   - **Asking twice does not enqueue twice.** The ledger's one-per-slot index.
 *   - **A satisfied intent cannot forget what it made.** A CHECK constraint.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

/**
 * `fixtures/` carries no `area_mapping` rows and `seedFixtures` loads none, so
 * the location a capture goes to has to be seeded here. Recorded as a
 * follow-up rather than added to the shared fixture: mappings feed the
 * backfill's attribution too, and quietly changing what every suite sees is
 * how one workstream breaks another's numbers.
 */
const MAPPED_AREA = 'home';
const MAPPED_PROJECT = 'ext-project-home';
const MAPPED_SECTION = 'ext-section-home';

describeOrSkip('the creation flows against PostgreSQL', () => {
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
    await database.client`
      insert into area_mapping (area_key, external_project_id, external_section_id)
      values (${MAPPED_AREA}, ${MAPPED_PROJECT}, ${MAPPED_SECTION})`;
  });

  function api(identity?: ReturnType<typeof identityWith>) {
    return createTestApp({
      client: database.client,
      ...(identity === undefined ? {} : { identity }),
      runner: stubRunner(),
    });
  }

  const url = (path: string): string => `${API_BASE_PATH}${path}`;

  interface CaptureBody {
    id: string;
    title: string;
    areaKey: string;
    externalProjectId: string | null;
    externalSectionId: string | null;
    externalTaskId: string | null;
    promotedTo: string | null;
  }

  interface IntentBody {
    id: string;
    objectKind: string;
    ordinal: number;
    state: string;
    externalId: string | null;
    requires: string | null;
    attempts: number;
    lastError: string | null;
  }

  async function capture(title: string, page: unknown = { mode: 'none' }): Promise<CaptureBody> {
    const response = await api().request('POST', url('/captures'), {
      title,
      areaKey: MAPPED_AREA,
      page,
    });
    expect(response.status).toBe(201);
    return response.body as CaptureBody;
  }

  async function intentsOf(entityId: string): Promise<IntentBody[]> {
    const response = await api().request('GET', url(`/creations?entityId=${entityId}`));
    expect(response.status).toBe(200);
    return (response.body as { items: IntentBody[] }).items;
  }

  /** Stands in for the converge pass, which is `apps/sync`'s and not the API's. */
  async function satisfy(intentId: string, externalId: string): Promise<void> {
    await database.client`
      update creation_intent
         set state = 'satisfied', external_id = ${externalId}, attempts = attempts + 1,
             updated_at = now()
       where id = ${intentId}::uuid`;
  }

  async function bindCaptureTask(captureId: string, externalId: string): Promise<void> {
    await database.client`
      update capture set external_task_id = ${externalId}, updated_at = now()
       where id = ${captureId}::uuid`;
    await database.client`
      insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
      values (${captureId}, 'capture', 'task', ${externalId})`;
  }

  describe('quick capture', () => {
    it('records the capture and one pending task intent, and writes nothing outward', async () => {
      const created = await capture('Something small');

      expect(created.externalProjectId).toBe(MAPPED_PROJECT);
      expect(created.externalSectionId).toBe(MAPPED_SECTION);
      // Nothing outward has happened: the task does not exist yet, and the
      // response says so rather than pretending.
      expect(created.externalTaskId).toBeNull();

      const intents = await intentsOf(created.id);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({ objectKind: 'task', state: 'pending', externalId: null });
    });

    /**
     * A capture and its intents commit **together**.
     *
     * The first version of this service inserted the capture and then
     * recorded its intents in a second transaction, because the intents
     * carry a backlink containing the capture's own id. A real run left two
     * captures committed with no intent at all — a capture that never
     * becomes a task, with nothing anywhere to say so. The invariant is
     * asserted rather than described: every capture has at least one intent.
     */
    it('never leaves a capture with no intent behind it', async () => {
      await capture('One');
      await capture('Two');

      const orphans = await database.client<{ count: string }[]>`
        select count(*) as count from capture c
         where not exists (select 1 from creation_intent i where i.entity_id = c.id)`;

      expect(Number(orphans[0]?.count)).toBe(0);
    });

    it('refuses an area mapped nowhere, naming what would fix it', async () => {
      const response = await api().request('POST', url('/captures'), {
        title: 'Nowhere to put this',
        areaKey: 'craft',
        page: { mode: 'none' },
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(response.body)).toContain('mappings');
    });

    it('refuses the four estimates by name rather than dropping them', async () => {
      const response = await api().request('POST', url('/captures'), {
        title: 'Something small',
        areaKey: MAPPED_AREA,
        value: 5,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('value');
    });

    it('adds a page intent when one is asked for, and none when it is not', async () => {
      const withPage = await capture('With a page', { mode: 'create' });
      const without = await capture('Without a page');

      expect((await intentsOf(withPage.id)).map((intent) => intent.objectKind).sort()).toEqual([
        'page',
        'task',
      ]);
      expect((await intentsOf(without.id)).map((intent) => intent.objectKind)).toEqual(['task']);
    });
  });

  describe('promotion', () => {
    /**
     * The definition of done, in one test: *promoting a capture reuses its
     * existing task; no second task appears.* The assertion is on
     * `external_anchor_id` being set at insert, because that is the fact
     * ADR-0010 guard 2 reads — the planner emits a create only for an
     * initiative with none.
     */
    it('binds the capture’s own task as the anchor, so no create can be planned', async () => {
      const created = await capture('Something small');
      await bindCaptureTask(created.id, 'ext-task-1');

      const response = await api().request('POST', url(`/captures/${created.id}/promote`), {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });

      expect(response.status).toBe(200);
      const initiative = response.body as {
        id: string;
        externalAnchorId: string | null;
        origin: string;
      };
      expect(initiative.externalAnchorId).toBe('ext-task-1');
      // Created in prisme *and* already anchored, which is the pair that makes
      // the planner structurally unable to emit a create for it.
      expect(initiative.origin).toBe('created_in_prisme');
    });

    it('moves the external reference, so the task is never claimed twice and never by nobody', async () => {
      const created = await capture('Something small');
      await bindCaptureTask(created.id, 'ext-task-2');

      const response = await api().request('POST', url(`/captures/${created.id}/promote`), {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });
      const initiative = response.body as { id: string };

      const refs = await database.client<{ prisme_id: string; prisme_kind: string }[]>`
        select prisme_id, prisme_kind from entity_external_ref
        where kind = 'task' and external_id = 'ext-task-2'`;

      expect(refs).toHaveLength(1);
      expect(refs[0]?.prisme_id).toBe(initiative.id);
      expect(refs[0]?.prisme_kind).toBe('initiative');
    });

    it('refuses a second promotion rather than making a second initiative', async () => {
      const created = await capture('Something small');
      await bindCaptureTask(created.id, 'ext-task-3');

      const body = {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      };
      const first = await api().request('POST', url(`/captures/${created.id}/promote`), body);
      const second = await api().request('POST', url(`/captures/${created.id}/promote`), body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);

      const count = await database.client<{ count: string }[]>`
        select count(*) as count from initiative where external_anchor_id = 'ext-task-3'`;
      expect(Number(count[0]?.count)).toBe(1);
    });

    /**
     * A capture whose task the converge pass has not made yet has no anchor to
     * reuse. Creating the initiative anyway would leave the reconciler free to
     * make a second task for it — the exact duplicate this workstream is about.
     */
    it('refuses to promote a capture whose task does not exist yet', async () => {
      const created = await capture('Something small');

      const response = await api().request('POST', url(`/captures/${created.id}/promote`), {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('converge');
    });
  });

  /**
   * *All three flows create exactly one object per tool, verified by a
   * follow-up `plan` showing `create: 0`.*
   *
   * The definition of done, executed rather than described: the **real
   * planner** is run over the desired state the reconciler would load, with
   * the promoted initiative's anchor present in the observed world. It must
   * emit no create.
   *
   * A control runs beside it, because a test that only ever sees zero proves
   * nothing about whether it could see one: the same planner, over the same
   * corpus, with the anchor binding removed, *does* emit a create. Without
   * the control this test would pass against a planner that had stopped
   * emitting creates entirely.
   */
  describe('the no-duplicate guard, through the real planner', () => {
    const PLANNER_CONFIG = {
      anchorLabel: DEFAULT_ANCHOR_LABEL,
      statusRequestPrefix: DEFAULT_STATUS_REQUEST_PREFIX,
      baseUrl: 'https://prisme.invalid',
    };

    /**
     * The anchor as the task tool would report it.
     *
     * Typed as `ExternalTask` on purpose. The first version was inferred, so
     * a misspelled field and a missing one both passed the type check; and
     * the second cast `''` into the `description` slot, which is not a string
     * but a `SanitisedText` — the planner reads `.text` off it. A cast into a
     * structured type is a type check switched off, and it cost two runs.
     */
    function anchorTask(externalId: string): ExternalTask {
      return {
        externalId,
        projectId: MAPPED_PROJECT,
        sectionId: MAPPED_SECTION,
        content: 'Something small',
        description: EMPTY_TEXT,
        labels: [DEFAULT_ANCHOR_LABEL],
        priority: 'medium',
        completed: false,
        order: 1,
        urls: [],
        contentHash: 'fixture-hash',
      };
    }

    /** Every initiative the planner would make a task for. */
    async function creates(observed: readonly ExternalTask[]): Promise<readonly string[]> {
      const store = createReconcilerStore(database.client);
      const [desired, lastApplied] = await Promise.all([
        store.loadDesired(),
        store.loadLastApplied(),
      ]);
      const result = plan(desired, { tasks: observed }, lastApplied, PLANNER_CONFIG);
      return result.actions
        .filter((action) => action.tag === 'create')
        .map((action) => action.initiativeId ?? '');
    }

    /**
     * Scoped to *this* initiative rather than to the whole plan's count. The
     * fixture corpus contains initiatives that legitimately have no anchor
     * yet, so a plan over it is expected to contain creates — asserting zero
     * across the board would have been asserting something false, and the
     * first version of this test did exactly that.
     */
    it('plans no create for a promoted capture, because its anchor already exists', async () => {
      const created = await capture('Something small');
      await bindCaptureTask(created.id, 'ext-task-promoted');
      const promoted = await api().request('POST', url(`/captures/${created.id}/promote`), {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });
      const initiativeId = (promoted.body as { id: string }).id;

      expect(await creates([anchorTask('ext-task-promoted')])).not.toContain(initiativeId);
    });

    /**
     * The control. Flip the one fact the guard reads — the anchor binding —
     * and the same planner over the same corpus emits a create.
     */
    it('plans a create for the same initiative once its anchor is taken away', async () => {
      const created = await capture('Something small');
      await bindCaptureTask(created.id, 'ext-task-control');
      const promoted = await api().request('POST', url(`/captures/${created.id}/promote`), {
        title: 'Something small, finished',
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });
      const initiativeId = (promoted.body as { id: string }).id;

      // `next` so the planner considers it at all, and no anchor.
      await database.client`
        update initiative set external_anchor_id = null, status = 'next'
         where id = ${initiativeId}::uuid`;
      await database.client`
        delete from entity_external_ref where prisme_id = ${initiativeId}`;

      expect(await creates([])).toContain(initiativeId);
    });
  });

  describe('the project flow', () => {
    async function project(body: Record<string, unknown>) {
      const response = await api().request('POST', url('/projects'), {
        name: 'A large effort',
        areaKey: MAPPED_AREA,
        sections: ['First', 'Second', 'Third'],
        ...body,
      });
      // 201 from `POST /projects`, which W05 defined and W15 does not change.
      expect(response.status).toBe(201);
      return response.body as {
        id: string;
        externalProjectId: string | null;
        externalPageId: string | null;
      };
    }

    it('plans a project, its sections in order, and makes each section wait', async () => {
      const created = await project({ taskProject: { mode: 'create' } });
      const intents = await intentsOf(created.id);

      const projectIntent = intents.find((intent) => intent.objectKind === 'project');
      const sections = intents
        .filter((intent) => intent.objectKind === 'section')
        .sort((left, right) => left.ordinal - right.ordinal);

      expect(sections.map((section) => section.ordinal)).toEqual([0, 1, 2]);
      expect(sections.every((section) => section.requires === projectIntent?.id)).toBe(true);
    });

    /**
     * The order the work will happen in, not the order the rows landed in.
     *
     * A project and its sections commit in one transaction, so `now()` is
     * identical across every row and a tie-break on `ordinal` alone leaves a
     * random uuid deciding. The ledger listed a project *after* one of its
     * own sections — arbitrary-looking, on the one screen whose job is to
     * show how far an ordered process got.
     */
    it('lists a project before its own sections, despite one transaction timestamp', async () => {
      const created = await project({ taskProject: { mode: 'create' } });
      const intents = await intentsOf(created.id);

      expect(intents.map((intent) => intent.objectKind)).toEqual([
        'project',
        'section',
        'section',
        'section',
      ]);
      expect(
        intents.filter((intent) => intent.objectKind === 'section').map((s) => s.ordinal),
      ).toEqual([0, 1, 2]);
    });

    /**
     * *"Link existing" binds without creating, for both pages and projects.*
     * The assertion that matters is the absence of a project intent: linking
     * that also enqueued a create is exactly the duplicate ADR-0010 forbids.
     */
    it('binds an existing task-tool project and plans no create for it', async () => {
      const created = await project({
        taskProject: { mode: 'link', externalId: 'ext-existing-project' },
      });

      expect(created.externalProjectId).toBe('ext-existing-project');
      const intents = await intentsOf(created.id);
      expect(intents.map((intent) => intent.objectKind)).not.toContain('project');
      // The sections are still planned: linking says the project exists, not
      // that its sections do.
      expect(intents.filter((intent) => intent.objectKind === 'section')).toHaveLength(3);
    });

    it('records a manual link decision, rather than implying a matcher made it', async () => {
      const created = await project({
        taskProject: { mode: 'link', externalId: 'ext-linked-project' },
      });

      const links = await database.client<
        { match_rule: string; confidence: string; decided_by: string }[]
      >`
        select match_rule, confidence, decided_by from entity_link
        where prisme_id = ${created.id} and external_id = 'ext-linked-project'`;

      expect(links[0]).toMatchObject({
        match_rule: 'manual',
        confidence: 'manual',
        decided_by: 'human',
      });
    });

    it('refuses to link an object another entity already holds', async () => {
      await project({ taskProject: { mode: 'link', externalId: 'ext-contested' } });

      const response = await api().request('POST', url('/projects'), {
        name: 'Another effort',
        areaKey: MAPPED_AREA,
        sections: [],
        taskProject: { mode: 'link', externalId: 'ext-contested' },
      });

      expect(response.status).toBe(409);
      // prisme's own sentence, not the driver's: a constraint violation quotes
      // the key, and the key is an identifier from a real workspace.
      expect(JSON.stringify(response.body)).not.toContain('entity_external_ref');
    });

    /**
     * *A simulated failure partway through project creation leaves a
     * recoverable state, not orphans in one tool.* The project and its first
     * section are satisfied, the rest are not, and asking again resumes rather
     * than duplicating.
     */
    it('resumes a half-created project without re-planning what already exists', async () => {
      const created = await project({ taskProject: { mode: 'create' } });
      const before = await intentsOf(created.id);

      const projectIntent = before.find((intent) => intent.objectKind === 'project');
      const firstSection = before.find(
        (intent) => intent.objectKind === 'section' && intent.ordinal === 0,
      );
      await satisfy(projectIntent?.id as string, 'ext-made-project');
      await satisfy(firstSection?.id as string, 'ext-made-section-0');

      const again = await api().request('POST', url(`/projects/${created.id}/structure`), {
        taskProject: { mode: 'create' },
      });
      expect(again.status).toBe(200);

      const after = await intentsOf(created.id);
      // Four rows before, four rows after: nothing was enqueued twice.
      expect(after).toHaveLength(before.length);

      const satisfied = after.filter((intent) => intent.state === 'satisfied');
      expect(satisfied.map((intent) => intent.externalId).sort()).toEqual([
        'ext-made-project',
        'ext-made-section-0',
      ]);
      // And what was already made keeps its id — a resume that blanked it
      // would be the orphan, one pass later.
      expect(after.filter((intent) => intent.state === 'pending')).toHaveLength(2);
    });
  });

  describe('the ledger', () => {
    it('cannot record a satisfied creation that forgot what it made', async () => {
      const created = await capture('Something small');
      const [intent] = await intentsOf(created.id);

      await expect(
        database.client`
          update creation_intent set state = 'satisfied' where id = ${intent?.id as string}::uuid`,
      ).rejects.toThrow(/satisfied_intents_name_what_they_made/);
    });

    it('cannot record a failure with no reason', async () => {
      const created = await capture('Something small');
      const [intent] = await intentsOf(created.id);

      await expect(
        database.client`
          update creation_intent set state = 'failed' where id = ${intent?.id as string}::uuid`,
      ).rejects.toThrow(/failures_say_why/);
    });

    it('retries a failed creation and leaves the attempt count alone', async () => {
      const created = await capture('Something small');
      const [intent] = await intentsOf(created.id);
      await database.client`
        update creation_intent
           set state = 'failed', last_error = 'the tool refused the command', attempts = 3
         where id = ${intent?.id as string}::uuid`;

      const response = await api().request('POST', url(`/creations/${intent?.id}/retry`), {});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ state: 'pending', lastError: null, attempts: 3 });
    });

    it('refuses to retry one that is already satisfied', async () => {
      const created = await capture('Something small');
      const [intent] = await intentsOf(created.id);
      await satisfy(intent?.id as string, 'ext-task-9');

      const response = await api().request('POST', url(`/creations/${intent?.id}/retry`), {});
      expect(response.status).toBe(409);
    });

    /**
     * The key is stored and reused forever, which is the opposite of the
     * reconciler's per-pass rule and the whole reason a retry after a timeout
     * that had in fact succeeded cannot double-create.
     */
    it('keeps one idempotency key for the life of an intent', async () => {
      const created = await capture('Something small');
      const [intent] = await intentsOf(created.id);

      const before = await database.client<{ idempotency_key: string }[]>`
        select idempotency_key::text from creation_intent where id = ${intent?.id as string}::uuid`;

      await database.client`
        update creation_intent set state = 'failed', last_error = 'timed out'
         where id = ${intent?.id as string}::uuid`;
      await api().request('POST', url(`/creations/${intent?.id}/retry`), {});

      const after = await database.client<{ idempotency_key: string }[]>`
        select idempotency_key::text from creation_intent where id = ${intent?.id as string}::uuid`;

      expect(after[0]?.idempotency_key).toBe(before[0]?.idempotency_key);
    });

    it('never returns the draft, which carries a title and an external location', async () => {
      const created = await capture('Something small');
      const response = await api().request('GET', url(`/creations?entityId=${created.id}`));

      expect(JSON.stringify(response.body)).not.toContain('draft');
      expect(JSON.stringify(response.body)).not.toContain(MAPPED_PROJECT);
    });
  });

  describe('the page button (ADR-0011)', () => {
    async function initiative(): Promise<string> {
      const response = await api().request('POST', url('/initiatives'), {
        title: 'Fence replaced',
        areaKey: MAPPED_AREA,
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });
      return (response.body as { id: string }).id;
    }

    it('records an intent for `create` and binds nothing yet', async () => {
      const id = await initiative();
      const response = await api().request('POST', url(`/initiatives/${id}/page`), {
        page: { mode: 'create' },
      });

      expect(response.status).toBe(200);
      expect((response.body as { externalPageId: string | null }).externalPageId).toBeNull();
      expect((await intentsOf(id)).map((intent) => intent.objectKind)).toEqual(['page']);
    });

    it('binds an existing page for `link`, and plans no create', async () => {
      const id = await initiative();
      const response = await api().request('POST', url(`/initiatives/${id}/page`), {
        page: { mode: 'link', externalId: 'ext-page-written-before-prisme' },
      });

      expect(response.status).toBe(200);
      expect((response.body as { externalPageId: string | null }).externalPageId).toBe(
        'ext-page-written-before-prisme',
      );
      expect(await intentsOf(id)).toHaveLength(0);
    });

    it('asking twice for a page does not enqueue a second one', async () => {
      const id = await initiative();
      await api().request('POST', url(`/initiatives/${id}/page`), { page: { mode: 'create' } });
      await api().request('POST', url(`/initiatives/${id}/page`), { page: { mode: 'create' } });

      expect(await intentsOf(id)).toHaveLength(1);
    });

    it('refuses `none`, because it would read as detaching a page', async () => {
      const id = await initiative();
      const response = await api().request('POST', url(`/initiatives/${id}/page`), {
        page: { mode: 'none' },
      });

      expect(response.status).toBe(422);
    });

    it('refuses a bare identifier, saying which of the three states to use', async () => {
      const id = await initiative();
      const response = await api().request('POST', url(`/initiatives/${id}/page`), {
        externalPageId: 'ext-page-1',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('mode');
    });
  });

  describe('search before create', () => {
    it('offers what prisme already holds, before a second one is made', async () => {
      await api().request('POST', url('/initiatives'), {
        title: 'Fence replaced',
        areaKey: MAPPED_AREA,
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });

      const response = await api().request('GET', url('/search?q=Fence%20replaced'));
      expect(response.status).toBe(200);

      const body = response.body as {
        worthReading: boolean;
        matches: { source: string; suggests: string; title: string }[];
      };
      expect(body.worthReading).toBe(true);
      expect(body.matches[0]).toMatchObject({ source: 'existing', suggests: 'open' });
    });

    /**
     * The defect a real search found. `initiatives.list({ search })` is a
     * substring match, and pre-filtering on it meant the fuzzy matcher only
     * ever saw candidates that already contained the query verbatim — so a
     * near-match, which is exactly what is *not* a substring, was filtered
     * out before it could be ranked.
     */
    it('finds a near-match that contains the query nowhere', async () => {
      await api().request('POST', url('/initiatives'), {
        title: 'Passport renewed',
        areaKey: MAPPED_AREA,
        value: 3,
        timeCriticality: 2,
        risk: 2,
        size: 3,
      });

      const response = await api().request('GET', url('/search?q=Renew%20the%20passport'));
      const body = response.body as { matches: { title: string }[] };

      expect(body.matches.map((match) => match.title)).toContain('Passport renewed');
    });

    it('offers an adoption rather than a create for something prisme does not hold', async () => {
      await database.client`
        insert into adoption_candidate
          (external_kind, external_id, title, area_key, proposed_kind, reason, scanned_at)
        values ('task', 'ext-unadopted', 'Rebuild the garden shed', ${MAPPED_AREA}, 'initiative',
                'a parent task with subtasks, in a mapped area', now())`;

      const response = await api().request('GET', url('/search?q=Rebuild%20the%20garden%20shed'));
      const body = response.body as { matches: { source: string; suggests: string }[] };

      expect(body.matches[0]).toMatchObject({ source: 'adoptable', suggests: 'adopt' });
    });

    it('finds a capture too, so two captures of one thought do not both stand', async () => {
      await capture('Book the annual check-up');

      const response = await api().request('GET', url('/search?q=Book%20the%20annual%20check-up'));
      const body = response.body as { matches: { kind: string }[] };

      expect(body.matches.map((match) => match.kind)).toContain('capture');
    });
  });

  describe('scopes', () => {
    it('lets a capture-scoped credential capture and nothing more', async () => {
      const captureOnly = api(identityWith(['write:capture', 'read:focus']));

      const created = await captureOnly.request('POST', url('/captures'), {
        title: 'Something small',
        areaKey: MAPPED_AREA,
      });
      expect(created.status).toBe(201);

      const promoted = await captureOnly.request(
        'POST',
        url(`/captures/${(created.body as CaptureBody).id}/promote`),
        { title: 'Promoted', value: 3, timeCriticality: 2, risk: 2, size: 3 },
      );
      expect(promoted.status).toBe(403);
    });

    it('does not let an initiative-scoped credential capture', async () => {
      const response = await api(identityWith(['write:initiative'])).request(
        'POST',
        url('/captures'),
        { title: 'Something small', areaKey: MAPPED_AREA },
      );

      expect(response.status).toBe(403);
    });

    /**
     * Reading what is outstanding must keep working while the kill switch is
     * pulled — that is exactly the moment somebody wants to know what they are
     * about to be unable to do. The same reasoning W10 applied to the replan
     * preview.
     */
    it('reads the ledger behind a read scope', async () => {
      const response = await api(identityWith(['read:sync'])).request('GET', url('/creations'));
      expect(response.status).toBe(200);
    });
  });
});
