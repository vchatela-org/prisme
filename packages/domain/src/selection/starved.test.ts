import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../entities/calendar.js';
import { anArea, anInitiative } from '../test-support/builders.js';
import { STARVED_BALANCE_FACTOR, starvedWithNothingQueued, type UnderWayContext } from './index.js';

const UNDER_WAY: UnderWayContext = {
  today: parseCalendarDate('2026-09-15'),
  projectStatusById: new Map([['p-paused', 'paused']]),
};

const AREAS = [
  anArea({ key: 'alpha' }),
  anArea({ key: 'beta' }),
  anArea({ key: 'gamma' }),
  anArea({ key: 'retired', active: false }),
  anArea({ key: 'upkeep', kind: 'run' }),
];

const CAPACITY = [
  { areaKey: 'alpha', balanceFactor: 2 },
  { areaKey: 'beta', balanceFactor: STARVED_BALANCE_FACTOR },
  { areaKey: 'gamma', balanceFactor: 1.49 },
  { areaKey: 'retired', balanceFactor: 2 },
  { areaKey: 'upkeep', balanceFactor: 2 },
];

function starved(initiatives: Parameters<typeof starvedWithNothingQueued>[0]['initiatives']) {
  return starvedWithNothingQueued({
    areas: AREAS,
    capacity: CAPACITY,
    initiatives,
    underWay: UNDER_WAY,
  }).map((entry) => entry.areaKey);
}

describe('starvedWithNothingQueued', () => {
  it('names every rankable area at or above the threshold with nothing in it', () => {
    expect(starved([])).toEqual(['alpha', 'beta']);
  });

  it('carries the factor it read', () => {
    expect(
      starvedWithNothingQueued({
        areas: AREAS,
        capacity: CAPACITY,
        initiatives: [],
        underWay: UNDER_WAY,
      })[0],
    ).toEqual({ areaKey: 'alpha', balanceFactor: 2 });
  });

  it('leaves out an area below the threshold, a lane and a retired area', () => {
    const keys = starved([]);
    expect(keys).not.toContain('gamma');
    expect(keys).not.toContain('upkeep');
    expect(keys).not.toContain('retired');
  });

  it.each(['inbox', 'later', 'next', 'now', 'waiting'] as const)(
    'counts a %s initiative as queued',
    (status) => {
      expect(starved([anInitiative({ areaKey: 'alpha', status })])).toEqual(['beta']);
    },
  );

  it.each(['review', 'done', 'dropped'] as const)(
    'does not count a %s initiative as queued',
    (status) => {
      expect(starved([anInitiative({ areaKey: 'alpha', status })])).toEqual(['alpha', 'beta']);
    },
  );

  it('does not count work that is not under way (ADR-0035)', () => {
    expect(
      starved([
        anInitiative({ id: 'a', areaKey: 'alpha', earliestStart: parseCalendarDate('2027-01-04') }),
        anInitiative({ id: 'b', areaKey: 'beta', projectId: 'p-paused' }),
      ]),
    ).toEqual(['alpha', 'beta']);
  });

  it('ignores an area the window did not measure', () => {
    expect(
      starvedWithNothingQueued({
        areas: AREAS,
        capacity: [],
        initiatives: [],
        underWay: UNDER_WAY,
      }),
    ).toEqual([]);
  });

  it('is ordered by key whatever order the areas arrive in', () => {
    expect(
      starvedWithNothingQueued({
        areas: [...AREAS].reverse(),
        capacity: CAPACITY,
        initiatives: [],
        underWay: UNDER_WAY,
      }).map((entry) => entry.areaKey),
    ).toEqual(['alpha', 'beta']);
  });
});
