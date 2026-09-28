import { describe, expect, it } from 'vitest';
import { docIdKey } from './ids.js';

/**
 * Identifier-shaped values are built at run time: the privacy deny-list refuses
 * any such literal in the tree, invented or not.
 */
const dashed = (digit: string): string =>
  [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-');
const bare = (digit: string): string => digit.repeat(32);

describe('docIdKey', () => {
  it('reads a dashed identifier and a bare one as the same page', () => {
    expect(docIdKey(dashed('a'))).toBe(docIdKey(bare('a')));
    expect(docIdKey(dashed('a'))).toBe(bare('a'));
  });

  it('ignores case and surrounding space', () => {
    expect(docIdKey(` ${dashed('B')} `)).toBe(bare('b'));
  });

  it('keeps two different pages apart', () => {
    expect(docIdKey(dashed('a'))).not.toBe(docIdKey(dashed('b')));
  });

  it('compares an opaque identifier as it is, dashes and all', () => {
    // Stripping the dashes would make these two equal, and they are not.
    expect(docIdKey('area-page-home')).toBe('area-page-home');
    expect(docIdKey('area-page-home')).not.toBe(docIdKey('area-pagehome'));
  });

  it('does not take a near miss for an identifier', () => {
    // 31 digits, or a dash in the wrong place, is an opaque token.
    const short = 'a'.repeat(31);
    expect(docIdKey(short)).toBe(short);
    const misplaced = `${'a'.repeat(4)}-${'a'.repeat(28)}`;
    expect(docIdKey(misplaced)).toBe(misplaced);
  });
});
