import { ConnectorError, type DocPropertyValue, type DocRecord } from '@prisme/connectors';
import { describe, expect, it } from 'vitest';
import {
  readObjectiveSuccess,
  type LinkedObjective,
  type ObjectiveSuccessStore,
  type SuccessColumn,
} from './run.js';

/**
 * The success read (ADR-0042) over fakes. Every identifier and column name is
 * invented (docs/17-privacy.md).
 */

const COLUMN = 'Réussite';
const NOW = new Date('2027-02-01T06:00:00.000Z');

function record(pageId: string, value: DocPropertyValue | undefined, archived = false): DocRecord {
  const properties = new Map<string, DocPropertyValue>();
  if (value !== undefined) properties.set(COLUMN, value);
  return {
    role: 'objectives_db',
    externalId: pageId,
    lastEditedAt: new Date('2027-01-20T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archived,
    title: 'An invented objective',
    properties,
    urls: [],
    contentHash: 'hash',
  };
}

const number = (value: number | null): DocPropertyValue => ({ kind: 'number', value });

function world(
  options: {
    column?: SuccessColumn | undefined;
    objectives?: readonly LinkedObjective[];
    records?: readonly DocRecord[] | Error;
  } = {},
) {
  const recorded: { byId?: ReadonlyMap<string, number | null>; at?: Date; cleared: number } = {
    cleared: 0,
  };
  let queries = 0;
  const store: ObjectiveSuccessStore = {
    loadSuccessColumn: () =>
      Promise.resolve(
        'column' in options ? options.column : { property: COLUMN, format: 'percent' },
      ),
    loadLinkedObjectives: () =>
      Promise.resolve(
        options.objectives ?? [
          { id: 'o-1', pageId: 'page-0001' },
          { id: 'o-2', pageId: 'page-0002' },
          { id: 'o-3', pageId: 'page-0003' },
        ],
      ),
    recordSuccess(byId, at) {
      recorded.byId = byId;
      recorded.at = at;
      return Promise.resolve(byId.size);
    },
    clearSuccess() {
      recorded.cleared += 1;
      return Promise.resolve(2);
    },
  };
  const docClient = {
    queryByRole() {
      queries += 1;
      const records = options.records ?? [
        // The same page, written bare: compared by `docIdKey`.
        record('page-0001', number(1)),
        record('page-0002', number(0.45)),
        record('page-0003', undefined),
      ];
      return records instanceof Error ? Promise.reject(records) : Promise.resolve([...records]);
    },
  };
  return { store, docClient, recorded, queries: () => queries };
}

describe('reading the document tool’s success figure', () => {
  it('reads a percent column as a percentage, by page, and writes it under apply', async () => {
    const { store, docClient, recorded } = world();
    const result = await readObjectiveSuccess({ mode: 'apply', store, docClient, now: () => NOW });
    expect(result.reading.enabled).toBe(true);
    expect([...(result.reading.byId ?? new Map())]).toEqual([
      ['o-1', 100],
      ['o-2', 45],
      ['o-3', null],
    ]);
    expect(result.read).toBe(2);
    expect(recorded.byId).toBe(result.reading.byId);
    expect(recorded.at).toEqual(NOW);
  });

  it('reads a plain number column as already a percentage', async () => {
    const { store, docClient } = world({
      column: { property: COLUMN, format: 'number' },
      records: [record('page-0002', number(80))],
      objectives: [{ id: 'o-2', pageId: 'page-0002' }],
    });
    const result = await readObjectiveSuccess({ mode: 'plan', store, docClient, now: () => NOW });
    expect(result.reading.byId?.get('o-2')).toBe(80);
  });

  it('writes nothing under plan, and still hands over what it read', async () => {
    const { store, docClient, recorded } = world();
    const result = await readObjectiveSuccess({ mode: 'plan', store, docClient, now: () => NOW });
    expect(recorded.byId).toBeUndefined();
    expect(result.written).toBe(0);
    expect(result.reading.byId?.get('o-1')).toBe(100);
  });

  it('is off, reads nothing and clears the stored figures, when no column is chosen', async () => {
    const { store, docClient, recorded, queries } = world({ column: undefined });
    const result = await readObjectiveSuccess({ mode: 'apply', store, docClient, now: () => NOW });
    expect(result.reading).toEqual({ enabled: false });
    expect(queries()).toBe(0);
    expect(recorded.cleared).toBe(1);
  });

  it('refuses a column whose format is not a success figure, rather than guessing', async () => {
    const { store, docClient, queries } = world({ column: { property: COLUMN, format: 'euro' } });
    const result = await readObjectiveSuccess({ mode: 'plan', store, docClient, now: () => NOW });
    expect(result.reading.enabled).toBe(false);
    expect(result.skipped).toContain('neither a percentage nor a plain number');
    expect(queries()).toBe(0);
  });

  it('hands nothing over when the store cannot be read, so the stored figures stand', async () => {
    const { store, docClient, recorded } = world({
      records: new ConnectorError('refused', 'a refusal', { tool: 'doc', operation: 'query' }),
    });
    const result = await readObjectiveSuccess({ mode: 'apply', store, docClient, now: () => NOW });
    expect(result.reading).toEqual({ enabled: true });
    expect(result.skipped).toContain('refused');
    expect(recorded.byId).toBeUndefined();
  });

  it('reads no figure from an archived page, a missing page, or a negative value', async () => {
    const { store, docClient } = world({
      records: [record('page-0001', number(1), true), record('page-0002', number(-0.2))],
    });
    const result = await readObjectiveSuccess({ mode: 'plan', store, docClient, now: () => NOW });
    expect([...(result.reading.byId?.values() ?? [])]).toEqual([null, null, null]);
  });
});
