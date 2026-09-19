import { describe, expect, it } from 'vitest';
import { indexTargets, resolve } from './resolve.js';
import type { Classification, ExternalObject, MatchTarget } from './types.js';

/**
 * Identity resolution, one describe per rule of docs/13-migration.md §3, in the
 * spec's order.
 *
 * Two properties matter more than the individual rules and each has a section
 * of its own at the bottom:
 *
 *   - **Only rule 1 is certain**, so only rule 1 can be applied by a machine.
 *     Every other result is a proposal.
 *   - **An ambiguous match is not a match**, at every rule. Two equally good
 *     answers is the situation where picking one is a coin toss recorded as a
 *     decision.
 */

const AS_INITIATIVE: Classification = { kind: 'initiative', reason: 'test' };

function objectOf(overrides: Partial<ExternalObject> = {}): ExternalObject {
  return {
    kind: 'task',
    externalId: 'x-1',
    title: 'Rebuild the garden shed',
    areaKey: 'home',
    closed: false,
    ...overrides,
  };
}

function targetOf(overrides: Partial<MatchTarget> = {}): MatchTarget {
  return {
    prismeId: 'i-1',
    kind: 'initiative',
    title: 'Rebuild the garden shed',
    areaKey: 'home',
    closed: false,
    ...overrides,
  };
}

function resolveAgainst(
  object: ExternalObject,
  targets: readonly MatchTarget[],
  classification: Classification = AS_INITIATIVE,
) {
  return resolve(object, classification, indexTargets(targets));
}

describe('rule 1 — an existing external-ID mapping', () => {
  it('is certain, and it is the only rule that is', () => {
    const proposal = resolveAgainst(objectOf({ mappedPrismeId: 'i-7', title: 'Anything at all' }), [
      targetOf({ prismeId: 'i-7', title: 'Nothing like it' }),
    ]);
    expect(proposal).toEqual({
      rule: 'existing_mapping',
      confidence: 'certain',
      prismeId: 'i-7',
    });
  });

  it('beats a perfect title match, because it is better evidence', () => {
    const proposal = resolveAgainst(objectOf({ mappedPrismeId: 'i-7' }), [
      targetOf({ prismeId: 'i-7', title: 'Nothing like it' }),
      targetOf({ prismeId: 'i-1' }),
    ]);
    expect(proposal?.prismeId).toBe('i-7');
  });

  it('is ignored when it points at an entity that is not there', () => {
    // A stale mapping from a retired automation. Falling through to the title
    // rules is right; inventing the entity is not.
    const proposal = resolveAgainst(objectOf({ mappedPrismeId: 'i-gone' }), [targetOf()]);
    expect(proposal?.rule).toBe('exact_title');
  });
});

describe('rule 2 — exact title, same area, both open', () => {
  it('proposes at high confidence', () => {
    const proposal = resolveAgainst(objectOf(), [targetOf()]);
    expect(proposal).toEqual({ rule: 'exact_title', confidence: 'high', prismeId: 'i-1' });
  });

  it('forgives whitespace, which is typing rather than meaning', () => {
    const proposal = resolveAgainst(objectOf({ title: '  Rebuild  the garden shed ' }), [
      targetOf(),
    ]);
    expect(proposal?.rule).toBe('exact_title');
  });

  it('refuses a different area', () => {
    expect(resolveAgainst(objectOf({ areaKey: 'work' }), [targetOf()])).toBeUndefined();
  });

  it('refuses when one side is closed and the other is not', () => {
    expect(resolveAgainst(objectOf({ closed: true }), [targetOf()])).toBeUndefined();
  });

  it('does not treat a missing area as a wildcard', () => {
    // "Unknown" matching everything is how a title common to two areas gets
    // bound to the wrong one.
    expect(resolveAgainst(objectOf({ areaKey: undefined }), [targetOf()])).toBeUndefined();
    const both = resolveAgainst(objectOf({ areaKey: undefined }), [
      targetOf({ areaKey: undefined }),
    ]);
    expect(both?.rule).toBe('exact_title');
  });

  it('refuses a target of another kind', () => {
    expect(resolveAgainst(objectOf(), [targetOf({ kind: 'project' })])).toBeUndefined();
  });
});

describe('rule 3 — the normalised title', () => {
  it.each([
    ['rebuild the garden shed'],
    ['REBUILD THE GARDEN SHED'],
    ['1. Rebuild the garden shed'],
    ['Rebuild the garden shed!'],
  ])('proposes %s at medium confidence', (title) => {
    const proposal = resolveAgainst(objectOf({ title }), [targetOf()]);
    expect(proposal?.rule).toBe('normalised_title');
    expect(proposal?.confidence).toBe('medium');
  });

  it('folds the accents the instance language is full of', () => {
    const proposal = resolveAgainst(objectOf({ title: 'Reparer la cloture' }), [
      targetOf({ title: 'Réparer la clôture' }),
    ]);
    expect(proposal?.rule).toBe('normalised_title');
  });

  it('still requires the same area and the same open state', () => {
    expect(
      resolveAgainst(objectOf({ title: 'rebuild the garden shed', areaKey: 'work' }), [targetOf()]),
    ).toBeUndefined();
  });
});

describe('rule 4 — fuzzy, with the score visible', () => {
  it('proposes at low confidence and carries its score', () => {
    const proposal = resolveAgainst(objectOf({ title: 'Rebuild the garden sheds' }), [targetOf()]);
    expect(proposal?.rule).toBe('fuzzy_title');
    expect(proposal?.confidence).toBe('low');
    expect(proposal?.similarity).toBeGreaterThan(0.8);
  });

  it.each([
    ['Review the 2026 budget', 'Review the 2027 budget'],
    ['Réparer la clôture nord', 'Réparer la clôture sud'],
    ['Plan the spring trip', 'Plan the summer trip'],
    ['Renew the car insurance', 'Renew the home insurance'],
  ])('does not match the near-miss %s / %s', (objectTitle, targetTitle) => {
    // The whole point of the workstream: these are different pieces of work.
    expect(
      resolveAgainst(objectOf({ title: objectTitle }), [targetOf({ title: targetTitle })]),
    ).toBeUndefined();
  });

  it('picks the better of two, when one is clearly better', () => {
    const proposal = resolveAgainst(objectOf({ title: 'Rebuild the garden sheds' }), [
      targetOf({ prismeId: 'i-far', title: 'Rebuild the garden' }),
      targetOf({ prismeId: 'i-near', title: 'Rebuild the garden shed' }),
    ]);
    expect(proposal?.prismeId).toBe('i-near');
  });
});

describe('rule 5 — the manual remainder', () => {
  it('is what nothing else resolved', () => {
    expect(resolveAgainst(objectOf({ title: 'Book the dentist' }), [targetOf()])).toBeUndefined();
  });

  it('is what an empty target set always produces', () => {
    expect(resolveAgainst(objectOf(), [])).toBeUndefined();
  });
});

describe('only certainty is automatic', () => {
  it('never returns an automatic confidence for a title rule', () => {
    // The database says the same thing in `only_certainty_is_automatic`. If
    // this ever regressed, the insert would fail rather than the corruption
    // succeed — but it should not get that far.
    const titles = [
      'Rebuild the garden shed',
      'rebuild the garden shed',
      'Rebuild the garden sheds',
    ];
    for (const title of titles) {
      const proposal = resolveAgainst(objectOf({ title }), [targetOf()]);
      expect(proposal?.confidence).not.toBe('certain');
    }
  });
});

describe('an ambiguous match is not a match', () => {
  it('refuses two targets with the same exact title', () => {
    expect(
      resolveAgainst(objectOf(), [targetOf({ prismeId: 'i-1' }), targetOf({ prismeId: 'i-2' })]),
    ).toBeUndefined();
  });

  it('refuses two targets that normalise to the same title', () => {
    expect(
      resolveAgainst(objectOf({ title: 'rebuild the garden shed' }), [
        targetOf({ prismeId: 'i-1', title: 'Rebuild the garden shed' }),
        targetOf({ prismeId: 'i-2', title: 'REBUILD THE GARDEN SHED!' }),
      ]),
    ).toBeUndefined();
  });

  it('refuses two fuzzy targets that score identically', () => {
    expect(
      resolveAgainst(objectOf({ title: 'Rebuild the garden sheds' }), [
        targetOf({ prismeId: 'i-1', title: 'Rebuild the garden shed' }),
        targetOf({ prismeId: 'i-2', title: 'Rebuild the garden shed.' }),
      ]),
    ).toBeUndefined();
  });

  it('is not confused by a second target of a different kind', () => {
    // Two rows, one viable. That is one match, not an ambiguity.
    const proposal = resolveAgainst(objectOf(), [
      targetOf({ prismeId: 'i-1' }),
      targetOf({ prismeId: 'p-1', kind: 'project' }),
    ]);
    expect(proposal?.prismeId).toBe('i-1');
  });
});

describe('the rules are tried in order', () => {
  it('a stronger rule always wins, whatever else is available', () => {
    const targets = [
      targetOf({ prismeId: 'i-mapped', title: 'Completely different' }),
      targetOf({ prismeId: 'i-exact' }),
      targetOf({ prismeId: 'i-normalised', title: 'rebuild the garden shed!' }),
    ];
    expect(resolveAgainst(objectOf({ mappedPrismeId: 'i-mapped' }), targets)?.prismeId).toBe(
      'i-mapped',
    );
    // Without the mapping, rule 2 fires — and rule 3 never gets a look in, even
    // though its target is also present.
    expect(resolveAgainst(objectOf(), targets)?.prismeId).toBe('i-exact');
  });
});
