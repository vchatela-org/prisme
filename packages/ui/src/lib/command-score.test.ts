import { describe, expect, it } from 'vitest';
import { commandScore } from './command-score.js';

describe('commandScore', () => {
  it('keeps every command visible before anything is typed', () => {
    expect(commandScore('Go to Focus', '')).toBe(1);
    expect(commandScore('Go to Focus', '   ')).toBe(1);
  });

  it('ranks the four kinds of match in the order a reader expects', () => {
    const exact = commandScore('focus', 'focus');
    const prefix = commandScore('focus on now', 'focus');
    const word = commandScore('go to focus', 'focus');
    const inside = commandScore('refocused view', 'focus');
    const scattered = commandScore('find our custom sets', 'focus');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  it('is case-insensitive in both directions', () => {
    expect(commandScore('Area Balance', 'area balance')).toBe(1);
    expect(commandScore('area balance', 'AREA BALANCE')).toBe(1);
  });

  it('treats the separators an interface actually uses as word breaks', () => {
    for (const value of ['year-review', 'year_review', 'year/review', 'year · review']) {
      expect(commandScore(value, 'review'), value).toBe(0.7);
    }
  });

  it('scores a keyword alias below any direct match', () => {
    const alias = commandScore('Command menu', 'palette', ['palette']);
    expect(alias).toBeGreaterThan(0);
    expect(alias).toBeLessThan(commandScore('Palette settings', 'palette'));
  });

  it('returns 0 — not a small number — when nothing matches', () => {
    expect(commandScore('Go to Focus', 'zzz')).toBe(0);
    expect(commandScore('Go to Focus', 'focuss')).toBe(0);
  });

  it('requires the subsequence to be in order', () => {
    expect(commandScore('abcdef', 'ace')).toBeGreaterThan(0);
    expect(commandScore('abcdef', 'eca')).toBe(0);
  });

  it('does not crash on the awkward inputs a text field can produce', () => {
    expect(commandScore('', 'x')).toBe(0);
    expect(commandScore('Réviser l’année', 'année')).toBeGreaterThan(0);
    expect(() => commandScore('anything', '🙂')).not.toThrow();
  });
});
