import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from './calendar.js';
import { INITIATIVE_STATUSES } from './initiative.js';
import {
  INITIATIVE_HORIZON_DAYS,
  keyResultHints,
  type KeyResultHintObjective,
  type KeyResultHintSubject,
} from './key-result-hint.js';

/**
 * The key-result hint — docs/19-how-it-works.md S1. A hint is shown, never
 * acted on, so the tests check both halves: it appears where an initiative
 * looks like a key result, and it stays away from ordinary work.
 */

const TODAY = parseCalendarDate('2026-10-28');

function subjectOf(overrides: Partial<KeyResultHintSubject> = {}): KeyResultHintSubject {
  return { title: 'Repaint the fence', areaKey: 'home', status: 'inbox', ...overrides };
}

const BE_FITTER: KeyResultHintObjective = {
  title: 'Be fitter',
  areaKey: 'health',
  status: 'active',
};

/** The calendar day `days` after today. */
function inDays(days: number) {
  const date = new Date(Date.UTC(2026, 9, 28 + days));
  return parseCalendarDate(date.toISOString().slice(0, 10));
}

describe('a deadline beyond six weeks', () => {
  it('is hinted one day past the horizon, and not on it', () => {
    expect(
      keyResultHints(subjectOf({ deadline: inDays(INITIATIVE_HORIZON_DAYS + 1) }), [], TODAY),
    ).toEqual(['long_horizon']);
    expect(
      keyResultHints(subjectOf({ deadline: inDays(INITIATIVE_HORIZON_DAYS) }), [], TODAY),
    ).toEqual([]);
  });

  it('is the year-end deadline a goal kept as a task arrives with', () => {
    expect(
      keyResultHints(subjectOf({ deadline: parseCalendarDate('2026-12-31') }), [], TODAY),
    ).toEqual(['long_horizon']);
  });

  it('counts from a later earliest start, since the work cannot begin before it', () => {
    expect(
      keyResultHints(subjectOf({ earliestStart: inDays(30), deadline: inDays(60) }), [], TODAY),
    ).toEqual([]);
  });

  it('counts from today when the earliest start has passed', () => {
    expect(
      keyResultHints(subjectOf({ earliestStart: inDays(-30), deadline: inDays(50) }), [], TODAY),
    ).toEqual(['long_horizon']);
  });

  it('is never hinted without a deadline, or with one behind', () => {
    expect(keyResultHints(subjectOf(), [], TODAY)).toEqual([]);
    expect(keyResultHints(subjectOf({ deadline: inDays(-90) }), [], TODAY)).toEqual([]);
  });

  it('only ever appears further out, never closer in', () => {
    // Monotone in the deadline: once hinted, every later deadline is hinted too.
    let seen = false;
    for (let days = -10; days <= 120; days += 1) {
      const hinted = keyResultHints(subjectOf({ deadline: inDays(days) }), [], TODAY).includes(
        'long_horizon',
      );
      if (seen) expect(hinted).toBe(true);
      seen ||= hinted;
    }
    expect(seen).toBe(true);
  });
});

describe('a title an objective already has', () => {
  it('is hinted in the objective’s area', () => {
    expect(
      keyResultHints(subjectOf({ title: 'Be fitter', areaKey: 'health' }), [BE_FITTER], TODAY),
    ).toEqual(['objective_title']);
  });

  it('matches the way adoption does: case, accents, punctuation, numbering', () => {
    expect(
      keyResultHints(subjectOf({ title: '1. be FITTER!', areaKey: 'health' }), [BE_FITTER], TODAY),
    ).toEqual(['objective_title']);
  });

  it('is not hinted in another area', () => {
    expect(
      keyResultHints(subjectOf({ title: 'Be fitter', areaKey: 'home' }), [BE_FITTER], TODAY),
    ).toEqual([]);
  });

  it('is not hinted against an objective that is closed', () => {
    for (const status of ['met', 'missed', 'dropped'] as const) {
      expect(
        keyResultHints(
          subjectOf({ title: 'Be fitter', areaKey: 'health' }),
          [{ ...BE_FITTER, status }],
          TODAY,
        ),
      ).toEqual([]);
    }
    expect(
      keyResultHints(
        subjectOf({ title: 'Be fitter', areaKey: 'health' }),
        [{ ...BE_FITTER, status: 'draft' }],
        TODAY,
      ),
    ).toEqual(['objective_title']);
  });

  it('is not hinted for a title that merely contains the objective’s', () => {
    expect(
      keyResultHints(
        subjectOf({ title: 'Be fitter by running twice a week', areaKey: 'health' }),
        [BE_FITTER],
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe('which initiatives are hinted at all', () => {
  it('is open work only — both signs together, in a fixed order', () => {
    const looksLikeOne = subjectOf({
      title: 'Be fitter',
      areaKey: 'health',
      deadline: parseCalendarDate('2026-12-31'),
    });
    for (const status of INITIATIVE_STATUSES) {
      const hints = keyResultHints({ ...looksLikeOne, status }, [BE_FITTER], TODAY);
      if (status === 'review' || status === 'done' || status === 'dropped') {
        expect(hints).toEqual([]);
      } else {
        expect(hints).toEqual(['long_horizon', 'objective_title']);
      }
    }
  });
});
