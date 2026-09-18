import type {
  ApiTokenRecord,
  ApiTokenSecretRecord,
  AuthStore,
  ConfirmationRecord,
  CreateTokenInput,
  WriteSwitchRecord,
} from './store.js';
import { RELEASED } from './write-switch.js';

/**
 * An in-memory {@link AuthStore}, for the unit tests.
 *
 * It exists so that the rejection cases — a wrong secret, a revoked token, a
 * stale confirmation — are ordinary fast tests rather than tests that need a
 * database. The behaviour that is genuinely SQL's (the atomic consume, the
 * array round-trip, the `NOT NULL` on `expires_at`) is covered against a real
 * PostgreSQL in `auth.integration.test.ts` instead, because a fake cannot have
 * the failures that layer actually has.
 *
 * Kept deliberately faithful on the one semantic that is easy to get wrong:
 * {@link consumeConfirmation} returns the record **as it was before the call**.
 */
export function createMemoryAuthStore(): AuthStore & { readonly size: () => number } {
  const tokens = new Map<string, ApiTokenSecretRecord>();
  const confirmations = new Map<string, ConfirmationRecord>();
  let writeSwitch: WriteSwitchRecord = RELEASED;

  const strip = (record: ApiTokenSecretRecord): ApiTokenRecord => {
    const { hash: _hash, ...rest } = record;
    return rest;
  };

  return {
    size: () => tokens.size,

    createToken(input: CreateTokenInput): Promise<ApiTokenRecord> {
      const record: ApiTokenSecretRecord = { ...input, lastUsedAt: null, revokedAt: null };
      tokens.set(input.id, record);
      return Promise.resolve(strip(record));
    },

    findToken: (id) => Promise.resolve(tokens.get(id)),

    listTokens: () =>
      Promise.resolve(
        [...tokens.values()]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(strip),
      ),

    revokeToken(id, at) {
      const record = tokens.get(id);
      if (record === undefined || record.revokedAt !== null) return Promise.resolve(false);
      tokens.set(id, { ...record, revokedAt: at });
      return Promise.resolve(true);
    },

    revokeAllTokens(at) {
      let count = 0;
      for (const [id, record] of tokens) {
        if (record.revokedAt !== null) continue;
        tokens.set(id, { ...record, revokedAt: at });
        count += 1;
      }
      return Promise.resolve(count);
    },

    touchToken(id, at) {
      const record = tokens.get(id);
      if (record !== undefined) tokens.set(id, { ...record, lastUsedAt: at });
      return Promise.resolve();
    },

    createConfirmation(record) {
      confirmations.set(record.id, record);
      return Promise.resolve();
    },

    consumeConfirmation(id, at) {
      const record = confirmations.get(id);
      if (record === undefined) return Promise.resolve(undefined);
      confirmations.set(id, { ...record, consumedAt: record.consumedAt ?? at });
      return Promise.resolve(record);
    },

    deleteExpiredConfirmations(before) {
      let count = 0;
      for (const [id, record] of confirmations) {
        if (record.expiresAt.getTime() < before.getTime()) {
          confirmations.delete(id);
          count += 1;
        }
      }
      return Promise.resolve(count);
    },

    readWriteSwitch: () => Promise.resolve(writeSwitch),

    setWriteSwitch(record) {
      writeSwitch = record;
      return Promise.resolve(record);
    },
  };
}
