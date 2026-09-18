import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInitiativeBody, updateInitiativeBody } from '../dto/initiative.js';
import { putAreaWeightBody } from '../dto/area.js';
import { ApiError } from './errors.js';
import { defineWrite, parseOrThrow, parseWriteBody } from './schema.js';

/**
 * The boundary, and the two refusals ADR-0008 asks for.
 *
 * The interesting case is the third one below: `due` is not a typo and not an
 * unknown field. It is a real field, owned by the task tool, and a caller
 * sending it has a wrong belief about who writes it. Answering `200` would
 * confirm that belief; answering `400 unknown_field` would deny the field
 * exists. Only naming the field *and* its owner tells the caller the truth.
 */

function thrown(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the parse to be refused, and it was not');
}

const VALID_INITIATIVE = {
  title: 'Fence replaced',
  areaKey: 'home',
  value: 5,
  timeCriticality: 3,
  risk: 2,
  size: 3,
} as const;

describe('write bodies', () => {
  it('accepts an allow-listed body and applies its defaults', () => {
    const parsed = parseWriteBody(createInitiativeBody, { ...VALID_INITIATIVE });
    expect(parsed.status).toBe('inbox');
    expect(parsed.dependsOn).toEqual([]);
  });

  it('refuses a field the task tool owns, naming it and its owner', () => {
    const error = thrown(() =>
      parseWriteBody(createInitiativeBody, { ...VALID_INITIATIVE, due: '2026-10-01' }),
    );

    expect(error.code).toBe('read_only_field');
    expect(error.status).toBe(400);
    expect(error.message).toContain('due');
    expect(error.fields?.[0]?.field).toBe('due');
    expect(error.fields?.[0]?.reason).toContain('the task tool owns');
    // The refusal cites where the rule is written, so the caller can read it.
    expect(error.fields?.[0]?.reason).toContain('ADR-0003');
  });

  it('refuses every derived field a caller might try to set', () => {
    for (const field of ['score', 'plannedStart', 'plannedEnd', 'progress', 'lastActivity']) {
      const error = thrown(() => parseWriteBody(updateInitiativeBody, { [field]: 1 }));
      expect(error.code, `${field} was not refused`).toBe('read_only_field');
      expect(error.fields?.[0]?.field).toBe(field);
    }
  });

  it('refuses `origin`, which is immutable by three separate mechanisms', () => {
    const error = thrown(() =>
      parseWriteBody(updateInitiativeBody, { origin: 'created_in_prisme' }),
    );
    expect(error.code).toBe('read_only_field');
    expect(error.fields?.[0]?.reason).toContain('ADR-0010');
  });

  it('names every refused field at once rather than one per round trip', () => {
    const error = thrown(() =>
      parseWriteBody(updateInitiativeBody, { due: '2026-10-01', plannedEnd: '2026-10-02' }),
    );
    expect(error.fields?.map((problem) => problem.field)).toEqual(['due', 'plannedEnd']);
  });

  it('separates an unknown field from a refused one', () => {
    const error = thrown(() =>
      parseWriteBody(createInitiativeBody, { ...VALID_INITIATIVE, colour: 'blue' }),
    );
    expect(error.code).toBe('unknown_field');
    expect(error.fields?.[0]?.field).toBe('colour');
  });

  it('reports an invalid value as invalid rather than as unknown', () => {
    const error = thrown(() =>
      parseWriteBody(createInitiativeBody, { ...VALID_INITIATIVE, size: 4 }),
    );
    expect(error.code).toBe('invalid_request');
    expect(error.fields?.[0]?.field).toBe('size');
  });

  it('refuses a body that is not an object', () => {
    expect(thrown(() => parseWriteBody(createInitiativeBody, [1, 2])).code).toBe('invalid_request');
    expect(thrown(() => parseWriteBody(createInitiativeBody, null)).code).toBe('invalid_request');
  });

  it('refuses a weight body that tries to name its own year or area', () => {
    const error = thrown(() => parseWriteBody(putAreaWeightBody, { weightPct: 30, year: 2026 }));
    expect(error.code).toBe('read_only_field');
    expect(error.fields?.[0]?.reason).toContain('ADR-0007');
  });

  it('carries no refusals when a write schema declares none', () => {
    const write = defineWrite('Plain', z.strictObject({ value: z.number() }));
    expect(parseWriteBody(write, { value: 1 })).toEqual({ value: 1 });
    expect(thrown(() => parseWriteBody(write, { other: 1 })).code).toBe('unknown_field');
  });
});

describe('path and query parsing', () => {
  it('says which of the three failed', () => {
    const schema = z.strictObject({ id: z.uuid() });
    expect(thrown(() => parseOrThrow(schema, { id: 'nope' }, 'path')).message).toContain('path');
    expect(thrown(() => parseOrThrow(schema, { id: 'nope' }, 'query')).message).toContain('query');
  });

  it('reports the field, not the value it was given', () => {
    const schema = z.strictObject({ token: z.uuid() });
    const error = thrown(() => parseOrThrow(schema, { token: 'hunter2' }, 'query'));
    expect(error.fields?.[0]?.field).toBe('token');
    expect(JSON.stringify(error.fields)).not.toContain('hunter2');
  });
});
