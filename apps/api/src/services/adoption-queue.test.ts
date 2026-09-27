import { describe, expect, it } from 'vitest';
import type { AdoptionCandidateRecord } from '../store/types.js';
import { calendarDayIn, NO_AREA, periodOf, queueView, sourceOf } from './adoption-queue.js';
import { carriedDateProperty } from './settings.js';

/** Synthetic candidates. No real title, store or area appears in this file. */
function candidate(
  id: string,
  over: Partial<AdoptionCandidateRecord> = {},
): AdoptionCandidateRecord {
  return {
    externalKind: 'page',
    externalId: id,
    title: `An invented candidate ${id}`,
    areaKey: null,
    proposedKind: 'key_result',
    reason: 'held in the objectives store',
    matchRule: null,
    confidence: null,
    proposedId: null,
    similarity: null,
    scannedAt: new Date('2026-09-27T06:00:00Z'),
    sourceRole: 'objectives_db',
    startsOn: null,
    endsOn: null,
    ...over,
  };
}

const TODAY = '2026-09-27';
const PAGE = { limit: 100, offset: 0 };

const past = candidate('past', { startsOn: '2024-01-01', endsOn: '2024-12-31' });
const current = candidate('current', { startsOn: '2026-01-01', endsOn: '2026-12-31' });
const upcoming = candidate('upcoming', { startsOn: '2027-01-01', endsOn: '2027-12-31' });
const undated = candidate('undated', { sourceRole: 'processes_db', proposedKind: 'ritual' });
const task = candidate('task', {
  externalKind: 'task',
  sourceRole: null,
  areaKey: 'home',
  proposedKind: 'initiative',
});

const QUEUE = [past, current, upcoming, undated, task];

describe('periodOf', () => {
  it('reads a period against today, inclusive at both ends', () => {
    expect(periodOf(past, TODAY)).toBe('ended');
    expect(periodOf(current, TODAY)).toBe('current');
    expect(periodOf(upcoming, TODAY)).toBe('upcoming');
    expect(periodOf(undated, TODAY)).toBe('undated');
    // A period that ends today has not ended; one that starts today has started.
    expect(periodOf({ startsOn: '2026-09-01', endsOn: TODAY }, TODAY)).toBe('current');
    expect(periodOf({ startsOn: TODAY, endsOn: TODAY }, TODAY)).toBe('current');
    expect(periodOf({ startsOn: '2026-09-26', endsOn: '2026-09-26' }, TODAY)).toBe('ended');
  });
});

describe('queueView', () => {
  it('leaves out what has ended by default, and says how many it left out', () => {
    const view = queueView(QUEUE, { when: 'open' }, TODAY, PAGE);
    expect(view.items.map((item) => item.externalId)).toEqual([
      'current',
      'upcoming',
      'undated',
      'task',
    ]);
    expect(view.total).toBe(4);
    expect(view.facets.when).toEqual({
      open: 4,
      current: 1,
      upcoming: 1,
      undated: 2,
      ended: 1,
      all: 5,
    });
  });

  it('shows only what has ended when asked, and everything under all', () => {
    expect(queueView(QUEUE, { when: 'ended' }, TODAY, PAGE).items).toEqual([past]);
    expect(queueView(QUEUE, { when: 'all' }, TODAY, PAGE).total).toBe(5);
  });

  it('filters by source: a store for a page, the kind for a task-tool object', () => {
    expect(sourceOf(task)).toBe('task');
    expect(sourceOf(undated)).toBe('processes_db');
    const view = queueView(QUEUE, { when: 'open', source: 'processes_db' }, TODAY, PAGE);
    expect(view.items).toEqual([undated]);
  });

  it('filters by area, and by no area at all', () => {
    expect(queueView(QUEUE, { when: 'all', areaKey: 'home' }, TODAY, PAGE).items).toEqual([task]);
    expect(queueView(QUEUE, { when: 'all', areaKey: NO_AREA }, TODAY, PAGE).total).toBe(4);
  });

  it('counts each filter over the rows the other filters leave, so a count is what a click shows', () => {
    const view = queueView(QUEUE, { when: 'open', source: 'objectives_db' }, TODAY, PAGE);
    // The source counts ignore the source filter, and respect the date one: the
    // ended objective is not among the three objectives counted.
    expect(view.facets.source).toEqual([
      { key: 'objectives_db', count: 2 },
      { key: 'processes_db', count: 1 },
      { key: 'task', count: 1 },
    ]);
    // The date counts ignore the date filter, and respect the source one.
    expect(view.facets.when).toMatchObject({ ended: 1, current: 1, upcoming: 1, undated: 0 });
    expect(view.facets.area).toEqual([{ key: null, count: 2 }]);
  });

  it('pages after filtering, and keeps the total of the whole filtered set', () => {
    const view = queueView(QUEUE, { when: 'all' }, TODAY, { limit: 2, offset: 2 });
    expect(view.items.map((item) => item.externalId)).toEqual(['upcoming', 'undated']);
    expect(view.total).toBe(5);
  });
});

describe('calendarDayIn', () => {
  it('is the day in the instance timezone, not in UTC', () => {
    // 23:30 UTC on the 26th is already the 27th in Paris.
    const now = new Date('2026-09-26T23:30:00Z');
    expect(calendarDayIn('UTC', now)).toBe('2026-09-26');
    expect(calendarDayIn('Europe/Paris', now)).toBe('2026-09-27');
  });
});

describe('carriedDateProperty', () => {
  it('keeps the choice while the store still has that date property', () => {
    expect(carriedDateProperty('When', ['Due', 'When'])).toBe('When');
  });

  it('drops it once the store no longer has it, rather than dating nothing silently', () => {
    expect(carriedDateProperty('When', ['Due'])).toBeNull();
  });

  it('keeps it when the check did not read the schema, since nothing is known to have changed', () => {
    expect(carriedDateProperty('When', null)).toBe('When');
    expect(carriedDateProperty(null, ['When'])).toBeNull();
  });
});
