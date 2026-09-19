import { describe, expect, it } from 'vitest';
import { classify, DEFAULT_CLASSIFIER_CONFIG } from './classify.js';
import { CANDIDATE_KINDS, isAdoptable, type ExternalObject } from './types.js';

/**
 * One test per row of docs/13-migration.md §4, *What becomes what*, in the
 * order the table is written — so the table and this file can be read side by
 * side and a missing row is visible.
 *
 * The last row is the one that carries the workstream: **"Loose task, no
 * structure → stays a task. Not everything is an initiative."** There is a
 * whole `describe` for it below, because over-promotion is the failure this
 * classifier is most likely to have and the least likely to be noticed — a
 * backlog of four hundred "initiatives" looks like a successful adoption right
 * up to the moment somebody tries to rank it.
 */

function objectOf(overrides: Partial<ExternalObject> = {}): ExternalObject {
  return {
    kind: 'task',
    externalId: 'x-1',
    title: 'Something',
    closed: false,
    ...overrides,
  };
}

describe('what becomes what', () => {
  it('parent task with subtasks, in an area → initiative', () => {
    const result = classify(objectOf({ childCount: 3, areaKey: 'home', areaLane: 'area' }));
    expect(result.kind).toBe('initiative');
  });

  it('dedicated project with sections → project', () => {
    const result = classify(objectOf({ kind: 'project', sectionCount: 4 }));
    expect(result.kind).toBe('project');
  });

  it('actionable takeaway → initiative, promoted not copied', () => {
    const result = classify(
      objectOf({ kind: 'page', role: 'takeaways_db', takeawayType: 'action' }),
    );
    expect(result.kind).toBe('initiative');
    expect(result.reason).toContain('promoted');
  });

  it('principle-type takeaway → stays a takeaway, never the backlog', () => {
    const result = classify(
      objectOf({ kind: 'page', role: 'takeaways_db', takeawayType: 'principle' }),
    );
    expect(result.kind).toBe('takeaway');
    expect(isAdoptable(result.kind)).toBe(false);
  });

  it('objective or key result stored as a task → key result, that task its anchor', () => {
    const labelled = classify(
      objectOf({
        labels: [DEFAULT_CLASSIFIER_CONFIG.keyResultLabel],
        childCount: 5,
        areaKey: 'home',
      }),
    );
    expect(labelled.kind).toBe('key_result');

    const stored = classify(objectOf({ kind: 'page', role: 'objectives_db' }));
    expect(stored.kind).toBe('key_result');
  });

  it('recurring task → the run lane, or a ritual when a human says so', () => {
    expect(classify(objectOf({ recurring: true, areaKey: 'home' })).kind).toBe('run');
    expect(
      classify(objectOf({ recurring: true, labels: [DEFAULT_CLASSIFIER_CONFIG.ritualLabel] })).kind,
    ).toBe('ritual');
  });

  it('machine-generated notification → the signals lane', () => {
    const result = classify(objectOf({ areaKey: 'signals', areaLane: 'signals', childCount: 9 }));
    expect(result.kind).toBe('signal');
  });

  it('loose task, no structure → stays a task', () => {
    expect(classify(objectOf({ areaKey: 'home', areaLane: 'area' })).kind).toBe('task');
  });
});

describe('the intent channel outranks every heuristic', () => {
  it('an anchor label makes a structureless task an initiative', () => {
    // A human put that label there. Nothing below it gets to disagree.
    const result = classify(objectOf({ labels: ['prisme'] }));
    expect(result.kind).toBe('initiative');
    expect(result.reason).toContain('a human asked');
  });

  it('a ritual label beats the recurrence that would have made it run', () => {
    const result = classify(
      objectOf({ recurring: true, labels: [DEFAULT_CLASSIFIER_CONFIG.ritualLabel] }),
    );
    expect(result.kind).toBe('ritual');
  });
});

describe('over-promotion — the trap this classifier exists to avoid', () => {
  it('one subtask is a note to yourself, not an initiative', () => {
    expect(classify(objectOf({ childCount: 1, areaKey: 'home' })).kind).toBe('task');
    expect(classify(objectOf({ childCount: 2, areaKey: 'home' })).kind).toBe('initiative');
  });

  it('structure outside every mapped area is not enough', () => {
    // An initiative belonging to no area cannot be allocated to, and allocation
    // comes before ranking.
    expect(classify(objectOf({ childCount: 7 })).kind).toBe('task');
  });

  it('a subtask is never a candidate — its parent is', () => {
    const result = classify(objectOf({ parentId: 'x-parent', childCount: 4, areaKey: 'home' }));
    expect(result.kind).toBe('task');
    expect(result.reason).toContain('parent');
  });

  it('a project without sections is a container, not a structure', () => {
    expect(classify(objectOf({ kind: 'project', sectionCount: 1 })).kind).toBe('task');
  });

  it('a section is a location — it maps to an area, it does not become one', () => {
    expect(classify(objectOf({ kind: 'section' })).kind).toBe('task');
  });

  it('leaves the overwhelming majority of a realistic corpus alone', () => {
    // 100 loose tasks, 3 with real structure. Anything that promotes more than
    // the three has started rebuilding the original problem.
    const corpus: ExternalObject[] = [];
    for (let index = 0; index < 100; index += 1) {
      corpus.push(
        objectOf({ externalId: `t-${String(index)}`, areaKey: 'home', areaLane: 'area' }),
      );
    }
    for (let index = 0; index < 3; index += 1) {
      corpus.push(
        objectOf({
          externalId: `s-${String(index)}`,
          areaKey: 'home',
          areaLane: 'area',
          childCount: 4,
        }),
      );
    }
    const promoted = corpus.filter((object) => isAdoptable(classify(object).kind));
    expect(promoted).toHaveLength(3);
  });
});

describe('totality', () => {
  it('always returns a kind, and always a reason', () => {
    // "The classifier had nothing to say" is a bug report; "it said leave this
    // alone" is an answer. There is no third state.
    const shapes: ExternalObject[] = [
      objectOf(),
      objectOf({ kind: 'page' }),
      objectOf({ kind: 'project' }),
      objectOf({ kind: 'section' }),
      objectOf({ kind: 'page', role: 'takeaways_db' }),
      objectOf({ kind: 'page', role: 'media_db' }),
      objectOf({ kind: 'page', role: 'processes_db' }),
      objectOf({ title: '', closed: true }),
    ];
    for (const shape of shapes) {
      const result = classify(shape);
      expect(CANDIDATE_KINDS).toContain(result.kind);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic — the same object twice gives the same answer', () => {
    const object = objectOf({ childCount: 3, areaKey: 'home', areaLane: 'area' });
    expect(classify(object)).toEqual(classify(object));
  });
});
