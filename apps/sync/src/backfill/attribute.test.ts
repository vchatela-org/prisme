import { describe, expect, it } from 'vitest';
import type { AreaKey, AreaKind } from '@prisme/domain';

import { locationKey } from '../reconcile/types.js';
import { attribute, laneOf } from './attribute.js';
import type { AttributionContext, StoredCompletion } from './types.js';

/**
 * Attribution: what a completion was, and how long it took.
 *
 * All synthetic — invented area keys, invented project ids, invented durations.
 * Nothing here resembles any real workspace (docs/17-privacy.md).
 */

const AREAS = new Map<AreaKey, AreaKind>([
  ['alpha', 'area'],
  ['beta', 'area'],
  ['upkeep', 'run'],
  ['noise', 'signals'],
]);

const LOCATIONS = new Map<string, AreaKey>([
  [locationKey('p-alpha'), 'alpha'],
  [locationKey('p-beta'), 'beta'],
  [locationKey('p-upkeep'), 'upkeep'],
  [locationKey('p-noise'), 'noise'],
]);

function context(overrides: Partial<AttributionContext> = {}): AttributionContext {
  return {
    areaByLocation: LOCATIONS,
    kindByArea: AREAS,
    ritualByTask: new Map(),
    declaredMinutesByTask: new Map(),
    defaultMinutes: 25,
    ...overrides,
  };
}

function completion(overrides: Partial<StoredCompletion> = {}): StoredCompletion {
  return {
    externalTaskId: 't-1',
    completedAt: new Date('2026-09-10T09:00:00Z'),
    externalProjectId: 'p-alpha',
    ...overrides,
  };
}

describe('the duration preference order (docs/12-scoring.md §4)', () => {
  it('uses a recorded duration when there is one, over everything else', () => {
    const result = attribute(
      [completion({ recordedMinutes: 90, durationScale: 'minute' })],
      context({ declaredMinutesByTask: new Map([['t-1', 20]]) }),
    );

    expect(result.attributed[0]?.minutes).toBe(90);
    expect(result.attributed[0]?.source).toBe('recorded');
  });

  it('falls back to the declared duration of the matching process page', () => {
    const result = attribute(
      [completion()],
      context({ declaredMinutesByTask: new Map([['t-1', 20]]) }),
    );

    expect(result.attributed[0]?.minutes).toBe(20);
    expect(result.attributed[0]?.source).toBe('declared');
  });

  it('falls back to the configured default, which is configuration and not a constant', () => {
    const result = attribute([completion()], context({ defaultMinutes: 45 }));

    expect(result.attributed[0]?.minutes).toBe(45);
    expect(result.attributed[0]?.source).toBe('default');
  });

  it('counts a zero-minute recorded duration as a measurement, not as absence', () => {
    const result = attribute(
      [completion({ recordedMinutes: 0, durationScale: 'minute' })],
      context(),
    );

    expect(result.attributed[0]?.minutes).toBe(0);
    expect(result.attributed[0]?.source).toBe('recorded');
  });
});

/**
 * The decision W03 deferred here. A day-scale duration is a block-out in a
 * calendar, not a measurement of effort: converting one to 1440 minutes would
 * let a single all-day task outweigh a fortnight of real work.
 */
describe('a day-scale duration', () => {
  it('is not converted, and falls through as if nothing had been recorded', () => {
    const result = attribute(
      [completion({ durationScale: 'day' })],
      context({ defaultMinutes: 25 }),
    );

    expect(result.attributed[0]?.minutes).toBe(25);
    expect(result.attributed[0]?.source).toBe('default');
  });

  it('is counted, so the fall-through is visible rather than silent', () => {
    const result = attribute(
      [completion({ durationScale: 'day' }), completion({ externalTaskId: 't-2' })],
      context(),
    );

    expect(result.dayScaleDurations).toBe(1);
  });
});

describe('lanes (ADR-0014)', () => {
  it('labels by the area kind, with ritual on top of an ordinary area', () => {
    expect(laneOf('area', false)).toBe('change');
    expect(laneOf('run', false)).toBe('run');
    expect(laneOf('area', true)).toBe('ritual');
    expect(laneOf('run', true)).toBe('ritual');
  });

  /**
   * Signals win over the ritual label. Not a style choice: the lane decides
   * what a completion *is*, and a machine-generated notification is not a habit
   * however it was bound.
   */
  it('keeps Signals as Signals whatever else is true of it', () => {
    expect(laneOf('signals', true)).toBe('signals');
  });

  it('counts Run toward capacity, because that is the pattern worth seeing', () => {
    const result = attribute(
      [
        completion({
          externalProjectId: 'p-upkeep',
          recordedMinutes: 120,
          durationScale: 'minute',
        }),
      ],
      context(),
    );

    expect(result.attributed[0]?.lane).toBe('run');
    expect(result.attributed[0]?.minutes).toBe(120);
  });

  it('gives Signals no minutes at all, however long the tool says they took', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-noise', recordedMinutes: 999, durationScale: 'minute' })],
      context(),
    );

    expect(result.attributed[0]?.lane).toBe('signals');
    expect(result.attributed[0]?.minutes).toBe(0);
  });

  it('marks a ritual completion and keeps its minutes in its own area', () => {
    const result = attribute(
      [completion({ recordedMinutes: 30, durationScale: 'minute' })],
      context({ ritualByTask: new Map([['t-1', 'ritual-1']]) }),
    );

    expect(result.attributed[0]?.lane).toBe('ritual');
    expect(result.attributed[0]?.ritualId).toBe('ritual-1');
    expect(result.attributed[0]?.areaKey).toBe('alpha');
    expect(result.attributed[0]?.minutes).toBe(30);
  });
});

describe('placing a completion', () => {
  it('prefers a section mapping over its project, because that is what a section mapping is for', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-alpha', externalSectionId: 's-1' })],
      context({
        areaByLocation: new Map([...LOCATIONS, [locationKey('p-alpha', 's-1'), 'beta']]),
      }),
    );

    expect(result.attributed[0]?.areaKey).toBe('beta');
  });

  it('falls back to the project when the section has no mapping of its own', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-alpha', externalSectionId: 's-unmapped' })],
      context(),
    );

    expect(result.attributed[0]?.areaKey).toBe('alpha');
  });

  it('reports an unmapped project with a count rather than dropping it', () => {
    const result = attribute(
      [
        completion({ externalProjectId: 'p-unknown' }),
        completion({ externalTaskId: 't-2', externalProjectId: 'p-unknown' }),
        completion({ externalTaskId: 't-3', externalProjectId: 'p-other' }),
      ],
      context(),
    );

    expect(result.attributed).toHaveLength(0);
    expect(result.gaps).toEqual([
      { externalProjectId: 'p-unknown', externalSectionId: undefined, completions: 2 },
      { externalProjectId: 'p-other', externalSectionId: undefined, completions: 1 },
    ]);
  });

  it('reports a completion with no project at all as a gap, not as an area', () => {
    const result = attribute([completion({ externalProjectId: undefined })], context());

    expect(result.attributed).toHaveLength(0);
    expect(result.gaps[0]?.completions).toBe(1);
  });

  /**
   * A mapping pointing at an area that was deleted is a different finding from
   * no mapping at all, and guessing an area for it would put someone else's
   * minutes in a real bucket.
   */
  it('counts a mapping to a missing area separately, and attributes nothing', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-gone' })],
      context({
        areaByLocation: new Map([...LOCATIONS, [locationKey('p-gone'), 'deleted']]),
      }),
    );

    expect(result.attributed).toHaveLength(0);
    expect(result.danglingAreas).toBe(1);
    expect(result.gaps).toEqual([]);
  });
});

describe('the Signals label (ADR-0041)', () => {
  const LABEL = { label: 'signal', areaKey: 'noise' } as const;
  const SECTIONED = new Map<string, AreaKey>([
    ...LOCATIONS,
    [locationKey('p-alpha', 's-digest'), 'alpha'],
  ]);

  it('puts a labelled completion in an area section into the Signals lane, as volume', () => {
    const result = attribute(
      [
        completion({
          externalSectionId: 's-digest',
          labels: ['signal'],
          recordedMinutes: 40,
          durationScale: 'minute',
        }),
      ],
      context({ areaByLocation: SECTIONED, signalsLabel: LABEL }),
    );

    expect(result.attributed[0]).toMatchObject({
      areaKey: 'noise',
      areaKind: 'signals',
      lane: 'signals',
      minutes: 0,
    });
  });

  it('leaves an unlabelled completion where its location puts it', () => {
    const result = attribute(
      [
        completion({ externalTaskId: 't-1', externalSectionId: 's-digest', labels: [] }),
        completion({ externalTaskId: 't-2', labels: ['errand'] }),
        completion({ externalTaskId: 't-3' }),
      ],
      context({ areaByLocation: SECTIONED, signalsLabel: LABEL }),
    );

    expect(result.attributed.map((row) => [row.areaKey, row.lane])).toEqual([
      ['alpha', 'change'],
      ['alpha', 'change'],
      ['alpha', 'change'],
    ]);
  });

  it('changes nothing when no label is chosen', () => {
    const labelled = [completion({ labels: ['signal'] })];
    const withSetting = attribute(labelled, context());
    const without = attribute([completion()], context());

    expect(withSetting.attributed).toEqual(without.attributed);
    expect(withSetting.attributed[0]?.lane).toBe('change');
  });

  it('places a labelled completion even where no mapping exists, so it is not a gap', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-unmapped', labels: ['signal'] })],
      context({ signalsLabel: LABEL }),
    );

    expect(result.gaps).toEqual([]);
    expect(result.attributed[0]?.areaKey).toBe('noise');
  });

  it('beats a ritual binding, because the lane is the area kind first', () => {
    const result = attribute(
      [completion({ labels: ['signal'] })],
      context({ signalsLabel: LABEL, ritualByTask: new Map([['t-1', 'r-1']]) }),
    );

    expect(result.attributed[0]?.lane).toBe('signals');
  });

  it('ignores a label pointing at an area that is not a Signals lane, rather than moving work into it', () => {
    const result = attribute(
      [completion({ externalProjectId: 'p-beta', labels: ['signal'] })],
      context({ signalsLabel: { label: 'signal', areaKey: 'upkeep' } }),
    );

    expect(result.attributed[0]).toMatchObject({ areaKey: 'beta', lane: 'change' });
  });
});
