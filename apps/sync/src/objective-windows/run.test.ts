import { describe, expect, it } from 'vitest';
import type { ObjectiveWindowStep } from '@prisme/domain';
import { advanceObjectiveWindows, type ObjectiveWindowStore, type OpenObjective } from './run.js';

/** A store over a list, where `applyStep` can be told that somebody won the race. */
function memoryStore(
  objectives: OpenObjective[],
  options: { racedIds?: readonly string[] } = {},
): ObjectiveWindowStore & { readonly applied: { id: string; step: ObjectiveWindowStep }[] } {
  const applied: { id: string; step: ObjectiveWindowStep }[] = [];
  return {
    applied,
    openObjectives: () => Promise.resolve(objectives),
    applyStep(id, step) {
      if (options.racedIds?.includes(id) === true) return Promise.resolve(false);
      applied.push({ id, step });
      return Promise.resolve(true);
    },
  };
}

const NOW = new Date('2026-12-01T06:00:00.000Z');

describe('advancing objective windows', () => {
  it('applies both steps of a draft whose whole window is over, in order', async () => {
    const store = memoryStore([{ id: 'o-1', type: 'monthly', period: '2026-10', status: 'draft' }]);
    const result = await advanceObjectiveWindows({
      store,
      today: '2026-12-01',
      now: NOW,
      mode: 'apply',
    });
    expect(store.applied.map((entry) => entry.step.to)).toEqual(['active', 'missed']);
    expect(result.counts).toEqual({
      period_started: 1,
      period_not_started: 0,
      review_window_ended: 1,
    });
  });

  it('stops at the first step somebody else got to first', async () => {
    const store = memoryStore(
      [{ id: 'o-1', type: 'monthly', period: '2026-10', status: 'draft' }],
      { racedIds: ['o-1'] },
    );
    const result = await advanceObjectiveWindows({
      store,
      today: '2026-12-01',
      now: NOW,
      mode: 'apply',
    });
    expect(result.raced).toBe(1);
    expect(store.applied).toEqual([]);
  });

  it('counts and writes nothing under plan', async () => {
    const store = memoryStore([{ id: 'o-1', type: 'monthly', period: '2026-12', status: 'draft' }]);
    const result = await advanceObjectiveWindows({
      store,
      today: '2026-12-01',
      now: NOW,
      mode: 'plan',
    });
    expect(result.counts.period_started).toBe(1);
    expect(store.applied).toEqual([]);
  });
});
