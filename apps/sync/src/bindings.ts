import { readFile } from 'node:fs/promises';
import type postgres from 'postgres';
import {
  createRoleBindings,
  ROLE_KEYS,
  roleBindingsSchema,
  type RoleBinding,
  type RoleBindings,
  type RoleKey,
} from '@prisme/connectors';

/**
 * Loading, storing and reading the **role bindings**.
 *
 * The gap W12 and W13 both recorded. `packages/connectors/src/role-key.ts`
 * binds a role key to an external identifier and refuses to guess; the client
 * that consumes it has existed since W03; and **nothing loaded one**, so
 * `createDocToolClient` had no caller outside test code and the document tool
 * was never read. Three things were waiting on it: W12's document-tool
 * classifier, W13's declared-duration tier, and W15's *Create page*.
 *
 * docs/15-runtime.md §2 says where they come from: "They load from the seed
 * path into the database, keyed by role." That is this module, and the three
 * functions it exports are the three things that means — parse a seed file,
 * write it, read it back as something a connector can address stores through.
 *
 * ## Why the file, and not the environment
 *
 * An identifier in the environment is an identifier in a deployment manifest,
 * and a manifest is a thing people paste into a bug report. The seed path is
 * gitignored (`docs/17-privacy.md` §1) and the identifier is never logged,
 * never put in an error message, and never returned from this module in a
 * form anything but a connector sees.
 */

export interface BindingsLoadResult {
  readonly bindings: readonly RoleBinding[];
  /** The roles that were bound, **by key only** — never the identifiers. */
  readonly roles: readonly RoleKey[];
}

/**
 * The seed file's shape, from `seed.example/bindings.json`.
 *
 * Deliberately loose: the file is hand-written by an instance's owner, it
 * carries prose keys (`_comment`, `_rules`) beside the data, and it will grow
 * (ADR-0025 adds four roles and two templates). What is *strict* is the part
 * that matters — every entry under `documentTool` whose value carries an `id`
 * must name a role prisme knows, and the identifiers are parsed through
 * `roleBindingsSchema`.
 */
interface SeedFile {
  readonly documentTool?: Readonly<Record<string, unknown>>;
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(ROLE_KEYS);

/** Keys under `documentTool` that are prose or a non-store binding. */
const NOT_A_STORE = new Set([
  '_comment',
  'projectTemplateId',
  'durationProperty',
  // ADR-0025's template bindings are page identifiers, not store identifiers.
  'initiative_page_template',
  'project_page_template',
]);

/**
 * Parse a seed file into bindings, refusing anything prisme cannot address.
 *
 * A role prisme does not know is an error rather than a skipped line: the file
 * is the one place an instance says which store is which, and a typo there
 * would otherwise surface as "the document tool was not read" — a run that
 * looks healthy and quietly classifies nothing
 * (`packages/connectors/CLAUDE.md` §3, "never guess a mapping").
 */
export function parseBindingsFile(text: string, path: string): BindingsLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object`);
  }

  const documentTool = (parsed as SeedFile).documentTool ?? {};
  const entries: RoleBinding[] = [];

  for (const [role, value] of Object.entries(documentTool)) {
    if (NOT_A_STORE.has(role)) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;

    const id = (value as { id?: unknown }).id;
    if (id === undefined || id === null) continue;

    /*
     * Named here rather than left to `roleBindingsSchema`, whose message can
     * only list the vocabulary it accepts — useful, but it does not say *which*
     * line is wrong, and this file is hand-edited. The schema still parses the
     * result below; this is so the operator is told the role and the file.
     */
    if (!KNOWN_ROLES.has(role)) {
      throw new Error(
        `${path} binds "${role}", which is not a role prisme knows. The roles are: ${ROLE_KEYS.join(', ')}`,
      );
    }

    const identifier = typeof id === 'string' ? id.trim() : '';
    if (identifier === '') {
      throw new Error(`${path} binds role ${role} to an empty identifier`);
    }

    // `seed.example/bindings.json` ships `REPLACE-ME` in every slot. An
    // instance that copies it and forgets to edit would otherwise bind six
    // stores to one nonsense identifier and fail at the first query — a 404
    // from the document tool, nowhere near the file that caused it. Refusing
    // here names the file and the role instead.
    if (identifier === 'REPLACE-ME') {
      throw new Error(
        `${path} still has the placeholder identifier for role ${role}; it was copied from seed.example and not filled in`,
      );
    }

    entries.push({ role: role as RoleKey, externalId: identifier });
  }

  if (entries.length === 0) {
    throw new Error(`${path} binds no stores under "documentTool"`);
  }

  // Parsed, so an unknown role, an empty identifier and a duplicate binding are
  // all refused here rather than at the first query. `createRoleBindings` is
  // then called for its duplicate check and its shape, and its result discarded:
  // the caller wants the *rows*, and only a run wants the resolver.
  const bindings = roleBindingsSchema.parse(entries);
  createRoleBindings(bindings);

  return { bindings, roles: bindings.map((binding) => binding.role).sort() };
}

/**
 * Write the bindings, replacing whatever was there.
 *
 * Replace rather than merge: the file is the whole truth about which store each
 * role names, and a merge would leave a role bound to a store the file no
 * longer mentions — the same reason a scan replaces its candidate mirror
 * wholesale rather than accumulating (ADR-0009).
 *
 * `on conflict do nothing` would be the opposite mistake in the other
 * direction, so this is a delete-then-insert inside one transaction: a file
 * that has *removed* a role must unbind it.
 */
export async function saveBindings(
  client: postgres.Sql,
  bindings: readonly RoleBinding[],
): Promise<void> {
  await client.begin(async (tx) => {
    await tx`delete from role_binding`;
    for (const binding of bindings) {
      await tx`
        insert into role_binding (role, external_id, tool)
        values (${binding.role}, ${binding.externalId}, 'doc')`;
    }
  });
}

/**
 * The bindings as a connector addresses stores through them.
 *
 * Empty when nothing is bound, which is the state of every instance that has
 * not run the loader — and the state the connectors already handle: `resolve`
 * throws `unbound_role`, and both callers (`adoption/run.ts`, `backfill/processes.ts`)
 * catch it and report **"not read"** rather than failing the pass. That is why
 * this returns an empty binding set rather than throwing.
 */
export async function readBindings(client: postgres.Sql): Promise<RoleBindings> {
  const rows = await client<{ role: string; external_id: string }[]>`
    select role, external_id from role_binding order by role`;

  const known = new Set<string>(ROLE_KEYS);
  return createRoleBindings(
    rows
      .filter((row) => known.has(row.role))
      .map((row) => ({ role: row.role as RoleKey, externalId: row.external_id })),
  );
}

/** Read a seed file from disk and parse it. */
export async function loadBindingsFromFile(path: string): Promise<BindingsLoadResult> {
  return parseBindingsFile(await readFile(path, 'utf8'), path);
}
