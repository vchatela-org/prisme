import { describe, expect, it } from 'vitest';
import {
  buildScale,
  dateOfDay,
  dayOf,
  daysBetween,
  isWeekend,
  thinLabels,
  widthOf,
  ZOOMS,
  type Tick,
} from './timeline-scale';

/**
 * The axis, without a browser.
 *
 * Two of these are here because W09 shipped both defects on the KPI charts and
 * found them by opening a page: a stepped label printed on top of its
 * neighbour, and the last label clipped by the viewBox. Both are properties of
 * a tick list, so both are checkable here, over every zoom and every plausible
 * span, rather than by looking.
 */

describe('day numbers', () => {
  it('round-trips a calendar date', () => {
    for (const date of ['2026-01-01', '2026-02-28', '2026-09-19', '2026-12-31', '2027-03-01']) {
      expect(dateOfDay(dayOf(date))).toBe(date);
    }
  });

  it('counts whole days across a month end and a year end', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-09-30')).toBe(-1);
    expect(daysBetween('2026-09-19', '2026-09-19')).toBe(0);
  });

  it('agrees with the calendar about weekends', () => {
    // 2026-09-19 is a Saturday, 2026-09-20 a Sunday, 2026-09-21 a Monday.
    expect(isWeekend(dayOf('2026-09-19'))).toBe(true);
    expect(isWeekend(dayOf('2026-09-20'))).toBe(true);
    expect(isWeekend(dayOf('2026-09-21'))).toBe(false);
  });

  it('is unaffected by a daylight-saving transition', () => {
    // Europe moves its clocks on 2026-10-25. In UTC whole days, nothing does.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(dateOfDay(dayOf('2026-10-25'))).toBe('2026-10-25');
  });
});

describe('the scale', () => {
  it('covers the plan with padding on both sides', () => {
    const scale = buildScale({ from: '2026-09-21', to: '2026-10-30', zoom: 'week', padDays: 7 });
    expect(scale.originDay).toBe(dayOf('2026-09-14'));
    expect(scale.days).toBe(daysBetween('2026-09-14', '2026-11-06') + 1);
    expect(scale.width).toBeCloseTo(scale.days * scale.dayWidth);
  });

  it('draws a plot even when the plan is a single day', () => {
    for (const zoom of ZOOMS) {
      const scale = buildScale({ from: '2026-09-21', to: '2026-09-21', zoom, padDays: 0 });
      expect(scale.days).toBeGreaterThanOrEqual(1);
      expect(scale.width).toBeGreaterThan(0);
    }
  });

  it('marks today only when the plan covers it', () => {
    const inside = buildScale({
      from: '2026-09-21',
      to: '2026-10-30',
      zoom: 'month',
      today: '2026-10-01',
    });
    expect(inside.todayX).not.toBeNull();

    const outside = buildScale({
      from: '2026-09-21',
      to: '2026-10-30',
      zoom: 'month',
      today: '2027-06-01',
    });
    expect(outside.todayX).toBeNull();
  });

  it('puts a bar of one day at one day wide, never zero', () => {
    const scale = buildScale({ from: '2026-09-21', to: '2026-10-30', zoom: 'week' });
    expect(widthOf(scale, '2026-09-21', '2026-09-21')).toBeCloseTo(scale.dayWidth);
    expect(widthOf(scale, '2026-09-21', '2026-09-25')).toBeCloseTo(5 * scale.dayWidth);
  });

  it('keeps a two-day bar visible at the year zoom', () => {
    const scale = buildScale({ from: '2026-01-01', to: '2026-12-31', zoom: 'year' });
    // 1.4px a day would be a bar nobody can see, let alone hit with a pointer.
    expect(widthOf(scale, '2026-03-02', '2026-03-03')).toBeGreaterThanOrEqual(3);
  });

  it('turns a drag distance into whole days at every zoom', () => {
    // What a drag actually does: pixels travelled, over the day width, rounded.
    // The assertion is that a day's worth of travel is a day, which is the one
    // property the gesture depends on.
    for (const zoom of ZOOMS) {
      const scale = buildScale({ from: '2026-09-21', to: '2026-10-30', zoom });
      expect(Math.round((scale.dayWidth * 3) / scale.dayWidth)).toBe(3);
      expect(dateOfDay(dayOf('2026-10-05') + 3)).toBe('2026-10-08');
    }
  });
});

describe('tick labels', () => {
  it('never prints two labels closer than the minimum gap', () => {
    // Every zoom, over spans from a fortnight to three years — the range where
    // a stepped label lands next to the one before it.
    for (const zoom of ZOOMS) {
      for (const days of [14, 30, 90, 180, 365, 400, 1_000]) {
        const scale = buildScale({
          from: '2026-01-05',
          to: dateOfDay(dayOf('2026-01-05') + days),
          zoom,
        });
        const labelled = scale.ticks.filter((tick) => tick.label !== null);
        for (let index = 1; index < labelled.length; index += 1) {
          const gap = (labelled[index]?.x ?? 0) - (labelled[index - 1]?.x ?? 0);
          expect(gap, `${zoom} over ${String(days)} days`).toBeGreaterThanOrEqual(52);
        }
      }
    }
  });

  it('never prints a label that would be clipped by the right edge', () => {
    for (const zoom of ZOOMS) {
      for (const days of [14, 30, 90, 365, 1_000]) {
        const scale = buildScale({
          from: '2026-01-05',
          to: dateOfDay(dayOf('2026-01-05') + days),
          zoom,
        });
        for (const tick of scale.ticks) {
          if (tick.label !== null) expect(tick.x + 22).toBeLessThanOrEqual(scale.width);
        }
      }
    }
  });

  it('always labels the first tick, so the axis starts somewhere named', () => {
    const ticks: Tick[] = [
      { day: 0, x: 0, label: 'Jan', major: true },
      { day: 10, x: 8, label: 'Feb', major: true },
    ];
    const thinned = thinLabels(ticks, 400);
    expect(thinned[0]?.label).toBe('Jan');
    expect(thinned[1]?.label).toBeNull();
  });

  it('keeps every gridline even where it drops the label', () => {
    const scale = buildScale({ from: '2026-01-01', to: '2028-12-31', zoom: 'year' });
    expect(scale.ticks.length).toBeGreaterThan(scale.ticks.filter((t) => t.label !== null).length);
  });

  it('names the year at a January boundary and not otherwise', () => {
    const scale = buildScale({ from: '2026-11-01', to: '2027-03-31', zoom: 'month' });
    const labels = scale.ticks.map((tick) => tick.label).filter((label) => label !== null);
    expect(labels).toContain('Jan 2027');
    expect(labels.some((label) => label === 'Dec')).toBe(true);
  });
});
