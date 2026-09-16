import { describe, expect, it } from 'vitest';
import { backoffDelayMs, DEFAULT_RETRY_POLICY, retryAfterMs } from './backoff.js';

const POLICY = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 30_000 };

describe('backoff', () => {
  it('doubles per attempt, at the ceiling', () => {
    const ceilings = [1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, POLICY, () => 1));
    expect(ceilings).toEqual([500, 1000, 2000, 4000]);
  });

  it('jitters down to zero, and never below', () => {
    expect(backoffDelayMs(3, POLICY, () => 0)).toBe(0);
    expect(backoffDelayMs(3, POLICY, () => -5)).toBe(0);
  });

  it('never exceeds the ceiling, whatever the source of randomness returns', () => {
    expect(backoffDelayMs(3, POLICY, () => 5)).toBe(2000);
  });

  it('clamps at maxDelayMs rather than growing for ever', () => {
    expect(backoffDelayMs(20, POLICY, () => 1)).toBe(POLICY.maxDelayMs);
  });

  it('spreads two callers apart — the reason for jitter at all', () => {
    const first = backoffDelayMs(4, POLICY, () => 0.1);
    const second = backoffDelayMs(4, POLICY, () => 0.9);
    expect(first).not.toBe(second);
  });

  it('ships a policy that gives up rather than retrying for ever', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(5);
  });
});

describe('Retry-After', () => {
  const now = new Date('2026-09-16T09:00:00.000Z');

  it('reads delta-seconds', () => {
    expect(retryAfterMs('30', now)).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    expect(retryAfterMs('Wed, 16 Sep 2026 09:00:45 GMT', now)).toBe(45_000);
  });

  it('clamps a date already in the past to zero', () => {
    expect(retryAfterMs('Wed, 16 Sep 2026 08:59:00 GMT', now)).toBe(0);
  });

  it('caps an absurd value — a 15-minute pass does not wait out a day', () => {
    expect(retryAfterMs('999999', now)).toBe(3_600_000);
  });

  it('returns undefined for an absent or unparseable header, so backoff takes over', () => {
    expect(retryAfterMs(undefined, now)).toBeUndefined();
    expect(retryAfterMs('   ', now)).toBeUndefined();
    expect(retryAfterMs('soon', now)).toBeUndefined();
  });
});
