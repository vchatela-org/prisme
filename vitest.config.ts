import { defineConfig } from 'vitest/config';

/**
 * One run for the whole monorepo, in two projects.
 *
 * The split is not about speed, it is about correctness. Vitest runs test
 * **files** in parallel, and the database-backed suites share one PostgreSQL
 * instance and truncate it between tests — so two of them running at once
 * means one suite empties the other's tables mid-test. That stayed invisible
 * while exactly one suite touched the database (W05's); the second one (W14's)
 * made it appear immediately, as a dozen unrelated-looking failures in a suite
 * nobody had changed, and as a `truncate` erroring in the shared helper.
 *
 * `integration` therefore runs its files one at a time. Everything else keeps
 * the full parallelism, which is where the run time actually is.
 *
 * The alternative — a database per suite — would be more parallel and slower
 * overall: each one would have to migrate from scratch. Worth revisiting if the
 * integration suites ever dominate the run.
 */

const INCLUDE = ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'];
const INTEGRATION = [
  'packages/*/src/**/*integration.test.ts',
  'apps/*/src/**/*integration.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: INCLUDE,
          exclude: INTEGRATION,
          environment: 'node',
          // A package with no tests yet is a slot waiting for its workstream,
          // not a failure. Every package that has tests still runs them.
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: INTEGRATION,
          environment: 'node',
          passWithNoTests: true,
          // The whole reason this project exists.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/bin/**', '**/test-support/**'],
    },
  },
});
