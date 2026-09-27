import type postgres from 'postgres';
import { createRoleBindings, ROLE_KEYS, type RoleBindings, type RoleKey } from '@prisme/connectors';

/**
 * Reading the **role bindings**: which external store each role key names.
 *
 * They are instance data, set on the **Settings → Notion** screen through the
 * API (`apps/api/src/routes/settings.ts`), which checks each store as it is
 * saved. The sync side only reads them, once at the start of a pass, so an
 * edit made mid-pass changes the *next* pass and not this one — the behaviour a
 * level-triggered design wants anyway.
 *
 * An identifier is never logged, never put in an error message, and never
 * returned from this module in a form anything but a connector sees
 * (`docs/17-privacy.md`).
 */

/**
 * The bindings as a connector addresses stores through them.
 *
 * Empty when nothing is bound, which is the state of every instance whose
 * Settings → Notion screen has not been filled in — and the state the
 * connectors already handle: `resolve` throws `unbound_role`, and both callers
 * (`adoption/run.ts`, `backfill/processes.ts`) catch it and report
 * **"not read"** rather than failing the pass. That is why this returns an
 * empty binding set rather than throwing.
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
