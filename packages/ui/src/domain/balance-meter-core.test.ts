import { describe, expect, it } from 'vitest';
import { balanceReading, balanceSummary } from './balance-meter-core.js';

describe('balanceReading', () => {
  it('puts an area that is exactly on its share at the midpoint of the track', () => {
    for (const target of [5, 15, 20, 30]) {
      expect(balanceReading(target, target).fillPct, `${target}%`).toBeCloseTo(50, 9);
    }
  });

  it('reads the same for two areas on very different shares — the point of the scaling', () => {
    // Both are at half their agreed share.
    expect(balanceReading(30, 15).fillPct).toBeCloseTo(balanceReading(5, 2.5).fillPct, 9);
  });

  it('calls a fifth of the target starved and double it over-served', () => {
    expect(balanceReading(30, 6).tone).toBe('starved');
    expect(balanceReading(30, 60).tone).toBe('over-served');
  });

  it('allows a 20% band either side before it says anything is wrong', () => {
    expect(balanceReading(30, 25.5).tone).toBe('on-target'); // ratio 0.85
    expect(balanceReading(30, 34.5).tone).toBe('on-target'); // ratio 1.15
    expect(balanceReading(30, 23).tone).toBe('starved'); // ratio 0.77
    expect(balanceReading(30, 37).tone).toBe('over-served'); // ratio 1.23
  });

  it('stops the fill at the end of the track and says that it did', () => {
    const wild = balanceReading(5, 50);
    expect(wild.fillPct).toBe(100);
    expect(wild.clamped).toBe(true);
    expect(wild.ratio).toBe(10);

    expect(balanceReading(5, 9.5).clamped).toBe(false);
  });

  it('handles an area that received nothing at all', () => {
    const none = balanceReading(30, 0);
    expect(none.fillPct).toBe(0);
    expect(none.ratio).toBe(0);
    expect(none.tone).toBe('starved');
  });

  it('refuses to divide by a target that does not exist, and says so instead', () => {
    const lane = balanceReading(0, 9.4);
    expect(lane.ratio).toBeNull();
    expect(lane.tone).toBe('unscaled');
    expect(lane.fillPct).toBe(9.4);
  });

  it('rejects input that would render a meaningless bar', () => {
    expect(() => balanceReading(Number.NaN, 10)).toThrow(/finite/);
    expect(() => balanceReading(10, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => balanceReading(-1, 10)).toThrow(/negative/);
    expect(() => balanceReading(10, -1)).toThrow(/negative/);
  });

  it('reproduces the fixture window without recomputing the balance factor', () => {
    // fixtures/areas.json, areaContext2026W37. The tones must agree with the
    // factors the domain computed there: 2.0 for a starved area, 0.5 for one
    // that took five times its share.
    expect(balanceReading(30, 15).tone).toBe('starved'); // health
    expect(balanceReading(20, 20).tone).toBe('on-target'); // craft
    expect(balanceReading(5, 25).tone).toBe('over-served'); // home
    expect(balanceReading(5, 4.2).tone).toBe('on-target'); // community
  });
});

describe('balanceSummary', () => {
  it('says the direction in words, so colour is never the only channel', () => {
    expect(balanceSummary(30, 15)).toBe('15.0% against 30% — starved');
    expect(balanceSummary(20, 20)).toBe('20.0% against 20% — on its agreed share');
    expect(balanceSummary(5, 25)).toBe('25.0% against 5% — over-served');
  });

  it('says what a lane took without judging it', () => {
    expect(balanceSummary(0, 9.4)).toBe('9.4% of capacity, no agreed share');
  });
});
