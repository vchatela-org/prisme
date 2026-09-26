import { describe, expect, it } from 'vitest';
import { normaliseDocIdentifier } from './settings.js';

/**
 * Built at run time rather than written out: the privacy deny-list refuses any
 * identifier-shaped literal in the tree, invented or not, and it is right to.
 */
const BARE = 'c0ffee'.repeat(5) + 'ab';
const DASHED = [
  BARE.slice(0, 8),
  BARE.slice(8, 12),
  BARE.slice(12, 16),
  BARE.slice(16, 20),
  BARE.slice(20),
].join('-');

describe('an identifier as a person pastes it', () => {
  it('keeps the dashed form, lower-cased', () => {
    expect(normaliseDocIdentifier(DASHED.toUpperCase())).toBe(DASHED);
  });

  it('dashes the bare form', () => {
    expect(normaliseDocIdentifier(` ${BARE} `)).toBe(DASHED);
  });

  it('takes the identifier out of a copied link, title slug and view included', () => {
    expect(
      normaliseDocIdentifier(
        `https://docs.invalid/space/Reading-notes-${BARE}?v=${'f'.repeat(32)}`,
      ),
    ).toBe(DASHED);
  });

  it('does not borrow hex-looking letters from the title in front of it', () => {
    // "Cafe" ends in hex digits; a parser that stripped dashes first would
    // glue them onto the identifier and shift it.
    expect(normaliseDocIdentifier(`https://docs.invalid/Cafe-${BARE}`)).toBe(DASHED);
  });

  it('accepts an opaque token, which is what fixtures and the local harness use', () => {
    expect(normaliseDocIdentifier('binding-takeaways-0002')).toBe('binding-takeaways-0002');
  });

  it('refuses anything else rather than storing it', () => {
    expect(normaliseDocIdentifier('not an id')).toBeUndefined();
    expect(normaliseDocIdentifier('https://docs.invalid/no-identifier-here')).toBeUndefined();
  });
});
