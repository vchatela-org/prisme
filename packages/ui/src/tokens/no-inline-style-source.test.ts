import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The source half of the CSP rule: **no `style` attribute in either rendering
 * tree**, whether or not a test happens to render the component.
 *
 * `../no-inline-style.test.tsx` renders the design system and asserts on the
 * markup, which is the stronger check — it sees what a dependency emits too.
 * It can only cover what it renders, and `apps/web` has no component-test
 * harness at all (W08's journal entry, the third follow-up). So this walks the
 * text as well, in the same spirit as `no-raw-colour.test.ts`, and fails on a
 * `style=` prop wherever it appears.
 *
 * Why the rule exists rather than a relaxed policy: `style-src` without
 * `unsafe-inline` is what makes an XSS a bug instead of a total compromise of
 * an application holding read/write tokens to an entire personal workspace
 * (docs/14-threat-model.md). A `style` attribute cannot be nonced, so the only
 * two ways to paint are a class from the generated stylesheet and — when the
 * value comes from data — an SVG presentation attribute.
 */

const UI_SRC = join(import.meta.dirname, '..');
const WEB_SRC = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'web', 'src');
const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/** `style=` as a JSX prop. `style="…"` inside a test's expectation is not one. */
const STYLE_PROP = /(?:^|[\s{(])style=\{/;

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
    }
  };
  walk(root);
  return found;
}

describe('nothing paints with a style attribute', () => {
  it('no component in packages/ui or apps/web sets one', () => {
    const offenders: string[] = [];

    for (const root of [UI_SRC, WEB_SRC]) {
      for (const file of sourceFiles(root)) {
        for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
          if (STYLE_PROP.test(line)) offenders.push(`${relative(REPO, file)}:${index + 1}`);
        }
      }
    }

    expect(
      offenders,
      'A `style` attribute is refused by the Content-Security-Policy the web tier sends, and ' +
        'the browser logs a violation for each one. Paint with a class from the generated ' +
        'stylesheet (packages/ui/src/tokens/area-color.ts), or with an SVG `fill`/`width` ' +
        'attribute when the value comes from data.',
    ).toEqual([]);
  });

  it('is actually looking at files — a guard against a silently empty walk', () => {
    expect(sourceFiles(UI_SRC).length).toBeGreaterThan(20);
    expect(sourceFiles(WEB_SRC).length).toBeGreaterThan(5);
  });

  it('recognises the shape it is looking for', () => {
    expect(STYLE_PROP.test('      <span style={{ backgroundColor: color }} />')).toBe(true);
    expect(STYLE_PROP.test('<span style={style} />')).toBe(true);
    expect(STYLE_PROP.test("expect(markup).not.toContain('style=\"')")).toBe(false);
  });
});
