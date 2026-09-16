import { createHash } from 'node:crypto';

/**
 * Content hashing — the second half of the watermark fix (docs/16-sync.md §2).
 *
 * Overlapping the watermark makes the read *wider*, which means the same
 * unchanged record arrives on two consecutive runs. Hashing is what stops that
 * from looking like a change: a record whose hash matches the one stored for it
 * is a no-op, whatever its timestamp says.
 *
 * The hash covers content and deliberately **excludes the timestamps**. A tool
 * that touches `last_edited_time` without changing anything — a rollup
 * recalculating, a bot stamping a field — must not produce a change here.
 *
 * Canonicalisation is explicit rather than `JSON.stringify(value)`, because
 * object key order is an implementation detail of whatever built the record and
 * a hash that depends on it is a hash that changes for no reason.
 */

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, entry]) => [String(key), entry] as const);
    return canonicalizeEntries(entries);
  }
  if (value instanceof Set) {
    return `[${[...value].map(canonicalize).sort().join(',')}]`;
  }
  if (typeof value === 'object') {
    return canonicalizeEntries(Object.entries(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  // A function or a symbol cannot have come from a parsed response. Hashing a
  // constant rather than a stringification keeps the result deterministic,
  // which is the one property the whole mechanism rests on.
  return '"<unhashable>"';
}

function canonicalizeEntries(entries: readonly (readonly [string, unknown])[]): string {
  const rendered = entries
    // `undefined` and a missing key are the same fact, and must hash the same.
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, canonicalize(entry)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${entry}`);
  return `{${rendered.join(',')}}`;
}

/** SHA-256 of the canonical form, as lower-case hex. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
