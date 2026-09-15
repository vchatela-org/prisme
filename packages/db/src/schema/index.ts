/**
 * Drizzle table definitions.
 *
 * Deliberately empty. W00 owns the *tooling* — client, transactions, migration
 * runner — and the domain tables belong to
 * docs/40-workstreams/W01-domain-scoring.md. Adding a table here from W00 would
 * mean guessing at a model that P0 froze on purpose.
 *
 * Add tables as modules beside this file and re-export them here; the migration
 * they produce is generated with `pnpm db:generate` and applied only by the
 * pre-rollout Job.
 */

export {};
