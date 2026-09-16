import { describe, expect, it } from 'vitest';

import type { Area } from '../entities/area.js';
import type { Initiative, InitiativeStatus } from '../entities/initiative.js';
import { computeScores } from '../scoring/compute.js';
import { wsjfBalanced, WSJF_BALANCED_DEFAULTS } from '../scoring/wsjf-balanced.js';
import { anArea, anAreaContext, anInitiative, TEST_NOW } from '../test-support/builders.js';
import { CANDIDATE_SELECTION_LIMITS, rank, selectNowSet, type SelectionLimits } from './index.js';

/**
 * The selection rules in isolation (docs/12-scoring.md §5). The worked example
 * lives next door; this file attacks each rule on its own, including the
 * combinations that example does not reach.
 */

const AREAS: readonly Area[] = [
  anArea({ key: 'alpha' }),
  anArea({ key: 'beta' }),
  anArea({ key: 'gamma' }),
  anArea({ key: 'upkeep', kind: 'run' }),
];

const CONTEXTS = [
  anAreaContext({ key: 'alpha' }),
  anAreaContext({ key: 'beta' }),
  anAreaContext({ key: 'gamma' }),
  anAreaContext({ key: 'upkeep' }),
];

/** Score descending is the input order; `value` is the knob that sets it. */
function select(initiatives: readonly Initiative[], limits: SelectionLimits) {
  const scored = computeScores(
    initiatives,
    CONTEXTS,
    wsjfBalanced,
    WSJF_BALANCED_DEFAULTS,
    TEST_NOW,
  );
  return selectNowSet(rank(scored, initiatives), AREAS, limits);
}

function candidate(
  id: string,
  overrides: Partial<Initiative> & { readonly status?: InitiativeStatus } = {},
): Initiative {
  return anInitiative({ id, status: 'next', size: 3, ...overrides });
}

describe('in-flight work keeps its slot', () => {
  it('stays whatever it scores, and above anything selected after it', () => {
    const selection = select(
      [
        candidate('flight', { status: 'now', value: 1, timeCriticality: 1, risk: 1, size: 13 }),
        candidate('challenger', { areaKey: 'beta', value: 13, timeCriticality: 13, risk: 13 }),
      ],
      { maxNow: 2, maxNowPerArea: 1 },
    );

    expect(selection.now.map((slot) => slot.initiativeId)).toEqual(['flight', 'challenger']);
    expect(selection.now[0]?.reason).toBe('in_flight');
    expect(selection.now[1]?.reason).toBe('selected');
  });

  it('is not demoted by arithmetic when more is in flight than the cap allows', () => {
    const selection = select(
      [
        candidate('a', { status: 'now' }),
        candidate('b', { status: 'now', areaKey: 'beta' }),
        candidate('c', { status: 'now', areaKey: 'gamma' }),
      ],
      { maxNow: 2, maxNowPerArea: 1 },
    );

    expect(selection.now).toHaveLength(3);
    expect(selection.overCapacity).toBe(true);
    expect(selection.now.every((slot) => slot.reason === 'in_flight')).toBe(true);
  });
});

describe('the per-area cap', () => {
  it('skips an area that already holds a slot', () => {
    const selection = select(
      [
        candidate('held', { status: 'now', value: 1 }),
        candidate('same-area', { value: 13, timeCriticality: 13, risk: 13 }),
        candidate('other-area', { areaKey: 'beta', value: 8 }),
      ],
      { maxNow: 5, maxNowPerArea: 1 },
    );

    expect(selection.now.map((slot) => slot.initiativeId)).toEqual(['held', 'other-area']);
    expect(selection.next.find((slot) => slot.initiativeId === 'same-area')?.reason).toBe(
      'area_at_cap',
    );
  });

  it('lets a wider cap through', () => {
    const selection = select(
      [
        candidate('held', { status: 'now', value: 1 }),
        candidate('same-area', { value: 13, timeCriticality: 13, risk: 13 }),
      ],
      { maxNow: 5, maxNowPerArea: 2 },
    );
    expect(selection.now.map((slot) => slot.initiativeId)).toEqual(['held', 'same-area']);
  });

  it('is what keeps one busy area from occupying every slot', () => {
    const crowd = Array.from({ length: 6 }, (_unused, index) =>
      candidate(`alpha-${String(index)}`, { value: 13 }),
    );
    const selection = select([...crowd, candidate('beta-1', { areaKey: 'beta', value: 1 })], {
      maxNow: 5,
      maxNowPerArea: 1,
    });

    expect(selection.now).toHaveLength(2);
    expect(selection.now.map((slot) => slot.areaKey).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('what is not a candidate', () => {
  it.each(['inbox', 'waiting', 'review'] as const)('leaves %s alone', (status) => {
    const selection = select([candidate('x', { status, value: 13 })], CANDIDATE_SELECTION_LIMITS);
    expect(selection.untouched.map((slot) => slot.initiativeId)).toEqual(['x']);
    expect(selection.untouched[0]?.proposedStatus).toBe('unchanged');
    expect(selection.untouched[0]?.reason).toBe('not_a_candidate');
  });

  it('never promotes a lane, whatever it scores', () => {
    const selection = select(
      [candidate('upkeep-1', { areaKey: 'upkeep', value: 13, timeCriticality: 13, risk: 13 })],
      CANDIDATE_SELECTION_LIMITS,
    );
    expect(selection.now).toEqual([]);
    expect(selection.untouched[0]?.reason).toBe('not_a_candidate');
  });

  it('holds back anything still blocked', () => {
    const selection = select(
      [candidate('blocked', { dependsOn: ['open'] }), candidate('open', { status: 'later' })],
      CANDIDATE_SELECTION_LIMITS,
    );
    const held = selection.next.find((slot) => slot.initiativeId === 'blocked');
    expect(held?.reason).toBe('blocked');
    expect(held?.blockedBy).toEqual(['open']);
  });

  it('counts a finished dependency as cleared', () => {
    const initiatives = [
      candidate('unblocked', { dependsOn: ['finished'] }),
      candidate('finished', { status: 'done' }),
    ];
    const selection = select(initiatives, CANDIDATE_SELECTION_LIMITS);
    expect(selection.now.map((slot) => slot.initiativeId)).toEqual(['unblocked']);
  });

  it('refuses a slice too large to be a slice', () => {
    const selection = select([candidate('huge', { size: 13 })], CANDIDATE_SELECTION_LIMITS);
    expect(selection.next[0]?.reason).toBe('too_large');
  });

  it('sends an unselected `later` item back to `later`, not up to `next`', () => {
    const selection = select(
      [candidate('held', { status: 'now' }), candidate('waiting-its-turn', { status: 'later' })],
      { maxNow: 5, maxNowPerArea: 1 },
    );
    expect(selection.later.map((slot) => slot.initiativeId)).toEqual(['waiting-its-turn']);
  });
});

describe('limits are configuration, and validated', () => {
  it('names the open question rather than deciding it', () => {
    expect(CANDIDATE_SELECTION_LIMITS).toEqual({ maxNow: 5, maxNowPerArea: 1 });
  });

  it('selects nothing at all when the cap is zero', () => {
    const selection = select([candidate('a', { value: 13 })], { maxNow: 0, maxNowPerArea: 1 });
    expect(selection.now).toEqual([]);
    expect(selection.next[0]?.reason).toBe('wip_full');
  });

  it.each([
    ['maxNow', { maxNow: -1, maxNowPerArea: 1 }],
    ['maxNow', { maxNow: 2.5, maxNowPerArea: 1 }],
    ['maxNowPerArea', { maxNow: 5, maxNowPerArea: -1 }],
  ])('refuses a nonsensical %s', (_field, limits) => {
    expect(() => selectNowSet([], AREAS, limits)).toThrow(/whole number of slots/);
  });
});

describe('selection is deterministic and complete', () => {
  const initiatives = [
    candidate('a', { status: 'now' }),
    candidate('b', { areaKey: 'beta', value: 13 }),
    candidate('c', { areaKey: 'gamma', status: 'later' }),
    candidate('d', { status: 'inbox' }),
  ];

  it('accounts for every initiative exactly once', () => {
    const selection = select(initiatives, CANDIDATE_SELECTION_LIMITS);
    const placed = [
      ...selection.now,
      ...selection.next,
      ...selection.later,
      ...selection.untouched,
    ].map((slot) => slot.initiativeId);

    expect(placed.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(placed).size).toBe(placed.length);
    expect(selection.priorities.size).toBe(initiatives.length);
  });

  it('produces the same selection twice', () => {
    expect(select(initiatives, CANDIDATE_SELECTION_LIMITS)).toEqual(
      select(initiatives, CANDIDATE_SELECTION_LIMITS),
    );
  });

  it('refuses a ranking that names work it was not given', () => {
    const scored = computeScores(
      [candidate('ghost')],
      CONTEXTS,
      wsjfBalanced,
      WSJF_BALANCED_DEFAULTS,
      TEST_NOW,
    );
    expect(() => rank(scored, [])).toThrow(/not in the initiative set/);
  });
});
