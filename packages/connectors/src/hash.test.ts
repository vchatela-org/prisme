import { describe, expect, it } from 'vitest';
import { contentHash } from './hash.js';

/**
 * The hash is only useful if it moves for real changes and stays still for
 * everything else. Both halves are asserted, because each failure mode is
 * invisible in a different way: a hash that moves too easily reports change on
 * every run and makes the overlap expensive; a hash that moves too rarely loses
 * an edit, which is the failure the whole mechanism exists to prevent.
 */

describe('contentHash', () => {
  it('is stable across key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it('treats an absent key and an undefined value as the same fact', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it('distinguishes undefined from null, because the tools do', () => {
    expect(contentHash({ a: null })).not.toBe(contentHash({}));
  });

  it('respects array order, which carries meaning', () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  it('is insensitive to Set order, which does not', () => {
    expect(contentHash(new Set(['a', 'b']))).toBe(contentHash(new Set(['b', 'a'])));
  });

  it('hashes a Map by its entries, whatever order they were inserted in', () => {
    const one = new Map([
      ['first', 1],
      ['second', 2],
    ]);
    const other = new Map([
      ['second', 2],
      ['first', 1],
    ]);
    expect(contentHash(one)).toBe(contentHash(other));
  });

  it('reduces a Date to its instant', () => {
    expect(contentHash({ at: new Date('2026-09-16T08:58:00.000Z') })).toBe(
      contentHash({ at: new Date('2026-09-16T08:58:00.000Z') }),
    );
    expect(contentHash({ at: new Date('2026-09-16T08:58:00.000Z') })).not.toBe(
      contentHash({ at: new Date('2026-09-16T08:59:00.000Z') }),
    );
  });

  it('does not collide across types with the same rendering', () => {
    expect(contentHash({ value: 1 })).not.toBe(contentHash({ value: '1' }));
  });

  it('produces hex that the privacy deny-list cannot mistake for an external ID', () => {
    const hash = contentHash({ anything: true });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // A 32-hex run with word boundaries either side is the deny-list's pattern
    // for a page ID. A 64-character run has no boundary in the middle, so a
    // hash is never a false positive — worth pinning, since committing hashes
    // to a fixture would otherwise fail the scan for no reason.
    expect(/\b[0-9a-f]{32}\b/.test(hash)).toBe(false);
  });
});
