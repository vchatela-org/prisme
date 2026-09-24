import { describe, expect, it } from 'vitest';
import type { CreationIntent, SearchMatch } from './contracts';
import {
  ledgerAdvice,
  matchHref,
  pageStateOf,
  parseSections,
  searchHeadline,
  similarityLabel,
  summariseLedger,
} from './create-view';

function intent(overrides: Partial<CreationIntent> = {}): CreationIntent {
  return {
    id: 'intent-1',
    entityKind: 'project',
    entityId: 'entity-1',
    tool: 'task',
    objectKind: 'section',
    ordinal: 0,
    state: 'pending',
    externalId: null,
    attempts: 0,
    lastError: null,
    requires: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('the page button’s state', () => {
  it('is present when a page is bound', () => {
    expect(pageStateOf('page-1', [])).toBe('present');
  });

  it('is absent when there is no page and nobody asked for one', () => {
    expect(pageStateOf(null, [intent({ objectKind: 'task' })])).toBe('absent');
  });

  /**
   * The state ADR-0011's two-state rule predates. Creating a page is no
   * longer synchronous, so between the click and the page there is a gap the
   * rule reads as "no page" — and a *Create page* button shown in that gap is
   * how somebody presses it four times.
   */
  it('is requested when a page intent is outstanding', () => {
    expect(pageStateOf(null, [intent({ objectKind: 'page', tool: 'document' })])).toBe('requested');
  });

  it('goes back to absent once the page intent is satisfied but the reference has not landed', () => {
    // A transient inconsistency: the intent is satisfied and the entity has
    // not been re-read. `absent` is the safe reading — the one-per-slot index
    // refuses a second intent anyway, so offering the button costs nothing.
    expect(
      pageStateOf(null, [intent({ objectKind: 'page', tool: 'document', state: 'satisfied' })]),
    ).toBe('absent');
  });
});

describe('parsing a project’s sections', () => {
  it('keeps the order written and drops blank lines', () => {
    expect(parseSections('  First \n\n Second\n\n\nThird  ').sections).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('is empty for an empty box', () => {
    expect(parseSections('   \n  \n').sections).toEqual([]);
  });

  /**
   * Refused rather than deduplicated. Two sections with one name are two
   * places to put the same work, and prisme could not tell them apart
   * afterwards — a section's identity here is its position and its name.
   */
  it('refuses a duplicate rather than silently dropping it', () => {
    const parsed = parseSections('First\nSecond\nfirst');
    expect(parsed.duplicate).toBe('first');
  });

  it('treats a duplicate as a duplicate whatever its case', () => {
    expect(parseSections('Kitchen\nKITCHEN').duplicate).toBe('KITCHEN');
  });
});

describe('summarising the ledger', () => {
  it('counts a page intent as ordinary pending work, since it now is', () => {
    // Before ADR-0025 was accepted a page intent was counted apart, because no
    // pass could ever make one. That became untrue the moment the role keys
    // existed, and a separate column reading zero is worse than no column:
    // it reads as a state somebody is watching.
    const summary = summariseLedger([
      intent({ id: '1', state: 'pending' }),
      intent({ id: '2', state: 'pending', tool: 'document', objectKind: 'page' }),
      intent({ id: '3', state: 'failed', lastError: 'refused' }),
      intent({ id: '4', state: 'satisfied', externalId: 'made-1' }),
    ]);

    expect(summary).toEqual({ pending: 2, failed: 1, satisfied: 1 });
  });

  it('is all zeroes for an empty ledger', () => {
    expect(summariseLedger([])).toEqual({ pending: 0, failed: 0, satisfied: 0 });
  });
});

describe('what to do about a ledger row', () => {
  it('offers a retry for a failure, and explains why it is safe', () => {
    const advice = ledgerAdvice(intent({ state: 'failed', lastError: 'refused' }));
    expect(advice.retryable).toBe(true);
    expect(advice.sentence).toContain('same key');
  });

  /**
   * A page is still not retryable, and for a reason that survived ADR-0025:
   * pressing a button cannot change whether this instance has bound where the
   * page lives, and offering one is an invitation to press it forever.
   */
  it('offers no retry for a page, and names what actually blocks one', () => {
    const advice = ledgerAdvice(intent({ tool: 'document', objectKind: 'page' }));
    expect(advice.retryable).toBe(false);
    expect(advice.sentence).toContain('blocked');
    expect(advice.sentence).toContain('ADR-0028');
  });

  it('says a dependent row is waiting for what it belongs to', () => {
    const advice = ledgerAdvice(intent({ requires: 'intent-0' }));
    expect(advice.retryable).toBe(false);
    expect(advice.sentence).toContain('Waiting for');
  });

  it('says a satisfied row is done, and offers nothing', () => {
    const advice = ledgerAdvice(intent({ state: 'satisfied', externalId: 'made-1' }));
    expect(advice.retryable).toBe(false);
  });
});

describe('where a search match leads', () => {
  function match(overrides: Partial<SearchMatch> = {}): SearchMatch {
    return {
      source: 'existing',
      kind: 'initiative',
      prismeId: 'i-1',
      externalId: null,
      title: 'Fence replaced',
      areaKey: 'home',
      similarity: 0.9,
      suggests: 'open',
      ...overrides,
    };
  }

  it('opens an initiative prisme already holds', () => {
    expect(matchHref(match())).toBe('/initiative/i-1');
  });

  /**
   * Always the queue, never a deep link that adopts. Adopting is one of three
   * decisions a human makes there, and jumping past it would be prisme
   * deciding on their behalf.
   */
  it('sends an adoptable match to the queue rather than adopting it', () => {
    expect(
      matchHref(match({ source: 'adoptable', kind: 'task', prismeId: null, externalId: 't-1' })),
    ).toBe('/adoption');
  });

  it('filters the backlog to a project', () => {
    expect(matchHref(match({ kind: 'project', prismeId: 'pr-1' }))).toContain('projectId=pr-1');
  });
});

describe('the search headline', () => {
  it('says nothing exists when nothing matched', () => {
    expect(searchHeadline(false, 0)).toContain('Nothing like this');
  });

  /**
   * Two wordings, deliberately. A near-certain match is worth stopping for; a
   * list of loose ones is worth a glance. Phrasing both as a warning is how
   * somebody learns to dismiss the warning.
   */
  it('interrupts for a near-certain match and merely mentions loose ones', () => {
    expect(searchHeadline(true, 1)).toContain('before creating a second');
    expect(searchHeadline(false, 3)).toContain('loosely similar');
  });

  it('agrees with itself about singular and plural', () => {
    expect(searchHeadline(false, 1)).toContain('1 loosely similar thing,');
    expect(searchHeadline(false, 2)).toContain('2 loosely similar things,');
  });
});

describe('the similarity label', () => {
  it('reads as a percentage', () => {
    expect(similarityLabel(0.871)).toBe('87%');
    expect(similarityLabel(1)).toBe('100%');
  });
});
