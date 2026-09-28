import { describe, expect, it } from 'vitest';
import type { AdoptionCandidateRecord } from '../store/types.js';
import {
  calendarDayIn,
  endedDigest,
  endedSelection,
  NO_AREA,
  periodOf,
  queueView,
  sourceOf,
  type EndedFilter,
} from './adoption-queue.js';
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

describe('endedSelection', () => {
  const endsToday = candidate('ends-today', { startsOn: '2026-09-01', endsOn: TODAY });
  const endedYesterday = candidate('ended-yesterday', {
    startsOn: '2026-09-26',
    endsOn: '2026-09-26',
  });
  const endedProcess = candidate('ended-process', {
    sourceRole: 'processes_db',
    proposedKind: 'ritual',
    startsOn: '2025-01-01',
    endsOn: '2025-06-30',
  });
  const endedTask = candidate('ended-task', {
    externalKind: 'task',
    sourceRole: null,
    areaKey: 'home',
    proposedKind: 'initiative',
    startsOn: '2025-03-01',
    endsOn: '2025-03-31',
  });
  const ALL = [...QUEUE, endsToday, endedYesterday, endedProcess, endedTask];

  const ids = (filter: EndedFilter, today = TODAY): string[] =>
    endedSelection(ALL, filter, today).candidates.map((item) => item.externalId);

  it('takes what has ended and nothing else', () => {
    expect(ids({})).toEqual(['past', 'ended-yesterday', 'ended-process', 'ended-task']);
  });

  it('does not take a period that ends today: it has not ended yet', () => {
    expect(ids({})).not.toContain('ends-today');
    // The next day, it has.
    expect(ids({}, '2026-09-28')).toContain('ends-today');
  });

  it('respects the source, area and kind filters', () => {
    expect(ids({ source: 'objectives_db' })).toEqual(['past', 'ended-yesterday']);
    expect(ids({ source: 'task' })).toEqual(['ended-task']);
    expect(ids({ areaKey: 'home' })).toEqual(['ended-task']);
    expect(ids({ areaKey: NO_AREA })).toEqual(['past', 'ended-yesterday', 'ended-process']);
    expect(ids({ kind: 'ritual' })).toEqual(['ended-process']);
    expect(ids({ source: 'objectives_db', areaKey: 'home' })).toEqual([]);
  });

  it('cannot be widened past ended, whatever the filter carries', () => {
    // A caller holding a queue filter passes it whole; `when` is not read.
    const widened = { when: 'all', source: 'objectives_db' } as EndedFilter;
    expect(ids(widened)).toEqual(['past', 'ended-yesterday']);
    for (const item of endedSelection(ALL, widened, TODAY).candidates) {
      expect(periodOf(item, TODAY)).toBe('ended');
    }
  });

  it('counts exactly what the Ended filter shows, under every filter', () => {
    const filters: EndedFilter[] = [
      {},
      { source: 'objectives_db' },
      { source: 'task' },
      { areaKey: NO_AREA },
      { areaKey: 'home' },
      { kind: 'key_result' },
      { source: 'processes_db', areaKey: NO_AREA },
    ];
    for (const filter of filters) {
      const selection = endedSelection(ALL, filter, TODAY);
      const shown = queueView(ALL, { ...filter, when: 'ended' }, TODAY, PAGE);
      expect(selection.candidates).toEqual(shown.items);
      expect(selection.count).toBe(shown.facets.when.ended);
      // And the same number the default view says it is hiding.
      expect(selection.count).toBe(
        queueView(ALL, { ...filter, when: 'open' }, TODAY, PAGE).facets.when.ended,
      );
    }
  });

  it('names the set with a digest that moves when the set does, and only then', () => {
    const before = endedSelection(ALL, {}, TODAY);
    expect(before.digest).toBe(endedDigest(before.candidates));
    expect(before.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The same set in another order, or with other titles, is the same set.
    expect(endedDigest([...before.candidates].reverse())).toBe(before.digest);
    const retitled = ALL.map((item) => ({ ...item, title: `${item.title}, renamed` }));
    expect(endedSelection(retitled, {}, TODAY).digest).toBe(before.digest);

    // One more ended, one fewer, or the day turning over: another set.
    const extra = candidate('another-ended', { startsOn: '2023-01-01', endsOn: '2023-12-31' });
    expect(endedSelection([...ALL, extra], {}, TODAY).digest).not.toBe(before.digest);
    expect(endedSelection(ALL.slice(1), {}, TODAY).digest).not.toBe(before.digest);
    expect(endedSelection(ALL, {}, '2026-09-28').digest).not.toBe(before.digest);
    // A different kind with the same identifier is a different object.
    const asTask = { ...past, externalKind: 'task' };
    expect(endedDigest([asTask])).not.toBe(endedDigest([past]));
  });

  it('is empty, with a digest of its own, when nothing has ended', () => {
    const selection = endedSelection([current, upcoming, undated], {}, TODAY);
    expect(selection.count).toBe(0);
    expect(selection.digest).toBe(endedDigest([]));
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
