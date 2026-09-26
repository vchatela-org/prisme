import { describe, expect, it } from 'vitest';
import type { SettingsArea, TaskLocations } from './contracts';
import {
  AREA_KEY_PATTERN,
  checkAdvice,
  holders,
  keyFromName,
  mergedAreaColors,
  nameLocation,
  ROLE_COPY,
  roleCopy,
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
  it('lets a chosen colour beat a pin, and leaves unchosen areas to their pin', () => {
    expect(
      mergedAreaColors({ craft: 2, money: 5 }, [
        { key: 'craft', colorSlot: 7 },
        { key: 'money', colorSlot: null },
      ]),
    ).toEqual({ craft: 7, money: 5 });
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
      'initiative_page_template',
      'project_page_template',
      'capture_page_template',
    ]) {
      expect(ROLE_COPY[role]).toBeDefined();
    }
    expect(roleCopy('something_new').label).toBe('something_new');
  });

  it('turns a failure kind into advice, and a pass into nothing', () => {
    expect(checkAdvice(null)).toBeNull();
    expect(checkAdvice('refused')).toMatch(/shared with the prisme integration/);
  });

  it('proposes a key the API will accept', () => {
    expect(keyFromName('Santé & Sport')).toBe('sante-sport');
    expect(AREA_KEY_PATTERN.test(keyFromName('Santé & Sport'))).toBe(true);
  });
});
