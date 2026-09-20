import { describe, expect, it } from 'vitest';
import type { DocRecord, DocToolClient, RoleKey } from '@prisme/connectors';

import { declaredMinutesFromProcesses } from './processes.js';
import type { RitualRecord } from './types.js';

/**
 * The declared-duration tier.
 *
 * Every identifier and property name here is invented. The property name in
 * particular is instance data in a real workspace — the document tool keys its
 * properties by whatever they happen to be called — which is exactly why it
 * arrives as configuration rather than being compiled in.
 */

const DURATION_PROPERTY = 'Invented duration property';

function record(externalId: string, properties: Record<string, unknown>): DocRecord {
  return {
    role: 'processes_db',
    externalId,
    lastEditedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    archived: false,
    title: 'Invented process',
    properties: new Map(Object.entries(properties)) as DocRecord['properties'],
    urls: [],
    contentHash: 'hash',
  };
}

function client(records: readonly DocRecord[], failOn?: RoleKey): DocToolClient {
  return {
    queryByRole: (role: RoleKey) => {
      if (role === failOn) return Promise.reject(new Error('no binding for role'));
      return Promise.resolve([...records]);
    },
    fetchPage: () => Promise.reject(new Error('not used')),
  };
}

function ritual(overrides: Partial<RitualRecord> = {}): RitualRecord {
  return {
    id: 'r-1',
    name: 'Invented habit',
    areaKey: 'alpha',
    cadence: 'weekly',
    externalTaskId: 't-1',
    externalPageId: 'page-1',
    ...overrides,
  };
}

describe('with no document-tool client', () => {
  /**
   * Which is every run today: nothing in this repository loads the role
   * bindings, so the processes store is not addressable. W12 found the same
   * gap. The tier is skipped and said to be skipped.
   */
  it('reads nothing and says so, rather than failing the run', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.read).toBe(false);
    expect(result.byTask.size).toBe(0);
  });

  it('reads nothing when the property name is not configured either', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: 20 } })]),
    });

    expect(result.read).toBe(false);
  });

  it('treats an unbound role as "not read" rather than as an error', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([], 'processes_db'),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.read).toBe(false);
    expect(result.byTask.size).toBe(0);
  });
});

describe('joining a process page to a task', () => {
  it('goes through the ritual, which binds a page to a task', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: 20 } })]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.read).toBe(true);
    expect(result.byTask.get('t-1')).toBe(20);
  });

  it('cannot place a duration when the ritual binds no task', async () => {
    const result = await declaredMinutesFromProcesses([ritual({ externalTaskId: undefined })], {
      docClient: client([record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: 20 } })]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.byTask.size).toBe(0);
  });

  it('cannot place a duration when the ritual names no page', async () => {
    const result = await declaredMinutesFromProcesses([ritual({ externalPageId: undefined })], {
      docClient: client([record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: 20 } })]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.byTask.size).toBe(0);
  });
});

/**
 * Never guess a mapping (`packages/connectors/CLAUDE.md` §3). A duration held
 * as free text says "45 min" in one row and something else entirely in the
 * next, and a parser that gets the second one wrong produces a silently wrong
 * measurement — which is worse than a default that is honestly a default.
 */
describe('a property prisme will not interpret', () => {
  it('counts a non-numeric duration as unreadable instead of parsing it', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([
        record('page-1', { [DURATION_PROPERTY]: { kind: 'select', value: '45 minutes' } }),
      ]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.byTask.size).toBe(0);
    expect(result.unreadable).toBe(1);
  });

  it('counts an empty number as unreadable rather than as zero minutes', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([
        record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: null } }),
      ]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.unreadable).toBe(1);
  });

  it('refuses a negative duration', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([record('page-1', { [DURATION_PROPERTY]: { kind: 'number', value: -5 } })]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.unreadable).toBe(1);
  });

  it('passes over a page that simply does not carry the property', async () => {
    const result = await declaredMinutesFromProcesses([ritual()], {
      docClient: client([record('page-1', { 'Something else': { kind: 'number', value: 20 } })]),
      durationProperty: DURATION_PROPERTY,
    });

    expect(result.unreadable).toBe(0);
    expect(result.byTask.size).toBe(0);
  });
});
