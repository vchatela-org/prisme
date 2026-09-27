import { describe, expect, it } from 'vitest';
import type { DocPropertyValue } from '@prisme/connectors';
import { areaOfRelation, indexAreaPages } from './area-relation.js';

/**
 * ADR-0033's rule — exactly one related page, and it is exactly one area's page
 * — against every way it can fail to hold.
 *
 * Invented, non-hexadecimal page identifiers, except where the test is about the
 * identifier's format; those are built at run time, because the privacy
 * deny-list refuses any such literal in the tree.
 */

const dashed = (digit: string): string =>
  [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-');
const bare = (digit: string): string => digit.repeat(32);

const relation = (...ids: string[]): DocPropertyValue => ({ kind: 'relation', ids });

const AREAS = indexAreaPages([
  { key: 'health', externalPageId: 'area-page-health' },
  { key: 'home', externalPageId: 'area-page-home' },
  { key: 'craft', externalPageId: null },
  { key: 'money', externalPageId: undefined },
]);

describe('the area a relation names', () => {
  it('is the area whose page is the one related page', () => {
    expect(areaOfRelation(relation('area-page-home'), AREAS)).toBe('home');
  });

  it('is none when the relation is empty', () => {
    expect(areaOfRelation(relation(), AREAS)).toBeUndefined();
  });

  it('is none when the entry relates to several pages, even two known ones', () => {
    // Never a guess: which of the two is the entry's area is the owner's call.
    const both = relation('area-page-home', 'area-page-health');
    expect(areaOfRelation(both, AREAS)).toBeUndefined();
  });

  it('is none for a page no area names', () => {
    expect(areaOfRelation(relation('area-page-garden'), AREAS)).toBeUndefined();
  });

  it('is none when the property is missing, or is not a relation', () => {
    expect(areaOfRelation(undefined, AREAS)).toBeUndefined();
    expect(areaOfRelation({ kind: 'select', value: 'area-page-home' }, AREAS)).toBeUndefined();
  });

  it('is none when two areas name the same page', () => {
    const shared = indexAreaPages([
      { key: 'health', externalPageId: 'area-page-shared' },
      { key: 'home', externalPageId: 'area-page-shared' },
    ]);
    expect(areaOfRelation(relation('area-page-shared'), shared)).toBeUndefined();
  });

  it('matches a dashed relation against a bare page identifier, and the reverse', () => {
    const byBare = indexAreaPages([{ key: 'health', externalPageId: bare('a') }]);
    expect(areaOfRelation(relation(dashed('a')), byBare)).toBe('health');

    const byDashed = indexAreaPages([{ key: 'home', externalPageId: dashed('B') }]);
    expect(areaOfRelation(relation(bare('b')), byDashed)).toBe('home');
  });

  it('reads one page written two ways as one page, not several', () => {
    const byBare = indexAreaPages([{ key: 'health', externalPageId: bare('c') }]);
    expect(areaOfRelation(relation(dashed('c'), bare('c')), byBare)).toBe('health');
  });

  it('compares an opaque identifier exactly', () => {
    // An opaque identifier is compared as it is: stripping its dashes would
    // make these two equal.
    expect(areaOfRelation(relation('area-pagehome'), AREAS)).toBeUndefined();
  });
});
