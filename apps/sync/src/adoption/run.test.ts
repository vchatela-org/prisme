import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@prisme/connectors';
import { parseCalendarDate } from '@prisme/domain';
import type {
  DocRecord,
  DocToolClient,
  RoleKey,
  TaskSnapshot,
  TaskToolClient,
} from '@prisme/connectors';
import { locationKey } from '../reconcile/types.js';
import { indexAreaPages, type AreaPage } from './area-relation.js';
import type { AuditableEntity } from './coverage.js';
import type { AdoptionStore, TakeawaySeen } from './ports.js';
import { adopt } from './run.js';
import type { Candidate, DecidedSet, MatchTarget } from './types.js';

/**
 * The pass, end to end, against an in-memory store.
 *
 * The property being tested is the one the whole workstream rests on: **this
 * code path has no outward door**. It takes read clients and a store whose only
 * write is the candidate mirror, so there is nothing here that a write freeze
 * would need to hold back — and the tests below assert that by giving it clients
 * whose write methods do not exist.
 */

interface Recorded {
  readonly candidates: Candidate[];
  readonly scannedAt: Date[];
  readonly takeaways: (readonly TakeawaySeen[])[];
}

function storeOf(
  overrides: {
    targets?: readonly MatchTarget[];
    decided?: DecidedSet;
    auditable?: readonly AuditableEntity[];
    dateProperties?: ReadonlyMap<string, string>;
    areaProperties?: ReadonlyMap<string, string>;
    areaPages?: readonly AreaPage[];
  } = {},
): { store: AdoptionStore; recorded: Recorded } {
  const recorded: Recorded = { candidates: [], scannedAt: [], takeaways: [] };
  const store: AdoptionStore = {
    loadTargets: () => Promise.resolve(overrides.targets ?? []),
    loadDecided: () =>
      Promise.resolve(overrides.decided ?? { linked: new Set(), ignored: new Set() }),
    loadAuditable: () => Promise.resolve(overrides.auditable ?? []),
    loadAreaMap: () =>
      Promise.resolve({
        areaByLocation: new Map([[locationKey('p-home'), 'home']]),
        laneByArea: new Map<string, 'area' | 'run' | 'signals'>([['home', 'area']]),
        areaByPage: indexAreaPages(overrides.areaPages ?? []),
      }),
    loadDateProperties: () => Promise.resolve(overrides.dateProperties ?? new Map()),
    loadAreaProperties: () => Promise.resolve(overrides.areaProperties ?? new Map()),
    replaceCandidates: (candidates, scannedAt) => {
      recorded.candidates.push(...candidates);
      recorded.scannedAt.push(scannedAt);
      return Promise.resolve();
    },
    mirrorTakeaways: (takeaways) => {
      recorded.takeaways.push(takeaways);
      return Promise.resolve();
    },
  };
  return { store, recorded };
}

function snapshotOf(): TaskSnapshot {
  const task = (externalId: string, content: string, parentId?: string) => ({
    externalId,
    projectId: 'p-home',
    content,
    description: { text: '', segments: [], urls: [] },
    labels: [],
    priority: 'lowest' as const,
    completed: false,
    order: 1,
    urls: [],
    contentHash: 'hash',
    ...(parentId === undefined ? {} : { parentId }),
  });

  return {
    token: 'token-1',
    projects: [{ externalId: 'p-home', name: 'Home', archived: false, order: 1 }],
    sections: [],
    labels: [],
    tasks: [
      task('t-parent', 'Rebuild the garden shed'),
      task('t-kid-1', 'Buy timber', 't-parent'),
      task('t-kid-2', 'Hire a skip', 't-parent'),
      task('t-loose', 'Book the dentist'),
    ],
  };
}

function taskClientOf(snapshot: TaskSnapshot = snapshotOf()): TaskToolClient {
  return {
    fetchAll: () => Promise.resolve(snapshot),
    syncIncremental: () => {
      throw new Error('a scan never advances a cursor');
    },
    fetchCompletions: () => Promise.resolve([]),
    fetchLocations: () => Promise.resolve({ projects: [], sections: [] }),
  };
}

const NOW = new Date('2026-09-19T09:00:00Z');

describe('the adoption pass', () => {
  it('queues the structured task and leaves the loose one alone', async () => {
    const { store } = storeOf();
    const result = await adopt({ store, taskClient: taskClientOf(), now: () => NOW });

    expect(result.scan.queue.map((candidate) => candidate.object.externalId)).toEqual(['t-parent']);
    // Two subtasks and one loose task, plus the project, which has no sections.
    expect(result.scan.leftInPlace.task).toBe(4);
  });

  it('advances no cursor and reads nothing incrementally', async () => {
    // `syncIncremental` throws if it is called. A scan is a question.
    const { store } = storeOf();
    await expect(
      adopt({ store, taskClient: taskClientOf(), now: () => NOW }),
    ).resolves.toBeDefined();
  });

  it('writes the mirror only when asked, and writes the whole queue', async () => {
    const { store, recorded } = storeOf();
    await adopt({ store, taskClient: taskClientOf(), now: () => NOW });
    expect(recorded.candidates).toHaveLength(0);

    await adopt({ store, taskClient: taskClientOf(), now: () => NOW, persist: true });
    expect(recorded.candidates.map((candidate) => candidate.object.externalId)).toEqual([
      't-parent',
    ]);
    expect(recorded.scannedAt).toEqual([NOW]);
  });

  it('proposes a match against an unbound entity, at high confidence and no higher', async () => {
    const { store } = storeOf({
      targets: [
        {
          prismeId: 'i-1',
          kind: 'initiative',
          title: 'Rebuild the garden shed',
          areaKey: 'home',
          closed: false,
        },
      ],
    });
    const result = await adopt({ store, taskClient: taskClientOf(), now: () => NOW });
    expect(result.scan.queue[0]?.proposal).toMatchObject({
      rule: 'exact_title',
      confidence: 'high',
      prismeId: 'i-1',
    });
    // High is not certain, so nothing here may be applied by a machine.
    expect(result.scan.autoLinkable).toEqual([]);
  });

  it('reports the create audit, and says where the numbers came from', async () => {
    const { store } = storeOf({
      auditable: [
        { prismeId: 'i-1', kind: 'initiative', origin: 'adopted', bound: true },
        { prismeId: 'i-2', kind: 'initiative', origin: 'created_in_prisme', bound: false },
      ],
    });
    const result = await adopt({ store, taskClient: taskClientOf(), now: () => NOW });

    expect(result.coverage.wouldCreate.map((risk) => risk.prismeId)).toEqual(['i-2']);
    expect(result.report).toContain('Would create: 1');
    expect(result.report).toContain('task tool');
    expect(result.report).toContain('document tool   not read');
  });

  it('carries on when a document store is not bound, and names a store that is not bound', async () => {
    // A workspace with no processes store is a workspace with no rituals, not a
    // broken configuration — and it must not take the task-tool scan down.
    const docClient: DocToolClient = {
      queryByRole: vi.fn((role: RoleKey) =>
        Promise.reject(
          role === 'processes_db'
            ? new ConnectorError('unbound_role', 'no binding for role processes_db', {
                tool: 'doc',
                operation: 'resolve role key',
              })
            : new ConnectorError('refused', 'the store refused the query', {
                tool: 'doc',
                operation: 'query store',
              }),
        ),
      ),
      fetchPage: () => Promise.reject(new Error('not used')),
      // Required by the interface since ADR-0025 made pages creatable; these
      // fakes are readers, so reaching it is a test error rather than a no-op.
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    };
    const { store } = storeOf();
    const result = await adopt({
      store,
      taskClient: taskClientOf(),
      docClient,
      now: () => NOW,
    });
    expect(result.scan.queue).toHaveLength(1);
    expect(result.report).toContain('document tool   not read');
    // The reason, not just the fact: before this, "a store nobody bound" and
    // "a read that was refused" printed the same six characters. One unbound of
    // four is a role nobody bound; four would be a settings screen never filled in.
    expect(result.report).toContain('not read — 3 refused, 1 unbound_role');
  });

  it('tells a refused read apart from an unbound store in the plan', async () => {
    // The two call for opposite responses — a binding to set, or a credential
    // to go and look at — and the message that would say which names the role
    // binding, so it is the failure kind that reaches the plan.
    const refuses = (failure: 'unbound_role' | 'invalid_token'): DocToolClient => ({
      queryByRole: vi.fn(() =>
        Promise.reject(
          new ConnectorError(failure, 'the message names the role binding', {
            tool: 'doc',
            operation: 'query store',
            ...(failure === 'invalid_token' ? { status: 401 } : {}),
          }),
        ),
      ),
      fetchPage: () => Promise.reject(new Error('not used')),
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    });

    const { store } = storeOf();
    const unbound = await adopt({
      store,
      taskClient: taskClientOf(),
      docClient: refuses('unbound_role'),
      now: () => NOW,
    });
    const denied = await adopt({
      store,
      taskClient: taskClientOf(),
      docClient: refuses('invalid_token'),
      now: () => NOW,
    });

    expect(unbound.report).toContain('not read — 4 unbound_role');
    expect(denied.report).toContain('not read — 4 invalid_token');
    // And the message never reaches the plan, whichever failure it was.
    expect(unbound.report).not.toContain('the message names the role binding');
    expect(denied.report).not.toContain('the message names the role binding');
  });

  it('reads the document stores that are bound, and never the write-only one', async () => {
    const queried: string[] = [];
    const docClient: DocToolClient = {
      queryByRole: (role) => {
        queried.push(role);
        return Promise.resolve([]);
      },
      fetchPage: () => Promise.reject(new Error('not used')),
      // Required by the interface since ADR-0025 made pages creatable; these
      // fakes are readers, so reaching it is a test error rather than a no-op.
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    };
    const { store } = storeOf();
    await adopt({ store, taskClient: taskClientOf(), docClient, now: () => NOW });

    expect(queried).toContain('objectives_db');
    expect(queried).toContain('takeaways_db');
    expect(queried).toContain('processes_db');
    // `reviews_db` is write-only: prisme pushes summaries there and has no
    // business reading them back.
    expect(queried).not.toContain('reviews_db');
  });

  it('mirrors the typed takeaways it read, and only when it read them (G10)', async () => {
    const page = (id: string, type: string | null, archived = false): DocRecord => ({
      role: 'takeaways_db',
      externalId: id,
      lastEditedAt: NOW,
      createdAt: NOW,
      archived,
      title: `An invented reading note ${id}`,
      properties: new Map(
        type === null ? [] : [['Kind', { kind: 'select' as const, value: type }]],
      ),
      urls: [],
      contentHash: id,
    });
    const docClient: DocToolClient = {
      queryByRole: (role) =>
        Promise.resolve(
          role === 'takeaways_db'
            ? [
                page('tk-1', 'Action'),
                page('tk-2', 'Principle'),
                page('tk-3', null),
                page('tk-4', 'Action', true),
              ]
            : [],
        ),
      fetchPage: () => Promise.reject(new Error('not used')),
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    };

    const { store, recorded } = storeOf();
    await adopt({
      store,
      taskClient: taskClientOf(),
      docClient,
      now: () => NOW,
      persist: true,
      takeawayTypeProperty: 'Kind',
    });
    // The untyped one is neither, and the archived one is gone from the store.
    expect(recorded.takeaways).toEqual([
      [
        { externalPageId: 'tk-1', kind: 'action' },
        { externalPageId: 'tk-2', kind: 'principle' },
      ],
    ]);

    // A store that could not be read says nothing about what it holds, so the
    // mirror is left alone rather than emptied.
    const unread = storeOf();
    await adopt({ store: unread.store, taskClient: taskClientOf(), now: () => NOW, persist: true });
    expect(unread.recorded.takeaways).toEqual([]);
  });

  it('dates a candidate from its store’s chosen property, and no other store’s', async () => {
    const entry = (role: RoleKey, id: string, start: string, end: string | null): DocRecord => ({
      role,
      externalId: id,
      lastEditedAt: NOW,
      createdAt: NOW,
      archived: false,
      title: `An invented entry ${id}`,
      properties: new Map([
        [
          'When',
          {
            kind: 'date' as const,
            start: parseCalendarDate(start),
            end: end === null ? null : parseCalendarDate(end),
          },
        ],
      ]),
      urls: [],
      contentHash: id,
    });
    const docClient: DocToolClient = {
      queryByRole: (role) =>
        Promise.resolve(
          role === 'objectives_db'
            ? [entry('objectives_db', 'ob-1', '2024-01-01', '2024-12-31')]
            : role === 'processes_db'
              ? [entry('processes_db', 'pr-1', '2026-10-01', null)]
              : [],
        ),
      fetchPage: () => Promise.reject(new Error('not used')),
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    };

    // Only the objectives store has a date property chosen.
    const { store, recorded } = storeOf({ dateProperties: new Map([['objectives_db', 'When']]) });
    await adopt({ store, taskClient: taskClientOf(), docClient, now: () => NOW, persist: true });

    const byId = new Map(recorded.candidates.map((c) => [c.object.externalId, c.object]));
    expect(byId.get('ob-1')).toMatchObject({ startsOn: '2024-01-01', endsOn: '2024-12-31' });
    // The processes store carries the same column, and nobody chose it there.
    expect(byId.get('pr-1')?.startsOn).toBeUndefined();
    expect(byId.get('pr-1')?.endsOn).toBeUndefined();
  });

  it('gives a page the area its store’s relation names, so the rules can match it (ADR-0033)', async () => {
    const entry = (role: RoleKey, id: string, title: string, related: string[]): DocRecord => ({
      role,
      externalId: id,
      lastEditedAt: NOW,
      createdAt: NOW,
      archived: false,
      title,
      properties: new Map([
        ['Sphere', { kind: 'relation' as const, ids: related }],
        ['Kind', { kind: 'select' as const, value: 'Action' }],
      ]),
      urls: [],
      contentHash: id,
    });
    const docClient: DocToolClient = {
      queryByRole: (role) =>
        Promise.resolve(
          role === 'objectives_db'
            ? [entry('objectives_db', 'ob-1', 'Walk to work twice a week', ['area-page-home'])]
            : role === 'takeaways_db'
              ? [
                  entry('takeaways_db', 'tk-1', 'Fix the gate', ['area-page-home']),
                  entry('takeaways_db', 'tk-2', 'Paint the fence', []),
                ]
              : [],
        ),
      fetchPage: () => Promise.reject(new Error('not used')),
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
      listTemplates: () => Promise.reject(new Error('not used')),
    };
    // A key result inherits its objective's area; one with the same statement
    // in the same area is what rule 2 proposes.
    const targets: MatchTarget[] = [
      {
        prismeId: 'kr-1',
        kind: 'key_result',
        title: 'Walk to work twice a week',
        areaKey: 'home',
        closed: false,
      },
    ];
    const areaPages = [{ key: 'home', externalPageId: 'area-page-home' }];

    const chosen = storeOf({
      targets,
      areaPages,
      areaProperties: new Map([
        ['objectives_db', 'Sphere'],
        ['takeaways_db', 'Sphere'],
      ]),
    });
    await adopt({
      store: chosen.store,
      taskClient: taskClientOf(),
      docClient,
      now: () => NOW,
      persist: true,
      takeawayTypeProperty: 'Kind',
    });
    const byId = new Map(chosen.recorded.candidates.map((c) => [c.object.externalId, c]));
    expect(byId.get('ob-1')?.object.areaKey).toBe('home');
    expect(byId.get('ob-1')?.proposal).toMatchObject({ rule: 'exact_title', prismeId: 'kr-1' });
    expect(byId.get('tk-1')?.object.areaKey).toBe('home');
    expect(byId.get('tk-2')?.object.areaKey).toBeUndefined();
    // The takeaway's area is the document tool's, mirrored as read.
    expect(chosen.recorded.takeaways).toEqual([
      [
        { externalPageId: 'tk-1', kind: 'action', areaKey: 'home' },
        { externalPageId: 'tk-2', kind: 'action' },
      ],
    ]);

    // With no column chosen, a page is outside every area, as before — and "no
    // area" matches only "no area", so nothing is proposed.
    const unchosen = storeOf({ targets, areaPages });
    await adopt({
      store: unchosen.store,
      taskClient: taskClientOf(),
      docClient,
      now: () => NOW,
      persist: true,
    });
    const objective = unchosen.recorded.candidates.find((c) => c.object.externalId === 'ob-1');
    expect(objective?.object.areaKey).toBeUndefined();
    expect(objective?.proposal).toBeUndefined();
  });

  it('is idempotent: two passes over an unchanged world agree exactly', async () => {
    const { store } = storeOf();
    const snapshot = snapshotOf();
    const first = await adopt({ store, taskClient: taskClientOf(snapshot), now: () => NOW });
    const second = await adopt({ store, taskClient: taskClientOf(snapshot), now: () => NOW });
    expect(second.report).toBe(first.report);
  });
});
