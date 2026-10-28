import { describe, expect, it } from 'vitest';
import { scan, unresolved, type ScanInput } from './queue.js';
import { externalKey, type ExternalObject, type MatchTarget } from './types.js';

/**
 * **Convergence** — the property the queue lives or dies by.
 *
 * "*Ignore* is what makes the queue converge. A queue that re-proposes the same
 * 200 items every week gets abandoned in a fortnight, and then the model quietly
 * diverges from reality" (docs/13-migration.md §4).
 *
 * So the tests below do not check that ignoring works once. They re-run the
 * whole scan against the same unchanged external world and assert that the
 * queue is **strictly smaller** each time a decision is made, and that it
 * reaches empty and stays there. That is the executable form of "the queue
 * provably converges" in the definition of done.
 */

function objectOf(overrides: Partial<ExternalObject> = {}): ExternalObject {
  return {
    kind: 'task',
    externalId: 'x-1',
    title: 'Rebuild the garden shed',
    areaKey: 'home',
    areaLane: 'area',
    closed: false,
    childCount: 3,
    ...overrides,
  };
}

function targetOf(overrides: Partial<MatchTarget> = {}): MatchTarget {
  return {
    prismeId: 'i-1',
    kind: 'initiative',
    title: 'Rebuild the garden shed',
    areaKey: 'home',
    closed: false,
    ...overrides,
  };
}

function nothingDecided(): ScanInput['decided'] {
  return { linked: new Set(), ignored: new Set() };
}

/** A world of five structured tasks and twenty loose ones. */
function world(): readonly ExternalObject[] {
  const objects: ExternalObject[] = [];
  for (let index = 0; index < 5; index += 1) {
    objects.push(
      objectOf({ externalId: `big-${String(index)}`, title: `Project ${String(index)}` }),
    );
  }
  for (let index = 0; index < 20; index += 1) {
    objects.push(
      objectOf({
        externalId: `small-${String(index)}`,
        title: `Errand ${String(index)}`,
        childCount: 0,
      }),
    );
  }
  return objects;
}

describe('what reaches the queue', () => {
  it('is only what would become a prisme entity', () => {
    const result = scan({ objects: world(), targets: [], decided: nothingDecided() });
    expect(result.queue).toHaveLength(5);
    expect(result.leftInPlace.task).toBe(20);
  });

  it('never grows with the number of loose tasks', () => {
    // The over-promotion trap by the back door: nobody works a queue of four
    // thousand, so nobody works the queue.
    const many: ExternalObject[] = [...world()];
    for (let index = 0; index < 4000; index += 1) {
      many.push(objectOf({ externalId: `noise-${String(index)}`, childCount: 0 }));
    }
    const result = scan({ objects: many, targets: [], decided: nothingDecided() });
    expect(result.queue).toHaveLength(5);
    expect(result.leftInPlace.task).toBe(4020);
  });

  it('excludes what is already linked, and counts it instead', () => {
    const objects = world();
    const decided = {
      linked: new Set([externalKey('task', 'big-0'), externalKey('task', 'big-1')]),
      ignored: new Set<string>(),
    };
    const result = scan({ objects, targets: [], decided });
    expect(result.queue).toHaveLength(3);
    expect(result.alreadyLinked).toBe(2);
  });
});

describe('convergence', () => {
  it('shrinks with every decision and reaches empty', () => {
    const objects = world();
    const linked = new Set<string>();
    const ignored = new Set<string>();

    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 5; step += 1) {
      const result = scan({ objects, targets: [], decided: { linked, ignored } });
      expect(result.queue.length).toBeLessThan(previous);
      previous = result.queue.length;

      const next = result.queue[0];
      expect(next).toBeDefined();
      const key = externalKey(next!.object.kind, next!.object.externalId);
      // Alternate the two decisions, because both must make the queue smaller.
      if (step % 2 === 0) linked.add(key);
      else ignored.add(key);
    }

    const finished = scan({ objects, targets: [], decided: { linked, ignored } });
    expect(finished.queue).toHaveLength(0);
    expect(finished.alreadyLinked + finished.ignored).toBe(5);
  });

  it('never re-proposes an ignored item, however many times it re-scans', () => {
    const objects = world();
    const decided = {
      linked: new Set<string>(),
      ignored: new Set([externalKey('task', 'big-0')]),
    };
    for (let pass = 0; pass < 10; pass += 1) {
      const result = scan({ objects, targets: [], decided });
      expect(result.queue.map((candidate) => candidate.object.externalId)).not.toContain('big-0');
      expect(result.ignored).toBe(1);
    }
  });

  it('is idempotent: two scans of an unchanged world are identical', () => {
    const input: ScanInput = { objects: world(), targets: [], decided: nothingDecided() };
    expect(scan(input)).toEqual(scan(input));
  });

  it('is level-triggered: the result depends on the world, not on the order it arrived', () => {
    const objects = world();
    const reversed = [...objects].reverse();
    const decided = nothingDecided();
    expect(scan({ objects, targets: [], decided }).queue).toEqual(
      scan({ objects: reversed, targets: [], decided }).queue,
    );
  });
});

describe('the order the queue is worked in', () => {
  it('puts confident proposals first and the manual remainder last', () => {
    const objects = [
      objectOf({ externalId: 'a', title: 'Nothing matches this' }),
      objectOf({ externalId: 'b', title: 'Rebuild the garden shed' }),
      objectOf({ externalId: 'c', title: 'Mapped', mappedPrismeId: 'i-map' }),
      objectOf({ externalId: 'd', title: 'rebuild the greenhouse!' }),
    ];
    const targets = [
      targetOf({ prismeId: 'i-map', title: 'Mapped entity' }),
      targetOf({ prismeId: 'i-1' }),
      targetOf({ prismeId: 'i-2', title: 'Rebuild the greenhouse' }),
    ];
    const result = scan({ objects, targets, decided: nothingDecided() });
    expect(result.queue.map((candidate) => candidate.object.externalId)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
  });
});

describe('what a machine may do on its own', () => {
  it('is exactly the certain proposals, and nothing else', () => {
    const objects = [
      objectOf({ externalId: 'mapped', title: 'Mapped', mappedPrismeId: 'i-map' }),
      objectOf({ externalId: 'exact', title: 'Rebuild the garden shed' }),
    ];
    const targets = [targetOf({ prismeId: 'i-map', title: 'Mapped entity' }), targetOf()];
    const result = scan({ objects, targets, decided: nothingDecided() });

    expect(result.autoLinkable.map((candidate) => candidate.object.externalId)).toEqual(['mapped']);
    for (const candidate of result.autoLinkable) {
      expect(candidate.proposal?.confidence).toBe('certain');
    }
    expect(unresolved(result).map((candidate) => candidate.object.externalId)).toEqual(['exact']);
  });
});

/**
 * S1 (docs/19-how-it-works.md): an objective or a key result kept as a task.
 * The classifier never reads a title, so without this rule such a task is a
 * loose task left in place, or an initiative — never the key result
 * docs/13-migration.md §4 says it becomes.
 */
describe('a task kept as a key result or an objective', () => {
  const keyResult = targetOf({ prismeId: 'k-1', kind: 'key_result', title: 'Run 1000 km' });
  const objective = targetOf({ prismeId: 'o-1', kind: 'objective', title: 'Be fitter' });

  function only(input: Partial<ScanInput>) {
    const result = scan({ objects: [], targets: [], decided: nothingDecided(), ...input });
    expect(result.queue).toHaveLength(1);
    return result.queue[0];
  }

  it('is proposed as the key result its title names, rather than left in place', () => {
    const candidate = only({
      objects: [objectOf({ title: 'Run 1000 km', childCount: 0 })],
      targets: [keyResult],
    });
    expect(candidate?.classification.kind).toBe('key_result');
    expect(candidate?.proposal).toEqual({
      rule: 'exact_title',
      confidence: 'high',
      prismeId: 'k-1',
    });
  });

  it('matches a key result on a normalised title, at medium confidence', () => {
    const candidate = only({
      objects: [objectOf({ title: '1. run 1000 KM!', childCount: 0 })],
      targets: [keyResult],
    });
    expect(candidate?.proposal).toMatchObject({ rule: 'normalised_title', confidence: 'medium' });
  });

  it('is read as a key result of an objective its title repeats, with nothing to link yet', () => {
    // The objective is in `objectives`, not `targets`: it was adopted from its
    // page, so it is bound — and that is exactly the one a task beside it repeats.
    const candidate = only({
      objects: [objectOf({ title: 'Be fitter' })],
      objectives: [objective],
    });
    expect(candidate?.classification.kind).toBe('key_result');
    expect(candidate?.proposal).toBeUndefined();
  });

  it('prefers the key result to the objective when the title names both', () => {
    const candidate = only({
      objects: [objectOf({ title: 'Be fitter', childCount: 0 })],
      targets: [targetOf({ prismeId: 'k-2', kind: 'key_result', title: 'Be fitter' })],
      objectives: [objective],
    });
    expect(candidate?.proposal?.prismeId).toBe('k-2');
  });

  it('never replaces a match of the task’s own kind', () => {
    const candidate = only({
      objects: [objectOf({ title: 'Be fitter' })],
      targets: [targetOf({ prismeId: 'i-1', title: 'Be fitter' })],
      objectives: [objective],
    });
    expect(candidate?.classification.kind).toBe('initiative');
    expect(candidate?.proposal?.prismeId).toBe('i-1');
  });

  it('is never a fuzzy guess across kinds', () => {
    const result = scan({
      objects: [objectOf({ title: 'Run 1000 km this year', childCount: 0 })],
      targets: [keyResult],
      objectives: [targetOf({ prismeId: 'o-2', kind: 'objective', title: 'Run 1000 km this yr' })],
      decided: nothingDecided(),
    });
    expect(result.queue).toEqual([]);
    expect(result.leftInPlace.task).toBe(1);
  });

  it('needs the same area, and the same open-or-closed', () => {
    const result = scan({
      objects: [
        objectOf({ externalId: 'a', title: 'Run 1000 km', childCount: 0, areaKey: 'work' }),
        objectOf({ externalId: 'b', title: 'Be fitter', childCount: 0, closed: true }),
      ],
      targets: [keyResult],
      objectives: [objective],
      decided: nothingDecided(),
    });
    expect(result.queue).toEqual([]);
  });

  it('is no match when two key results share the title', () => {
    const result = scan({
      objects: [objectOf({ title: 'Run 1000 km', childCount: 0 })],
      targets: [keyResult, { ...keyResult, prismeId: 'k-9' }],
      decided: nothingDecided(),
    });
    expect(result.queue).toEqual([]);
  });

  it('leaves a labelled task to its label, and a subtask to its parent', () => {
    const result = scan({
      objects: [
        objectOf({ externalId: 'a', title: 'Be fitter', labels: ['prisme'] }),
        objectOf({ externalId: 'b', title: 'Be fitter', childCount: 0, parentId: 'p' }),
      ],
      objectives: [objective],
      targets: [],
      decided: nothingDecided(),
    });
    // The labelled one is the reconciler's intent channel, still an initiative.
    expect(result.queue.map((candidate) => candidate.classification.kind)).toEqual(['initiative']);
    expect(result.leftInPlace.task).toBe(1);
  });

  it('is never certain, so a machine never applies it', () => {
    const result = scan({
      objects: [objectOf({ title: 'Run 1000 km', childCount: 0 })],
      targets: [keyResult],
      decided: nothingDecided(),
    });
    expect(result.autoLinkable).toEqual([]);
  });

  it('converges: once linked, the task is not asked about again', () => {
    const object = objectOf({ title: 'Run 1000 km', childCount: 0 });
    const result = scan({
      objects: [object],
      targets: [keyResult],
      decided: { linked: new Set([externalKey('task', object.externalId)]), ignored: new Set() },
    });
    expect(result.queue).toEqual([]);
    expect(result.alreadyLinked).toBe(1);
  });
});
