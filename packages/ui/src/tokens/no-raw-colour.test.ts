import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "No hard-coded colour anywhere in the monorepo" is the first non-negotiable
 * in `packages/ui/CLAUDE.md`. A promise nobody checks is a promise that decays
 * on the first busy afternoon, so this walks the two trees that render
 * anything and fails on a colour literal outside the palette.
 *
 * It is deliberately a test rather than an ESLint rule: the rule would have to
 * live in the root config, which W07 does not own, and a reviewer reading a
 * failure here gets the reason along with the line.
 */

const UI_SRC = join(import.meta.dirname, '..');
const WEB_SRC = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'web', 'src');

/** The one file allowed to name a colour, plus the tests that assert on it. */
const ALLOWED = new Set([join(UI_SRC, 'tokens', 'palette.ts')]);

const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/;

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

describe('colour lives in exactly one place', () => {
  it('no source file outside the palette names a colour', () => {
    const offenders: string[] = [];

    for (const root of [UI_SRC, WEB_SRC]) {
      for (const file of sourceFiles(root)) {
        if (ALLOWED.has(file)) continue;
        for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
          if (COLOUR_LITERAL.test(line)) {
            offenders.push(`${relative(join(UI_SRC, '..', '..', '..'), file)}:${index + 1}`);
          }
        }
      }
    }

    expect(
      offenders,
      'Colour belongs in packages/ui/src/tokens/palette.ts. Read a semantic token instead.',
    ).toEqual([]);
  });

  it('is actually looking at files — a guard against a silently empty walk', () => {
    const files = sourceFiles(UI_SRC);
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(`tokens${sep}palette.ts`))).toBe(true);
  });
});
