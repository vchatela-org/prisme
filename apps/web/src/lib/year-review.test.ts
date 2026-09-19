import { describe, expect, it } from 'vitest';
import {
  driftPct,
  movedTowardObserved,
  REQUIRED_SUM_PCT,
  reviewTarget,
  verdictFor,
  type WeightEntry,
} from './year-review';

function anEntry(overrides: Partial<WeightEntry> = {}): WeightEntry {
  return {
    areaKey: 'craft',
    name: 'Craft',
    weightPct: 20,
    previousPct: 20,
    observedPct: 20,
    ...overrides,
  };
}

describe('reviewTarget', () => {
  it('decides the current year when the current year was never decided', () => {
    // The gate is holding right now: every balance factor on screen is carried
    // from an earlier year, and the banner is up.
    expect(reviewTarget(2026, () => false)).toEqual({
      year: 2026,
      reviewing: 2025,
      stance: 'overdue',
    });
  });

  it('decides next year once the current one is settled', () => {
    expect(reviewTarget(2026, (year) => year === 2026)).toEqual({
      year: 2027,
      reviewing: 2026,
      stance: 'ahead',
    });
  });

  it('never offers to re-decide a year that has weights of its own', () => {
    const decided = new Set([2025, 2026]);
    const target = reviewTarget(2026, (year) => decided.has(year));

    expect(decided.has(target.year)).toBe(false);
    expect(target.year).toBe(2027);
  });

  it('always reviews the year immediately before the one it writes', () => {
    for (const currentYear of [2024, 2026, 2030]) {
      for (const decided of [true, false]) {
        const target = reviewTarget(currentYear, () => decided);
        expect(target.reviewing).toBe(target.year - 1);
      }
    }
  });
});

describe('verdictFor', () => {
  const SPLIT: readonly WeightEntry[] = [
    anEntry({ areaKey: 'health', name: 'Health', weightPct: 30 }),
    anEntry({ areaKey: 'relationships', name: 'Relationships', weightPct: 25 }),
    anEntry({ areaKey: 'craft', name: 'Craft', weightPct: 20 }),
    anEntry({ areaKey: 'money', name: 'Money', weightPct: 15 }),
    anEntry({ areaKey: 'home', name: 'Home', weightPct: 5 }),
    anEntry({ areaKey: 'community', name: 'Community', weightPct: 5 }),
  ];

  it('accepts a split that accounts for the whole capacity', () => {
    const verdict = verdictFor(SPLIT);
    expect(verdict.sumPct).toBe(REQUIRED_SUM_PCT);
    expect(verdict.valid).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  it('refuses a split that does not add up, and says what it adds up to', () => {
    const short = SPLIT.map((entry) =>
      entry.areaKey === 'health' ? { ...entry, weightPct: 20 } : entry,
    );
    const verdict = verdictFor(short);

    expect(verdict.valid).toBe(false);
    expect(verdict.sumPct).toBe(90);
    expect(verdict.problems.join(' ')).toContain('add up to 90%');
  });

  it('refuses a share outside the scale, naming the area', () => {
    const verdict = verdictFor([anEntry({ name: 'Craft', weightPct: 140 })]);
    expect(verdict.valid).toBe(false);
    expect(verdict.problems.join(' ')).toContain('Craft needs a share between 0 and 100');
  });

  it('treats a blank input as incomplete rather than as zero', () => {
    const verdict = verdictFor([...SPLIT.slice(1), anEntry({ weightPct: Number.NaN })]);
    expect(verdict.complete).toBe(false);
    expect(verdict.valid).toBe(false);
  });

  it('refuses an empty allocation rather than accepting a sum of zero', () => {
    const verdict = verdictFor([]);
    expect(verdict.valid).toBe(false);
    expect(verdict.problems.join(' ')).toContain('no rankable areas');
  });

  it('does not block a decision on floating-point dust', () => {
    // 33.33 × 3 is 99.99, which is the same decision as 100 and should not be
    // what stops it being taken.
    const thirds = [
      anEntry({ areaKey: 'a', name: 'A', weightPct: 33.33 }),
      anEntry({ areaKey: 'b', name: 'B', weightPct: 33.33 }),
      anEntry({ areaKey: 'c', name: 'C', weightPct: 33.34 }),
    ];
    expect(verdictFor(thirds).valid).toBe(true);
  });
});

describe('driftPct', () => {
  it('reports the move from the year being reviewed', () => {
    expect(driftPct(anEntry({ weightPct: 30, previousPct: 20 }))).toBe(10);
    expect(driftPct(anEntry({ weightPct: 15, previousPct: 20 }))).toBe(-5);
  });

  it('is null when there is nothing to compare against', () => {
    expect(driftPct(anEntry({ previousPct: null }))).toBeNull();
  });
});

describe('movedTowardObserved', () => {
  it('spots a weight being pulled toward what the area actually got', () => {
    // Declared 30, actually got 15, now being set to 20: the allocation is
    // being fitted to the behaviour rather than the other way round.
    expect(movedTowardObserved(anEntry({ previousPct: 30, observedPct: 15, weightPct: 20 }))).toBe(
      true,
    );
  });

  it('does not flag a weight moving away from what happened', () => {
    expect(movedTowardObserved(anEntry({ previousPct: 30, observedPct: 15, weightPct: 35 }))).toBe(
      false,
    );
  });

  it('does not flag an unchanged weight', () => {
    expect(movedTowardObserved(anEntry({ previousPct: 30, observedPct: 15, weightPct: 30 }))).toBe(
      false,
    );
  });

  it('says nothing when there is no history to judge against', () => {
    expect(movedTowardObserved(anEntry({ previousPct: null }))).toBe(false);
    expect(movedTowardObserved(anEntry({ observedPct: null }))).toBe(false);
  });
});
