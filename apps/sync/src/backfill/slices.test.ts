import { describe, expect, it } from 'vitest';

import { planResume, sliceRange, type Cursor } from './slices.js';

/**
 * Slicing and resuming.
 *
 * Everything here is invented instants. The interesting cases are all about
 * boundaries, because a backfill that loses a day loses it silently: the chart
 * still draws, the balance factor still has a number, and nothing ever says
 * which week was never read.
 */

const at = (iso: string): Date => new Date(iso);

describe('sliceRange', () => {
  it('covers the range with half-open windows, oldest first', () => {
    const slices = sliceRange(at('2026-01-01T00:00:00Z'), at('2026-03-01T00:00:00Z'), 28);

    expect(slices).toHaveLength(3);
    expect(slices[0]?.since.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(slices[0]?.until.toISOString()).toBe('2026-01-29T00:00:00.000Z');
    expect(slices[2]?.until.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('leaves no gap and no overlap between adjacent windows', () => {
    const slices = sliceRange(at('2024-06-11T13:20:00Z'), at('2026-09-20T00:00:00Z'), 28);

    for (let index = 1; index < slices.length; index += 1) {
      expect(slices[index]?.since.getTime()).toBe(slices[index - 1]?.until.getTime());
    }
  });

  it('clips the last window to the end rather than overshooting it', () => {
    const slices = sliceRange(at('2026-01-01T00:00:00Z'), at('2026-01-10T00:00:00Z'), 28);

    expect(slices).toHaveLength(1);
    expect(slices[0]?.until.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  it('produces nothing for an empty or inverted range', () => {
    expect(sliceRange(at('2026-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toEqual([]);
    expect(sliceRange(at('2026-02-01T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toEqual([]);
  });

  it('refuses a window with no width, rather than looping forever', () => {
    expect(() => sliceRange(at('2026-01-01T00:00:00Z'), at('2026-02-01T00:00:00Z'), 0)).toThrow(
      /at least one day/,
    );
  });
});

describe('planResume', () => {
  const request = { from: at('2026-01-01T00:00:00Z'), to: at('2026-04-01T00:00:00Z') };

  it('fetches the whole range when there is no cursor', () => {
    const plan = planResume(request, undefined, 28);

    expect(plan.reason).toBe('first run');
    expect(plan.slices[0]?.since.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(plan.covers).toEqual(request);
  });

  it('resumes from where the last run got to, not from the requested start', () => {
    const cursor: Cursor = {
      coveredFrom: at('2026-01-01T00:00:00Z'),
      coveredThrough: at('2026-02-15T00:00:00Z'),
    };
    const plan = planResume(request, cursor, 28);

    expect(plan.reason).toBe('resumed');
    expect(plan.slices[0]?.since.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('fetches nothing when the cursor already covers the request', () => {
    const cursor: Cursor = {
      coveredFrom: at('2026-01-01T00:00:00Z'),
      coveredThrough: at('2026-06-01T00:00:00Z'),
    };
    const plan = planResume(request, cursor, 28);

    expect(plan.reason).toBe('already covered');
    expect(plan.slices).toEqual([]);
    // The covered range does not shrink because a shorter request was made.
    expect(plan.covers.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  /**
   * The one that matters. A cursor saying "2026 onwards is here" plus a request
   * for 2024 is not a resume: the stretch before the cursor's start was never
   * fetched, and resuming at `coveredThrough` would advance the cursor over a
   * hole that nothing would ever revisit — every later run would resume past it
   * too.
   */
  it('re-fetches everything when asked to extend backwards', () => {
    const cursor: Cursor = {
      coveredFrom: at('2026-01-01T00:00:00Z'),
      coveredThrough: at('2026-03-01T00:00:00Z'),
    };
    const plan = planResume(
      { from: at('2024-01-01T00:00:00Z'), to: at('2026-04-01T00:00:00Z') },
      cursor,
      28,
    );

    expect(plan.reason).toBe('extended backwards');
    expect(plan.slices[0]?.since.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(plan.covers.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('never narrows the covered range when a later run asks for less', () => {
    const cursor: Cursor = {
      coveredFrom: at('2025-01-01T00:00:00Z'),
      coveredThrough: at('2026-03-01T00:00:00Z'),
    };
    const plan = planResume(
      { from: at('2026-02-01T00:00:00Z'), to: at('2026-04-01T00:00:00Z') },
      cursor,
      28,
    );

    expect(plan.reason).toBe('resumed');
    expect(plan.covers.from.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(plan.covers.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
