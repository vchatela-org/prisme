import { defineConfig } from 'vitest/config';

/**
 * One run for the whole monorepo. Packages may add their own configuration
 * later; until then a single root run is the thing CI executes and the thing a
 * developer executes, which is the point.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    // A package with no tests yet is a slot waiting for its workstream, not a
    // failure. Every package that has tests still runs them.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/bin/**', '**/test-support/**'],
    },
  },
});
