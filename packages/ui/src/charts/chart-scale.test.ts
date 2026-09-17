import { describe, expect, it } from 'vitest';
import {
  areaPath,
  barPath,
  barThickness,
  linearScale,
  linePath,
  nearestIndex,
  niceTicks,
  paddedDomain,
  zeroBasedDomain,
} from './chart-scale.js';

describe('linearScale', () => {
  it('maps the ends of the domain onto the ends of the range', () => {
    const scale = linearScale([0, 100], [0, 200]);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(100);
    expect(scale(100)).toBe(200);
  });

  it('handles an inverted range, which is how y axes work in SVG', () => {
    const scale = linearScale([0, 10], [120, 0]);
    expect(scale(0)).toBe(120);
    expect(scale(10)).toBe(0);
    expect(scale(5)).toBe(60);
  });

  it('does not divide by zero when every value is the same', () => {
    const scale = linearScale([7, 7], [0, 100]);
    expect(scale(7)).toBe(0);
    expect(Number.isNaN(scale(7))).toBe(false);
  });

  it('keeps its domain and range for a caller that needs them', () => {
    const scale = linearScale([0, 1], [10, 20]);
    expect(scale.domain).toEqual([0, 1]);
    expect(scale.range).toEqual([10, 20]);
  });
});

describe('niceTicks', () => {
  it('produces round numbers a reader can hold in their head', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 9.4, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    // A raw step of 6 snaps up to 10, not down to 5: the ticks stay round and
    // the count comes out a little under what was asked for.
    expect(niceTicks(0, 30, 5)).toEqual([0, 10, 20, 30]);
  });

  it('does not drift on a fractional step', () => {
    for (const tick of niceTicks(0, 1, 11)) {
      expect(String(tick)).not.toMatch(/0000000|9999999/);
    }
  });

  it('covers a range that does not start at zero', () => {
    const ticks = niceTicks(60, 64, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(60);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(64);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('gives a single tick for a flat series rather than dividing by zero', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it('refuses input that cannot produce an axis', () => {
    expect(() => niceTicks(Number.NaN, 1)).toThrow(/finite/);
    expect(() => niceTicks(0, 1, 1)).toThrow(/two ticks/);
  });
});

describe('domains', () => {
  it('starts a bar domain at zero, always', () => {
    expect(zeroBasedDomain([12, 30, 25])).toEqual([0, 30]);
  });

  it('gives an all-zero bar series a usable axis', () => {
    expect(zeroBasedDomain([0, 0])).toEqual([0, 1]);
    expect(zeroBasedDomain([])).toEqual([0, 1]);
  });

  it('keeps room below zero when a value is negative', () => {
    expect(zeroBasedDomain([-4, 10])).toEqual([-4, 10]);
  });

  it('pads a line domain so a narrow trend is still a shape', () => {
    const [min, max] = paddedDomain([60, 61, 64]);
    expect(min).toBeLessThan(60);
    expect(max).toBeGreaterThan(64);
  });

  it('gives a flat or single-point line somewhere to sit', () => {
    const [min, max] = paddedDomain([42]);
    expect(min).toBeLessThan(42);
    expect(max).toBeGreaterThan(42);

    const [zeroMin, zeroMax] = paddedDomain([0, 0]);
    expect(zeroMin).toBeLessThan(zeroMax);
  });

  it('handles no data at all', () => {
    expect(paddedDomain([])).toEqual([0, 1]);
  });
});

describe('paths', () => {
  it('draws straight segments between measured points', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 5, y: 0 },
        { x: 10, y: 4 },
      ]),
    ).toBe('M0,10 L5,0 L10,4');
  });

  it('rounds to two decimals, so the markup stays readable', () => {
    expect(linePath([{ x: 1.23456, y: 9.87654 }])).toBe('M1.23,9.88');
  });

  it('returns an empty path for no points rather than something broken', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([], 100)).toBe('');
  });

  it('closes an area onto its baseline', () => {
    expect(
      areaPath(
        [
          { x: 0, y: 10 },
          { x: 10, y: 4 },
        ],
        50,
      ),
    ).toBe('M0,10 L10,4 L10,50 L0,50 Z');
  });

  it('draws a single point as a degenerate path, not a crash', () => {
    expect(linePath([{ x: 3, y: 4 }])).toBe('M3,4');
  });
});

describe('nearestIndex', () => {
  const positions = [0, 25, 50, 75, 100];

  it('snaps to the closest position', () => {
    expect(nearestIndex(positions, 0)).toBe(0);
    expect(nearestIndex(positions, 26)).toBe(1);
    expect(nearestIndex(positions, 60)).toBe(2);
    expect(nearestIndex(positions, 99)).toBe(4);
  });

  it('clamps outside the plot instead of returning nothing', () => {
    expect(nearestIndex(positions, -40)).toBe(0);
    expect(nearestIndex(positions, 400)).toBe(4);
  });

  it('keeps the earlier point on a tie, so the crosshair cannot jitter', () => {
    expect(nearestIndex([0, 10], 5)).toBe(0);
  });

  it('says -1 when there is nothing to snap to', () => {
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('barPath', () => {
  it('rounds the data end and leaves the baseline square', () => {
    const path = barPath(0, 10, 100, 20, 'right');
    // Starts on the baseline with a straight vertical edge…
    expect(path).toMatch(/^M0,10 /);
    expect(path).toContain('H0 Z');
    // …and curves only at the far end.
    expect(path.match(/Q/g)).toHaveLength(2);
  });

  it('grows upwards for a column, with the same treatment', () => {
    const path = barPath(100, 10, 40, 20, 'up');
    expect(path).toMatch(/^M10,100 /);
    expect(path).toContain('V100 Z');
    expect(path.match(/Q/g)).toHaveLength(2);
  });

  it('never rounds more than the bar has to give', () => {
    // A 2px-long bar cannot carry a 4px radius without curving past its own
    // baseline, which would make it look longer than it is.
    const stubby = barPath(0, 0, 2, 20, 'right');
    expect(stubby).toContain('Q2,0 2,2');
  });

  it('draws nothing for a zero value, rather than a stub of pure radius', () => {
    expect(barPath(0, 0, 0, 20, 'right')).toBe('');
    expect(barPath(0, 0, -5, 20, 'right')).toBe('');
    expect(barPath(0, 0, 50, 0, 'right')).toBe('');
  });
});

describe('barThickness', () => {
  it('caps a bar at 24px however wide the band is', () => {
    expect(barThickness(400, 1)).toBe(24);
  });

  it('shares the band between series and leaves the gap between them', () => {
    const thickness = barThickness(60, 2);
    expect(thickness).toBeLessThanOrEqual(24);
    expect(thickness * 2 + 2).toBeLessThanOrEqual(60);
  });

  it('never returns a bar too thin to see', () => {
    expect(barThickness(4, 8)).toBeGreaterThanOrEqual(2);
  });

  it('always leaves air in the band', () => {
    for (const band of [20, 40, 80, 160]) {
      for (const series of [1, 2, 3]) {
        const used = barThickness(band, series) * series + 2 * (series - 1);
        expect(used, `${band}/${series}`).toBeLessThan(band);
      }
    }
  });
});
