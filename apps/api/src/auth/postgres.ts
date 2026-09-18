import type postgres from 'postgres';
import type { Scope } from '../http/scopes.js';
import type {
  ApiTokenRecord,
  ApiTokenSecretRecord,
  AuthStore,
  ConfirmationRecord,
  CreateTokenInput,
  WriteSwitchRecord,
} from './store.js';

/**
 * The auth store, in SQL.
 *
 * Every statement is a tagged template, which postgres.js turns into a
 * parameterised query — no value is ever concatenated into SQL
 * (docs/14-threat-model.md §5). That rule is load-bearing everywhere in this
 * repository and doubly so here, where the parameters are credential material
 * supplied by whoever is trying to authenticate.
 *
 * Two conventions carried over from `store/postgres.ts`, both found by running
 * against a real PostgreSQL rather than by reading:
 *
 *   - **Timestamps are sent as ISO text.** `createDatabase` wraps the driver in
 *     Drizzle, which replaces the shared client's `timestamptz` serializer with
 *     the identity function; a tagged template on that same client then hands
 *     the driver a `Date` where it wants a string, and the error names neither
 *     the column nor the statement.
 *   - **Nothing here returns a row.** Every shape is named and explicit, so a
 *     column added later cannot arrive at a caller by accident.
 */

type Sql = postgres.Sql;

function stamp(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function instant(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  // A `timestamptz` arrives as a Date or as text depending on whether Drizzle
  // has replaced the shared client's parser (see the note above). Anything else
  // is a column that is not a timestamp, and inventing a date from its default
  // stringification would be worse than refusing.
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  throw new Error('a timestamp column came back as something other than a date or a string');
}

function required(value: unknown): Date {
  const parsed = instant(value);
  if (parsed === null) throw new Error('a NOT NULL timestamp came back null');
  return parsed;
}

interface TokenRow {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly hash: string;
  readonly created_at: unknown;
  readonly created_by: string;
  readonly expires_at: unknown;
  readonly last_used_at: unknown;
  readonly revoked_at: unknown;
}

function tokenOf(row: TokenRow): ApiTokenSecretRecord {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes as readonly Scope[],
    hash: row.hash,
    createdAt: required(row.created_at),
    createdBy: row.created_by,
    expiresAt: required(row.expires_at),
    lastUsedAt: instant(row.last_used_at),
    revokedAt: instant(row.revoked_at),
  };
}

/** The hash never leaves this module for anything but verification. */
function publicToken(record: ApiTokenSecretRecord): ApiTokenRecord {
  const { hash: _hash, ...rest } = record;
  return rest;
}

interface ConfirmationRow {
  readonly id: string;
  readonly fingerprint: string;
  readonly diff_hash: string;
  readonly operation: string;
  readonly subject: string;
  readonly issued_at: unknown;
  readonly expires_at: unknown;
  readonly consumed_at: unknown;
}

function confirmationOf(row: ConfirmationRow): ConfirmationRecord {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    diffHash: row.diff_hash,
    operation: row.operation,
    subject: row.subject,
    issuedAt: required(row.issued_at),
    expiresAt: required(row.expires_at),
    consumedAt: instant(row.consumed_at),
  };
}

export function createPostgresAuthStore(sql: Sql): AuthStore {
  return {
    async createToken(input: CreateTokenInput): Promise<ApiTokenRecord> {
      const rows = await sql<TokenRow[]>`
        INSERT INTO api_token (id, name, scopes, hash, created_at, created_by, expires_at)
        VALUES (
          ${input.id}, ${input.name}, ${sql.array([...input.scopes])}, ${input.hash},
          ${input.createdAt.toISOString()}, ${input.createdBy}, ${input.expiresAt.toISOString()}
        )
        RETURNING *`;
      return publicToken(tokenOf(rows[0] as TokenRow));
    },

    async findToken(id: string): Promise<ApiTokenSecretRecord | undefined> {
      const rows = await sql<TokenRow[]>`SELECT * FROM api_token WHERE id = ${id}`;
      const row = rows[0];
      return row === undefined ? undefined : tokenOf(row);
    },

    async listTokens(): Promise<readonly ApiTokenRecord[]> {
      const rows = await sql<TokenRow[]>`SELECT * FROM api_token ORDER BY created_at DESC`;
      return rows.map((row) => publicToken(tokenOf(row)));
    },

    async revokeToken(id: string, at: Date): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        UPDATE api_token SET revoked_at = ${at.toISOString()}
        WHERE id = ${id} AND revoked_at IS NULL
        RETURNING id`;
      return rows.length > 0;
    },

    async revokeAllTokens(at: Date): Promise<number> {
      const rows = await sql<{ id: string }[]>`
        UPDATE api_token SET revoked_at = ${at.toISOString()}
        WHERE revoked_at IS NULL
        RETURNING id`;
      return rows.length;
    },

    async touchToken(id: string, at: Date): Promise<void> {
      await sql`UPDATE api_token SET last_used_at = ${at.toISOString()} WHERE id = ${id}`;
    },

    async createConfirmation(record: ConfirmationRecord): Promise<void> {
      await sql`
        INSERT INTO confirmation_token
          (id, fingerprint, diff_hash, operation, subject, issued_at, expires_at, consumed_at)
        VALUES (
          ${record.id}, ${record.fingerprint}, ${record.diffHash}, ${record.operation},
          ${record.subject}, ${record.issuedAt.toISOString()}, ${record.expiresAt.toISOString()},
          ${stamp(record.consumedAt)}
        )`;
    },

    async consumeConfirmation(id: string, at: Date): Promise<ConfirmationRecord | undefined> {
      /*
       * **The `WHERE` clause is the mutual exclusion.** Exactly one transaction
       * can ever see `consumed_at IS NULL` and update the row, so exactly one
       * caller is told it won.
       *
       * The first version of this used a self-join to fetch the pre-update
       * image in a single statement, and a ten-way race against a real
       * PostgreSQL showed two winners. Under READ COMMITTED the second
       * transaction blocks on the row lock, then re-checks its `WHERE` and
       * proceeds — but the `FROM` side of the join is still reading the
       * *original* snapshot, so `prior.consumed_at` came back NULL for both.
       * It is the kind of bug a fake store cannot have, and reading the SQL did
       * not find it either.
       *
       * The second query runs only when nothing was updated, and it races with
       * nothing: `consumed_at` never returns to NULL, so "already consumed" and
       * "no such row" are both stable answers by the time it is asked.
       */
      const won = await sql<ConfirmationRow[]>`
        UPDATE confirmation_token
           SET consumed_at = ${at.toISOString()}
         WHERE id = ${id} AND consumed_at IS NULL
        RETURNING *`;

      const winner = won[0];
      // Returned as it was before this call — `consumedAt: null` is what tells
      // the caller it is the one that took it.
      if (winner !== undefined) return { ...confirmationOf(winner), consumedAt: null };

      const existing = await sql<ConfirmationRow[]>`
        SELECT * FROM confirmation_token WHERE id = ${id}`;
      const row = existing[0];
      return row === undefined ? undefined : confirmationOf(row);
    },

    async deleteExpiredConfirmations(before: Date): Promise<number> {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM confirmation_token WHERE expires_at < ${before.toISOString()} RETURNING id`;
      return rows.length;
    },

    async readWriteSwitch(): Promise<WriteSwitchRecord> {
      const rows = await sql<
        {
          engaged: boolean;
          mode: string;
          changed_at: unknown;
          changed_by: string | null;
          reason: string | null;
        }[]
      >`SELECT engaged, mode, changed_at, changed_by, reason FROM write_switch WHERE id = 'singleton'`;
      const row = rows[0];
      if (row === undefined) {
        // The migration inserts the row, so this is a database somebody has
        // edited. Refusing to invent a default is the safe reading: the caller
        // keeps its last known state rather than concluding "not engaged".
        throw new Error('write_switch has no singleton row');
      }
      return {
        engaged: row.engaged,
        mode: row.mode === 'all' ? 'all' : 'outward',
        changedAt: instant(row.changed_at),
        changedBy: row.changed_by,
        reason: row.reason,
      };
    },

    async setWriteSwitch(record: WriteSwitchRecord): Promise<WriteSwitchRecord> {
      await sql`
        UPDATE write_switch
           SET engaged = ${record.engaged}, mode = ${record.mode},
               changed_at = ${stamp(record.changedAt)}, changed_by = ${record.changedBy},
               reason = ${record.reason}
         WHERE id = 'singleton'`;
      return record;
    },
  };
}
