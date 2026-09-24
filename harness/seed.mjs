/**
 * Put the synthetic fixture set into the local database.
 *
 *   node harness/seed.mjs        # run by up.sh; safe to run twice
 *
 * ## Fixture data only
 *
 * Everything this loads comes from [`fixtures/`](../fixtures/) — invented areas,
 * invented titles, invented identifiers. Nothing is read from a real instance
 * and nothing real may be added here: this file is committed, and the repository
 * is public ([`17-privacy.md`](../docs/17-privacy.md)).
 *
 * ## Why it truncates first
 *
 * `seedFixtures` **inserts** — it is written for an integration suite that has
 * just emptied the database, and it does not carry conflict handling for every
 * table. So seeding into a populated database fails part-way with a unique-key
 * violation, and the harness's second run reports a failure that has nothing to
 * do with what changed. The first version of this harness did exactly that, and
 * it is why this step is a truncate *and* a seed rather than a seed.
 *
 * **Every table is truncated rather than a listed set**, with the migration
 * ledger excluded — the one table that must survive, because it is what says the
 * schema is current. A hand-written list is what goes stale as migrations add
 * tables, and its failure mode is the worst one here: a table nobody listed
 * keeps rows from the previous run, and the screens then show a mixture of two
 * seeds that looks like a bug in the application.
 *
 * **The ledger's name is `prisme_migration`, and getting it wrong is silent.**
 * The first version of this file inherited an exclusion for a table called
 * `migration`, which has never existed — so every table *was* truncated,
 * including the ledger, and the API it started reported `schemaVersion: null`
 * and answered **503 on `/readyz` for ever**, with `database: reachable` beside
 * it. Nothing else fails: the schema objects are all still there and every query
 * works. It was found by starting the stack and reading `/readyz` rather than by
 * trusting that it started.
 *
 * The ledger is also why this script needs no migration step of its own: it runs
 * against whatever schema is already there. If it is out of date, `pnpm db:migrate`
 * is the thing to run, and it will say so.
 */
import postgres from 'postgres';
import { seedFixtures } from '../apps/api/dist/test-support/seed.js';

/** Never truncated: it is what tells the application the schema is current. */
const LEDGER = 'prisme_migration';

const url = process.env['DATABASE_URL'];
if (url === undefined || url.trim() === '') {
  console.error('DATABASE_URL is not set. Source harness/env.sh first, or run up.sh.');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });

const tables = await sql`
  select tablename from pg_tables
  where schemaname = 'public' and tablename <> ${LEDGER}
`;

if (tables.length === 0) {
  console.error(
    'No tables found. Run `pnpm db:migrate` first — this seeds a schema, it does not make one.',
  );
  await sql.end();
  process.exit(1);
}

// One statement, so the wipe cannot half-happen: `cascade` covers the foreign
// keys the order of a truncate list would otherwise have to respect.
await sql.unsafe(
  `truncate table ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} restart identity cascade`,
);

const seeded = await seedFixtures(sql);

console.log(
  `seeded ${String(seeded.areaKeys.length)} areas, ${String(seeded.initiativeIds.size)} initiatives, ` +
    `${String(seeded.objectiveIds.size)} objectives across ${String(tables.length)} tables`,
);

await sql.end();
