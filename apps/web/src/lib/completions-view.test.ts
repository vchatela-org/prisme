import { describe, expect, it } from 'vitest';
import { completionsSummary, itemisationGap, minutesLabel, sourceLabel } from './completions-view';

/** Invented totals. Nothing here resembles an instance. */

const totals = (
  minutesBySource: { recorded: number; declared: number; default: number },
  completions: number,
) => ({
  completions,
  minutes: minutesBySource.recorded + minutesBySource.declared + minutesBySource.default,
  minutesBySource,
});

describe('minutesLabel', () => {
  it('reads as minutes under an hour, and as hours and minutes above it', () => {
    expect(minutesLabel(0)).toBe('0 min');
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(120)).toBe('2 h');
    expect(minutesLabel(80)).toBe('1 h 20 min');
  });
});

describe('sourceLabel', () => {
  it('names every tier, and says a volume-only row has none', () => {
    expect(sourceLabel({ minutesSource: 'recorded' })).toBe('recorded');
    expect(sourceLabel({ minutesSource: 'declared' })).toBe('from its process');
    expect(sourceLabel({ minutesSource: 'default' })).toBe('default estimate');
    expect(sourceLabel({ minutesSource: null })).toBe('volume only');
  });
});

describe('completionsSummary', () => {
  it('says how much of the time is the default estimate', () => {
    expect(completionsSummary(totals({ recorded: 30, declared: 0, default: 90 }, 4), 'area')).toBe(
      '4 completions, 2 h of attributed time — 75% of it the default estimate rather than a recorded duration.',
    );
  });

  it('says so plainly when every minute is the default', () => {
    expect(completionsSummary(totals({ recorded: 0, declared: 0, default: 30 }, 1), 'area')).toBe(
      '1 completion, 30 min of attributed time — all of it the default estimate rather than a recorded duration.',
    );
  });

  it('does not invent an estimate where everything was recorded', () => {
    expect(completionsSummary(totals({ recorded: 60, declared: 0, default: 0 }, 2), 'run')).toBe(
      '2 completions, 1 h of attributed time — none of it the default estimate.',
    );
  });

  it('counts Signals as volume, with no time', () => {
    expect(
      completionsSummary(totals({ recorded: 0, declared: 0, default: 0 }, 9), 'signals'),
    ).toMatch(/^9 completions\. Signals are counted as volume/);
  });
});

describe('itemisationGap', () => {
  it('is silent when the list adds up to the balance row', () => {
    expect(itemisationGap(5, 5)).toBeNull();
  });

  it('says why a list is short of the balance row', () => {
    expect(itemisationGap(2, 5)).toMatch(/counted 5 here and 2 are listed/);
    // The daily sync re-reads only the trailing window, so it cannot be the
    // whole promise: a past year's weeks close only through a backfill.
    expect(itemisationGap(2, 5)).toMatch(/daily sync itemises the recent weeks, and a backfill/);
  });

  it('says so when the list holds more than the balance counted', () => {
    expect(itemisationGap(6, 5)).toMatch(/6 are listed and the balance counted 5/);
  });
});
