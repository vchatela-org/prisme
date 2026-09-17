import { describe, expect, it } from 'vitest';
import { formatDuration, relativeTime } from './relative-time.js';

const NOW = new Date('2026-09-16T12:00:00Z');
const ago = (milliseconds: number): Date => new Date(NOW.getTime() - milliseconds);

describe('relativeTime', () => {
  it('picks the unit a reader would have used', () => {
    expect(relativeTime(ago(5_000), NOW, 'en')).toBe('5 seconds ago');
    expect(relativeTime(ago(4 * 60_000), NOW, 'en')).toBe('4 minutes ago');
    expect(relativeTime(ago(3 * 3_600_000), NOW, 'en')).toBe('3 hours ago');
    expect(relativeTime(ago(2 * 86_400_000), NOW, 'en')).toBe('2 days ago');
  });

  it('says "now" rather than "0 seconds ago"', () => {
    expect(relativeTime(NOW, NOW, 'en')).toBe('now');
  });

  it('handles a clock that is ahead of the timestamp', () => {
    expect(relativeTime(new Date(NOW.getTime() + 60_000), NOW, 'en')).toBe('in 1 minute');
  });

  it('follows the locale, since the instance runs in French', () => {
    expect(relativeTime(ago(4 * 60_000), NOW, 'fr')).toBe('il y a 4 minutes');
  });

  it('is a pure function of its two arguments', () => {
    expect(relativeTime(ago(90_000), NOW, 'en')).toBe(relativeTime(ago(90_000), NOW, 'en'));
  });
});

describe('formatDuration', () => {
  it('scales the unit with the size', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(340)).toBe('340ms');
    expect(formatDuration(1_240)).toBe('1.2s');
    expect(formatDuration(59_900)).toBe('59.9s');
    expect(formatDuration(75_000)).toBe('1m 15s');
  });

  it('refuses a duration that cannot be one', () => {
    expect(() => formatDuration(-1)).toThrow(/non-negative/);
    expect(() => formatDuration(Number.NaN)).toThrow(/non-negative/);
  });
});
