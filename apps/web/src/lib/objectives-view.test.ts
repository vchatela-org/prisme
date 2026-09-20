import { describe, expect, it } from 'vitest';
import type { KeyResult, Objective } from './contracts';
import {
  currentPeriod,
  divergenceOf,
  elapsedPctOf,
  groupByPeriod,
  LATE_IN_PERIOD_PCT,
  looksLikeAHabit,
  MATERIAL_GAP_PCT,
  nextMonthlyPeriod,
  objectiveProgress,
  orphanInitiatives,
  orphanObjectives,
  servedInitiativeIds,
} from './objectives-view';

/**
 * Synthetic throughout. Every statement, unit and title below is invented for
 * this file — the repository is public and a test fixture is exactly where a
 * real objective gets copied to while something is being debugged
 * (docs/17-privacy.md).
 */

function keyResult(over: Partial<KeyResult> = {}): KeyResult {
  return {
    id: 'kr-1',
    objectiveId: 'obj-1',
    statement: 'Ship the thing',
    target: 1,
    unit: 'thing',
    progressSelf: 50,
    progressComputed: 50,
    externalAnchorId: null,
    servedBy: [],
    measurementCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function objective(over: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-1',
    title: 'An objective',
    type: 'annual',
    period: '2026',
    areaKey: 'alpha',
    status: 'active',
    externalPageId: null,
    keyResults: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('divergenceOf', () => {
  it('reports no gap at all when there is no breakdown to compute from', () => {
    const result = divergenceOf(keyResult({ progressSelf: 80, progressComputed: null }), 50);

    // Not a gap of 80. Absent is not zero, and treating it as zero would
    // manufacture the loudest possible finding out of no information.
    expect(result.gapPct).toBeNull();
    expect(result.material).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it('calls out activity without progress when self is far below computed', () => {
    const result = divergenceOf(keyResult({ progressSelf: 15, progressComputed: 70 }), 50);

    expect(result.gapPct).toBe(-55);
    expect(result.material).toBe(true);
    expect(result.findings.map((finding) => finding.pattern)).toEqual([
      'activity_without_progress',
    ]);
  });

  it('calls out progress from outside the tracked work when self is far above', () => {
    const result = divergenceOf(keyResult({ progressSelf: 90, progressComputed: 20 }), 50);

    expect(result.gapPct).toBe(70);
    expect(result.findings.map((finding) => finding.pattern)).toEqual([
      'progress_outside_tracked_work',
    ]);
  });

  it('says nothing about a gap that is not material', () => {
    const result = divergenceOf(
      keyResult({ progressSelf: 50, progressComputed: 50 - (MATERIAL_GAP_PCT - 1) }),
      50,
    );

    expect(result.material).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it('treats a gap exactly at the threshold as material', () => {
    const result = divergenceOf(
      keyResult({ progressSelf: 50, progressComputed: 50 + MATERIAL_GAP_PCT }),
      50,
    );

    expect(result.material).toBe(true);
  });

  it('is silent about two low numbers early in the period', () => {
    const result = divergenceOf(keyResult({ progressSelf: 10, progressComputed: 10 }), 20);

    expect(result.findings).toEqual([]);
  });

  it('reports at risk once both numbers are low and the period is nearly gone', () => {
    const result = divergenceOf(
      keyResult({ progressSelf: 10, progressComputed: 10 }),
      LATE_IN_PERIOD_PCT,
    );

    expect(result.findings.map((finding) => finding.pattern)).toEqual(['at_risk']);
  });

  it('reports both readings when both apply rather than picking one', () => {
    // Low on both, late, and 20 points apart: the ADR's first and third rows
    // are simultaneously true, and hiding either at the review where both
    // hold is the failure this returns a list to avoid.
    const result = divergenceOf(keyResult({ progressSelf: 5, progressComputed: 25 }), 90);

    expect(result.findings.map((finding) => finding.pattern)).toEqual([
      'activity_without_progress',
      'at_risk',
    ]);
  });

  it('never averages the two numbers', () => {
    const result = divergenceOf(keyResult({ progressSelf: 0, progressComputed: 100 }), 50);

    expect(JSON.stringify(result)).not.toContain('50');
  });
});

describe('elapsedPctOf', () => {
  it('is zero before an annual period starts and a hundred after it ends', () => {
    expect(elapsedPctOf('2026', '2025-12-31')).toBe(0);
    expect(elapsedPctOf('2026', '2027-01-01')).toBe(100);
  });

  it('is about half way through an annual period at the start of July', () => {
    expect(elapsedPctOf('2026', '2026-07-02')).toBeCloseTo(50, 0);
  });

  it('handles a leap year without a date library', () => {
    // 2028-02-29 exists; the span is 365 days from 1 Jan to 31 Dec.
    expect(elapsedPctOf('2028', '2028-02-29')).toBeGreaterThan(0);
    expect(elapsedPctOf('2028', '2028-12-31')).toBe(100);
  });

  it('gets February’s length right for a monthly period', () => {
    expect(elapsedPctOf('2026-02', '2026-02-28')).toBe(100);
    expect(elapsedPctOf('2027-02', '2027-02-28')).toBe(100);
    // A leap February runs one day longer, so the 28th is not the end of it.
    expect(elapsedPctOf('2028-02', '2028-02-28')).toBeLessThan(100);
    expect(elapsedPctOf('2028-02', '2028-02-29')).toBe(100);
  });

  it('crosses a December boundary correctly', () => {
    expect(elapsedPctOf('2026-12', '2026-12-01')).toBe(0);
    expect(elapsedPctOf('2026-12', '2026-12-31')).toBe(100);
    expect(elapsedPctOf('2026-12', '2027-01-01')).toBe(100);
  });

  it('returns zero rather than throwing on something that is not a period', () => {
    expect(elapsedPctOf('not-a-period', '2026-06-01')).toBe(0);
    expect(elapsedPctOf('2026-13', '2026-06-01')).toBe(0);
    expect(elapsedPctOf('2026', 'yesterday')).toBe(0);
  });
});

describe('objectiveProgress', () => {
  it('reports nothing for an objective with no key results', () => {
    expect(objectiveProgress(objective())).toEqual({
      selfPct: null,
      computedPct: null,
      computedFrom: 0,
      keyResultCount: 0,
    });
  });

  it('means the self numbers over every key result', () => {
    const result = objectiveProgress(
      objective({
        keyResults: [
          keyResult({ id: 'a', progressSelf: 20 }),
          keyResult({ id: 'b', progressSelf: 80 }),
        ],
      }),
    );

    expect(result.selfPct).toBe(50);
  });

  it('leaves a key result with no computed progress out of the computed mean', () => {
    const result = objectiveProgress(
      objective({
        keyResults: [
          keyResult({ id: 'a', progressComputed: 60 }),
          keyResult({ id: 'b', progressComputed: null }),
        ],
      }),
    );

    // 60, not 30: the second key result has no breakdown, which is not the
    // same as a breakdown showing nothing done.
    expect(result.computedPct).toBe(60);
    expect(result.computedFrom).toBe(1);
    expect(result.keyResultCount).toBe(2);
  });

  it('reports no computed progress when none of the key results has any', () => {
    const result = objectiveProgress(
      objective({ keyResults: [keyResult({ progressComputed: null })] }),
    );

    expect(result.computedPct).toBeNull();
    expect(result.computedFrom).toBe(0);
  });
});

describe('looksLikeAHabit', () => {
  it('recognises a rate as a cadence', () => {
    expect(looksLikeAHabit(keyResult({ unit: 'sessions/week' }))).toBe(true);
    expect(looksLikeAHabit(keyResult({ unit: 'times per month' }))).toBe(true);
    expect(looksLikeAHabit(keyResult({ unit: 'evenings a week' }))).toBe(true);
  });

  it('leaves an outcome alone', () => {
    expect(looksLikeAHabit(keyResult({ unit: 'document' }))).toBe(false);
    expect(looksLikeAHabit(keyResult({ unit: 'months' }))).toBe(false);
    expect(looksLikeAHabit(keyResult({ unit: 'event' }))).toBe(false);
    expect(looksLikeAHabit(keyResult({ unit: 'kg' }))).toBe(false);
  });

  it('does not care about capitalisation', () => {
    expect(looksLikeAHabit(keyResult({ unit: 'Sessions/Week' }))).toBe(true);
  });
});

describe('orphan detection', () => {
  it('finds an objective with no key results at all', () => {
    const empty = objective({ id: 'obj-empty', keyResults: [] });
    expect(orphanObjectives([empty]).map((item) => item.id)).toEqual(['obj-empty']);
  });

  it('finds an objective whose key results name no initiative', () => {
    const unserved = objective({
      id: 'obj-unserved',
      keyResults: [keyResult({ servedBy: [] }), keyResult({ id: 'kr-2', servedBy: [] })],
    });
    expect(orphanObjectives([unserved]).map((item) => item.id)).toEqual(['obj-unserved']);
  });

  it('leaves an objective alone as soon as one key result is served', () => {
    const served = objective({
      keyResults: [keyResult({ servedBy: [] }), keyResult({ id: 'kr-2', servedBy: ['init-1'] })],
    });
    expect(orphanObjectives([served])).toEqual([]);
  });

  it('collects every served initiative id across objectives', () => {
    const ids = servedInitiativeIds([
      objective({ id: 'a', keyResults: [keyResult({ servedBy: ['init-1', 'init-2'] })] }),
      objective({ id: 'b', keyResults: [keyResult({ id: 'kr-2', servedBy: ['init-2'] })] }),
    ]);

    expect([...ids].sort()).toEqual(['init-1', 'init-2']);
  });

  it('finds initiatives serving no objective, in the other direction', () => {
    const initiatives = [
      { id: 'init-1', title: 'Served', areaKey: 'alpha', status: 'now' },
      { id: 'init-9', title: 'Serving nothing', areaKey: 'beta', status: 'next' },
    ];

    const orphans = orphanInitiatives(initiatives, new Set(['init-1']));
    expect(orphans.map((item) => item.id)).toEqual(['init-9']);
  });

  it('reports nothing in either direction when everything is linked', () => {
    const linked = objective({ keyResults: [keyResult({ servedBy: ['init-1'] })] });
    expect(orphanObjectives([linked])).toEqual([]);
    expect(
      orphanInitiatives(
        [{ id: 'init-1', title: 'Served', areaKey: 'alpha', status: 'now' }],
        servedInitiativeIds([linked]),
      ),
    ).toEqual([]);
  });
});

describe('groupByPeriod', () => {
  it('orders the most recent year first, with the annual period before its months', () => {
    const groups = groupByPeriod([
      objective({ id: '1', period: '2026-03', type: 'monthly' }),
      objective({ id: '2', period: '2025', type: 'annual' }),
      objective({ id: '3', period: '2026', type: 'annual' }),
      objective({ id: '4', period: '2026-09', type: 'monthly' }),
    ]);

    expect(groups.map((group) => group.period)).toEqual(['2026', '2026-09', '2026-03', '2025']);
  });

  it('labels each group by the shape of its period', () => {
    const groups = groupByPeriod([
      objective({ id: '1', period: '2026' }),
      objective({ id: '2', period: '2026-09', type: 'monthly' }),
    ]);

    expect(groups.map((group) => group.type)).toEqual(['annual', 'monthly']);
  });

  it('sorts the objectives inside a period by title', () => {
    const groups = groupByPeriod([
      objective({ id: '1', title: 'Beta', period: '2026' }),
      objective({ id: '2', title: 'Alpha', period: '2026' }),
    ]);

    expect(groups[0]?.objectives.map((item) => item.title)).toEqual(['Alpha', 'Beta']);
  });

  it('returns nothing for nothing', () => {
    expect(groupByPeriod([])).toEqual([]);
  });
});

describe('period helpers', () => {
  it('rolls the month forward, and the year with it in December', () => {
    expect(nextMonthlyPeriod('2026-09-19')).toBe('2026-10');
    expect(nextMonthlyPeriod('2026-12-31')).toBe('2027-01');
    expect(nextMonthlyPeriod('2026-01-01')).toBe('2026-02');
  });

  it('gives the period an objective of each type would be authored for', () => {
    expect(currentPeriod('annual', '2026-09-19')).toBe('2026');
    expect(currentPeriod('monthly', '2026-09-19')).toBe('2026-09');
  });
});
