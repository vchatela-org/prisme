import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * **No test builds its own database client.**
 *
 * This is the guard for the class of defect W15 recorded and W16 closed. The
 * application builds its client through `createDatabase`, which wraps the
 * driver in Drizzle; Drizzle replaces the shared client's serializers, so a
 * `jsonb` object, a `timestamptz[]` array and a date-typed parameter all reach
 * the socket differently on that client than on a bare one. The integration
 * suite built a **bare** one, and so two production defects were invisible to
 * it — W04's `timestamptz` round trip and W15's `sql.json()` — until each was
 * found by hand.
 *
 * Switching `openTestDatabase` to `createDatabase` closed that instance, and
 * immediately exposed two more of the same class that had never run under CI:
 * `GET /events` answering `500` on a `jsonb` **string**, and
 * `prisme-sync backfill` failing outright on its `timestamptz[]` and `date[]`
 * window writes. That is what a class of defect looks like — one fix, three
 * more instances — and it is why this file exists rather than a comment.
 *
 * The rule is a source walk rather than a runtime assertion, because what goes
 * wrong is the *construction*, and a client that has already been built cannot
 * be asked whether it was built the right way. The walk covers every
 * `*.test.ts` under `apps/`: a suite that builds a client is the defect, whether
 * or not its own assertions pass.
 *
 * One escape hatch, and it is spelled out rather than implied: a bare
 * `postgres(…)` is permitted when the two lines above it carry the marker
 * **bare-client-ok**, anywhere in the comment block directly above it. Exactly
 * two do — the schema-owner connections in the two
 * `test-support/database.ts` modules, which run DDL and `truncate` and never a
 * tagged-template write. Prose that merely mentions the constructor is not a
 * construction, so comment lines are skipped.
 */

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/** Every file under the two applications, excluding what is not source. */
function applicationSources(): string[] {
  const root = new URL('../../../..', import.meta.url).pathname;
  return [
    ...walk(`${root}apps/api/src`),
    ...walk(`${root}apps/sync/src`),
    ...walk(`${root}apps/web/src`),
  ];
}

/** The contiguous comment lines immediately above `index`, joined. */
function commentBlockAbove(lines: readonly string[], index: number): string {
  const block: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor] as string;
    if (!COMMENT.test(line)) break;
    block.unshift(line);
  }
  return block.join('\n');
}

const CONSTRUCTION = /(?<![.\w])postgres\(/;
const ESCAPE = /bare-client-ok/;
/** A line inside a `//` or block comment is prose, not a call site. */
const COMMENT = /^\s*(\/\/|\/?\*)/;

describe('test database clients', () => {
  it('are built by createDatabase, never by a bare driver constructor', () => {
    const offenders: string[] = [];

    for (const path of applicationSources()) {
      const source = readFileSync(path, 'utf8');
      const lines = source.split('\n');

      for (const [index, line] of lines.entries()) {
        // The import is the constructor being named, not being called.
        if (/^\s*import\b/.test(line)) continue;
        if (COMMENT.test(line)) continue;
        if (!CONSTRUCTION.test(line)) continue;

        // The escape hatch is the marker in the comment block directly above.
        if (ESCAPE.test(commentBlockAbove(lines, index))) continue;

        offenders.push(`${path.replace(/^\//, '')}:${String(index + 1)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('builds the application client the same way in both applications', () => {
    const root = new URL('../../../..', import.meta.url).pathname;
    for (const path of [
      'apps/api/src/test-support/database.ts',
      'apps/sync/src/test-support/database.ts',
    ]) {
      const source = readFileSync(`${root}${path}`, 'utf8');
      expect(source, `${path} must build its application client through createDatabase`).toContain(
        'createDatabase(',
      );
    }
  });
});
