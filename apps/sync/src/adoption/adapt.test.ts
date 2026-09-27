import { describe, expect, it } from 'vitest';
import type {
  DocPropertyValue,
  DocRecord,
  ExternalProject,
  ExternalSection,
  ExternalTask,
} from '@prisme/connectors';
import { parseCalendarDate } from '@prisme/domain';
import { locationKey } from '../reconcile/types.js';
import {
  adaptDocRecords,
  adaptProjects,
  adaptTasks,
  periodOf,
  type AdaptOptions,
} from './adapt.js';

/**
 * The adapter is the only file that knows either tool's vocabulary, so these
 * tests are about the two things that would go wrong silently: structure
 * counted from the wrong place, and a property read with a guess.
 */

const OPTIONS: AdaptOptions = {
  areaByLocation: new Map([
    [locationKey('p-home'), 'home'],
    [locationKey('p-home', 's-signals'), 'signals'],
  ]),
  laneByArea: new Map([
    ['home', 'area'],
    ['signals', 'signals'],
  ]),
  mappingProperty: 'prisme id',
  takeawayTypeProperty: 'type',
};

function taskOf(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    externalId: 't-1',
    projectId: 'p-home',
    content: 'Rebuild the garden shed',
    description: { text: '', segments: [], urls: [] },
    labels: [],
    priority: 'lowest',
    completed: false,
    order: 1,
    urls: [],
    contentHash: 'hash',
    ...overrides,
  };
}

describe('tasks', () => {
  it('counts children from the list that was actually read', () => {
    // A child the read did not return is a child that cannot be adopted either,
    // so the count is derived rather than trusted from the tool.
    const objects = adaptTasks(
      [
        taskOf({ externalId: 'parent' }),
        taskOf({ externalId: 'kid-1', parentId: 'parent' }),
        taskOf({ externalId: 'kid-2', parentId: 'parent' }),
        taskOf({ externalId: 'alone' }),
      ],
      OPTIONS,
    );
    expect(objects.find((object) => object.externalId === 'parent')?.childCount).toBe(2);
    expect(objects.find((object) => object.externalId === 'alone')?.childCount).toBe(0);
    expect(objects.find((object) => object.externalId === 'kid-1')?.parentId).toBe('parent');
  });

  it('prefers a section mapping over its project, so one project can feed two areas', () => {
    const [inProject, inSection] = adaptTasks(
      [taskOf({ externalId: 'a' }), taskOf({ externalId: 'b', sectionId: 's-signals' })],
      OPTIONS,
    );
    expect(inProject).toMatchObject({ areaKey: 'home', areaLane: 'area' });
    expect(inSection).toMatchObject({ areaKey: 'signals', areaLane: 'signals' });
  });

  it('leaves an unmapped location with no area at all, rather than a default', () => {
    const [object] = adaptTasks([taskOf({ projectId: 'p-unknown' })], OPTIONS);
    expect(object?.areaKey).toBeUndefined();
    expect(object?.areaLane).toBeUndefined();
  });

  it('carries completion and recurrence, which decide two classifier branches', () => {
    const [object] = adaptTasks(
      [
        taskOf({
          completed: true,
          due: { date: parseCalendarDate('2026-10-01'), isRecurring: true },
        }),
      ],
      OPTIONS,
    );
    expect(object).toMatchObject({ closed: true, recurring: true });
  });
});

describe('projects', () => {
  function projectOf(overrides: Partial<ExternalProject> = {}): ExternalProject {
    return { externalId: 'p-home', name: 'Home', archived: false, order: 1, ...overrides };
  }
  function sectionOf(overrides: Partial<ExternalSection> = {}): ExternalSection {
    return {
      externalId: 's-1',
      projectId: 'p-home',
      name: 'Doing',
      archived: false,
      order: 1,
      ...overrides,
    };
  }

  it('counts sections, ignoring archived ones', () => {
    const [object] = adaptProjects(
      [projectOf()],
      [sectionOf({ externalId: 's-1' }), sectionOf({ externalId: 's-2', archived: true })],
      OPTIONS,
    );
    expect(object?.sectionCount).toBe(1);
  });

  it('treats an archived project as closed', () => {
    const [object] = adaptProjects([projectOf({ archived: true })], [], OPTIONS);
    expect(object?.closed).toBe(true);
  });
});

describe('document records', () => {
  function recordOf(properties: readonly (readonly [string, DocPropertyValue])[] = []): DocRecord {
    return {
      role: 'takeaways_db',
      externalId: 'page-1',
      lastEditedAt: new Date('2026-09-19T08:00:00Z'),
      createdAt: new Date('2026-09-01T08:00:00Z'),
      archived: false,
      title: 'Slow is smooth',
      properties: new Map(properties),
      urls: [],
      contentHash: 'hash',
    };
  }

  it('reads the takeaway type from the property the instance names', () => {
    const [action] = adaptDocRecords(
      [recordOf([['type', { kind: 'select', value: 'Action' }]])],
      OPTIONS,
    );
    expect(action?.takeawayType).toBe('action');

    const [principle] = adaptDocRecords(
      [recordOf([['type', { kind: 'select', value: 'Principe' }]])],
      OPTIONS,
    );
    expect(principle?.takeawayType).toBe('principle');
  });

  it('leaves the type unset rather than guessing at an unrecognised value', () => {
    // The wrong guess puts a principle in the backlog, and principles are the
    // things that must never be there.
    const [object] = adaptDocRecords(
      [recordOf([['type', { kind: 'select', value: 'Something else' }]])],
      OPTIONS,
    );
    expect(object?.takeawayType).toBeUndefined();
  });

  it('reads guard 4s mapping property, and ignores an empty one', () => {
    const [mapped] = adaptDocRecords(
      [recordOf([['prisme id', { kind: 'url', value: ' i-42 ' }]])],
      OPTIONS,
    );
    expect(mapped?.mappedPrismeId).toBe('i-42');

    const [blank] = adaptDocRecords(
      [recordOf([['prisme id', { kind: 'url', value: '  ' }]])],
      OPTIONS,
    );
    expect(blank?.mappedPrismeId).toBeUndefined();
  });

  it('reads neither property when the instance has not named one', () => {
    const [object] = adaptDocRecords([recordOf([['type', { kind: 'select', value: 'Action' }]])], {
      areaByLocation: new Map(),
      laneByArea: new Map(),
    });
    expect(object?.takeawayType).toBeUndefined();
    expect(object?.mappedPrismeId).toBeUndefined();
  });

  it('carries the role, which is what the classifier keys on', () => {
    const [object] = adaptDocRecords([recordOf()], OPTIONS);
    expect(object).toMatchObject({ kind: 'page', role: 'takeaways_db' });
  });

  describe('the period a chosen date property names', () => {
    const dated = (start: string | null, end: string | null = null) =>
      recordOf([
        [
          'When',
          {
            kind: 'date',
            start: start === null ? null : parseCalendarDate(start),
            end: end === null ? null : parseCalendarDate(end),
          },
        ],
      ]);

    it('reads a range as it is, and a single date as a one-day period', () => {
      expect(periodOf(dated('2024-01-01', '2024-12-31'), 'When')).toEqual({
        startsOn: '2024-01-01',
        endsOn: '2024-12-31',
      });
      expect(periodOf(dated('2026-10-01'), 'When')).toEqual({
        startsOn: '2026-10-01',
        endsOn: '2026-10-01',
      });
    });

    it('puts a backwards range in order rather than refusing it', () => {
      expect(periodOf(dated('2024-12-31', '2024-01-01'), 'When')).toEqual({
        startsOn: '2024-01-01',
        endsOn: '2024-12-31',
      });
    });

    it('is no date at all when the property is empty, missing, not a date, or not chosen', () => {
      expect(periodOf(dated(null), 'When')).toBeUndefined();
      expect(periodOf(dated('2024-01-01'), 'Another column')).toBeUndefined();
      expect(periodOf(recordOf([['When', { kind: 'select', value: '2024' }]]), 'When')).toBe(
        undefined,
      );
      expect(periodOf(dated('2024-01-01'), undefined)).toBeUndefined();
    });

    it('reads the property chosen for the record’s own store, and no other', () => {
      const record = dated('2024-01-01', '2024-12-31');
      const [chosen] = adaptDocRecords([record], {
        ...OPTIONS,
        datePropertyByRole: new Map([['takeaways_db', 'When']]),
      });
      expect(chosen).toMatchObject({ startsOn: '2024-01-01', endsOn: '2024-12-31' });

      const [elsewhere] = adaptDocRecords([record], {
        ...OPTIONS,
        datePropertyByRole: new Map([['objectives_db', 'When']]),
      });
      expect(elsewhere?.startsOn).toBeUndefined();
    });
  });
});
