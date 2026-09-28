import { describe, expect, it } from 'vitest';
import { adoptRefusal, isAdoptableKind, type AdoptionSubject } from './adoption.js';
import { objectivePeriodOf } from './objective.js';

describe('the objective a period names', () => {
  it('is annual for exactly one calendar year', () => {
    expect(objectivePeriodOf('2026-01-01', '2026-12-31')).toEqual({
      type: 'annual',
      period: '2026',
    });
  });

  it('is monthly for exactly one calendar month, whatever its length', () => {
    expect(objectivePeriodOf('2026-09-01', '2026-09-30')).toEqual({
      type: 'monthly',
      period: '2026-09',
    });
    expect(objectivePeriodOf('2026-01-01', '2026-01-31')).toEqual({
      type: 'monthly',
      period: '2026-01',
    });
    expect(objectivePeriodOf('2028-02-01', '2028-02-29')).toEqual({
      type: 'monthly',
      period: '2028-02',
    });
    expect(objectivePeriodOf('2026-02-01', '2026-02-28')).toEqual({
      type: 'monthly',
      period: '2026-02',
    });
  });

  it('is nothing for any other span, rather than the nearest shape', () => {
    // A quarter, a year that starts in March, a fortnight, a month one day
    // short, a year spilling into the next, and a single day.
    expect(objectivePeriodOf('2026-01-01', '2026-03-31')).toBeUndefined();
    expect(objectivePeriodOf('2026-03-01', '2027-02-28')).toBeUndefined();
    expect(objectivePeriodOf('2026-09-01', '2026-09-14')).toBeUndefined();
    expect(objectivePeriodOf('2026-09-01', '2026-09-29')).toBeUndefined();
    expect(objectivePeriodOf('2026-01-01', '2027-01-01')).toBeUndefined();
    expect(objectivePeriodOf('2026-09-01', '2026-09-01')).toBeUndefined();
  });

  it('is nothing without both dates, or with one that is not a day', () => {
    expect(objectivePeriodOf(null, null)).toBeUndefined();
    expect(objectivePeriodOf('2026-01-01', null)).toBeUndefined();
    expect(objectivePeriodOf(undefined, '2026-12-31')).toBeUndefined();
    expect(objectivePeriodOf('2026-02-01', '2026-02-30')).toBeUndefined();
  });
});

describe('why adopting a candidate would be refused', () => {
  const objective: AdoptionSubject = {
    externalKind: 'page',
    proposedKind: 'objective',
    areaKey: 'craft',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
  };

  it('is not refused for an objectives page with an area and a calendar period', () => {
    expect(adoptRefusal(objective)).toBeUndefined();
    expect(adoptRefusal({ ...objective, startsOn: '2026-09-01', endsOn: '2026-09-30' })).toBe(
      undefined,
    );
  });

  it('is not refused for a task-tool initiative or project in an area', () => {
    const task = { ...objective, externalKind: 'task', startsOn: null, endsOn: null };
    expect(adoptRefusal({ ...task, proposedKind: 'initiative' })).toBeUndefined();
    expect(adoptRefusal({ ...task, externalKind: 'project', proposedKind: 'project' })).toBe(
      undefined,
    );
  });

  it('refuses an objective whose dates are not one calendar year or month', () => {
    expect(adoptRefusal({ ...objective, endsOn: '2026-03-31' })).toBe('period_not_calendar');
    expect(adoptRefusal({ ...objective, startsOn: null, endsOn: null })).toBe(
      'period_not_calendar',
    );
  });

  it('refuses an objective with no area before looking at its dates', () => {
    expect(adoptRefusal({ ...objective, areaKey: null, endsOn: null })).toBe('no_area');
  });

  it('refuses a page proposed as an initiative — a takeaway is promoted', () => {
    expect(adoptRefusal({ ...objective, proposedKind: 'initiative' })).toBe('promote_takeaway');
  });

  it('refuses a key result and a ritual by kind, before the area', () => {
    // The area is not the problem for either, so it is not the advice.
    expect(adoptRefusal({ ...objective, proposedKind: 'key_result', areaKey: null })).toBe(
      'needs_objective',
    );
    expect(adoptRefusal({ ...objective, proposedKind: 'ritual', areaKey: null })).toBe(
      'needs_cadence',
    );
  });

  it('refuses a kind that stays where it is', () => {
    for (const kind of ['task', 'takeaway', 'run', 'signal']) {
      expect(isAdoptableKind(kind)).toBe(false);
      expect(adoptRefusal({ ...objective, proposedKind: kind })).toBe('not_adoptable');
    }
  });
});
