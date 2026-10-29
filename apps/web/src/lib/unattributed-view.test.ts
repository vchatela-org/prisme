import { describe, expect, it } from 'vitest';
import type { TaskLocations, Unattributed } from './contracts';
import { unattributedRows, unattributedSummary } from './unattributed-view';

const locations: TaskLocations = {
  failure: null,
  projects: [
    {
      id: 'p-general',
      name: 'General',
      parentId: null,
      archived: false,
      inbox: false,
      sections: [{ id: 's-house', name: 'House', archived: false }],
    },
    { id: 'p-inbox', name: 'Inbox', parentId: null, archived: false, inbox: true, sections: [] },
  ],
};

const data: Unattributed = {
  from: '2026-08-24',
  to: '2026-09-17',
  windowWeeks: 4,
  observedSource: 'capacity_week',
  total: 4,
  items: [
    { externalProjectId: 'p-general', externalSectionId: null, completions: 2, partlyMapped: true },
    { externalProjectId: 'p-loose', externalSectionId: null, completions: 1, partlyMapped: false },
    { externalProjectId: null, externalSectionId: null, completions: 1, partlyMapped: false },
  ],
};

describe('completions the chart counted toward no area (S9)', () => {
  it('offers the rest of a project split by section, and the whole of an unmapped one', () => {
    const rows = unattributedRows(data, locations);
    expect(rows.map((row) => [row.where, row.action])).toEqual([
      ['General — tasks in no section', 'map_rest'],
      ['p-loose', 'map_project'],
      ['No project', null],
    ]);
  });

  it('says how many were left out, and nothing when none were', () => {
    expect(unattributedSummary(data)).toContain('4 completions in the last 4 weeks');
    expect(unattributedSummary({ ...data, total: 0, items: [] })).toBeNull();
  });
});

describe('the task tool’s Inbox (S11)', () => {
  it('lists its completions and offers no mapping, because it belongs to no area', () => {
    const rows = unattributedRows(
      {
        ...data,
        total: 3,
        items: [
          {
            externalProjectId: 'p-inbox',
            externalSectionId: null,
            completions: 3,
            partlyMapped: false,
          },
        ],
      },
      locations,
    );
    expect(rows).toEqual([
      {
        key: 'p-inbox/',
        projectId: 'p-inbox',
        where: 'Inbox — Todoist’s Inbox, which belongs to no area',
        completions: 3,
        action: null,
      },
    ]);
  });
});
