import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads a recorded response from `fixtures/connectors/`.
 *
 * Read from disk rather than imported, so the contract tests run against the
 * same bytes a reviewer reads in the fixture file — an import would be resolved
 * and cached by the bundler, and a fixture that drifts from what is committed
 * is a contract test that proves nothing.
 */

const FIXTURE_ROOT = new URL('../../../../fixtures/connectors/', import.meta.url);

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_ROOT)), 'utf8')) as unknown;
}
