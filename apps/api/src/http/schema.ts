import type { z } from 'zod';
import { ApiError, type FieldProblem } from './errors.js';

/**
 * Parsing at the boundary, and the two refusals that follow from ownership.
 *
 * docs/14-threat-model.md §5 asks for one Zod schema per boundary, parsed
 * before any other code sees the value, and explicit field allow-lists on every
 * write path. This file is both: `defineWrite` takes a **strict** object schema
 * — which is the allow-list — and a table of the fields this endpoint owns but
 * refuses, which is ADR-0008 expressed as an HTTP response.
 *
 * ### Why a refused field is not the same as an unknown one
 *
 * `{"due": "2026-10-01"}` on an initiative is not a typo. It is a caller acting
 * on a belief about who owns that field, and the honest answer names the owner:
 * the task tool does, and prisme never writes it (ADR-0003). Silently dropping
 * it would teach the caller that the write worked — apps/api/CLAUDE.md §4, and
 * the reason the check happens *before* the strict parse rather than falling
 * out of it as an unrecognised key.
 */

/** A schema with a name, so it reaches OpenAPI as a component rather than inline. */
export interface NamedSchema<T> {
  readonly name: string;
  readonly schema: z.ZodType<T>;
}

export function named<T>(name: string, schema: z.ZodType<T>): NamedSchema<T> {
  return { name, schema };
}

/**
 * A write body: the allow-list, and the fields refused by name.
 *
 * `readOnly` maps a field to the sentence explaining why this endpoint will not
 * write it — because another store owns it, because it is derived, or because
 * it has a dedicated endpoint that records the decision properly. The sentence
 * is returned to the caller, so it is written for a person reading an error at
 * the moment they got something wrong: cite the spec, name the owner, say where
 * the field *is* written.
 */
export interface WriteSchema<T> extends NamedSchema<T> {
  readonly readOnly: Readonly<Record<string, string>>;
}

export function defineWrite<T>(
  name: string,
  schema: z.ZodType<T>,
  readOnly: Readonly<Record<string, string>> = {},
): WriteSchema<T> {
  return { name, schema, readOnly };
}

function problemsOf(error: z.ZodError): readonly FieldProblem[] {
  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? '(body)' : issue.path.join('.'),
    reason: issue.message,
  }));
}

/**
 * Unrecognised keys, pulled out of a strict object's issues.
 *
 * Zod reports them as one issue listing every offending key, which is exactly
 * the shape a caller wants back — all of them at once rather than one per round
 * trip.
 */
function unrecognisedKeys(error: z.ZodError): readonly string[] {
  const keys: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') keys.push(...issue.keys);
  }
  return keys;
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError('invalid_request', `the ${where} is not valid`, problemsOf(result.error));
}

/**
 * Parse a write body: refuse a field prisme does not own here, then the
 * allow-list, then everything else.
 *
 * The order matters. A read-only field is also an unrecognised key to a strict
 * schema, and "unknown field" is the wrong answer to a caller who named a field
 * that very much exists.
 */
export function parseWriteBody<T>(write: WriteSchema<T>, value: unknown): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('invalid_request', 'the request body must be a JSON object');
  }

  const refused: FieldProblem[] = [];
  for (const field of Object.keys(value)) {
    const reason = write.readOnly[field];
    if (reason !== undefined) refused.push({ field, reason });
  }
  if (refused.length > 0) {
    const names = refused.map((problem) => problem.field).join(', ');
    throw new ApiError(
      'read_only_field',
      `${names} cannot be written here; the request was refused rather than ignored, and each field says why`,
      refused,
    );
  }

  const result = write.schema.safeParse(value);
  if (result.success) return result.data;

  const unknown = unrecognisedKeys(result.error);
  if (unknown.length > 0) {
    throw new ApiError(
      'unknown_field',
      `the request body names ${unknown.join(', ')}, which this endpoint does not accept`,
      unknown.map((field) => ({ field, reason: 'not a field of this request' })),
    );
  }

  throw new ApiError('invalid_request', 'the request body is not valid', problemsOf(result.error));
}
