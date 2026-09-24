import { readFile } from 'node:fs/promises';
import type postgres from 'postgres';
import { z } from 'zod';
import {
  AREA_KINDS,
  areaSchema,
  areaWeightSchema,
  assertWeightsSumTo100,
  resolveWeights,
  type AreaKind,
  type AreaWeight,
} from '@prisme/domain';

/**
 * Loading the instance's **areas, their year weights, and their external
 * mappings** — the other half of the seed path.
 *
 * [`bindings.ts`](bindings.ts) loads the role bindings, which is what makes the
 * document and task tools addressable. This is what makes prisme's own model
 * addressable: which areas exist, what share of capacity each gets in a given
 * year, and which external projects and sections fold into each one.
 *
 * ## Why this module exists
 *
 * [`docs/17-privacy.md`](../../../docs/17-privacy.md) says areas, weights, tool
 * mappings and external IDs load from `seed/`, and
 * [`docs/13-migration.md`](../../../docs/13-migration.md) step 1 depends on it.
 * Neither was true. `parseBindingsFile` reads the `documentTool` key and nothing
 * else, so the `areaMappings` array sitting in the same file was parsed by
 * nobody; `seed/areas.json` had no loader at all; and `pnpm seed:load`, which
 * [`seed.example/README.md`](../../../seed.example/README.md) tells the reader to
 * run, existed in no `package.json` in the repository. `POST /areas` and
 * `PUT /areas/:key/mappings` have no UI caller and no CLI, so a live instance's
 * areas and mappings could only be set by hand-written calls.
 *
 * A documented command that does not exist is worse than an absent one: it looks
 * like the configuration step is handled.
 *
 * ## The three rules this file is built around
 *
 * 1. **Prose keys are ignored; data keys are strict.** Every seed file carries
 *    `_comment` and `_rules` beside its data, and a hand-written file grows
 *    them. So a key beginning with `_` is prose and is skipped — but any *other*
 *    unrecognised key is refused, naming it. A typo (`areaWeight` for
 *    `areaWeights`) would otherwise load nothing and report success, which is the
 *    failure this module was written to close.
 * 2. **Nothing is deleted, and absence is not a value.** A role binding is
 *    replace-wholesale — removing a role from the file must unbind it — but an
 *    **area is not**: work hangs from it, so an area the file omits is left
 *    exactly as it was. Inside an area, a field the file does not carry is left
 *    alone too: `"active"` absent is not `"active": true`, or re-running the
 *    loader would silently reactivate an area somebody archived in the
 *    application.
 * 3. **Refusing beats guessing** ([`apps/sync/CLAUDE.md`](../../CLAUDE.md) §5).
 *    Every ambiguity below is an error naming the line rather than a default
 *    applied quietly: a weight for a lane, a weight for an unlisted area, a year
 *    whose shares do not divide one person's capacity, a year covering only some
 *    of the file's areas, a location mapped to two areas.
 *
 * ## What is deliberately *not* written
 *
 * No event is appended. `PUT /areas/:key/weights/:year` records a
 * `weight_changed` event because that is a *decision made in the application*
 * and the year-review chart is drawn from the log; a seed load is the initial
 * configuration of an instance that has no history yet. The bindings loader
 * makes the same call and for the same reason.
 */

/** A data key, as opposed to the prose a hand-written seed file carries. */
const isProse = (key: string): boolean => key.startsWith('_');

/** The data keys of an object, with the prose dropped. */
function dataKeys(value: Record<string, unknown>): readonly string[] {
  return Object.keys(value).filter((key) => !isProse(key));
}

/**
 * A copy with every `_`-prefixed key removed, so a schema can be **strict**
 * about the keys that carry meaning without refusing the prose beside them.
 */
function withoutProse(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isProse(key)) out[key] = item;
  }
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/*
 * The file's own shapes, kept strict. `seed.example/areas.json` is the
 * documentation and this is the parser: they are two spellings of one format,
 * and the field names here are the ones that file uses.
 */
const rawAreaSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(AREA_KINDS),
    active: z.boolean().optional(),
    externalPageId: z.string().min(1).optional(),
    runBudgetHoursPerWeek: z.number().nonnegative().optional(),
  })
  .strict();

const rawMappingSchema = z
  .object({
    areaKey: z.string().min(1),
    externalProjectId: z.string().min(1),
    externalSectionId: z.string().min(1).optional(),
  })
  .strict();

/**
 * An area as the file states it.
 *
 * Distinct from the domain's `Area` in one way that matters: **an optional field
 * here means the file did not carry it**, which is not the same as carrying the
 * default. `Area` requires `active`, so it cannot express that, and collapsing
 * the two is how a loader reactivates an archived area.
 */
export interface AreaSeed {
  readonly key: string;
  readonly name: string;
  readonly kind: AreaKind;
  readonly active?: boolean | undefined;
  readonly externalPageId?: string | undefined;
  readonly runBudgetHoursPerWeek?: number | undefined;
}

/** A location in an external tool: the identity the one-area rule is about. */
export interface MappingSeed {
  readonly areaKey: string;
  readonly externalProjectId: string;
  readonly externalSectionId?: string | undefined;
}

export interface AreasLoadResult {
  readonly areas: readonly AreaSeed[];
  readonly weights: readonly AreaWeight[];
}

/** `(project, section)` with the section absent spelled the same way twice. */
const locationOf = (mapping: MappingSeed): string =>
  `${mapping.externalProjectId}\u0000${mapping.externalSectionId ?? ''}`;

const weightCell = (year: number, areaKey: string): string => `${String(year)}\u0000${areaKey}`;

/**
 * The `areaMappings` array, parsed on its own.
 *
 * Separate from {@link parseAreasFile} because the array lives in
 * `seed/bindings.json` and not in `seed/areas.json` — it is the external
 * locations of a workspace, which is what that file is about — while the areas
 * it refers to live in the other one. `bindings.ts` calls this, and the two
 * commands that load the two files say which is which in their usage.
 */
export function parseMappingList(value: unknown, path: string): readonly MappingSeed[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${path} has an "areaMappings" key that is not an array`);
  }

  const mappings: MappingSeed[] = [];
  const seen = new Map<string, number>();

  value.forEach((entry, index) => {
    const where = `${path} areaMappings[${String(index)}]`;
    if (!isRecord(entry)) throw new Error(`${where} is not an object`);

    const parsed = rawMappingSchema.safeParse(withoutProse(entry));
    if (!parsed.success) {
      const bad = dataKeys(entry).find((key) => !(key in rawMappingSchema.shape));
      throw new Error(
        bad === undefined
          ? `${where} is not { areaKey, externalProjectId, externalSectionId? }`
          : `${where} has an unrecognised key "${bad}"`,
      );
    }

    const mapping = parsed.data;
    for (const [field, identifier] of [
      ['externalProjectId', mapping.externalProjectId],
      ['externalSectionId', mapping.externalSectionId],
    ] as const) {
      if (identifier === 'REPLACE-ME') {
        throw new Error(
          `${where} still has the placeholder ${field}; it was copied from seed.example and not filled in`,
        );
      }
    }

    const location = locationOf(mapping);
    const first = seen.get(location);
    if (first !== undefined) {
      // The database refuses this too, by a unique index over the project and
      // the section. Naming both lines here is the difference between an
      // operator fixing their file and an operator reading a constraint
      // violation from a table they did not know existed.
      throw new Error(
        `${path} maps the same external location to "${mapping.areaKey}" at areaMappings[${String(first)}] and again at areaMappings[${String(index)}]: one location belongs to exactly one area`,
      );
    }
    seen.set(location, index);
    mappings.push(mapping);
  });

  return mappings;
}

/**
 * Parse a `seed/areas.json`.
 *
 * Refuses, by name: an unrecognised key, an area listed twice, a run budget on
 * something that is not the Run lane, a weight for an area the file does not
 * list, a weight for a lane, a year whose shares do not sum to 100, and a year
 * that covers only some of the file's areas — a partial year sums to 100 by
 * construction, so the sum check cannot see it, and the omitted area would
 * quietly carry a zero share on every chart.
 */
export function parseAreasFile(text: string, path: string): AreasLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }

  if (!isRecord(parsed)) throw new Error(`${path} must be a JSON object`);

  const known = new Set(['areas', 'areaWeights']);
  const unknownKey = dataKeys(parsed).find((key) => !known.has(key));
  if (unknownKey !== undefined) {
    throw new Error(
      `${path} has an unrecognised key "${unknownKey}"; the file carries "areas" and "areaWeights"`,
    );
  }

  const rawAreas = parsed['areas'];
  if (!Array.isArray(rawAreas) || rawAreas.length === 0) {
    throw new Error(`${path} lists no areas`);
  }

  const areas: AreaSeed[] = [];
  const kindByKey = new Map<string, AreaKind>();

  rawAreas.forEach((entry, index) => {
    const where = `${path} areas[${String(index)}]`;
    if (!isRecord(entry)) throw new Error(`${where} is not an object`);

    const result = rawAreaSchema.safeParse(withoutProse(entry));
    if (!result.success) {
      const bad = dataKeys(entry).find((key) => !(key in rawAreaSchema.shape));
      throw new Error(
        bad === undefined
          ? `${where} is not { key, name, kind, active?, externalPageId?, runBudgetHoursPerWeek? }`
          : `${where} has an unrecognised key "${bad}"`,
      );
    }

    const raw = result.data;
    if (kindByKey.has(raw.key)) {
      throw new Error(`${path} lists the area "${raw.key}" more than once`);
    }

    if (raw.runBudgetHoursPerWeek !== undefined && raw.kind !== 'run') {
      // The database refuses this as well (`run_budget_belongs_to_the_run_lane`).
      // A refusal that says which line is wrong is worth the duplication.
      throw new Error(
        `${where} gives "${raw.key}" a run budget, and its kind is "${raw.kind}": Run is the only lane budgeted in hours per week`,
      );
    }

    // Validated by the domain's own schema — for its invariants and its shape,
    // and the result discarded, the way `bindings.ts` discards
    // `createRoleBindings`' — while the seed keeps the fields the file actually
    // carried, because an update has to tell "absent" from "the default".
    areaSchema.parse({
      key: raw.key,
      name: raw.name,
      kind: raw.kind,
      active: raw.active ?? true,
      ...(raw.externalPageId === undefined ? {} : { externalPageId: raw.externalPageId }),
      ...(raw.runBudgetHoursPerWeek === undefined
        ? {}
        : { runBudgetHoursPerWeek: raw.runBudgetHoursPerWeek }),
    });

    kindByKey.set(raw.key, raw.kind);
    areas.push({
      key: raw.key,
      name: raw.name,
      kind: raw.kind,
      ...(raw.active === undefined ? {} : { active: raw.active }),
      ...(raw.externalPageId === undefined ? {} : { externalPageId: raw.externalPageId }),
      ...(raw.runBudgetHoursPerWeek === undefined
        ? {}
        : { runBudgetHoursPerWeek: raw.runBudgetHoursPerWeek }),
    });
  });

  const rawWeights = parsed['areaWeights'] ?? [];
  if (!Array.isArray(rawWeights)) {
    throw new Error(`${path} has an "areaWeights" key that is not an array`);
  }

  const weights: AreaWeight[] = [];
  rawWeights.forEach((entry, index) => {
    const where = `${path} areaWeights[${String(index)}]`;
    if (!isRecord(entry)) throw new Error(`${where} is not an object`);

    const result = areaWeightSchema.safeParse(withoutProse(entry));
    if (!result.success) throw new Error(`${where} is not { areaKey, year, weightPct }`);

    const weight = result.data;
    const kind = kindByKey.get(weight.areaKey);
    if (kind === undefined) {
      throw new Error(
        `${where} gives "${weight.areaKey}" a weight, and ${path} does not list that area`,
      );
    }
    if (kind !== 'area') {
      // `PUT /areas/:key/weights/:year` refuses this for the same reason: a lane
      // given a percentage share is a lane put back into the allocation it was
      // deliberately taken out of (ADR-0014).
      throw new Error(
        `${where} gives the "${weight.areaKey}" lane a weight: Run is budgeted in hours per week and Signals carries no share at all`,
      );
    }
    weights.push(weight);
  });

  const rankable = areas.filter((area) => area.kind === 'area').map((area) => area.key);
  const years = [...new Set(weights.map((weight) => weight.year))].sort((a, b) => a - b);

  for (const year of years) {
    const forYear = weights.filter((weight) => weight.year === year);
    const weighted = new Set(forYear.map((weight) => weight.areaKey));
    const missing = rankable.find((key) => !weighted.has(key));
    if (missing !== undefined) {
      throw new Error(
        `${path} sets ${String(year)} weights but not for "${missing}": a year divides capacity between every area or it is not a decision`,
      );
    }
    assertWeightsSumTo100(resolveWeights(forYear, year));
  }

  // Sorted so a run is reproducible and two runs write in one order.
  weights.sort((a, b) => a.year - b.year || a.areaKey.localeCompare(b.areaKey));

  return { areas, weights };
}

/** Read a seed file from disk and parse it. */
export async function loadAreasFromFile(path: string): Promise<AreasLoadResult> {
  return parseAreasFile(await readFile(path, 'utf8'), path);
}

export interface SaveAreasOptions {
  /** Replace a year whose stored weights differ from the file's. */
  readonly force: boolean;
}

export interface SaveAreasResult {
  readonly created: readonly string[];
  /**
   * The file's areas that already existed. Named for what is known rather than
   * "updated": the update is unconditional, so whether a value actually moved
   * is not something this loader can say without reading back what it wrote.
   */
  readonly existing: readonly string[];
  readonly weightsWritten: number;
  /** Every year the file covers. */
  readonly years: readonly number[];
  /** Years left exactly as they were, because the file already agreed with them. */
  readonly yearsAgreed: readonly number[];
}

type Tx = postgres.TransactionSql;

/**
 * Write the areas and their weights.
 *
 * **An area the file states is updated only in the fields the file carries** —
 * the `case when … is undefined` shape the API's own `update` uses, because
 * `coalesce` cannot tell "clear it" from "do not touch it".
 *
 * **A year whose stored weights differ from the file's is refused** unless
 * `--force`, which is the rule `seed.example/areas.json` states in its own
 * `_rules`. A year whose stored weights *agree* is neither refused nor rewritten:
 * that is what makes a second `pnpm seed:load` a quiet success rather than an
 * error, and idempotence is the property that makes a configuration loader safe
 * to re-run.
 *
 * One transaction, so a file that fails validation halfway through leaves the
 * instance exactly as it found it.
 */
export async function saveAreas(
  client: postgres.Sql,
  loaded: AreasLoadResult,
  options: SaveAreasOptions,
): Promise<SaveAreasResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const yearsAgreed: number[] = [];
  const years = [...new Set(loaded.weights.map((weight) => weight.year))].sort((a, b) => a - b);
  let weightsWritten = 0;

  await client.begin(async (tx: Tx) => {
    const storedAreas = await tx<{ key: string }[]>`select key from area`;
    const known = new Set(storedAreas.map((row) => row.key));

    for (const area of loaded.areas) {
      if (!known.has(area.key)) {
        await tx`
          insert into area (key, name, kind, active, external_page_id, run_budget_hours_per_week)
          values (${area.key}, ${area.name}, ${area.kind}, ${area.active ?? true},
                  ${area.externalPageId ?? null}, ${area.runBudgetHoursPerWeek ?? null})`;
        created.push(area.key);
        continue;
      }

      await tx`
        update area set
          name = ${area.name},
          kind = ${area.kind},
          active = case when ${area.active === undefined} then active else ${area.active ?? true} end,
          external_page_id = case when ${area.externalPageId === undefined}
                              then external_page_id else ${area.externalPageId ?? null} end,
          -- Kind is checked first, and that is not a shortcut: a weekly budget
          -- belongs to the Run lane and to nothing else (the check constraint
          -- run_budget_belongs_to_the_run_lane), so an area whose kind is no
          -- longer Run has no budget by definition. Leaving the stored value in
          -- place would have the constraint refuse an edit the file asked for,
          -- with an error naming a constraint rather than a line.
          run_budget_hours_per_week = case when ${area.kind !== 'run'}
                                       then null
                                       when ${area.runBudgetHoursPerWeek === undefined}
                                       then run_budget_hours_per_week
                                       else ${area.runBudgetHoursPerWeek ?? null} end
        where key = ${area.key}`;
      existing.push(area.key);
    }

    /*
     * Every stored weight, read whole rather than filtered by year: the table is
     * one row per area per year, so an `= any(...)` would save nothing and would
     * be this repository's only use of an array parameter.
     */
    const stored = await tx<{ area_key: string; year: number; weight_pct: string }[]>`
      select area_key, year, weight_pct from area_weight`;
    const storedBy = new Map(
      stored.map((row) => [weightCell(row.year, row.area_key), Number(row.weight_pct)]),
    );

    for (const year of years) {
      const forYear = loaded.weights.filter((weight) => weight.year === year);
      const decided = forYear.some((weight) => storedBy.has(weightCell(year, weight.areaKey)));
      const agrees =
        decided &&
        forYear.every(
          (weight) => storedBy.get(weightCell(year, weight.areaKey)) === weight.weightPct,
        );

      if (agrees) {
        yearsAgreed.push(year);
        continue;
      }

      if (decided && !options.force) {
        // ADR-0007: a weight is fixed for a whole calendar year. Replacing it is
        // a review decision, so it takes saying so.
        throw new Error(
          `${String(year)} already has weights that differ from the file, and a weight is fixed for a whole calendar year (ADR-0007). Re-run with --force to replace them.`,
        );
      }

      for (const weight of forYear) {
        await tx`
          insert into area_weight (area_key, year, weight_pct)
          values (${weight.areaKey}, ${weight.year}, ${weight.weightPct})
          on conflict (area_key, year) do update set weight_pct = excluded.weight_pct`;
        weightsWritten += 1;
      }
    }
  });

  return { created, existing, weightsWritten, years, yearsAgreed };
}

export interface SaveMappingsResult {
  /** The areas whose mappings were replaced, by key only. */
  readonly areas: readonly string[];
  readonly count: number;
}

/**
 * Write the area mappings — the external locations that fold into each area.
 *
 * **Whole-area replacement, and only for the areas the file mentions.** An
 * area's locations come from the file entire, so removing one removes it here
 * too — the rule `replaceMappings` states on the API side. An area the file does
 * not mention keeps its mappings, because a seed file is not a statement about
 * the areas it leaves out.
 *
 * **A location already mapped to an area the file does not mention is refused.**
 * One external location belongs to exactly one area —
 * `area_mapping_one_area_per_location`, and that table is what lets prisme work
 * against an existing structure instead of a tidied one. Replacing an area's
 * mappings could otherwise take a location out from under another area, and the
 * unique index would raise a constraint violation naming a table the operator
 * has never heard of.
 *
 * ## The identifier in the refusal, and why it is there
 *
 * `bindings.ts` prints keys and never identifiers, because a log is a thing
 * people paste into an issue. This refusal names the external project id,
 * deliberately: a message that says *a location conflicts* without saying
 * **which** cannot be acted on, and an unactionable refusal is not a refusal. It
 * goes to the operator's own terminal, about their own file; nothing in it is
 * written to a table, a metric or a journal.
 */
export async function saveMappings(
  client: postgres.Sql,
  mappings: readonly MappingSeed[],
): Promise<SaveMappingsResult> {
  if (mappings.length === 0) return { areas: [], count: 0 };

  const touched = [...new Set(mappings.map((mapping) => mapping.areaKey))].sort();

  await client.begin(async (tx: Tx) => {
    const areas = await tx<{ key: string }[]>`select key from area`;
    const knownKeys = new Set(areas.map((row) => row.key));
    const unknown = touched.find((key) => !knownKeys.has(key));
    if (unknown !== undefined) {
      throw new Error(
        `the file maps external locations to "${unknown}", which is not an area in this instance. Load the areas first: prisme-sync areas --from <path>`,
      );
    }

    const held = await tx<
      { area_key: string; external_project_id: string; external_section_id: string | null }[]
    >`select area_key, external_project_id, external_section_id from area_mapping`;
    const heldBy = new Map(
      held.map((row) => [
        `${row.external_project_id}\u0000${row.external_section_id ?? ''}`,
        row.area_key,
      ]),
    );

    for (const mapping of mappings) {
      const holder = heldBy.get(locationOf(mapping));
      if (holder !== undefined && !touched.includes(holder)) {
        throw new Error(
          `external location ${mapping.externalProjectId}${mapping.externalSectionId === undefined ? '' : ` / ${mapping.externalSectionId}`} is mapped to "${holder}" already, and the file does not mention that area. Move it in the file or in the application — one location belongs to exactly one area.`,
        );
      }
    }

    for (const key of touched) {
      await tx`delete from area_mapping where area_key = ${key}`;
    }
    for (const mapping of mappings) {
      await tx`
        insert into area_mapping (area_key, external_project_id, external_section_id)
        values (${mapping.areaKey}, ${mapping.externalProjectId}, ${mapping.externalSectionId ?? null})`;
    }
  });

  return { areas: touched, count: mappings.length };
}
