/**
 * Redaction happens at the serializer, not at the call site.
 *
 * The rule from docs/15-runtime.md §5 is deliberately strong: a token must be
 * unloggable *even by* `log.info({ config })`. That only holds if redaction is
 * applied to every value on its way out, by key name, without anyone having to
 * remember. A `log.info('token: ' + token)` still leaks — which is why
 * CLAUDE.md §4 forbids interpolating a secret into a message at all.
 */

/**
 * Key-name patterns whose values never reach the log.
 *
 * Matched against the key with case and separators removed, so `TOKEN_PEPPER`,
 * `tokenPepper` and `token-pepper` are the same key.
 *
 * `AUTH_ISSUER_URL`, `AUTH_AUDIENCE` and the rest of the `AUTH_*` family are
 * deliberately absent: docs/15-runtime.md §2 records them as configuration
 * rather than credentials, and redacting them would hide the values an
 * operator most often needs to debug a failing boot. `AUTH_ASSERTION_*` is
 * different — an assertion is a bearer credential (docs/14-threat-model.md §3)
 * — and `assertion` is on the list below.
 */
const DEFAULT_DENY_LIST: readonly RegExp[] = [
  /token/,
  /secret/,
  /password/,
  /passwd/,
  /pepper/,
  /apikey/,
  /authorization/,
  /cookie/,
  /credential/,
  /assertion/,
  /jwt/,
  /privatekey/,
  /signature/,
  /sessionid/,
  /databaseurl/,
  /connectionstring/,
  /\bdsn\b/,
  /bearer/,
];

export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;

/** `postgres://user:hunter2@host/db` → `postgres://***:***@host/db`. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface RedactOptions {
  /** Extra key-name patterns, added to the defaults rather than replacing them. */
  readonly additionalPatterns?: readonly RegExp[];
}

/**
 * True when a value logged under this key must be replaced.
 *
 * Exported because it is worth testing directly: this predicate is the whole
 * control.
 */
export function isSecretKey(key: string, options: RedactOptions = {}): boolean {
  const normalized = normalizeKey(key);
  if (DEFAULT_DENY_LIST.some((pattern) => pattern.test(normalized))) return true;
  return (options.additionalPatterns ?? []).some((pattern) => pattern.test(normalized));
}

/** Scrub credentials embedded in a string value, whatever key it arrived under. */
export function scrubValue(value: string): string {
  return value.replace(URL_CREDENTIALS, '$1***:***@');
}

/**
 * Deep-copy `value`, replacing anything held under a denied key with
 * {@link REDACTED}.
 *
 * Cycles, `Error`s, `Map`s, `Set`s and over-deep structures are all handled
 * here rather than crashing the logger: a serializer that throws takes the
 * process's only diagnostic channel with it.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return walk(value, options, 0, new WeakSet<object>());
}

function walk(
  value: unknown,
  options: RedactOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubValue(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return value;

  if (depth >= MAX_DEPTH) return '[truncated]';

  const object = value;
  if (seen.has(object)) return '[circular]';
  seen.add(object);

  if (object instanceof Error) {
    return {
      name: object.name,
      message: scrubValue(object.message),
      ...(object.stack === undefined ? {} : { stack: scrubValue(object.stack) }),
      ...(object.cause === undefined
        ? {}
        : { cause: walk(object.cause, options, depth + 1, seen) }),
    };
  }

  if (object instanceof Date) return object.toISOString();
  if (object instanceof Map) {
    return Object.fromEntries(
      [...object.entries()].map(([key, entry]) => [
        String(key),
        isSecretKey(String(key), options) ? REDACTED : walk(entry, options, depth + 1, seen),
      ]),
    );
  }
  if (object instanceof Set) {
    return [...object.values()].map((entry) => walk(entry, options, depth + 1, seen));
  }
  if (Array.isArray(object)) {
    return object.map((entry) => walk(entry, options, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(object as Record<string, unknown>)) {
    out[key] = isSecretKey(key, options) ? REDACTED : walk(entry, options, depth + 1, seen);
  }
  return out;
}
