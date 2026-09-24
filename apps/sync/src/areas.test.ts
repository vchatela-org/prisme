import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAreasFile, parseMappingList } from './areas.js';

/**
 * The areas loader's parsing half.
 *
 * Two committed files carry the shape, and both are invented:
 *
 * - [`seed.example/areas.json`](../../../seed.example/areas.json) is the **format an instance
 *   copies**, and it is the positive case below. That is deliberate: the example and the parser are
 *   two spellings of one format, and a parser tested only against a fixture of its own invention
 *   can drift from the file the documentation tells a person to write. Unlike
 *   `seed.example/bindings.json` — which every one of its identifiers makes unloadable on purpose —
 *   this one has no placeholder, so it loads.
 * - [`fixtures/bindings.json`](../../../fixtures/bindings.json) carries the `areaMappings` array,
 *   which is where that key actually lives.
 *
 * `fixtures/areas.json` is deliberately **not** used here, and the reason is worth writing down
 * because it looks like it should be: it is a *test fixture*, not a seed file. It carries
 * `areaContext2026W37` and `_displayNote`, which belong to the scoring tests, so the strict parser
 * below refuses it — correctly, and the distinction is the point of the `_`-prefix rule.
 */

const EXAMPLE_AREAS = new URL('../../../seed.example/areas.json', import.meta.url).pathname;
const FIXTURE_BINDINGS = new URL('../../../fixtures/bindings.json', import.meta.url).pathname;

function parse(text: string): ReturnType<typeof parseAreasFile> {
  return parseAreasFile(text, 'seed/areas.json');
}

/** An area list and its weights, as JSON text, with one key replaced. */
function fileWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    areas: [
      { key: 'alpha', name: 'Alpha', kind: 'area' },
      { key: 'beta', name: 'Beta', kind: 'area' },
      { key: 'run', name: 'Run', kind: 'run', runBudgetHoursPerWeek: 3 },
    ],
    areaWeights: [
      { areaKey: 'alpha', year: 2026, weightPct: 60 },
      { areaKey: 'beta', year: 2026, weightPct: 40 },
    ],
    ...overrides,
  });
}

describe('parseAreasFile', () => {
  it('reads the format example the documentation tells a person to copy', () => {
    const loaded = parseAreasFile(readFileSync(EXAMPLE_AREAS, 'utf8'), EXAMPLE_AREAS);

    // Five entries: three areas and the two lanes. The lanes carry no weight —
    // the file's own `_rules` say so, and the parser refuses one that does.
    expect(loaded.areas.map((area) => area.key)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'run',
      'signals',
    ]);
    // `active` is absent from the example, and **absent is not `true`**: the
    // parse keeps the distinction, because an update has to leave an archived
    // area archived.
    expect(loaded.areas[0]).toEqual({ key: 'alpha', name: 'Alpha', kind: 'area' });
    expect(loaded.areas.find((area) => area.key === 'run')?.runBudgetHoursPerWeek).toBe(3);
    expect(loaded.weights).toHaveLength(3);
    expect(loaded.weights.every((weight) => weight.year === 2026)).toBe(true);
  });

  it('carries `active` when the file states it, and omits it when it does not', () => {
    const stated = parse(
      fileWith({
        areas: [
          { key: 'alpha', name: 'Alpha', kind: 'area', active: false },
          { key: 'beta', name: 'Beta', kind: 'area' },
        ],
      }),
    );

    // The distinction the loader's update rests on: `false` is a value, and
    // absent is not `true`.
    expect(stated.areas[0]?.active).toBe(false);
    expect(stated.areas[1]?.active).toBeUndefined();
    expect('active' in (stated.areas[1] ?? {})).toBe(false);
  });

  it('ignores prose at both levels, and refuses a data key it does not know', () => {
    const withProse = fileWith({
      _comment: 'synthetic',
      areas: [
        { key: 'alpha', name: 'Alpha', kind: 'area', _note: 'why this area exists' },
        { key: 'beta', name: 'Beta', kind: 'area' },
        { key: 'run', name: 'Run', kind: 'run', runBudgetHoursPerWeek: 3 },
      ],
    });
    expect(() => parse(withProse)).not.toThrow();

    // The failure this strictness exists for: `areaWeight` for `areaWeights`
    // would otherwise load no weights at all and report success.
    expect(() => parse(fileWith({ areaWeight: [] }))).toThrow(/unrecognised key "areaWeight"/);
    // The same rule inside an entry, where the typo is a field name.
    expect(() =>
      parse(
        fileWith({
          areas: [
            { key: 'alpha', name: 'Alpha', kind: 'area', active: true, enabled: true },
            { key: 'beta', name: 'Beta', kind: 'area' },
            { key: 'run', name: 'Run', kind: 'run', runBudgetHoursPerWeek: 3 },
          ],
        }),
      ),
    ).toThrow(/unrecognised key "enabled"/);
  });

  it('refuses a file that lists the same area twice', () => {
    expect(() =>
      parse(
        fileWith({
          areas: [
            { key: 'alpha', name: 'Alpha', kind: 'area' },
            { key: 'alpha', name: 'The same one', kind: 'area' },
          ],
        }),
      ),
    ).toThrow(/lists the area "alpha" more than once/);
  });

  it('refuses a run budget on anything but the Run lane', () => {
    expect(() =>
      parse(
        fileWith({
          areas: [{ key: 'alpha', name: 'Alpha', kind: 'area', runBudgetHoursPerWeek: 4 }],
          areaWeights: [{ areaKey: 'alpha', year: 2026, weightPct: 100 }],
        }),
      ),
    ).toThrow(/Run is the only lane budgeted in hours per week/);
  });

  it('refuses a weight for an area the file does not list', () => {
    expect(() =>
      parse(fileWith({ areaWeights: [{ areaKey: 'gamma', year: 2026, weightPct: 100 }] })),
    ).toThrow(/does not list that area/);
  });

  it('refuses a weight for a lane', () => {
    expect(() =>
      parse(
        fileWith({
          areaWeights: [
            { areaKey: 'alpha', year: 2026, weightPct: 60 },
            { areaKey: 'beta', year: 2026, weightPct: 40 },
            { areaKey: 'run', year: 2026, weightPct: 0 },
          ],
        }),
      ),
    ).toThrow(/Signals carries no share at all/);
  });

  it('refuses a year whose shares do not sum to 100', () => {
    expect(() =>
      parse(
        fileWith({
          areaWeights: [
            { areaKey: 'alpha', year: 2026, weightPct: 60 },
            { areaKey: 'beta', year: 2026, weightPct: 30 },
          ],
        }),
      ),
    ).toThrow(/sum to 90, not 100/);
  });

  it('refuses a year that names only some of the areas', () => {
    // The sum is 100 and the year is still not a decision: `beta` is absent
    // from the map rather than zero in it, so no sum check can see this and the
    // area would quietly carry no share at all.
    expect(() =>
      parse(fileWith({ areaWeights: [{ areaKey: 'alpha', year: 2026, weightPct: 100 }] })),
    ).toThrow(/sets 2026 weights but not for "beta"/);
  });

  it('refuses a file that is not a JSON object, and one that lists no areas', () => {
    expect(() => parse('not json')).toThrow(/is not valid JSON/);
    expect(() => parse('[]')).toThrow(/must be a JSON object/);
    expect(() => parse(JSON.stringify({ areas: [] }))).toThrow(/lists no areas/);
  });
});

describe('parseMappingList', () => {
  it('reads the array from the file it actually lives in', () => {
    const parsed = JSON.parse(readFileSync(FIXTURE_BINDINGS, 'utf8')) as { areaMappings: unknown };
    const mappings = parseMappingList(parsed.areaMappings, FIXTURE_BINDINGS);

    expect(mappings).toEqual([
      { areaKey: 'alpha', externalProjectId: 'binding-project-0001' },
      { areaKey: 'beta', externalProjectId: 'binding-project-0002' },
    ]);
  });

  it('is empty when the file does not carry the key', () => {
    expect(parseMappingList(undefined, 'seed/bindings.json')).toEqual([]);
  });

  it('refuses a placeholder that was never filled in', () => {
    expect(() =>
      parseMappingList(
        [{ areaKey: 'alpha', externalProjectId: 'REPLACE-ME' }],
        'seed/bindings.json',
      ),
    ).toThrow(/placeholder externalProjectId/);
  });

  it('refuses one location mapped to two areas', () => {
    // The database refuses this too, by a unique index. The refusal names both
    // lines, which is the difference between fixing a file and reading a
    // constraint violation from a table nobody has heard of.
    expect(() =>
      parseMappingList(
        [
          { areaKey: 'alpha', externalProjectId: 'p1', externalSectionId: 's1' },
          { areaKey: 'beta', externalProjectId: 'p1', externalSectionId: 's1' },
        ],
        'seed/bindings.json',
      ),
    ).toThrow(/areaMappings\[0\] and again at areaMappings\[1\]/);
  });

  it('allows one project to appear twice when the sections differ', () => {
    // A project and a section of it are different locations: the unique index
    // is over both columns, and a mapping without a section is a whole project.
    const mappings = parseMappingList(
      [
        { areaKey: 'alpha', externalProjectId: 'p1' },
        { areaKey: 'beta', externalProjectId: 'p1', externalSectionId: 's1' },
      ],
      'seed/bindings.json',
    );
    expect(mappings).toHaveLength(2);
  });

  it('refuses a shape it does not know', () => {
    // An unknown *key* is named, which is more use than a shape dump — and it
    // is the same rule the areas file follows.
    expect(() => parseMappingList([{ area: 'alpha' }], 'seed/bindings.json')).toThrow(
      /unrecognised key "area"/,
    );
    expect(() =>
      parseMappingList(
        [{ areaKey: 'alpha', externalProjectId: 'p1', areaMappings: [] }],
        'seed/bindings.json',
      ),
    ).toThrow(/unrecognised key "areaMappings"/);
    // A known key with the wrong type has no key to name, so the shape is what
    // the message states.
    expect(() =>
      parseMappingList([{ areaKey: 42, externalProjectId: 'p1' }], 'seed/bindings.json'),
    ).toThrow(/is not \{ areaKey, externalProjectId, externalSectionId\? \}/);
    expect(() => parseMappingList({}, 'seed/bindings.json')).toThrow(/is not an array/);
  });
});
