import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SAYS_MET_PCT,
  documentSaysMet,
  documentSuccessPct,
  documentSuccessScale,
} from './document-success.js';

/**
 * ADR-0042. The figure is shown, not obeyed: these helpers say what a number
 * reads as, and nothing here decides an objective's status.
 */
describe('the document’s success figure', () => {
  it('reads 100 or more as met, and nothing else', () => {
    expect(DOCUMENT_SAYS_MET_PCT).toBe(100);
    expect(documentSaysMet(100)).toBe(true);
    expect(documentSaysMet(140)).toBe(true);
    expect(documentSaysMet(99.99)).toBe(false);
    expect(documentSaysMet(null)).toBe(false);
    expect(documentSaysMet(undefined)).toBe(false);
  });

  it('takes a percent-formatted property as a fraction, and a number as already a percentage', () => {
    expect(documentSuccessScale('percent')).toBe('fraction');
    expect(documentSuccessScale('number')).toBe('percentage');
    expect(documentSuccessScale('number_with_commas')).toBe('percentage');
  });

  it('refuses a format that is not a success figure, such as a currency', () => {
    expect(documentSuccessScale('dollar')).toBeUndefined();
    expect(documentSuccessScale('euro')).toBeUndefined();
    expect(documentSuccessScale('')).toBeUndefined();
  });

  it('converts a fraction to a percentage, and rounds float noise away', () => {
    expect(documentSuccessPct(1, 'fraction')).toBe(100);
    expect(documentSuccessPct(0.05, 'fraction')).toBe(5);
    expect(documentSuccessPct(0.1 + 0.2, 'fraction')).toBe(30);
    expect(documentSuccessPct(42, 'percentage')).toBe(42);
  });

  it('gives no figure for a missing, non-finite or negative value', () => {
    expect(documentSuccessPct(null, 'percentage')).toBeUndefined();
    expect(documentSuccessPct(undefined, 'fraction')).toBeUndefined();
    expect(documentSuccessPct(Number.NaN, 'percentage')).toBeUndefined();
    expect(documentSuccessPct(Number.POSITIVE_INFINITY, 'fraction')).toBeUndefined();
    expect(documentSuccessPct(-1, 'percentage')).toBeUndefined();
  });
});
