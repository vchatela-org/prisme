import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Area } from '../entities/area.js';
import { parseCalendarDate } from '../entities/calendar.js';
import type { Fibonacci } from '../entities/fibonacci.js';
import type { Initiative, InitiativeStatus } from '../entities/initiative.js';
import type { Origin } from '../entities/provenance.js';
import { computeScores } from '../scoring/compute.js';
import type { AreaScoringContext } from '../scoring/types.js';
import { wsjfBalanced, WSJF_BALANCED_DEFAULTS } from '../scoring/wsjf-balanced.js';
import { anArea, anInitiative } from '../test-support/builders.js';
import { CANDIDATE_SELECTION_LIMITS, rank, selectNowSet } from './index.js';

/**
 * The worked example in `docs/12-scoring.md` §6, reproduced end to end from the
 * fixtures — scoring, ranking and selection — including **the two cases where
 * ranking and selection disagree**.
 *
 * That disagreement is the reason the example exists. An initiative can outrank
 * another on raw WSJF and still not be picked, and a system that cannot show
 * that clearly is one whose ranking nobody will believe.
 *
 * Fixture data only, as everywhere (docs/17-privacy.md).
 */

interface FixtureInitiative {
  readonly id: string;
  readonly title: string;
  readonly areaKey: string;
  readonly status: InitiativeStatus;
  readonly value: Fibonacci;
  readonly timeCriticality: Fibonacci;
  readonly risk: Fibonacci;
  readonly size: Fibonacci;
  readonly deadline: string | null;
  readonly dependsOn: readonly string[];
  readonly origin: Origin;
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url)), 'utf8'),
  ) as T;
}

const initiativeFixture = fixture<{
  readonly asOf: string;
  readonly initiatives: readonly FixtureInitiative[];
}>('initiatives.json');

const areaFixture = fixture<{
  readonly areas: readonly { readonly key: string; readonly name: string; readonly kind: string }[];
  readonly areaContext2026W37: {
    readonly areas: readonly {
      readonly key: string;
      readonly targetPct?: number;
      readonly observedSharePct: number;
      readonly balanceFactor?: number;
    }[];
  };
}>('areas.json');

const NOW = new Date(`${initiativeFixture.asOf}T00:00:00Z`);

/**
 * The eight rows of the §6 table. The fixture set is larger — it also carries
 * the deadline-override case and work in every closed status — and the example
 * in the specification is deliberately a subset of it.
 */
const EXAMPLE_IDS = [
  'init-001',
  'init-002',
  'init-003',
  'init-004',
  'init-005',
  'init-006',
  'init-007',
  'init-008',
] as const;

function toInitiative(source: FixtureInitiative): Initiative {
  return anInitiative({
    id: source.id,
    title: source.title,
    areaKey: source.areaKey,
    status: source.status,
    value: source.value,
    timeCriticality: source.timeCriticality,
    risk: source.risk,
    size: source.size,
    dependsOn: source.dependsOn,
    origin: source.origin,
    ...(source.deadline === null ? {} : { deadline: parseCalendarDate(source.deadline) }),
  });
}

const initiatives: readonly Initiative[] = initiativeFixture.initiatives
  .filter((source) => (EXAMPLE_IDS as readonly string[]).includes(source.id))
  .map(toInitiative);

const areas: readonly Area[] = areaFixture.areas.map((source) =>
  anArea({ key: source.key, name: source.name, kind: source.kind as Area['kind'] }),
);

const contexts: readonly AreaScoringContext[] = areaFixture.areaContext2026W37.areas
  .filter((source) => source.balanceFactor !== undefined && source.targetPct !== undefined)
  .map((source) => ({
    key: source.key,
    targetShare: source.targetPct ?? 0,
    actualShare: source.observedSharePct,
    balanceFactor: source.balanceFactor ?? 1,
    stale: false,
  }));

const scored = computeScores(initiatives, contexts, wsjfBalanced, WSJF_BALANCED_DEFAULTS, NOW);
const selection = selectNowSet(rank(scored, initiatives), areas, CANDIDATE_SELECTION_LIMITS);

/** The table in docs/12-scoring.md §6, transcribed. */
const EXPECTED = [
  {
    id: 'init-001',
    area: 'health',
    cod: 15,
    wsjf: 5.0,
    score: 10.0,
    lane: 'now',
    priority: 'highest',
  },
  {
    id: 'init-002',
    area: 'relationships',
    cod: 15,
    wsjf: 5.0,
    score: 9.0,
    lane: 'now',
    priority: 'highest',
  },
  {
    id: 'init-003',
    area: 'money',
    cod: 19,
    wsjf: 3.8,
    score: 4.56,
    lane: 'now',
    priority: 'highest',
  },
  { id: 'init-004', area: 'craft', cod: 16, wsjf: 3.2, score: 3.2, lane: 'now', priority: 'high' },
  {
    id: 'init-005',
    area: 'home',
    cod: 18,
    wsjf: 2.25,
    score: 1.125,
    lane: 'now',
    priority: 'high',
  },
  {
    id: 'init-006',
    area: 'home',
    cod: 16,
    wsjf: 3.2,
    score: 1.6,
    lane: 'next',
    priority: 'medium',
  },
  {
    id: 'init-007',
    area: 'community',
    cod: 13,
    wsjf: 1.625,
    score: 1.95,
    lane: 'next',
    priority: 'medium',
  },
  {
    id: 'init-008',
    area: 'craft',
    cod: 7,
    wsjf: 0.875,
    score: 0.875,
    lane: 'later',
    priority: 'lowest',
  },
] as const;

describe('the worked example, scored', () => {
  it('scores all eight rows', () => {
    expect(scored).toHaveLength(EXPECTED.length);
  });

  it.each(EXPECTED.map((row) => [row.id, row] as const))('reproduces %s', (_id, row) => {
    const result = scored.find((entry) => entry.initiativeId === row.id);
    expect(result?.areaKey).toBe(row.area);
    expect(result?.factors['costOfDelay']).toBe(row.cod);
    expect(result?.factors['wsjf']).toBe(row.wsjf);
    expect(result?.score).toBe(row.score);
  });

  it('ranks in the order the balanced scores imply', () => {
    expect(scored.map((entry) => entry.initiativeId)).toEqual([
      'init-001',
      'init-002',
      'init-003',
      'init-004',
      'init-007',
      'init-006',
      'init-005',
      'init-008',
    ]);
  });
});

describe('the worked example, selected', () => {
  it('fills five slots, in ranked order', () => {
    expect(selection.now.map((slot) => slot.initiativeId)).toEqual([
      'init-001',
      'init-002',
      'init-003',
      'init-004',
      'init-005',
    ]);
    expect(selection.overCapacity).toBe(false);
  });

  it.each(EXPECTED.map((row) => [row.id, row] as const))('places %s', (_id, row) => {
    const lane =
      selection.now.find((slot) => slot.initiativeId === row.id) ??
      selection.next.find((slot) => slot.initiativeId === row.id) ??
      selection.later.find((slot) => slot.initiativeId === row.id);

    expect(lane?.proposedStatus).toBe(row.lane);
    expect(selection.priorities.get(row.id)).toBe(row.priority);
  });

  it('gives the top three the highest priority and the rest of `now` high', () => {
    expect(selection.now.map((slot) => slot.priority)).toEqual([
      'highest',
      'highest',
      'highest',
      'high',
      'high',
    ]);
  });
});

describe('the two disagreements the example exists to show', () => {
  it('keeps the in-flight home initiative despite the lowest score in `now`', () => {
    const inFlight = selection.now.find((slot) => slot.initiativeId === 'init-005');
    expect(inFlight?.reason).toBe('in_flight');
    expect(inFlight?.score).toBe(1.125);

    // Every other slot outscores it. Ranking did not put it there; being under
    // way did.
    for (const slot of selection.now) {
      if (slot.initiativeId !== 'init-005') expect(slot.score).toBeGreaterThan(1.125);
    }
  });

  it('leaves draught-proofing in `next` though it outranks the item in flight', () => {
    const raw = (id: string) => scored.find((entry) => entry.initiativeId === id)?.factors['wsjf'];

    expect(raw('init-006')).toBe(3.2);
    expect(raw('init-005')).toBe(2.25);
    expect(selection.next.map((slot) => slot.initiativeId)).toContain('init-006');
  });

  it('holds the community initiative back because work in progress is full', () => {
    const held = selection.next.find((slot) => slot.initiativeId === 'init-007');
    expect(held?.reason).toBe('wip_full');
  });

  it('records that draught-proofing waits on the work in flight', () => {
    // The specification's prose gives the area cap as the reason, and that is
    // true: `home` already holds a slot. The fixture also makes init-006 depend
    // on init-005, and a hard blocker is reported ahead of a policy cap —
    // "waiting on X" is more actionable than "your area is full". Both hold; the
    // outcome is `next` either way.
    const held = selection.next.find((slot) => slot.initiativeId === 'init-006');
    expect(held?.reason).toBe('blocked');
    expect(held?.blockedBy).toEqual(['init-005']);
  });

  it('scores the home-server item lowest because it was scored honestly', () => {
    const last = scored.at(-1);
    expect(last?.initiativeId).toBe('init-008');
    expect(last?.factors['balanceFactor']).toBe(1);
  });
});
