import type { z } from 'zod';
import { ConnectorError, type ExternalTool } from './errors.js';

/**
 * The boundary. Every response is parsed here before any other code sees it
 * (docs/14-threat-model.md §5, *Untrusted input*).
 *
 * An unexpected shape **fails the run**. It is never coerced, never defaulted
 * and never guessed: a guessed mapping writes wrong values into a real
 * workspace, and it does it silently, for as long as nobody looks.
 *
 * ## Why the path is filtered
 *
 * A Zod issue path is the honest answer to "which field?", and for a wire
 * envelope — `results.0.last_edited_time` — it is vendor vocabulary that is
 * identical for every workspace. But the document tool keys a page's
 * properties by their **user-defined names**, so a raw path can read
 * `results.0.properties.<someone's column name>.number`, and that is instance
 * data on its way into a log line (docs/17-privacy.md §1).
 *
 * So a path segment survives only if it looks like a wire key: lower-case
 * ASCII snake_case, or an array index. Everything else becomes `<redacted>`.
 * The rule errs safe — a wire key that happened to be capitalised would be
 * redacted too, and losing a little debuggability is the correct trade against
 * publishing someone's schema.
 *
 * For the same reason the message is built from the issue's `code` and
 * `expected` rather than from Zod's rendered `message`: those two are
 * ours, whereas a rendered message can quote the input.
 */

const WIRE_KEY = /^[a-z][a-z0-9_]*$/;

/** How many issues a message lists before it stops. Bounded, so a wholly wrong response is still readable. */
const MAX_ISSUES = 5;

export interface ParseContext {
  readonly tool: ExternalTool;
  /** What was being attempted: `sync incremental`, `query objectives_db`. */
  readonly operation: string;
  /** The wire shape expected: `sync response`, `page`, `block list`. */
  readonly shape: string;
}

export function redactPathSegment(segment: PropertyKey): string {
  if (typeof segment === 'number') return String(segment);
  if (typeof segment === 'symbol') return '<redacted>';
  if (/^\d+$/.test(segment)) return segment;
  return WIRE_KEY.test(segment) ? segment : '<redacted>';
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '<root>';
  return path.map(redactPathSegment).join('.');
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = formatIssuePath(issue.path);
  const expected = 'expected' in issue ? issue.expected : undefined;
  return typeof expected === 'string'
    ? `${path} — ${issue.code}, expected ${expected}`
    : `${path} — ${issue.code}`;
}

/**
 * Parses `value` or throws {@link ConnectorError} with `invalid_shape`.
 *
 * The thrown message names the fields that failed and nothing else. It does
 * not include the response body — that body is somebody's planning history.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, context: ParseContext): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues;
  const listed = issues.slice(0, MAX_ISSUES).map(describeIssue).join('; ');
  const remaining = issues.length - Math.min(issues.length, MAX_ISSUES);
  const suffix = remaining > 0 ? `; and ${String(remaining)} more` : '';

  throw new ConnectorError(
    'invalid_shape',
    `unexpected ${context.shape}: ${listed}${suffix}. The mapping is not guessed — fix the schema or the integration`,
    { tool: context.tool, operation: context.operation, cause: result.error },
  );
}

/** JSON that failed to parse at all. Kept here so the message stays body-free. */
export function parseJsonOrThrow(body: string, context: ParseContext): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ConnectorError('invalid_shape', `${context.shape} was not JSON`, {
      tool: context.tool,
      operation: context.operation,
      cause,
    });
  }
}
