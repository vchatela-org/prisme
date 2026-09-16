import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { anAreaContext, anInitiative, TEST_NOW } from '../test-support/builders.js';
import { computeScores, toScoreRows } from './compute.js';
import { createRegistry } from './registry.js';
import { scoringRegistry } from './index.js';
import type { ScoringMethod } from './types.js';
import { wsjfBalanced, WSJF_BALANCED_DEFAULTS } from './wsjf-balanced.js';

/**
 * The registry (ADR-0006). One method is active; any number run in shadow.
 *
 * The invariant worth more than the API: nothing outside `scoring/` reads a
 * method-specific field. There is no `wsjf` accessor to test here, and the
 * absence is the point.
 */

/** A second method, so the interface is exercised against more than one. */
const constantMethod: ScoringMethod<{ readonly constant: number }> = {
  id: 'constant',
  version: 1,
  paramsSchema: z.object({ constant: z.number() }),
  defaultParams: { constant: 1 },
  score: (_input, params) => ({
    score: params.constant,
    factors: { constant: params.constant },
    explain: `Everything scores ${String(params.constant)}.`,
  }),
};

describe('the registry', () => {
  it('ships wsjf-balanced active, and nothing in shadow', () => {
    expect(scoringRegistry.activeMethod().id).toBe('wsjf-balanced');
    expect(scoringRegistry.listActive().map((method) => method.id)).toEqual(['wsjf-balanced']);
    expect(scoringRegistry.listShadow()).toEqual([]);
  });

  it('refuses a second active method', () => {
    const registry = createRegistry();
    registry.register(wsjfBalanced, 'active');
    expect(() => registry.register(constantMethod, 'active')).toThrow(
      /ordering is determined by exactly one method/,
    );
  });

  it('accepts any number of shadow methods', () => {
    const registry = createRegistry();
    registry.register(wsjfBalanced, 'active');
    registry.register(constantMethod, 'shadow');
    expect(registry.listShadow().map((method) => method.id)).toEqual(['constant']);
  });

  it('refuses a duplicate id', () => {
    const registry = createRegistry();
    registry.register(wsjfBalanced, 'active');
    expect(() => registry.register(wsjfBalanced, 'shadow')).toThrow(/already registered/);
  });

  it('will not guess at an unknown id', () => {
    const registry = createRegistry();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
    expect(() => registry.require('nope')).toThrow(/no scoring method registered/);
  });

  it('says plainly that ordering is undefined with no active method', () => {
    const registry = createRegistry();
    registry.register(constantMethod, 'shadow');
    expect(() => registry.activeMethod()).toThrow(/ordering is undefined/);
  });

  it('lists in id order, not in registration order', () => {
    const registry = createRegistry();
    const zebra = { ...constantMethod, id: 'zebra' };
    const apple = { ...constantMethod, id: 'apple' };
    registry.register(zebra, 'shadow');
    registry.register(apple, 'shadow');
    expect(registry.listShadow().map((method) => method.id)).toEqual(['apple', 'zebra']);
  });
});

describe('computeScores', () => {
  const areas = [
    anAreaContext({ key: 'alpha', balanceFactor: 2 }),
    anAreaContext({ key: 'beta', balanceFactor: 0.5 }),
  ];

  const initiatives = [
    anInitiative({ id: 'a1', areaKey: 'alpha', value: 8, timeCriticality: 2, risk: 5, size: 3 }),
    anInitiative({ id: 'b1', areaKey: 'beta', value: 8, timeCriticality: 5, risk: 5, size: 8 }),
    anInitiative({ id: 'done-1', areaKey: 'alpha', status: 'done' }),
    anInitiative({ id: 'dropped-1', areaKey: 'alpha', status: 'dropped' }),
    anInitiative({ id: 'lane-1', areaKey: 'run' }),
  ];

  it('scores open work, skips closed work, and never sees a lane', () => {
    const scored = computeScores(
      initiatives,
      areas,
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
    );
    expect(scored.map((result) => result.initiativeId)).toEqual(['a1', 'b1']);
  });

  it('scores closed work only when asked', () => {
    const scored = computeScores(
      initiatives,
      areas,
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
      { includeClosed: true },
    );
    expect(scored.map((result) => result.initiativeId).sort()).toEqual([
      'a1',
      'b1',
      'done-1',
      'dropped-1',
    ]);
  });

  it('attributes every result to the method and version that produced it', () => {
    const [first] = computeScores(
      initiatives,
      areas,
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
    );
    expect(first?.methodId).toBe('wsjf-balanced');
    expect(first?.methodVersion).toBe(wsjfBalanced.version);
    expect(first?.areaKey).toBe('alpha');
  });

  it('validates parameters through the method’s own schema', () => {
    expect(() =>
      computeScores(
        initiatives,
        areas,
        wsjfBalanced,
        { ...WSJF_BALANCED_DEFAULTS, deadlineOverrideDays: -1 },
        TEST_NOW,
      ),
    ).toThrow();
  });

  it('breaks ties the same way every run', () => {
    const tied = [
      anInitiative({ id: 'z', areaKey: 'alpha', value: 3, timeCriticality: 3, risk: 3, size: 3 }),
      anInitiative({ id: 'a', areaKey: 'alpha', value: 3, timeCriticality: 3, risk: 3, size: 3 }),
      anInitiative({ id: 'm', areaKey: 'alpha', value: 3, timeCriticality: 3, risk: 3, size: 3 }),
    ];
    const order = () =>
      computeScores(tied, areas, wsjfBalanced, WSJF_BALANCED_DEFAULTS, TEST_NOW).map(
        (result) => result.initiativeId,
      );
    expect(order()).toEqual(['a', 'm', 'z']);
    expect(order()).toEqual(order());
  });

  it('prefers the larger cost of delay when two scores land equal', () => {
    // 39 ÷ 13 and 9 ÷ 3 are both 3.00 at a neutral balance. The one carrying
    // more cost of delay ranks first — a tie on the ratio is not a tie on what
    // is at stake.
    const equalScores = [
      anInitiative({
        id: 'small',
        areaKey: 'neutral',
        value: 3,
        timeCriticality: 3,
        risk: 3,
        size: 3,
      }),
      anInitiative({
        id: 'large',
        areaKey: 'neutral',
        value: 13,
        timeCriticality: 13,
        risk: 13,
        size: 13,
      }),
    ];
    const neutral = [anAreaContext({ key: 'neutral', balanceFactor: 1 })];
    const scored = computeScores(
      equalScores,
      neutral,
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
    );
    expect(scored.map((result) => result.initiativeId)).toEqual(['large', 'small']);
  });
});

describe('score rows', () => {
  it('records the active method on the rows it produced', () => {
    const scored = computeScores(
      [anInitiative({ id: 'a1' })],
      [anAreaContext()],
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
    );
    const rows = toScoreRows(scored, {
      computedAt: TEST_NOW,
      activeMethodId: 'wsjf-balanced',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.isActiveMethod).toBe(true);
    expect(rows[0]?.methodVersion).toBe(wsjfBalanced.version);
    expect(rows[0]?.computedAt).toBe(TEST_NOW);
  });

  it('marks a shadow method’s rows as not ordering anything', () => {
    const scored = computeScores(
      [anInitiative({ id: 'a1' })],
      [anAreaContext()],
      constantMethod,
      { constant: 7 },
      TEST_NOW,
    );
    const rows = toScoreRows(scored, {
      computedAt: TEST_NOW,
      activeMethodId: 'wsjf-balanced',
    });
    expect(rows[0]?.isActiveMethod).toBe(false);
    expect(rows[0]?.score).toBe(7);
  });
});
