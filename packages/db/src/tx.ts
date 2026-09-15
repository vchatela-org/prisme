import type { Database } from './client.js';

/**
 * The transaction helper everything else uses.
 *
 * It exists so that the reconciler's hardest invariant is cheap to honour: the
 * sync token advancing and the changes it represents must commit together
 * (ADR-0018). Two separate statements cannot give that; one transaction can.
 */

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TransactionOptions {
  /**
   * `serializable` for anything that reads then decides — the reconciler's
   * plan/apply pair is exactly that shape. Defaults to PostgreSQL's
   * `read committed`.
   */
  readonly isolation?: 'read committed' | 'repeatable read' | 'serializable';
  readonly readOnly?: boolean;
}

export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => fn(tx), {
    ...(options.isolation === undefined ? {} : { isolationLevel: options.isolation }),
    ...(options.readOnly === undefined
      ? {}
      : { accessMode: options.readOnly ? 'read only' : 'read write' }),
  });
}
