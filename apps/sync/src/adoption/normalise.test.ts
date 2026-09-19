import { describe, expect, it } from 'vitest';
import { exactForm, foldAccents, normalise, stripLeadingNumbering } from './normalise.js';

/**
 * Normalisation is rule 3's comparison, and rule 3 is `medium` — a proposal a
 * human confirms. These tests therefore check two different things, and the
 * second matters more:
 *
 *   1. titles that *should* collapse together do; and
 *   2. titles that should **not** collapse together do not.
 *
 * A normalisation that is too aggressive turns a `medium` proposal into a wrong
 * answer sitting where the right one usually is, and confirming it is one click.
 */

describe('accent folding', () => {
  it('folds the accents the instance language is full of', () => {
    expect(foldAccents('Réparer la clôture')).toBe('Reparer la cloture');
    expect(foldAccents('Ça coûte cher')).toBe('Ca coute cher');
  });

  it('leaves a title with no accents byte-identical', () => {
    expect(foldAccents('Rebuild the shed')).toBe('Rebuild the shed');
  });

  it('folds a precomposed and a decomposed character to the same thing', () => {
    // é as one code point, and as e + combining acute. Identical on screen.
    expect(foldAccents('été')).toBe(foldAccents('été'));
  });
});

describe('leading numbering', () => {
  it.each([
    ['1. Rebuild the shed', 'Rebuild the shed'],
    ['2) Rebuild the shed', 'Rebuild the shed'],
    ['03 - Rebuild the shed', 'Rebuild the shed'],
    ['IV. Rebuild the shed', 'Rebuild the shed'],
    ['# 4 Rebuild the shed', 'Rebuild the shed'],
    ['#4 Rebuild the shed', 'Rebuild the shed'],
    ['- Rebuild the shed', 'Rebuild the shed'],
    ['• Rebuild the shed', 'Rebuild the shed'],
    ['a) Rebuild the shed', 'Rebuild the shed'],
  ])('strips %s', (input, expected) => {
    expect(stripLeadingNumbering(input)).toBe(expected);
  });

  it('strips at most one run, so a second number is content', () => {
    expect(stripLeadingNumbering('1. 2. Rebuild the shed')).toBe('2. Rebuild the shed');
  });

  it('keeps the numbering when it is the whole title', () => {
    // Otherwise every such title normalises to '' and matches every other one.
    expect(stripLeadingNumbering('4.')).toBe('4.');
    expect(normalise('4.')).toBe('4');
    expect(normalise('7.')).toBe('7');
    expect(normalise('4.')).not.toBe(normalise('7.'));
  });

  it('does not strip a number that is part of the title', () => {
    expect(stripLeadingNumbering('2026 objectives')).toBe('2026 objectives');
    expect(stripLeadingNumbering('10k run')).toBe('10k run');
  });
});

describe('the normalised form', () => {
  it.each([
    ['Réparer la clôture', 'reparer la cloture'],
    ['  Rebuild   the shed  ', 'rebuild the shed'],
    ['Rebuild the shed!', 'rebuild the shed'],
    ['1. Rebuild the shed', 'rebuild the shed'],
    ['REBUILD THE SHED', 'rebuild the shed'],
    ['Rebuild the shed (again)', 'rebuild the shed again'],
  ])('%s → %s', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('collapses every written form of one title onto one string', () => {
    const forms = [
      '1. Réparer la clôture',
      'Réparer la clôture',
      'réparer la clôture',
      'Reparer la cloture',
      '  RÉPARER LA CLÔTURE  ',
    ];
    expect(new Set(forms.map(normalise)).size).toBe(1);
  });

  it('keeps titles apart that differ by more than punctuation and case', () => {
    // The near-miss set. Each pair renders similarly to a tired reader and is
    // a different piece of work.
    const pairs: readonly [string, string][] = [
      ['Rebuild the shed', 'Rebuild the sheds'],
      ['Réparer la clôture', 'Réparer la clôture nord'],
      ['Review 2026 budget', 'Review 2027 budget'],
      ['Call the plumber', 'Call the plumber back'],
    ];
    for (const [left, right] of pairs) {
      expect(normalise(left)).not.toBe(normalise(right));
    }
  });
});

describe('the exact form', () => {
  it('forgives whitespace and Unicode composition, and nothing else', () => {
    expect(exactForm('  Rebuild  the shed ')).toBe('Rebuild the shed');
    expect(exactForm('été')).toBe('été');
  });

  it('still separates case, accents and punctuation — that is rule 3s job', () => {
    expect(exactForm('Rebuild the shed')).not.toBe(exactForm('rebuild the shed'));
    expect(exactForm('Réparer')).not.toBe(exactForm('Reparer'));
    expect(exactForm('Rebuild the shed')).not.toBe(exactForm('Rebuild the shed!'));
  });
});
