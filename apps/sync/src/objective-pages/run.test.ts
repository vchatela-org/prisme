import { ConnectorError, type DocPropertyValue, type DocRecord } from '@prisme/connectors';
import type { DocumentEntryWriter, ObjectivePageDates } from '@prisme/connectors/write';
import type { CalendarDate } from '@prisme/domain';
import { describe, expect, it } from 'vitest';
import type { SyncEvent } from '../apply/ports.js';
import { currentWriteSubject, type WriteSubject } from '../audit/subject.js';
import {
  lastAppliedKey,
  type ConflictRecord,
  type LastAppliedIndex,
  type LastAppliedWrite,
} from '../reconcile/types.js';
import { datesValue, OBJECTIVE_PAGE, type LinkedObjective } from './plan.js';
import { reconcileObjectivePages, type ObjectivePageStore } from './run.js';

/**
 * The objective-pages pass (ADR-0034), end to end over fakes: what it reads,
 * what it sends, what it records, and what it refuses to do. Every identifier,
 * title and column name is invented (docs/17-privacy.md).
 */

const COLUMN = 'Période';

const OBJECTIVE: LinkedObjective = {
  objectiveId: 'objective-0001',
  title: 'Run a first marathon',
  type: 'annual',
  period: '2027',
  pageId: 'page-0001',
};

function record(pageId: string, dates: DocPropertyValue | undefined): DocRecord {
  const properties = new Map<string, DocPropertyValue>();
  if (dates !== undefined) properties.set(COLUMN, dates);
  return {
    role: 'objectives_db',
    externalId: pageId,
    lastEditedAt: new Date('2026-09-20T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archived: false,
    title: 'Run a first marathon',
    properties,
    urls: [],
    contentHash: 'hash',
  };
}

const range = (start: string, end: string): DocPropertyValue => ({
  kind: 'date',
  start: start as CalendarDate,
  end: end as CalendarDate,
});

interface Recorded {
  readonly lastApplied: LastAppliedWrite[];
  readonly conflicts: ConflictRecord[];
  readonly events: SyncEvent[];
  readonly writes: { write: ObjectivePageDates; subject: WriteSubject | undefined }[];
  readonly queries: string[];
}

function world(
  options: {
    dateColumn?: string | undefined;
    objectives?: readonly LinkedObjective[];
    records?: readonly DocRecord[];
    lastApplied?: LastAppliedIndex;
    writer?: (write: ObjectivePageDates) => Promise<void>;
  } = {},
) {
  const recorded: Recorded = {
    lastApplied: [],
    conflicts: [],
    events: [],
    writes: [],
    queries: [],
  };

  const store: ObjectivePageStore = {
    loadDateColumn: () => Promise.resolve('dateColumn' in options ? options.dateColumn : COLUMN),
    loadLinkedObjectives: () => Promise.resolve(options.objectives ?? [OBJECTIVE]),
    loadLastApplied: () => Promise.resolve(options.lastApplied ?? new Map()),
    recordLastApplied: (writes) => {
      recorded.lastApplied.push(...writes);
      return Promise.resolve();
    },
    recordConflict: (conflict) => {
      recorded.conflicts.push(conflict);
      return Promise.resolve();
    },
    recordEvent: (event) => {
      recorded.events.push(event);
      return Promise.resolve();
    },
  };

  const docClient = {
    queryByRole: (role: string, since?: Date) => {
      recorded.queries.push(since === undefined ? role : `${role} since`);
      return Promise.resolve([
        ...(options.records ?? [record('page-0001', range('2028-01-01', '2028-12-31'))]),
      ]);
    },
  };

  const writer: DocumentEntryWriter = {
    setObjectivePageDates: async (write) => {
      recorded.writes.push({ write, subject: currentWriteSubject() });
      if (options.writer !== undefined) await options.writer(write);
    },
  };

  return { store, docClient, writer, recorded };
}

const BASE = {
  writeEnabled: true,
  runId: 'run-0001',
  now: () => new Date('2026-09-28T10:00:00.000Z'),
};

describe('the objective-pages pass', () => {
  it('reads the whole objectives store, and writes the period to the page', async () => {
    const { recorded, ...ports } = world();

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.queries).toEqual(['objectives_db']);
    expect(recorded.writes).toEqual([
      {
        write: {
          pageId: 'page-0001',
          property: COLUMN,
          startsOn: '2027-01-01',
          endsOn: '2027-12-31',
        },
        subject: { entityKind: 'objective', entityId: 'objective-0001' },
      },
    ]);
    expect(recorded.lastApplied).toEqual([
      {
        entityKind: OBJECTIVE_PAGE,
        entityId: 'page-0001',
        field: 'dates',
        value: datesValue('2027-01-01', '2027-12-31'),
      },
    ]);
    expect(recorded.events).toMatchObject([
      { kind: 'sync_action', entityKind: 'objective', entityId: 'objective-0001' },
    ]);
    expect(result).toMatchObject({ applied: 1, conflicts: 0, failures: [] });
  });

  it('plans without writing anything, and records nothing', async () => {
    const { recorded, ...ports } = world();

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'plan' });

    expect(recorded.writes).toEqual([]);
    expect(recorded.lastApplied).toEqual([]);
    expect(recorded.events).toEqual([]);
    expect(result.plan?.counts.update).toBe(1);
    expect(result.report).toContain('1 to update');
  });

  it('records a hand edit it overwrote in the conflict ledger', async () => {
    const written = datesValue('2027-01-01', '2027-12-31');
    const { recorded, ...ports } = world({
      records: [record('page-0001', range('2027-06-01', '2027-12-31'))],
      lastApplied: new Map([
        [
          lastAppliedKey(OBJECTIVE_PAGE, 'page-0001', 'dates'),
          {
            entityKind: OBJECTIVE_PAGE,
            entityId: 'page-0001',
            field: 'dates',
            value: written,
            appliedAt: new Date('2026-09-01T00:00:00.000Z'),
          },
        ],
      ]),
    });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.writes).toHaveLength(1);
    expect(recorded.conflicts).toEqual([
      {
        entityId: 'objective-0001',
        field: 'period',
        prismeValue: written,
        externalValue: datesValue('2027-06-01', '2027-12-31'),
        resolution: 'prisme_wins',
      },
    ]);
    expect(result.conflicts).toBe(1);
  });

  it('sends nothing when every page already carries its period', async () => {
    const { recorded, ...ports } = world({
      records: [record('page-0001', range('2027-01-01', '2027-12-31'))],
    });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.writes).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.report).toContain('nothing to do');
  });

  it('refuses to write with the freeze on, and says so', async () => {
    const { recorded, ...ports } = world();

    const result = await reconcileObjectivePages({
      ...BASE,
      ...ports,
      writeEnabled: false,
      mode: 'apply',
    });

    expect(recorded.writes).toEqual([]);
    expect(result.refused).toMatch(/SYNC_WRITE_ENABLED is false/);
  });

  it('reads nothing when no date column is chosen', async () => {
    const { recorded, ...ports } = world({ dateColumn: undefined });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.queries).toEqual([]);
    expect(result.skipped).toMatch(/date column/);
  });

  it('reads nothing when no objective is linked to a page', async () => {
    const { recorded, ...ports } = world({ objectives: [] });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.queries).toEqual([]);
    expect(result.skipped).toMatch(/no objective is linked/);
  });

  it('keeps going past a failed write, records nothing for it, and reports it', async () => {
    const second = { ...OBJECTIVE, objectiveId: 'objective-0002', pageId: 'page-0002' };
    const { recorded, ...ports } = world({
      objectives: [OBJECTIVE, second],
      records: [
        record('page-0001', range('2028-01-01', '2028-12-31')),
        record('page-0002', range('2028-01-01', '2028-12-31')),
      ],
      writer: (write) =>
        write.pageId === 'page-0001'
          ? Promise.reject(
              new ConnectorError('refused', 'the entry is in the trash; nothing was written', {
                tool: 'doc',
                operation: 'set entry date objectives_db',
              }),
            )
          : Promise.resolve(),
    });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.objectiveId).toBe('objective-0001');
    expect(result.failures[0]?.reason).toMatch(/in the trash; nothing was written$/);
    expect(result.applied).toBe(1);
    expect(recorded.lastApplied.map((write) => write.entityId)).toEqual(['page-0002']);
  });

  it('stops at a rejected token rather than trying every page with it', async () => {
    const second = { ...OBJECTIVE, objectiveId: 'objective-0002', pageId: 'page-0002' };
    const { recorded, ...ports } = world({
      objectives: [OBJECTIVE, second],
      records: [
        record('page-0001', range('2028-01-01', '2028-12-31')),
        record('page-0002', range('2028-01-01', '2028-12-31')),
      ],
      writer: () =>
        Promise.reject(
          new ConnectorError('invalid_token', 'the token was rejected', {
            tool: 'doc',
            operation: 'set entry date objectives_db',
          }),
        ),
    });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(recorded.writes).toHaveLength(1);
    expect(result.stopped).toMatch(/the token was rejected$/);
  });

  it('keeps a driver error’s text out of the reason, which is logged', async () => {
    const { recorded: _recorded, ...ports } = world({
      writer: () => Promise.reject(new TypeError('row "Run a first marathon" is odd')),
    });

    const result = await reconcileObjectivePages({ ...BASE, ...ports, mode: 'apply' });

    expect(result.failures[0]?.reason).toBe('TypeError while writing the page');
  });
});
