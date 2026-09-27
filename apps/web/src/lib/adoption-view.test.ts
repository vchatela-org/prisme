import { describe, expect, it } from 'vitest';
import {
  candidateLink,
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
