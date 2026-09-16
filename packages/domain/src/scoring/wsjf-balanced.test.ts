import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type CalendarDate, parseCalendarDate } from '../entities/calendar.js';
import { type Fibonacci, FIBONACCI_SCALE, nextFibonacci } from '../entities/fibonacci.js';
import { anAreaContext, anInitiative, TEST_NOW } from '../test-support/builders.js';
import { wsjfBalanced, wsjfBalancedParamsSchema, WSJF_BALANCED_DEFAULTS } from './wsjf-balanced.js';
import type { ScoringResult } from './types.js';

/**
 * `wsjf-balanced`, pinned two ways.
 *
 * **Golden** — `fixtures/scoring/wsjf-balanced.golden.json` fixes inputs to
 * outputs at full float precision, including the 14-day boundary that must not
 * trigger. A diff there requires a `version` bump, and
 * `scripts/check-golden-fixtures.py` fails the build when one moves without the
 * other.
 *
 * **Properties** — enumerated over the *entire* legal input space rather than
 * sampled from it. The four scoring inputs are a closed six-value scale, so
 * 6⁴ = 1296 combinations cover every initiative that can be constructed. An
 * exhaustive walk proves each property outright and runs the same way every
 * time; a random generator would only make it probable, and would need a seed
 * printed in the failure to be reproducible at all.
 */

interface GoldenCase {
  readonly id: string;
  readonly in: {
    readonly value: Fibonacci;
    readonly timeCriticality: Fibonacci;
    readonly risk: Fibonacci;
    readonly size: Fibonacci;
    readonly deadline: string | null;
    readonly balanceFactor: number;
  };
  readonly out: {
    readonly effectiveTimeCriticality: number;
    readonly cod: number;
    readonly wsjf: number;
    readonly score: number;
  };
}

interface GoldenFile {
  readonly method: { readonly id: string; readonly version: number };
  readonly params: unknown;
  readonly now: string;
  readonly cases: readonly GoldenCase[];
}

const GOLDEN_PATH = fileURLToPath(
  new URL('../../../../fixtures/scoring/wsjf-balanced.golden.json', import.meta.url),
);

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;

const goldenParams = wsjfBalancedParamsSchema.parse(golden.params);
const goldenNow = new Date(`${golden.now}T00:00:00Z`);

function score(
  overrides: {
    readonly value?: Fibonacci;
    readonly timeCriticality?: Fibonacci;
    readonly risk?: Fibonacci;
    readonly size?: Fibonacci;
    readonly deadline?: CalendarDate | undefined;
  },
  balanceFactor: number,
  now: Date = TEST_NOW,
): ScoringResult {
  return wsjfBalanced.score(
    {
      initiative: anInitiative(overrides),
      area: anAreaContext({ balanceFactor }),
      now,
    },
    WSJF_BALANCED_DEFAULTS,
  );
}

describe('the golden file', () => {
  it('pins the version the method actually is', () => {
    expect(golden.method.id).toBe(wsjfBalanced.id);
    expect(golden.method.version).toBe(wsjfBalanced.version);
  });

  it('parses its parameters against the method’s own schema', () => {
    expect(goldenParams).toEqual(WSJF_BALANCED_DEFAULTS);
  });

  it.each(golden.cases.map((testCase) => [testCase.id, testCase] as const))(
    'reproduces %s exactly',
    (_id, testCase) => {
      const result = wsjfBalanced.score(
        {
          initiative: anInitiative({
            value: testCase.in.value,
            timeCriticality: testCase.in.timeCriticality,
            risk: testCase.in.risk,
            size: testCase.in.size,
            ...(testCase.in.deadline === null
              ? {}
              : { deadline: parseCalendarDate(testCase.in.deadline) }),
          }),
          area: anAreaContext({ balanceFactor: testCase.in.balanceFactor }),
          now: goldenNow,
        },
        goldenParams,
      );

      expect(result.factors['effectiveTimeCriticality']).toBe(
        testCase.out.effectiveTimeCriticality,
      );
      expect(result.factors['costOfDelay']).toBe(testCase.out.cod);
      expect(result.factors['wsjf']).toBe(testCase.out.wsjf);
      // Exact, not `toBeCloseTo`. The golden file stores full float precision
      // on purpose — 1.125 displays as 1.13, and rounding here would let a real
      // arithmetic change hide inside the display convention.
      expect(result.score).toBe(testCase.out.score);
    },
  );

  it('covers the boundary the specification is explicit about', () => {
    const boundary = golden.cases.find((testCase) => testCase.id === 'edge-deadline-boundary');
    expect(boundary?.in.deadline).toBe('2026-09-29');
    expect(boundary?.out.effectiveTimeCriticality).toBe(boundary?.in.timeCriticality);
  });
});

describe('the deadline override', () => {
  it('fires strictly inside the window and not on its edge', () => {
    const thirteen = score({ timeCriticality: 1, deadline: parseCalendarDate('2026-09-28') }, 1);
    const fourteen = score({ timeCriticality: 1, deadline: parseCalendarDate('2026-09-29') }, 1);

    expect(thirteen.factors['effectiveTimeCriticality']).toBe(13);
    expect(fourteen.factors['effectiveTimeCriticality']).toBe(1);
  });

  it('keeps applying once the deadline is behind us', () => {
    const overdue = score({ timeCriticality: 1, deadline: parseCalendarDate('2026-09-01') }, 1);
    expect(overdue.factors['effectiveTimeCriticality']).toBe(13);
    expect(overdue.explain).toContain('14 days overdue');
  });

  it('is a floor, never a demotion', () => {
    // With the shipped override of 13 the two readings coincide; with a lower
    // configured value, taking the maximum is what stops a near deadline from
    // *lowering* an already-urgent score.
    const result = wsjfBalanced.score(
      {
        initiative: anInitiative({
          timeCriticality: 13,
          deadline: parseCalendarDate('2026-09-16'),
        }),
        area: anAreaContext(),
        now: TEST_NOW,
      },
      { ...WSJF_BALANCED_DEFAULTS, deadlineOverrideValue: 3 },
    );
    expect(result.factors['effectiveTimeCriticality']).toBe(13);
  });

  it('reports the days remaining in the factors, deadline or not', () => {
    expect(score({ deadline: parseCalendarDate('2026-09-25') }, 1).factors).toHaveProperty(
      'daysUntilDeadline',
      10,
    );
    expect(score({}, 1).factors).not.toHaveProperty('daysUntilDeadline');
  });
});

describe('every result is explainable', () => {
  it('names each term, so a surprising ranking can be interrogated', () => {
    const result = score({ value: 8, timeCriticality: 2, risk: 5, size: 3 }, 2);
    expect(result.explain).toBe(
      'Cost of delay 15 = value 8 + time criticality 2 + risk 5; over size 3 that is ' +
        'WSJF 5.00, lifted ×2.00 because the area is starved, giving 10.00.',
    );
  });

  it('says why an over-served area was damped', () => {
    expect(score({}, 0.5).explain).toContain('damped ×0.50 because the area is over-served');
  });

  it('says when nothing was adjusted', () => {
    expect(score({}, 1).explain).toContain('left at ×1.00 because the area is on its agreed share');
  });

  it('carries every intermediate in factors', () => {
    expect(Object.keys(score({}, 1).factors).sort()).toEqual([
      'balanceFactor',
      'costOfDelay',
      'effectiveTimeCriticality',
      'risk',
      'size',
      'timeCriticality',
      'value',
      'wsjf',
    ]);
  });
});

/**
 * The exhaustive properties. Every combination of the four scoring inputs,
 * crossed with a spread of balance factors and deadline positions.
 */
const BALANCE_FACTORS = [0.5, 0.8, 1, 1.2, 1.8, 2] as const;

const DEADLINES: readonly (CalendarDate | undefined)[] = [
  undefined,
  parseCalendarDate('2026-09-20'), // inside the override window
  parseCalendarDate('2026-09-29'), // exactly on the boundary
  parseCalendarDate('2026-12-01'), // far out
];

interface Combination {
  readonly value: Fibonacci;
  readonly timeCriticality: Fibonacci;
  readonly risk: Fibonacci;
  readonly size: Fibonacci;
}

function everyCombination(): readonly Combination[] {
  const all: Combination[] = [];
  for (const value of FIBONACCI_SCALE) {
    for (const timeCriticality of FIBONACCI_SCALE) {
      for (const risk of FIBONACCI_SCALE) {
        for (const size of FIBONACCI_SCALE) {
          all.push({ value, timeCriticality, risk, size });
        }
      }
    }
  }
  return all;
}

const COMBINATIONS = everyCombination();

describe('properties, over the whole closed input domain', () => {
  it('covers all 1296 constructible initiatives', () => {
    expect(COMBINATIONS).toHaveLength(FIBONACCI_SCALE.length ** 4);
  });

  it.each(['value', 'risk', 'timeCriticality'] as const)(
    'raising %s never lowers a score',
    (field) => {
      for (const combination of COMBINATIONS) {
        const higher = nextFibonacci(combination[field]);
        if (higher === undefined) continue;

        for (const balanceFactor of BALANCE_FACTORS) {
          for (const deadline of DEADLINES) {
            const before = score({ ...combination, deadline }, balanceFactor).score;
            const after = score({ ...combination, [field]: higher, deadline }, balanceFactor).score;
            expect(after).toBeGreaterThanOrEqual(before);
          }
        }
      }
    },
  );

  it('raising size never raises a score', () => {
    for (const combination of COMBINATIONS) {
      const larger = nextFibonacci(combination.size);
      if (larger === undefined) continue;

      for (const balanceFactor of BALANCE_FACTORS) {
        const before = score(combination, balanceFactor).score;
        const after = score({ ...combination, size: larger }, balanceFactor).score;
        expect(after).toBeLessThanOrEqual(before);
      }
    }
  });

  it('raising the balance factor never lowers a score', () => {
    for (const combination of COMBINATIONS) {
      let previous = Number.NEGATIVE_INFINITY;
      for (const balanceFactor of BALANCE_FACTORS) {
        const current = score(combination, balanceFactor).score;
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('keeps the balance factor inside its clamp, whatever it is handed', () => {
    const [min, max] = WSJF_BALANCED_DEFAULTS.balanceClamp;
    const hostile = [
      Number.NEGATIVE_INFINITY,
      -3,
      0,
      0.0001,
      0.49999,
      0.5,
      1,
      2,
      2.00001,
      1e9,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ];

    for (const balanceFactor of hostile) {
      const factor = score({}, balanceFactor).factors['balanceFactor'];
      expect(factor).toBeGreaterThanOrEqual(min);
      expect(factor).toBeLessThanOrEqual(max);
      expect(Number.isNaN(factor)).toBe(false);
    }
  });

  it('is identical under repeated evaluation', () => {
    for (const combination of COMBINATIONS) {
      for (const deadline of DEADLINES) {
        const first = score({ ...combination, deadline }, 1.2);
        const second = score({ ...combination, deadline }, 1.2);
        expect(second).toEqual(first);
      }
    }
  });

  it('ignores every field that is not an input to the formula', () => {
    for (const combination of COMBINATIONS) {
      const base = wsjfBalanced.score(
        {
          initiative: anInitiative(combination),
          area: anAreaContext({ balanceFactor: 1.2 }),
          now: TEST_NOW,
        },
        WSJF_BALANCED_DEFAULTS,
      );

      const noisy = wsjfBalanced.score(
        {
          initiative: anInitiative({
            ...combination,
            id: 'something-else',
            title: 'A different sentence entirely',
            status: 'inbox',
            projectId: 'project-9',
            earliestStart: parseCalendarDate('2026-10-01'),
            plannedStart: parseCalendarDate('2026-11-01'),
            plannedEnd: parseCalendarDate('2026-11-30'),
            dependsOn: ['other-1', 'other-2'],
            externalPageId: 'page-9',
            externalAnchorId: 'task-9',
            origin: 'adopted',
          }),
          area: anAreaContext({
            key: 'omega',
            targetShare: 99,
            actualShare: 1,
            balanceFactor: 1.2,
            stale: true,
          }),
          now: TEST_NOW,
        },
        WSJF_BALANCED_DEFAULTS,
      );

      expect(noisy).toEqual(base);
    }
  });
});
