import { describe, expect, it } from 'vitest';
import { INITIATIVE_STATUSES, ORIGINS } from '@prisme/domain';
import { plan } from '../reconcile/plan.js';
import { anchorOf, CONFIG, desiredOf, observedOf } from '../test-support/builders.js';
import { coverage, wouldProduceCreate, type AuditableEntity } from './coverage.js';
import { scan } from './queue.js';
import { CANDIDATE_KINDS, type CandidateKind, type ExternalObject } from './types.js';

/**
 * **The adversarial test** — W12's definition of done, first line:
 *
 * > A corpus of adopted entities produces **zero** `create` actions, for every
 * > entity kind.
 *
 * W04 already owns one of these for the planner over initiatives
 * (`reconcile/plan.adversarial.test.ts`). This is not a duplicate of it, and
 * the difference is the reason both exist:
 *
 *   - W04's asks *does the planner honour provenance?*
 *   - This one asks *can anything W12 produces reach the planner in a state
 *     that creates?* — the corpus comes out of the adoption path rather than
 *     out of a builder, and every kind goes through it.
 *
 * It is the executable form of guard 2 (ADR-0010) from the adoption side. If
 * someone deletes the provenance check as redundant, this fails loudly rather
 * than quietly duplicating somebody's real task list.
 */

/** Every way an entity can sit in the model, by construction rather than by sampling. */
const BOUND_STATES = [true, false] as const;

describe('an adopted entity can never produce a create', () => {
  it('holds for every kind, bound or not — exhaustively', () => {
    const entities: AuditableEntity[] = [];
    for (const kind of CANDIDATE_KINDS) {
      for (const bound of BOUND_STATES) {
        entities.push({ prismeId: `${kind}-${String(bound)}`, kind, origin: 'adopted', bound });
      }
    }
    expect(entities).toHaveLength(CANDIDATE_KINDS.length * 2);

    for (const entity of entities) {
      expect(wouldProduceCreate(entity)).toBeUndefined();
    }
    expect(coverage(entities, emptyScan()).wouldCreate).toEqual([]);
  });

  it('holds through the real planner, for every status and link state', () => {
    // The corpus: an adopted anchor in every status, with and without a bound
    // external reference, with and without the external task present.
    for (const status of INITIATIVE_STATUSES) {
      for (const anchorId of [undefined, 'task-0001']) {
        for (const pending of [undefined, 'task-0002']) {
          const desired = desiredOf([
            anchorOf({
              status,
              origin: 'adopted',
              ...(anchorId === undefined ? {} : { externalAnchorId: anchorId }),
              ...(pending === undefined ? {} : { pendingExternalId: pending }),
            }),
          ]);
          const result = plan(desired, observedOf([]), new Map(), CONFIG);
          expect(result.counts.create).toBe(0);
        }
      }
    }
  });

  it('is the only thing separating an adopted entity from a created one', () => {
    // The control. Flip origin and nothing else, and a create appears — which
    // is what proves the assertions above are testing the guard rather than
    // some unrelated reason the corpus happened not to create.
    const base = { status: 'now' as const, externalAnchorId: undefined };
    const adopted = plan(
      desiredOf([anchorOf({ ...base, origin: 'adopted' })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );
    const created = plan(
      desiredOf([anchorOf({ ...base, origin: 'created_in_prisme' })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );
    expect(adopted.counts.create).toBe(0);
    expect(created.counts.create).toBe(1);
  });

  it('covers both origins, so the audit agrees with the planner', () => {
    for (const origin of ORIGINS) {
      for (const bound of BOUND_STATES) {
        const entity: AuditableEntity = { prismeId: 'e-1', kind: 'initiative', origin, bound };
        const audited = wouldProduceCreate(entity) !== undefined;
        const expected = origin === 'created_in_prisme' && !bound;
        expect(audited).toBe(expected);
      }
    }
  });
});

describe('adoption itself creates nothing', () => {
  it('produces no entity that would create, for any kind the classifier emits', () => {
    // Walk a corpus that classifies into every kind, adopt every adoptable one,
    // and audit the result. `adopted` is the only origin adoption can produce,
    // so the create count is structurally zero — this asserts that the
    // structure is actually what the code does.
    const objects = corpusCoveringEveryKind();
    const result = scan({
      objects,
      targets: [],
      decided: { linked: new Set(), ignored: new Set() },
    });

    const adoptedEntities: AuditableEntity[] = result.queue.map((candidate, index) => ({
      prismeId: `adopted-${String(index)}`,
      kind: candidate.classification.kind,
      origin: 'adopted',
      bound: true,
    }));

    const report = coverage(adoptedEntities, result);
    expect(report.wouldCreate).toEqual([]);
    expect(report.entities.createdInPrisme).toBe(0);
    expect(report.linkCoveragePct).toBe(100);
  });

  it('reaches every kind the classifier can emit, so the corpus is not a subset', () => {
    const objects = corpusCoveringEveryKind();
    const seen = new Set<CandidateKind>();
    const result = scan({
      objects,
      targets: [],
      decided: { linked: new Set(), ignored: new Set() },
    });
    for (const candidate of result.queue) seen.add(candidate.classification.kind);
    for (const [kind, count] of Object.entries(result.leftInPlace)) {
      if (count > 0) seen.add(kind as CandidateKind);
    }
    expect([...seen].sort()).toEqual([...CANDIDATE_KINDS].sort());
  });
});

function emptyScan() {
  return scan({ objects: [], targets: [], decided: { linked: new Set(), ignored: new Set() } });
}

/** One external object for each row of docs/13-migration.md §4. */
function corpusCoveringEveryKind(): readonly ExternalObject[] {
  const base = { closed: false } as const;
  return [
    // initiative — a parent task with subtasks, in a mapped area
    {
      ...base,
      kind: 'task',
      externalId: 'k-initiative',
      title: 'Rebuild the garden shed',
      areaKey: 'home',
      areaLane: 'area',
      childCount: 4,
    },
    // project — a dedicated project with sections
    {
      ...base,
      kind: 'project',
      externalId: 'k-project',
      title: 'House renovation',
      sectionCount: 5,
    },
    // key_result — held in the objectives store
    { ...base, kind: 'page', externalId: 'k-kr', title: 'Run 1000km', role: 'objectives_db' },
    // ritual — held in the processes store
    { ...base, kind: 'page', externalId: 'k-ritual', title: 'Weekly review', role: 'processes_db' },
    // run — recurring
    {
      ...base,
      kind: 'task',
      externalId: 'k-run',
      title: 'Water the plants',
      areaKey: 'home',
      recurring: true,
    },
    // signal — a machine-generated notification, in a signals lane
    {
      ...base,
      kind: 'task',
      externalId: 'k-signal',
      title: 'Build 412 failed',
      areaKey: 'signals',
      areaLane: 'signals',
    },
    // takeaway — a principle, which never enters the backlog
    {
      ...base,
      kind: 'page',
      externalId: 'k-takeaway',
      title: 'Slow is smooth',
      role: 'takeaways_db',
      takeawayType: 'principle',
    },
    // task — a loose task, which is most of them
    { ...base, kind: 'task', externalId: 'k-task', title: 'Book the dentist', areaKey: 'home' },
  ];
}
