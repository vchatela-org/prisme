import { describe, expect, it } from 'vitest';
import { taskOf } from '../test-support/builders.js';
import { descendantsOf, indexChildren, rollupOf, sameRollup } from './subtree.js';

const AT = (iso: string) => new Date(iso);

describe('walking a subtree', () => {
  it('collects descendants at any depth, and never the root', () => {
    const tasks = [
      taskOf({ externalId: 'a' }),
      taskOf({ externalId: 'b', parentId: 'a' }),
      taskOf({ externalId: 'c', parentId: 'b' }),
      taskOf({ externalId: 'd' }),
    ];

    const found = descendantsOf(indexChildren(tasks), 'a').map((task) => task.externalId);

    expect(found).toEqual(['b', 'c']);
  });

  it('returns a wrong answer rather than hanging on a parent chain that loops', () => {
    const tasks = [
      taskOf({ externalId: 'a', parentId: 'b' }),
      taskOf({ externalId: 'b', parentId: 'a' }),
    ];

    expect(descendantsOf(indexChildren(tasks), 'a').map((task) => task.externalId)).toEqual(['b']);
  });
});

describe('the roll-up', () => {
  it('counts completions and reports the most recent one', () => {
    const rollup = rollupOf([
      taskOf({ externalId: 'b', completed: true, completedAt: AT('2026-09-10T10:00:00Z') }),
      taskOf({ externalId: 'c', completed: true, completedAt: AT('2026-09-12T10:00:00Z') }),
      taskOf({ externalId: 'd' }),
      taskOf({ externalId: 'e' }),
    ]);

    expect(rollup).toMatchObject({ progress: 50, openTaskCount: 2 });
    expect(rollup.lastActivity?.toISOString()).toBe('2026-09-12T10:00:00.000Z');
  });

  it('reports an anchor nobody has broken down as 0%, not as finished', () => {
    expect(rollupOf([])).toMatchObject({ progress: 0, openTaskCount: 0 });
  });

  it('treats an empty subtree prisme has never mirrored as nothing to record', () => {
    expect(sameRollup(undefined, rollupOf([]))).toBe(true);
    expect(sameRollup(undefined, { progress: 0, openTaskCount: 1 })).toBe(false);
  });
});
