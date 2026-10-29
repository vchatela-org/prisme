import type postgres from 'postgres';
import type { LinkedObjective, ObjectiveSuccessStore, SuccessColumn } from './run.js';

type Sql = postgres.Sql;

/**
 * `role_binding` and `objective`, for the success read (ADR-0042).
 *
 * The figure is prisme's mirror of a document-tool value: rewritten whole each
 * pass, never a decision, so overwriting it loses nothing. Timestamps cross as
 * text, for the reason `state/postgres.ts` gives.
 */
export function createObjectiveSuccessStore(client: Sql): ObjectiveSuccessStore {
  return {
    async loadSuccessColumn(): Promise<SuccessColumn | undefined> {
      const rows = await client<
        { success_property: string | null; number_properties: string | null }[]
      >`
        select success_property, number_properties::text
        from role_binding where role = 'objectives_db'`;
      const row = rows[0];
      if (row === undefined || row.success_property === null) return undefined;
      const listed = parseNumberProperties(row.number_properties);
      const format =
        listed.find((property) => property.name === row.success_property)?.format ?? 'unknown';
      return { property: row.success_property, format };
    },

    async loadLinkedObjectives(): Promise<readonly LinkedObjective[]> {
      const rows = await client<{ id: string; external_page_id: string }[]>`
        select id::text, external_page_id
        from objective
        where external_page_id is not null and btrim(external_page_id) <> ''
        order by id`;
      return rows.map((row) => ({ id: row.id, pageId: row.external_page_id }));
    },

    async recordSuccess(byId: ReadonlyMap<string, number | null>, at: Date): Promise<number> {
      let written = 0;
      await client.begin(async (tx: postgres.TransactionSql) => {
        for (const [id, figure] of byId) {
          const rows = await tx`
            update objective set
              document_success = ${figure},
              document_success_read_at = ${figure === null ? null : at.toISOString()}::timestamptz
            where id = ${id}::uuid
            returning id`;
          written += rows.length;
        }
      });
      return written;
    },

    async clearSuccess(): Promise<number> {
      const rows = await client`
        update objective set document_success = null, document_success_read_at = null
        where document_success is not null or document_success_read_at is not null
        returning id`;
      return rows.length;
    },
  };
}

/** The stored list, or none: a malformed one is no list, never a guessed format. */
function parseNumberProperties(
  text: string | null,
): readonly { readonly name: string; readonly format: string }[] {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === 'string' &&
      typeof (entry as { format?: unknown }).format === 'string'
        ? [{ name: (entry as { name: string }).name, format: (entry as { format: string }).format }]
        : [],
    );
  } catch {
    return [];
  }
}
