// Imported rather than read off the global, for the same reason the sibling
// suites do it: the repository restricts the *global* `process` so that
// configuration goes through `@prisme/config`, and a test harness choosing its
// own database is not application configuration.
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAreasFromFile, saveAreas, saveMappings, type MappingSeed } from './areas.js';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from './test-support/database.js';

/**
 * Areas, weights and mappings, against a real PostgreSQL.
 *
 * The unit tests cover parsing a file. What they cannot cover is the three
 * properties the loader's *writing* half is built on, and each of them is a
 * thing that would be discovered on a live instance otherwise:
 *
 * 1. **Absence is not a value.** An area archived in the application stays
 *    archived when the file — which does not carry `active` — is re-run.
 * 2. **A year the file agrees with is left alone, and a year it disagrees with
 *    is refused** without `--force`. That pair is what makes the loader safe to
 *    re-run *and* unable to overwrite a review decision silently.
 * 3. **One external location belongs to exactly one area**, enforced by a unique
 *    index the loader refuses before reaching.
 *
 * Fixture data only: `seed.example/areas.json` is invented, and the external
 * identifiers the mapping cases use are written here.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

const TABLES = [
  'confirmation_token',
  'creation_intent',
  'capture',
  'capacity_week',
  'completion_history',
  'backfill_cursor',
  'adoption_candidate',
  'adoption_ignore',
  'api_token',
  'sync_conflict',
  'last_applied',
  'entity_link',
  'entity_external_ref',
  'event_log',
  'review_session',
  'ritual_adherence',
  'ritual',
  'takeaway',
  'key_result_measurement',
  'key_result_served_by',
  'key_result',
  'objective',
  'task_mirror',
  'initiative_score',
  'initiative_dependency',
  'initiative',
  'project',
  'area_mapping',
  'area_weight',
  'area',
  'role_binding',
  'sync_cursor',
] as const;

const EXAMPLE_AREAS = new URL('../../../seed.example/areas.json', import.meta.url).pathname;

const MAPPINGS: readonly MappingSeed[] = [
  { areaKey: 'alpha', externalProjectId: 'ext-project-0001' },
  { areaKey: 'alpha', externalProjectId: 'ext-project-0001', externalSectionId: 'ext-section-a' },
  { areaKey: 'beta', externalProjectId: 'ext-project-0002' },
];

describeOrSkip('areas, weights and mappings against PostgreSQL', () => {
  let database: SyncTestDatabase;
  let client: postgres.Sql;

  beforeAll(async () => {
    database = await openTestDatabase();
    client = database.client;
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate(TABLES);
  });

  /** The format example, loaded and parsed — the state most cases start from. */
  async function loadExample(): Promise<Awaited<ReturnType<typeof loadAreasFromFile>>> {
    return loadAreasFromFile(EXAMPLE_AREAS);
  }

  it('loads the areas and their weights into an empty instance', async () => {
    const saved = await saveAreas(client, await loadExample(), { force: false });

    expect(saved.created).toEqual(['alpha', 'beta', 'gamma', 'run', 'signals']);
    expect(saved.existing).toEqual([]);
    expect(saved.years).toEqual([2026]);
    expect(saved.yearsAgreed).toEqual([]);

    const weights = await client<{ area_key: string; weight_pct: string }[]>`
      select area_key, weight_pct from area_weight order by area_key`;
    expect(weights.map((row) => [row.area_key, Number(row.weight_pct)])).toEqual([
      ['alpha', 50],
      ['beta', 30],
      ['gamma', 20],
    ]);

    // The lane's budget, which is what makes Run capacity rather than a share.
    const run = await client<{ run_budget_hours_per_week: string }[]>`
      select run_budget_hours_per_week from area where key = 'run'`;
    expect(Number(run[0]?.run_budget_hours_per_week)).toBe(3);
  });

  it('is a no-op the second time, and says so', async () => {
    const loaded = await loadExample();
    await saveAreas(client, loaded, { force: false });

    // Without this the loader would either refuse every re-run or rewrite the
    // year — and the first makes `pnpm seed:load` useless, the second makes it
    // able to overwrite a decision without saying so.
    const again = await saveAreas(client, loaded, { force: false });

    expect(again.created).toEqual([]);
    expect(again.existing).toEqual(['alpha', 'beta', 'gamma', 'run', 'signals']);
    expect(again.weightsWritten).toBe(0);
    expect(again.yearsAgreed).toEqual([2026]);
  });

  it('leaves an area archived in the application archived, and reactivates one the file says to', async () => {
    await saveAreas(client, await loadExample(), { force: false });
    await client`update area set active = false where key = 'beta'`;

    // The file does not carry `active` for these areas, and **absent is not
    // `true`**: a loader that defaulted it would reactivate this on every run.
    await saveAreas(client, await loadExample(), { force: false });
    const archived = await client<{ active: boolean }[]>`
      select active from area where key = 'beta'`;
    expect(archived[0]?.active).toBe(false);

    // Stated, it is honoured — which is what makes the omission a choice
    // rather than a limitation.
    const stated = await loadExample();
    await saveAreas(
      client,
      { ...stated, areas: stated.areas.map((area) => ({ ...area, active: true })) },
      { force: false },
    );
    const revived = await client<{ active: boolean }[]>`
      select active from area where key = 'beta'`;
    expect(revived[0]?.active).toBe(true);
  });

  it('leaves an area the file does not mention exactly as it was', async () => {
    await saveAreas(client, await loadExample(), { force: false });
    await client`insert into area (key, name, kind) values ('delta', 'Delta', 'area')`;

    await saveAreas(client, await loadExample(), { force: false });

    // An area is not a role binding: work hangs from it, so a file that omits
    // one is a file that has not been updated, not a decision to drop it.
    const rows = await client<{ key: string }[]>`select key from area where key = 'delta'`;
    expect(rows).toHaveLength(1);
  });

  it('refuses to replace a year whose stored weights differ, and replaces it with --force', async () => {
    const loaded = await loadExample();
    await saveAreas(client, loaded, { force: false });
    // A year reviewed in the application: the decision moved away from the file.
    await client`update area_weight set weight_pct = 70 where area_key = 'alpha' and year = 2026`;

    await expect(saveAreas(client, loaded, { force: false })).rejects.toThrow(
      /already has weights that differ from the file/,
    );
    // Refused, and nothing written: the transaction is the unit.
    const untouched = await client<{ weight_pct: string }[]>`
      select weight_pct from area_weight where area_key = 'beta' and year = 2026`;
    expect(Number(untouched[0]?.weight_pct)).toBe(30);

    const forced = await saveAreas(client, loaded, { force: true });
    expect(forced.weightsWritten).toBe(3);
    expect(forced.yearsAgreed).toEqual([]);
    const restored = await client<{ weight_pct: string }[]>`
      select weight_pct from area_weight where area_key = 'alpha' and year = 2026`;
    expect(Number(restored[0]?.weight_pct)).toBe(50);
  });

  it('maps external locations onto the areas, replacing an area’s set whole', async () => {
    await saveAreas(client, await loadExample(), { force: false });

    const first = await saveMappings(client, MAPPINGS);
    expect(first.areas).toEqual(['alpha', 'beta']);
    expect(first.count).toBe(3);

    // Removing one from the file removes it here: an area's locations come from
    // the file entire, which is the rule `replaceMappings` states.
    const second = await saveMappings(client, [MAPPINGS[0] as MappingSeed]);
    expect(second.count).toBe(1);
    const held = await client<{ external_project_id: string }[]>`
      select external_project_id from area_mapping order by external_project_id`;
    // `beta`'s mapping is left alone — the file does not mention `beta` — and
    // `alpha`'s section mapping is gone.
    expect(held.map((row) => row.external_project_id)).toEqual([
      'ext-project-0001',
      'ext-project-0002',
    ]);
  });

  it('refuses a location another area already holds', async () => {
    await saveAreas(client, await loadExample(), { force: false });
    await saveMappings(client, [{ areaKey: 'beta', externalProjectId: 'ext-project-0007' }]);

    // The file now claims for `alpha` a location `beta` holds and the file does
    // not mention `beta`. The unique index would refuse this too, with a
    // constraint violation naming a table the operator has never heard of.
    await expect(
      saveMappings(client, [{ areaKey: 'alpha', externalProjectId: 'ext-project-0007' }]),
    ).rejects.toThrow(/is mapped to "beta" already/);

    const rows = await client<{ area_key: string }[]>`
      select area_key from area_mapping where external_project_id = 'ext-project-0007'`;
    expect(rows.map((row) => row.area_key)).toEqual(['beta']);
  });

  it('refuses a mapping to an area this instance does not have', async () => {
    await saveAreas(client, await loadExample(), { force: false });

    await expect(
      saveMappings(client, [{ areaKey: 'not-an-area', externalProjectId: 'ext-project-0008' }]),
    ).rejects.toThrow(/which is not an area in this instance/);

    const rows = await client<{ count: string }[]>`select count(*) from area_mapping`;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
