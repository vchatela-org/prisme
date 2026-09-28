import { docIdKey, type DocPropertyValue } from '@prisme/connectors';
import type { CalendarDate } from '@prisme/domain';
import { describe, expect, it } from 'vitest';
import { lastAppliedKey, type LastAppliedIndex } from '../reconcile/types.js';
import {
  datesValue,
  formatObjectivePagePlan,
  OBJECTIVE_PAGE,
  observedDatesOf,
  PAGE_DATES_FIELD,
  planObjectivePages,
  type LinkedObjective,
  type ObservedEntry,
} from './plan.js';

/**
 * The objective-pages planner (ADR-0034), against plain values.
 *
 * Every identifier and title here is invented (docs/17-privacy.md).
 */

const OBJECTIVE: LinkedObjective = {
  objectiveId: 'objective-0001',
  title: 'Run a first marathon',
  type: 'annual',
  period: '2027',
  pageId: 'page-0001',
};

const YEAR_2027 = datesValue('2027-01-01', '2027-12-31');
const YEAR_2028 = datesValue('2028-01-01', '2028-12-31');

function entry(overrides: Partial<ObservedEntry> = {}): ObservedEntry {
  return { pageId: 'page-0001', archived: false, dates: YEAR_2028, ...overrides };
}

function lastApplied(pageId: string, value: string): LastAppliedIndex {
  return new Map([
    [
      lastAppliedKey(OBJECTIVE_PAGE, pageId, PAGE_DATES_FIELD),
      {
        entityKind: OBJECTIVE_PAGE,
        entityId: pageId,
        field: PAGE_DATES_FIELD,
        value,
        appliedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
  ]);
}

/**
 * One page's id, both ways the tool writes it — built at run time, because the
 * privacy deny-list refuses an identifier-shaped literal in the tree.
 */
const BARE = 'd'.repeat(32);
const DASHED = [8, 4, 4, 4, 12].map((length) => 'd'.repeat(length)).join('-');

const NOTHING_WRITTEN: LastAppliedIndex = new Map();
const CONFIG = { pageKey: docIdKey };

describe('an objective’s period, reconciled into its page', () => {
  it('sends nothing when the page already carries the period', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ dates: YEAR_2027 })],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('in_sync');
    expect(plan.actions[0]?.write).toBeUndefined();
    expect(plan.counts.in_sync).toBe(1);
  });

  it('writes the period the first time, without calling it a conflict', () => {
    // The objective moved from 2028 to 2027 in prisme, and nothing was ever
    // written to the page: prisme states its own value.
    const plan = planObjectivePages([OBJECTIVE], [entry()], NOTHING_WRITTEN, CONFIG);
    const action = plan.actions[0];

    expect(action?.verdict).toBe('update');
    expect(action?.write).toEqual({
      pageId: 'page-0001',
      startsOn: '2027-01-01',
      endsOn: '2027-12-31',
    });
    expect(action?.lastApplied).toEqual([
      { entityKind: OBJECTIVE_PAGE, entityId: 'page-0001', field: 'dates', value: YEAR_2027 },
    ]);
    expect(action?.conflict).toBeUndefined();
    expect(action?.detail).toBe(`dates ${YEAR_2028} → ${YEAR_2027}`);
  });

  it('writes a changed mind as an update: the page still holds what prisme last wrote', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry()],
      lastApplied('page-0001', YEAR_2028),
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('update');
    expect(plan.actions[0]?.conflict).toBeUndefined();
  });

  it('restores a hand edit and records it as a conflict prisme wins', () => {
    const edited = datesValue('2027-03-01', '2027-12-31');
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ dates: edited })],
      lastApplied('page-0001', YEAR_2027),
      CONFIG,
    );
    const action = plan.actions[0];

    expect(action?.verdict).toBe('conflict');
    expect(action?.write).toMatchObject({ startsOn: '2027-01-01', endsOn: '2027-12-31' });
    expect(action?.conflict).toEqual({
      entityId: 'objective-0001',
      field: 'period',
      prismeValue: YEAR_2027,
      externalValue: edited,
      resolution: 'prisme_wins',
    });
  });

  it('fills an emptied date column back in', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ dates: null })],
      lastApplied('page-0001', YEAR_2027),
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('conflict');
    expect(plan.actions[0]?.conflict?.externalValue).toBeNull();
    expect(plan.actions[0]?.detail).toContain(`no date → ${YEAR_2027}`);
  });

  it('writes a monthly objective’s whole month', () => {
    const plan = planObjectivePages(
      [{ ...OBJECTIVE, type: 'monthly', period: '2027-02' }],
      [entry()],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.write).toMatchObject({ startsOn: '2027-02-01', endsOn: '2027-02-28' });
  });

  it('matches the stored link to the page the way the tool writes one id two ways, and writes to the tool’s form', () => {
    const plan = planObjectivePages(
      [{ ...OBJECTIVE, pageId: BARE }],
      [entry({ pageId: DASHED })],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('update');
    expect(plan.actions[0]?.write?.pageId).toBe(DASHED);
  });
});

describe('what is never written', () => {
  it('a page that is not an entry of the objectives store', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ pageId: 'page-0002' })],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('not_in_store');
    expect(plan.actions[0]?.write).toBeUndefined();
  });

  it('a page in the trash', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ archived: true })],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('trashed');
    expect(plan.actions[0]?.write).toBeUndefined();
  });

  it('a page with no date column by the chosen name', () => {
    const plan = planObjectivePages(
      [OBJECTIVE],
      [entry({ dates: undefined })],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('no_column');
  });

  it('a page two objectives link, rather than writing both periods in turn for ever', () => {
    const plan = planObjectivePages(
      [OBJECTIVE, { ...OBJECTIVE, objectiveId: 'objective-0002', period: '2029' }],
      [entry()],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions.map((action) => action.verdict)).toEqual(['shared_page', 'shared_page']);
    expect(plan.counts.shared_page).toBe(2);
  });

  it('a period not written the way its type says', () => {
    const plan = planObjectivePages(
      [{ ...OBJECTIVE, type: 'monthly', period: '2027' }],
      [entry()],
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(plan.actions[0]?.verdict).toBe('unwritable_period');
  });
});

describe('the plan as a whole', () => {
  it('is the same plan in the same order from the same state', () => {
    const objectives = [
      { ...OBJECTIVE, objectiveId: 'objective-0002', pageId: 'page-0002' },
      OBJECTIVE,
    ];
    const entries = [entry(), entry({ pageId: 'page-0002' })];

    const first = planObjectivePages(objectives, entries, NOTHING_WRITTEN, CONFIG);
    const second = planObjectivePages(
      [...objectives].reverse(),
      [...entries].reverse(),
      NOTHING_WRITTEN,
      CONFIG,
    );

    expect(second).toEqual(first);
    expect(first.actions.map((action) => action.objectiveId)).toEqual([
      'objective-0001',
      'objective-0002',
    ]);
  });

  it('converges: once written, the next pass has nothing to do', () => {
    const first = planObjectivePages([OBJECTIVE], [entry()], NOTHING_WRITTEN, CONFIG);
    const written = first.actions[0]?.write;
    const next = planObjectivePages(
      [OBJECTIVE],
      [entry({ dates: datesValue(written?.startsOn ?? '', written?.endsOn ?? '') })],
      lastApplied('page-0001', YEAR_2027),
      CONFIG,
    );

    expect(next.actions[0]?.verdict).toBe('in_sync');
  });

  it('prints what will change, and a summary line', () => {
    const report = formatObjectivePagePlan(
      planObjectivePages([OBJECTIVE], [entry()], NOTHING_WRITTEN, CONFIG),
    );

    expect(report).toContain('update');
    expect(report).toContain('Run a first marathon');
    expect(report).toContain(
      'Objective pages: 1 to update, 0 conflicts, 0 not writable, 0 unchanged.',
    );
  });

  it('says so when every page already carries its period', () => {
    const report = formatObjectivePagePlan(
      planObjectivePages([OBJECTIVE], [entry({ dates: YEAR_2027 })], NOTHING_WRITTEN, CONFIG),
    );

    expect(report).toContain('nothing to do');
  });
});

describe('a date column, as the planner compares it', () => {
  const date = (start: string | null, end: string | null): DocPropertyValue => ({
    kind: 'date',
    start: start as CalendarDate | null,
    end: end as CalendarDate | null,
  });

  it('is the range for a range, and the day alone for a single date', () => {
    expect(observedDatesOf(date('2027-01-01', '2027-12-31'))).toBe(YEAR_2027);
    expect(observedDatesOf(date('2027-01-01', null))).toBe('2027-01-01');
  });

  it('is null when empty, and nothing at all when it is not a date', () => {
    expect(observedDatesOf(date(null, null))).toBeNull();
    expect(observedDatesOf(undefined)).toBeUndefined();
    expect(observedDatesOf({ kind: 'number', value: 3 })).toBeUndefined();
  });
});
