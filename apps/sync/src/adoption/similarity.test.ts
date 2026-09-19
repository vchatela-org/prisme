import { describe, expect, it } from 'vitest';
import {
  bigrams,
  fuzzyMatch,
  FUZZY_THRESHOLD,
  roundSimilarity,
  similarity,
  titlesAgree,
} from './similarity.js';

/**
 * The threshold is the number that decides whether a wrong suggestion is put in
 * front of a tired human at the moment they are clicking through a queue. So
 * the important assertions here are the **near-misses**: pairs of real-shaped
 * titles that are different pieces of work and must score *below*
 * {@link FUZZY_THRESHOLD}.
 *
 * If a change to this file makes a near-miss pass, that is not a test to
 * update. It is the corruption ADR-0010 exists to prevent, arriving as a green
 * build.
 */

describe('bigrams', () => {
  it('are pairs of adjacent characters', () => {
    expect(bigrams('shed')).toEqual(['sh', 'he', 'ed']);
  });

  it('are empty for a string too short to have one', () => {
    expect(bigrams('a')).toEqual([]);
    expect(bigrams('')).toEqual([]);
  });

  it('treat an astral character as one character', () => {
    // Split by index, '🌱x' would produce two broken halves matching nothing.
    expect(bigrams('🌱x')).toEqual(['🌱x']);
  });
});

describe('similarity', () => {
  it('is 1 for the same title', () => {
    expect(similarity('Rebuild the shed', 'Rebuild the shed')).toBe(1);
  });

  it('is 1 for titles that differ only in what normalisation folds', () => {
    expect(similarity('1. Réparer la clôture', 'reparer la cloture')).toBe(1);
  });

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'Rebuild the shed')).toBe(0);
    expect(similarity('Rebuild the shed', '   ')).toBe(0);
  });

  it('is symmetric', () => {
    const left = 'Réparer la clôture nord';
    const right = 'Reparer la cloture';
    expect(similarity(left, right)).toBe(similarity(right, left));
  });

  it('counts a repeated bigram once per occurrence, not once', () => {
    // A set intersection would score these 1. A multiset does not.
    expect(similarity('aaa', 'aaaa')).toBeLessThan(1);
  });

  it('is bounded in 0–1 for every pair it is given', () => {
    const titles = ['', 'a', 'Rebuild the shed', 'Réparer la clôture', '🌱 plant the hedge'];
    for (const left of titles) {
      for (const right of titles) {
        const score = similarity(left, right);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * The near-miss corpus.
 *
 * Every pair is two *different* pieces of work, written the way they are
 * actually written — which is to say, mostly the same. **None of them may ever
 * produce a match.** A change that makes one of these pass is not a test to
 * update: it is the silent corruption ADR-0010 exists to prevent, arriving as a
 * green build.
 *
 * The first pair is why `titlesAgree` exists at all. It scores 0.90 on
 * characters alone, comfortably above any threshold that still catches a real
 * near-match, and it is two different annual reviews.
 */
const NEAR_MISSES: readonly (readonly [string, string])[] = [
  ['Review the 2026 budget', 'Review the 2027 budget'],
  ['Réparer la clôture nord', 'Réparer la clôture sud'],
  ['Call the plumber', 'Call the electrician'],
  ['Rebuild the shed', 'Rebuild the fence'],
  ['Plan the spring trip', 'Plan the summer trip'],
  ['Renew the car insurance', 'Renew the home insurance'],
  ['Write the quarterly report', 'Read the quarterly report'],
  ['Run 10k', 'Run 21k'],
  ['Deploy v1 of the site', 'Deploy v2 of the site'],
  ['Repaint the kitchen', 'Repaint the kitchens door'],
];

describe('word-level agreement', () => {
  it.each(NEAR_MISSES)('refuses %s vs %s', (left, right) => {
    expect(fuzzyMatch(left, right)).toBeUndefined();
  });

  it('accepts an inflection', () => {
    expect(titlesAgree('Rebuild the garden shed', 'Rebuild the garden sheds')).toBe(true);
  });

  it('accepts a dropped article, which carries no identity', () => {
    expect(titlesAgree('Réparer la clôture', 'Réparer clôture')).toBe(true);
  });

  it('refuses a dropped noun, which does', () => {
    expect(titlesAgree('Réparer la clôture nord', 'Réparer la clôture')).toBe(false);
  });

  it('refuses a differing number however much agrees around it', () => {
    expect(similarity('Review the 2026 budget', 'Review the 2027 budget')).toBeGreaterThan(0.85);
    expect(titlesAgree('Review the 2026 budget', 'Review the 2027 budget')).toBe(false);
  });

  it('refuses an empty title on either side', () => {
    expect(titlesAgree('', 'Rebuild the shed')).toBe(false);
    expect(titlesAgree('Rebuild the shed', '  ')).toBe(false);
  });

  it('is symmetric over the whole corpus', () => {
    for (const [left, right] of NEAR_MISSES) {
      expect(titlesAgree(left, right)).toBe(titlesAgree(right, left));
    }
  });
});

describe('the threshold', () => {
  it('is met by a title that differs only in punctuation or inflection', () => {
    expect(
      fuzzyMatch('Rebuild the garden shed', 'Rebuild the garden shed.'),
    ).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(
      fuzzyMatch('Rebuild the garden shed', 'Rebuild the garden sheds'),
    ).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it('is not met by a title that gained a word, even a small one', () => {
    // Below the threshold on characters, and refused on words too. Rule 4 is
    // narrow on purpose; this lands in the manual remainder, where it is read.
    expect(fuzzyMatch('Réparer le vélo', 'Réparer le vélo de route')).toBeUndefined();
  });

  it('is high enough that unrelated titles are nowhere near it', () => {
    expect(similarity('Rebuild the shed', 'Book the dentist')).toBeLessThan(0.3);
    expect(fuzzyMatch('Rebuild the shed', 'Book the dentist')).toBeUndefined();
  });

  it('cannot be reached by lowering the threshold alone', () => {
    // Even at a threshold of zero, the word test still refuses every near-miss.
    for (const [left, right] of NEAR_MISSES) {
      expect(fuzzyMatch(left, right, 0)).toBeUndefined();
    }
  });
});

describe('rounding', () => {
  it('matches the three decimals the candidate table stores', () => {
    expect(roundSimilarity(0.123456)).toBe(0.123);
    expect(roundSimilarity(1)).toBe(1);
    expect(roundSimilarity(0.8888)).toBe(0.889);
  });
});
