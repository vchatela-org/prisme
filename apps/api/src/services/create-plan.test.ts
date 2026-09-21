import { describe, expect, it } from 'vitest';
import {
  backlinkFor,
  locationForArea,
  planCapture,
  planPage,
  planProject,
  rankMatches,
  SEARCH_FLOOR,
  type SearchCandidate,
} from './create-plan.js';
import type { AreaMappingRecord } from '../store/types.js';

const BASE = 'https://prisme.example';

function mapping(
  areaKey: string,
  externalProjectId: string,
  externalSectionId: string | null = null,
): AreaMappingRecord {
  return { areaKey, externalProjectId, externalSectionId };
}

describe('where a capture goes', () => {
  it('has nowhere to go when the area is mapped nowhere', () => {
    expect(locationForArea('home', [mapping('work', 'p-1')])).toBeUndefined();
  });

  it('uses the only mapping there is', () => {
    expect(locationForArea('home', [mapping('home', 'p-1')])).toEqual({
      externalProjectId: 'p-1',
    });
  });

  /**
   * A mapping naming a section is a more deliberate statement about where
   * things go than one naming a whole project, so it wins. Landing a capture
   * at the top of a project when a section was named would look like prisme
   * ignoring the mapping.
   */
  it('prefers the mapping that names a section', () => {
    const location = locationForArea('home', [
      mapping('home', 'p-2'),
      mapping('home', 'p-1', 's-9'),
    ]);
    expect(location).toEqual({ externalProjectId: 'p-1', externalSectionId: 's-9' });
  });

  it('breaks a tie the same way twice, so two captures a second apart agree', () => {
    const mappings = [mapping('home', 'p-9'), mapping('home', 'p-1'), mapping('home', 'p-5')];
    const first = locationForArea('home', mappings);
    const second = locationForArea('home', [...mappings].reverse());
    expect(first).toEqual(second);
    expect(first).toEqual({ externalProjectId: 'p-1' });
  });
});

describe('the backlink', () => {
  it('survives a base URL with a trailing slash', () => {
    expect(backlinkFor('https://prisme.example/', '/capture/c-1')).toBe(
      'prisme: https://prisme.example/capture/c-1',
    );
  });
});

describe('what a capture intends', () => {
  const location = { externalProjectId: 'p-1', externalSectionId: 's-1' };

  it('is one task, and nothing else, when no page was asked for', () => {
    const intents = planCapture({
      captureId: 'c-1',
      title: 'Something small',
      location,
      baseUrl: BASE,
      captureLabel: 'prisme-capture',
      page: { mode: 'none' },
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ tool: 'task', objectKind: 'task', ordinal: 0 });
  });

  /**
   * The capture label, never the anchor label. A capture wearing the anchor
   * label would be adopted as an initiative's anchor on the reconciler's next
   * pass, which turns "it stays a task" into a lie one cron interval later.
   */
  it('labels the task as a capture and never as an anchor', () => {
    const [task] = planCapture({
      captureId: 'c-1',
      title: 'Something small',
      location,
      baseUrl: BASE,
      captureLabel: 'prisme-capture',
      page: { mode: 'none' },
    });

    expect(task?.draft['labels']).toEqual(['prisme-capture']);
    expect(task?.draft['labels']).not.toContain('prisme');
  });

  it('carries no priority and no deadline, because a capture is not ranked', () => {
    const [task] = planCapture({
      captureId: 'c-1',
      title: 'Something small',
      location,
      baseUrl: BASE,
      captureLabel: 'prisme-capture',
      page: { mode: 'none' },
    });

    expect(task?.draft).not.toHaveProperty('priority');
    expect(task?.draft).not.toHaveProperty('deadline');
  });

  it('adds a page intent only when one was asked for', () => {
    const intents = planCapture({
      captureId: 'c-1',
      title: 'Something small',
      location,
      baseUrl: BASE,
      captureLabel: 'prisme-capture',
      page: { mode: 'create' },
    });

    expect(intents.map((intent) => intent.objectKind)).toEqual(['task', 'page']);
  });

  /**
   * `link` binds something that already exists, so it plans nothing. This is
   * ADR-0010's distinction at the point it is easiest to blur: adopting must
   * never enqueue a create.
   */
  it('plans nothing extra for a page that already exists', () => {
    const intents = planCapture({
      captureId: 'c-1',
      title: 'Something small',
      location,
      baseUrl: BASE,
      captureLabel: 'prisme-capture',
      page: { mode: 'link', externalId: 'page-7' },
    });

    expect(intents.map((intent) => intent.objectKind)).toEqual(['task']);
  });
});

describe('what a project intends', () => {
  it('is a project, then its sections in order, then a page', () => {
    const intents = planProject({
      projectId: 'pr-1',
      name: 'A large effort',
      sections: ['First', 'Second', 'Third'],
      baseUrl: BASE,
      taskProject: { mode: 'create' },
      page: { mode: 'create' },
    });

    expect(intents.map((intent) => intent.objectKind)).toEqual([
      'project',
      'section',
      'section',
      'section',
      'page',
    ]);
    expect(
      intents.filter((intent) => intent.objectKind === 'section').map((s) => s.ordinal),
    ).toEqual([0, 1, 2]);
  });

  /**
   * The edge, not an ordering convention. The converge pass refuses to create
   * a section whose project is unsatisfied rather than sending it with an
   * empty parent.
   */
  it('makes every section wait for the project it belongs to', () => {
    const intents = planProject({
      projectId: 'pr-1',
      name: 'A large effort',
      sections: ['First', 'Second'],
      baseUrl: BASE,
      taskProject: { mode: 'create' },
      page: { mode: 'none' },
    });

    const sections = intents.filter((intent) => intent.objectKind === 'section');
    expect(sections.every((section) => section.requiresIndex === 0)).toBe(true);
  });

  /**
   * Linking says "this project already exists", not "its sections do". The
   * sections are still planned, and they wait for nothing — the converge pass
   * reads the project's id from the entity, which the link has set.
   */
  it('still plans the sections when the project itself is linked', () => {
    const intents = planProject({
      projectId: 'pr-1',
      name: 'A large effort',
      sections: ['First', 'Second'],
      baseUrl: BASE,
      taskProject: { mode: 'link', externalId: 'project-42' },
      page: { mode: 'none' },
    });

    expect(intents.map((intent) => intent.objectKind)).toEqual(['section', 'section']);
    expect(intents.every((intent) => intent.requiresIndex === undefined)).toBe(true);
  });

  it('plans nothing at all when nothing external was asked for', () => {
    expect(
      planProject({
        projectId: 'pr-1',
        name: 'A large effort',
        sections: [],
        baseUrl: BASE,
        taskProject: { mode: 'none' },
        page: { mode: 'none' },
      }),
    ).toEqual([]);
  });
});

describe('a page on demand', () => {
  it('carries a title and nothing else, because the body is the template’s', () => {
    // ADR-0025: the body is a copy of the template's top-level blocks, and the
    // body belongs to the document tool the moment the page exists — so there
    // is no backlink for prisme to write, and the store, the template and the
    // parent are all decided in the converge pass.
    const planned = planPage({ title: 'Fence replaced' });

    expect(planned).toMatchObject({
      tool: 'document',
      objectKind: 'page',
      draft: { title: 'Fence replaced' },
    });
    expect(Object.keys(planned.draft)).toEqual(['title']);
  });
});

describe('search before create', () => {
  const candidates: SearchCandidate[] = [
    {
      source: 'existing',
      kind: 'initiative',
      prismeId: 'i-1',
      externalId: null,
      title: 'Fence replaced',
      areaKey: 'home',
    },
    {
      source: 'adoptable',
      kind: 'task',
      prismeId: null,
      externalId: 't-9',
      title: 'Replace the fence',
      areaKey: 'home',
    },
    {
      source: 'existing',
      kind: 'project',
      prismeId: 'pr-1',
      externalId: null,
      title: 'Kitchen renovated',
      areaKey: 'home',
    },
  ];

  it('finds nothing for a query that is only punctuation', () => {
    expect(rankMatches('---', candidates)).toEqual({ matches: [], worthReading: false });
  });

  it('puts the closest match first and says what it invites', () => {
    const { matches } = rankMatches('Fence replaced', candidates);
    expect(matches[0]).toMatchObject({ prismeId: 'i-1', similarity: 1, suggests: 'open' });
  });

  it('tells you to adopt rather than open something prisme does not hold', () => {
    const { matches } = rankMatches('Replace the fence', candidates);
    expect(matches[0]).toMatchObject({ externalId: 't-9', suggests: 'adopt' });
  });

  it('drops everything below the display floor', () => {
    const { matches } = rankMatches('Fence replaced', candidates);
    expect(matches.every((match) => match.similarity >= SEARCH_FLOOR)).toBe(true);
    expect(matches.map((match) => match.title)).not.toContain('Kitchen renovated');
  });

  it('ranks the same query the same way twice, whatever order the rows arrived in', () => {
    const first = rankMatches('fence', candidates);
    const second = rankMatches('fence', [...candidates].reverse());
    expect(first.matches.map((match) => match.title)).toEqual(
      second.matches.map((match) => match.title),
    );
  });

  /**
   * The lesson W12 paid for, applied here. Pure Sørensen–Dice scores these two
   * at 0.90; interrupting somebody typing the 2027 review with "did you mean
   * the 2026 one?" teaches them to dismiss the interruption, after which it
   * protects nothing.
   */
  it('does not interrupt over two different years, however alike they read', () => {
    const budgets: SearchCandidate[] = [
      {
        source: 'existing',
        kind: 'initiative',
        prismeId: 'i-2',
        externalId: null,
        title: 'Review the 2026 budget',
        areaKey: 'finance',
      },
    ];

    const result = rankMatches('Review the 2027 budget', budgets);
    // It is still listed — a reader glancing at a list is not being interrupted.
    expect(result.matches).toHaveLength(1);
    expect(result.worthReading).toBe(false);
  });

  it('interrupts over a real near-duplicate', () => {
    const result = rankMatches('Fence replaced', candidates);
    expect(result.worthReading).toBe(true);
  });
});
