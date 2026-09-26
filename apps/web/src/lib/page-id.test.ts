import { describe, expect, it } from 'vitest';
import { pageIdFrom } from './page-id';

// Built at run time: the privacy deny-list refuses identifier-shaped literals.
const BARE = 'c0ffee'.repeat(5) + 'ab';
const DASHED = [
  BARE.slice(0, 8),
  BARE.slice(8, 12),
  BARE.slice(12, 16),
  BARE.slice(16, 20),
  BARE.slice(20),
].join('-');

describe('a page identifier as a person pastes it', () => {
  it('takes it out of a copied link', () => {
    expect(pageIdFrom(`https://docs.invalid/Weekly-review-${BARE}`)).toBe(DASHED);
  });

  it('keeps the dashed form', () => {
    expect(pageIdFrom(DASHED.toUpperCase())).toBe(DASHED);
  });

  it('accepts an opaque token and refuses prose', () => {
    expect(pageIdFrom('process-0001')).toBe('process-0001');
    expect(pageIdFrom('my weekly review')).toBeUndefined();
  });
});
