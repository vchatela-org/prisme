import { describe, expect, it } from 'vitest';
import { candidateLink } from './adoption-view.js';

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
