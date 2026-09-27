import { describe, expect, it } from 'vitest';
import { isRetentionDays, retentionCutoff, WRITE_AUDIT_RETENTION } from './write-audit.js';

describe('the write audit retention window', () => {
  it('accepts whole days between the floor and the ceiling, inclusive', () => {
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.minDays)).toBe(true);
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.defaultDays)).toBe(true);
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.maxDays)).toBe(true);
  });

  it('refuses zero, which would be "delete everything tonight" rather than "off"', () => {
    expect(isRetentionDays(0)).toBe(false);
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.minDays - 1)).toBe(false);
  });

  it('refuses a fraction and anything past the ceiling', () => {
    expect(isRetentionDays(30.5)).toBe(false);
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.maxDays + 1)).toBe(false);
    expect(isRetentionDays(Number.NaN)).toBe(false);
  });

  it('keeps the default inside its own bounds', () => {
    expect(isRetentionDays(WRITE_AUDIT_RETENTION.defaultDays)).toBe(true);
  });

  it('cuts off whole days of elapsed time before now, not at a midnight', () => {
    const now = new Date('2026-03-31T17:45:00.000Z');
    expect(retentionCutoff(now, 7).toISOString()).toBe('2026-03-24T17:45:00.000Z');
    expect(retentionCutoff(now, 90).toISOString()).toBe('2025-12-31T17:45:00.000Z');
  });
});
