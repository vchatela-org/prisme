import { describe, expect, it } from 'vitest';
import { collectUrls } from '../sanitise.js';
import { trimTrailing } from './trim.js';

describe('trimTrailing', () => {
  it('removes the characters it was given, from the end only', () => {
    expect(trimTrailing('https://example.invalid/plan.', '.,;:!?')).toBe(
      'https://example.invalid/plan',
    );
    expect(trimTrailing('https://example.invalid/a.b', '.,;:!?')).toBe(
      'https://example.invalid/a.b',
    );
  });

  it('removes a run of them', () => {
    expect(trimTrailing('what?!?!', '.,;:!?')).toBe('what');
    expect(trimTrailing('https://example.invalid///', '/')).toBe('https://example.invalid');
  });

  it('leaves a string that ends in something else alone', () => {
    expect(trimTrailing('https://example.invalid', '/')).toBe('https://example.invalid');
  });

  it('handles a string made entirely of them', () => {
    expect(trimTrailing('////', '/')).toBe('');
    expect(trimTrailing('', '/')).toBe('');
  });
});

describe('the reason it is not a regular expression', () => {
  /**
   * `replace(/[.,;:!?]+$/, '')` is quadratic on a long run of matching
   * characters that is not at the end, and this text arrives from a
   * third-party tool. CodeQL's `js/polynomial-redos` caught all three uses in
   * this package; this test is the regression guard, and it fails by timing
   * out rather than by asserting.
   */
  it('scrapes a pathological paragraph in linear time', () => {
    const hostile = `https://example.invalid/a${'!'.repeat(100_000)} and more text`;

    const startedAt = Date.now();
    const urls = collectUrls(hostile);
    const elapsed = Date.now() - startedAt;

    expect(urls).toEqual(['https://example.invalid/a']);
    // Generous by three orders of magnitude: the regression it guards against
    // took long enough to hold the advisory lock, not 100ms.
    expect(elapsed).toBeLessThan(1000);
  });
});
