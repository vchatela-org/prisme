import { describe, expect, it } from 'vitest';
import type { AreaPages, SettingsArea, TaskLocations } from './contracts';
import {
  AREA_KEY_PATTERN,
  areaChoice,
  areaPageChoice,
  checkAdvice,
  dateChoice,
  holders,
  keyFromName,
  chosenAreaColors,
  nameLocation,
  ROLE_COPY,
  roleCopy,
  templateSummary,
} from './settings-view';

const LOCATIONS: TaskLocations = {
  failure: null,
  projects: [
    {
      id: 'p-1',
      name: 'Garden',
      parentId: null,
      archived: false,
      sections: [{ id: 's-1', name: 'Beds', archived: false }],
    },
    { id: 'p-2', name: 'Old', parentId: null, archived: true, sections: [] },
  ],
};

function area(key: string, overrides: Partial<SettingsArea> = {}): SettingsArea {
  return {
    key,
    name: key,
    kind: 'area',
    active: true,
    rankable: true,
    runBudgetHoursPerWeek: null,
    colorSlot: null,
    externalPageId: null,
    mappings: [],
    ...overrides,
  };
}

describe('naming a location', () => {
  it('names a project and a section from the tool’s list', () => {
    expect(nameLocation(LOCATIONS, 'p-1', 's-1')).toEqual({
      project: 'Garden',
      section: 'Beds',
      known: true,
      archived: false,
    });
  });

  it('says when the project is archived', () => {
    expect(nameLocation(LOCATIONS, 'p-2', null).archived).toBe(true);
  });

  it('falls back to the identifier, and says it is unknown, rather than inventing a name', () => {
    expect(nameLocation(null, 'p-9', null)).toEqual({
      project: 'p-9',
      section: null,
      known: false,
      archived: false,
    });
    expect(nameLocation(LOCATIONS, 'p-1', 's-9').known).toBe(false);
  });
});

describe('who holds a location', () => {
  it('indexes every mapping by project and section', () => {
    const held = holders([
      area('garden', {
        mappings: [{ externalProjectId: 'p-1', externalSectionId: null, isHome: true }],
      }),
      area('craft', {
        mappings: [{ externalProjectId: 'p-1', externalSectionId: 's-1', isHome: false }],
      }),
    ]);
    expect(held.get('p-1/')).toBe('garden');
    expect(held.get('p-1/s-1')).toBe('craft');
  });
});

describe('the colour map', () => {
  it('carries a chosen colour, and leaves an unchosen area to its key hash', () => {
    expect(
      chosenAreaColors([
        { key: 'craft', colorSlot: 7 },
        { key: 'money', colorSlot: null },
      ]),
    ).toEqual({ craft: 7 });
  });
});

describe('the words', () => {
  it('describes every role the API knows today', () => {
    for (const role of [
      'objectives_db',
      'takeaways_db',
      'media_db',
      'areas_db',
      'processes_db',
      'reviews_db',
      'initiative_pages_db',
      'project_pages_db',
      'capture_pages_db',
    ]) {
      expect(ROLE_COPY[role]).toBeDefined();
    }
    expect(roleCopy('something_new').label).toBe('something_new');
  });

  it('describes a page store as a database, and describes no template role', () => {
    // ADR-0030: a store's templates are the ones its database holds.
    for (const role of ['initiative_pages_db', 'project_pages_db', 'capture_pages_db']) {
      expect(ROLE_COPY[role]?.bind).toMatch(/database/);
    }
    expect(Object.keys(ROLE_COPY).some((role) => role.includes('template'))).toBe(false);
  });

  it('turns a failure kind into advice, and a pass into nothing', () => {
    expect(checkAdvice(null)).toBeNull();
    expect(checkAdvice('refused')).toMatch(/shared with the prisme integration/);
  });

  it('tells a page from an unshared store when the check could tell them apart', () => {
    // `wrong_kind` is only sent when the link was read as a page; a page the
    // integration cannot see is `refused`, and that advice keeps both causes.
    expect(checkAdvice('wrong_kind')).toMatch(/is to a page/);
    expect(checkAdvice('wrong_kind')).not.toMatch(/shared/);
    expect(checkAdvice('refused')).toMatch(/not to a database/);
  });

  it('says what a page store holds, and that holding nothing is not a failed check', () => {
    expect(templateSummary(null)).toBeNull();
    expect(templateSummary([])).toMatchObject({ warning: true });
    expect(templateSummary([])?.text).toMatch(/No template/);
    expect(templateSummary([{ name: 'Brief', isDefault: false }])).toEqual({
      text: 'Template: Brief.',
      warning: false,
    });
    expect(
      templateSummary([
        { name: 'Brief', isDefault: true },
        { name: 'Notes', isDefault: false },
      ])?.text,
    ).toMatch(/^Templates: Brief \(default\) · Notes\. A new page asks/);
  });

  it('proposes a key the API will accept', () => {
    expect(keyFromName('Café & Théâtre')).toBe('cafe-theatre');
    expect(AREA_KEY_PATTERN.test(keyFromName('Café & Théâtre'))).toBe(true);
  });
});

describe('dateChoice', () => {
  const binding = (over: Partial<Parameters<typeof dateChoice>[0]> = {}) => ({
    role: 'objectives_db',
    bound: true,
    dateProperty: null,
    dateProperties: ['Due', 'Period'],
    ...over,
  });

  it('offers the store’s date columns, with what is chosen', () => {
    expect(dateChoice(binding({ dateProperty: 'Period' }))).toEqual({
      state: 'choose',
      options: ['Due', 'Period'],
      chosen: 'Period',
    });
  });

  it('is hidden for a store nothing of which reaches Adoption, and for an unbound one', () => {
    expect(dateChoice(binding({ role: 'media_db' }))).toEqual({ state: 'hidden' });
    expect(dateChoice(binding({ role: 'initiative_pages_db' }))).toEqual({ state: 'hidden' });
    expect(dateChoice(binding({ bound: false }))).toEqual({ state: 'hidden' });
  });

  it('asks for a check before it can offer anything, and says when there is nothing', () => {
    expect(dateChoice(binding({ dateProperties: null }))).toEqual({ state: 'unchecked' });
    expect(dateChoice(binding({ dateProperties: [] }))).toEqual({ state: 'none', chosen: null });
  });
});

describe('areaChoice (ADR-0033)', () => {
  const binding = (over: Partial<Parameters<typeof areaChoice>[0]> = {}) => ({
    role: 'takeaways_db',
    bound: true,
    areaProperty: null,
    relationProperties: ['Linked notes', 'Sphere'],
    ...over,
  });

  it('offers the store’s relation columns, with what is chosen', () => {
    expect(areaChoice(binding({ areaProperty: 'Sphere' }))).toEqual({
      state: 'choose',
      options: ['Linked notes', 'Sphere'],
      chosen: 'Sphere',
    });
  });

  it('is offered where the date column is, and not on the Life areas store itself', () => {
    expect(areaChoice(binding({ role: 'objectives_db' })).state).toBe('choose');
    expect(areaChoice(binding({ role: 'processes_db' })).state).toBe('choose');
    expect(areaChoice(binding({ role: 'areas_db' }))).toEqual({ state: 'hidden' });
    expect(areaChoice(binding({ role: 'media_db' }))).toEqual({ state: 'hidden' });
    expect(areaChoice(binding({ bound: false }))).toEqual({ state: 'hidden' });
  });

  it('asks for a check before it can offer anything, and says when there is nothing', () => {
    expect(areaChoice(binding({ relationProperties: null }))).toEqual({ state: 'unchecked' });
    expect(areaChoice(binding({ relationProperties: [] }))).toEqual({
      state: 'none',
      chosen: null,
    });
  });
});

describe('areaPageChoice (ADR-0033)', () => {
  const nameOf = (key: string): string => key.toUpperCase();
  const pages = (
    items: readonly { id: string; title: string; heldBy: string | null }[],
  ): AreaPages => ({ bound: true, failure: null, pages: [...items] });

  it('offers the Life areas pages, marking one another area holds', () => {
    const choice = areaPageChoice(
      'home',
      'area-page-home',
      pages([
        { id: 'area-page-craft', title: 'Craft', heldBy: 'craft' },
        { id: 'area-page-home', title: 'Home', heldBy: 'home' },
        { id: 'area-page-garden', title: 'Garden', heldBy: null },
      ]),
      nameOf,
    );
    expect(choice).toEqual({
      state: 'choose',
      options: [
        { id: 'area-page-craft', title: 'Craft', takenBy: 'CRAFT' },
        { id: 'area-page-home', title: 'Home', takenBy: null },
        { id: 'area-page-garden', title: 'Garden', takenBy: null },
      ],
      chosen: 'area-page-home',
      elsewhere: null,
    });
  });

  it('says when the page the area has is not among them', () => {
    const choice = areaPageChoice('home', 'area-page-moved', pages([]), nameOf);
    expect(choice).toMatchObject({ state: 'choose', chosen: null, elsewhere: 'area-page-moved' });
  });

  it('says when there is nothing to pick from, and why', () => {
    expect(areaPageChoice('home', null, null, nameOf)).toEqual({ state: 'unbound', chosen: null });
    expect(
      areaPageChoice('home', null, { bound: false, failure: null, pages: [] }, nameOf),
    ).toEqual({ state: 'unbound', chosen: null });
    expect(
      areaPageChoice(
        'home',
        'area-page-home',
        { bound: true, failure: 'refused', pages: [] },
        nameOf,
      ),
    ).toEqual({ state: 'unreadable', failure: 'refused', chosen: 'area-page-home' });
  });
});
