import { describe, expect, it } from 'vitest';
import type { AreaSlot } from './contracts';
import {
  dayOf,
  daysSince,
  deadlineSentence,
  dueSummary,
  groupByArea,
  orderSlots,
  reasonSentence,
  stalenessOf,
  STALE_AFTER_DAYS,
} from './focus-view';
import { aFocusEntry, anInitiative } from './test-fixtures';

const NOW = new Date('2026-09-18T12:00:00.000Z');

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince('2026-09-11T12:00:00.000Z', NOW)).toBe(7);
  });

  it('rounds down, so a day is only counted once it has passed', () => {
    expect(daysSince('2026-09-17T13:00:00.000Z', NOW)).toBe(0);
    expect(daysSince('2026-09-17T11:00:00.000Z', NOW)).toBe(1);
  });

  it('is null with nothing to measure from', () => {
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('is null rather than NaN on an unparseable instant', () => {
    expect(daysSince('the day before yesterday', NOW)).toBeNull();
  });

  it('clamps a future timestamp to today rather than printing a negative age', () => {
    expect(daysSince('2026-09-20T12:00:00.000Z', NOW)).toBe(0);
  });
});

describe('stalenessOf', () => {
  it('is not stale below the threshold', () => {
    const entry = aFocusEntry({
      initiative: anInitiative({
        rollup: {
          openTaskCount: 1,
          totalTaskCount: 2,
          progressPct: 50,
          lastActivity: '2026-09-16T12:00:00.000Z',
        },
      }),
    });

    expect(stalenessOf(entry, NOW, STALE_AFTER_DAYS)).toMatchObject({ idleDays: 2, stale: false });
  });

  it('is stale exactly at the threshold, not a day after it', () => {
    const entry = aFocusEntry({
      initiative: anInitiative({
        rollup: {
          openTaskCount: 1,
          totalTaskCount: 2,
          progressPct: 50,
          lastActivity: '2026-09-11T12:00:00.000Z',
        },
      }),
    });

    const staleness = stalenessOf(entry, NOW, STALE_AFTER_DAYS);
    expect(staleness.stale).toBe(true);
    expect(staleness.label).toBe('No activity for 7 days');
  });

  it('ages an initiative nothing has ever touched by its creation date', () => {
    const entry = aFocusEntry({
      initiative: anInitiative({
        createdAt: '2026-08-01T12:00:00.000Z',
        rollup: {
          openTaskCount: 0,
          totalTaskCount: 0,
          progressPct: null,
          lastActivity: null,
        },
      }),
    });

    const staleness = stalenessOf(entry, NOW, STALE_AFTER_DAYS);
    expect(staleness.stale).toBe(true);
    expect(staleness.label).toBe('No task has ever moved here — 48 days old');
  });
});

describe('groupByArea', () => {
  const slots: AreaSlot[] = [
    { areaKey: 'craft', kind: 'area', used: 1, limit: 2 },
    { areaKey: 'home', kind: 'area', used: 2, limit: 2 },
  ];

  it('keeps the ranking the API sent, both between areas and inside one', () => {
    const entries = [
      aFocusEntry({ rank: 1, initiative: anInitiative({ id: 'a', areaKey: 'home' }) }),
      aFocusEntry({ rank: 2, initiative: anInitiative({ id: 'b', areaKey: 'craft' }) }),
      aFocusEntry({ rank: 3, initiative: anInitiative({ id: 'c', areaKey: 'home' }) }),
    ];

    const groups = groupByArea(entries, slots);

    expect(groups.map((group) => group.areaKey)).toEqual(['home', 'craft']);
    expect(groups[0]?.entries.map((entry) => entry.initiative.id)).toEqual(['a', 'c']);
  });

  it('attaches each area its slot line, and tolerates one the API did not send', () => {
    const entries = [
      aFocusEntry({ initiative: anInitiative({ id: 'a', areaKey: 'craft' }) }),
      aFocusEntry({ initiative: anInitiative({ id: 'b', areaKey: 'money' }) }),
    ];

    const groups = groupByArea(entries, slots);

    expect(groups[0]?.slot?.limit).toBe(2);
    expect(groups[1]?.slot).toBeUndefined();
  });

  it('is empty for an empty now set', () => {
    expect(groupByArea([], slots)).toEqual([]);
  });
});

describe('reasonSentence', () => {
  it('has a sentence for every reason the API can send', () => {
    const reasons = [
      'in_flight',
      'selected',
      'area_at_cap',
      'wip_full',
      'blocked',
      'too_large',
      'not_a_candidate',
    ] as const;

    for (const reason of reasons) {
      expect(reasonSentence(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('deadlineSentence', () => {
  it('says nothing when there is no deadline', () => {
    expect(deadlineSentence(null, false)).toBeNull();
  });

  it('counts down, and says today on the day', () => {
    expect(deadlineSentence(3, false)).toBe('3 days to its deadline');
    expect(deadlineSentence(0, false)).toBe('Deadline today');
  });

  it('counts up once it is behind', () => {
    expect(deadlineSentence(-2, false)).toBe('2 days past its deadline');
  });

  it('reports the schedule engine rather than applying a day threshold', () => {
    expect(deadlineSentence(30, true)).toBe(
      '30 days to its deadline — the schedule says that is not reachable',
    );
  });
});

describe('dueSummary', () => {
  const today = '2026-09-18';

  it('counts open work by when it was due, and ignores what is done', () => {
    const summary = dueSummary(
      [
        { completed: false, due: '2026-09-18' },
        { completed: false, due: '2026-09-17' },
        { completed: false, due: null },
        { completed: true, due: '2026-09-18' },
        { completed: false, due: '2026-09-25' },
      ],
      today,
    );

    expect(summary).toEqual({ dueToday: 1, overdue: 1, open: 4 });
  });

  it('is all zeroes for an initiative with no mirrored tasks', () => {
    expect(dueSummary([], today)).toEqual({ dueToday: 0, overdue: 0, open: 0 });
  });
});

describe('dayOf', () => {
  it('takes the calendar day out of an instant', () => {
    expect(dayOf('2026-09-18T22:30:00.000Z')).toBe('2026-09-18');
  });
});

describe('orderSlots', () => {
  it('puts lanes last: Run and Signals are context, not the subject', () => {
    const ordered = orderSlots([
      { areaKey: 'run', kind: 'run', used: 1, limit: 1 },
      { areaKey: 'home', kind: 'area', used: 0, limit: 2 },
      { areaKey: 'signals', kind: 'signals', used: 0, limit: 0 },
      { areaKey: 'craft', kind: 'area', used: 1, limit: 2 },
    ]);

    expect(ordered.map((slot) => slot.areaKey)).toEqual(['craft', 'home', 'run', 'signals']);
  });
});
