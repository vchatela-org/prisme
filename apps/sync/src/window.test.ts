import { describe, expect, it } from 'vitest';
import { shouldRunNow } from './window.js';

const BASE = { enabled: true, windowStart: 7, windowEnd: 22, timezone: 'Europe/Paris' };

describe('shouldRunNow', () => {
  it('runs inside the window', () => {
    // 2026-06-15T10:00Z is 12:00 in Europe/Paris.
    expect(shouldRunNow(BASE, new Date('2026-06-15T10:00:00Z'))).toEqual({
      shouldRun: true,
      reason: 'in-window',
    });
  });

  it('does not run before the window opens', () => {
    // 04:00Z is 06:00 in Paris — one hour early.
    expect(shouldRunNow(BASE, new Date('2026-06-15T04:00:00Z')).shouldRun).toBe(false);
  });

  it('does not run after the window closes', () => {
    // 21:00Z is 23:00 in Paris.
    expect(shouldRunNow(BASE, new Date('2026-06-15T21:00:00Z')).reason).toBe('outside-window');
  });

  it('reads the window in the configured zone, not UTC', () => {
    const utc = { ...BASE, timezone: 'UTC' };
    const instant = new Date('2026-06-15T05:30:00Z'); // 07:30 in Paris, 05:30 UTC
    expect(shouldRunNow(BASE, instant).shouldRun).toBe(true);
    expect(shouldRunNow(utc, instant).shouldRun).toBe(false);
  });

  it('honours the master switch before anything else', () => {
    expect(shouldRunNow({ ...BASE, enabled: false }, new Date('2026-06-15T10:00:00Z'))).toEqual({
      shouldRun: false,
      reason: 'sync-disabled',
    });
  });
});
