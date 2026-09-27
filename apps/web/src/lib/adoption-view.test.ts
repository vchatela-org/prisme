import { describe, expect, it } from 'vitest';
import {
  candidateLink,
  ignoreEndedConfirmation,
  ignoreEndedLabel,
  ignoreEndedOffer,
  NO_AREA,
  periodText,
  queueFilters,
  queueHref,
  sourceKey,
  sourceLabel,
} from './adoption-view.js';

/**
 * Invented hosts and identifiers, reserved for documentation. A real template
 * is instance configuration and a real identifier is instance data
 * (docs/17-privacy.md §1).
 */
const LINKS = {
  page: 'https://workspace.example.com/page/{id}',
  project: 'https://tasks.example.com/project/{id}',
};
const ID = 'fixture-object-one';

describe('opening an adoption candidate where it lives', () => {
  it('links a page through the document-tool template', () => {
    expect(candidateLink({ externalKind: 'page', externalId: ID }, LINKS)).toEqual({
      href: 'https://workspace.example.com/page/fixture-object-one',
      tool: 'Notion',
    });
  });

  it('links a project through the task-tool template', () => {
    expect(candidateLink({ externalKind: 'project', externalId: ID }, LINKS)).toEqual({
      href: 'https://tasks.example.com/project/fixture-object-one',
      tool: 'Todoist',
    });
  });

  it('never borrows the other tool’s template', () => {
    // A page id substituted into the project template is a well-formed link to
    // the wrong object, which is worse than no link at all.
    expect(
      candidateLink({ externalKind: 'page', externalId: ID }, { ...LINKS, page: undefined }),
    ).toBeUndefined();
    expect(
      candidateLink({ externalKind: 'project', externalId: ID }, { ...LINKS, project: undefined }),
    ).toBeUndefined();
  });

  it('has no link for a task or a section, because there is no template for either', () => {
    expect(candidateLink({ externalKind: 'task', externalId: ID }, LINKS)).toBeUndefined();
    expect(candidateLink({ externalKind: 'section', externalId: ID }, LINKS)).toBeUndefined();
  });

  it('keeps the page-link refusals — an identifier that would change the host is no link', () => {
    expect(
      candidateLink(
        { externalKind: 'page', externalId: ID },
        { ...LINKS, page: 'https://{id}.example.com/page' },
      ),
    ).toBeUndefined();
  });
});

describe('the queue’s filters, in the address', () => {
  it('reads the three filters, and defaults to what has not ended', () => {
    expect(queueFilters({})).toEqual({ when: 'open', source: undefined, areaKey: undefined });
    expect(queueFilters({ when: 'ended', source: 'objectives_db', areaKey: NO_AREA })).toEqual({
      when: 'ended',
      source: 'objectives_db',
      areaKey: NO_AREA,
    });
  });

  it('drops a value the API would refuse, rather than showing an error', () => {
    expect(queueFilters({ when: 'someday', source: 'Not A Role', areaKey: '../x' })).toEqual({
      when: 'open',
      source: undefined,
      areaKey: undefined,
    });
    // A repeated parameter arrives as a list, and is not a filter.
    expect(queueFilters({ when: ['ended', 'all'] }).when).toBe('open');
  });

  it('writes an address that leaves the defaults out', () => {
    const open = queueFilters({});
    expect(queueHref(open, {})).toBe('/adoption');
    expect(queueHref(open, { when: 'ended' })).toBe('/adoption?when=ended');
    const narrowed = queueFilters({ source: 'task', areaKey: 'home' });
    expect(queueHref(narrowed, { source: undefined })).toBe('/adoption?areaKey=home');
  });
});

describe('a candidate’s source and period, in words', () => {
  it('names a Notion database by its role, and a Todoist object by its kind', () => {
    expect(sourceKey({ sourceRole: 'objectives_db', externalKind: 'page' })).toBe('objectives_db');
    expect(sourceKey({ sourceRole: null, externalKind: 'task' })).toBe('task');
    expect(sourceLabel('objectives_db')).toBe('Notion · Objectives');
    expect(sourceLabel('task')).toBe('Todoist · Tasks');
  });

  it('writes a range, a single day, and nothing for an undated one', () => {
    expect(periodText({ startsOn: '2024-01-01', endsOn: '2024-12-31', period: 'ended' })).toBe(
      '2024-01-01 → 2024-12-31 · ended',
    );
    expect(periodText({ startsOn: '2099-01-01', endsOn: '2099-01-01', period: 'upcoming' })).toBe(
      '2099-01-01 · not started',
    );
    expect(periodText({ startsOn: null, endsOn: null, period: 'undated' })).toBe('');
  });
});

describe('ignoring every ended entry at once', () => {
  // An invented digest, built at run time rather than written as a literal.
  const DIGEST = 'fixture-digest-'.padEnd(43, 'x');
  const offered = { ignoreEnded: { count: 12, digest: DIGEST } };
  const nameOf = (key: string): string => (key === 'home' ? 'Home' : key);

  it('is offered only under the Ended filter, and only with something to ignore', () => {
    const ended = queueFilters({ when: 'ended', source: 'objectives_db' });
    expect(ignoreEndedOffer(ended, offered)).toEqual({
      count: 12,
      digest: DIGEST,
      source: 'objectives_db',
      areaKey: undefined,
    });
    // Not where the rows it would ignore are hidden, or mixed with running ones.
    expect(ignoreEndedOffer(queueFilters({}), offered)).toBeUndefined();
    expect(ignoreEndedOffer(queueFilters({ when: 'all' }), offered)).toBeUndefined();
    // Not with nothing to ignore, nor against an API that does not offer it.
    expect(ignoreEndedOffer(ended, { ignoreEnded: { count: 0, digest: DIGEST } })).toBeUndefined();
    expect(ignoreEndedOffer(ended, {})).toBeUndefined();
  });

  it('puts the count on the button', () => {
    expect(ignoreEndedLabel(12)).toBe('Ignore all 12 ended');
    expect(ignoreEndedLabel(1)).toBe('Ignore the 1 ended');
  });

  it('confirms with the count, the filters in force, and that it is permanent', () => {
    const offer = ignoreEndedOffer(
      queueFilters({ when: 'ended', source: 'objectives_db', areaKey: 'home' }),
      offered,
    );
    expect(offer).toBeDefined();
    if (offer === undefined) return;

    const copy = ignoreEndedConfirmation(offer, 12, nameOf);
    expect(copy.title).toBe('Ignore 12 ended entries permanently?');
    expect(copy.filters).toBe('Date: Ended · From: Notion · Objectives · Area: Home');
    expect(copy.description).toContain('12 ended entries.');
    expect(copy.description).toMatch(/no undo/);
    expect(copy.description).toMatch(/extending its date will not come back/);
  });

  it('names the unfiltered view, the unmapped bucket, and rows beyond the page', () => {
    const everywhere = ignoreEndedOffer(queueFilters({ when: 'ended' }), offered);
    const unmapped = ignoreEndedOffer(queueFilters({ when: 'ended', areaKey: NO_AREA }), {
      ignoreEnded: { count: 1, digest: DIGEST },
    });
    if (everywhere === undefined || unmapped === undefined) throw new Error('not offered');

    expect(ignoreEndedConfirmation(everywhere, 10, nameOf)).toMatchObject({
      filters: 'Date: Ended · From: Anywhere · Area: Any',
    });
    expect(ignoreEndedConfirmation(everywhere, 10, nameOf).description).toContain(
      '12 ended entries — 2 of them beyond the 10 listed here.',
    );
    expect(ignoreEndedConfirmation(unmapped, 1, nameOf)).toMatchObject({
      title: 'Ignore 1 ended entry permanently?',
      filters: 'Date: Ended · From: Anywhere · Area: Outside every area',
    });
  });
});
