import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit only ever *generates* SQL here. It never applies it.
 *
 * Applying is `src/bin/migrate.ts`, a standalone entrypoint run as a Job before
 * rollout (docs/15-runtime.md §3). Keeping generation and application apart is
 * what stops a migration from being applied by a developer's laptop, or by an
 * application process at start-up.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  migrations: {
    prefix: 'index',
  },
});
