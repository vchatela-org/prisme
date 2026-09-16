import type { Area } from '../entities/area.js';
import { parseCalendarDate, parseYear, type Year } from '../entities/calendar.js';
import type { Initiative } from '../entities/initiative.js';
import type { AreaScoringContext } from '../scoring/types.js';

/**
 * Builders for tests. **Synthetic throughout** — every key, title and number
 * here is invented, and none of it resembles any real configuration
 * (docs/17-privacy.md, fixtures/README.md).
 *
 * Excluded from the build in `tsconfig.build.json`: this is scaffolding, not
 * part of the package's surface.
 */

export const TEST_NOW = new Date('2026-09-15T00:00:00Z');
export const TEST_YEAR: Year = parseYear(2026);

export function anInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: 'test-001',
    title: 'Something finished',
    areaKey: 'alpha',
    status: 'next',
    value: 5,
    timeCriticality: 3,
    risk: 3,
    size: 5,
    dependsOn: [],
    origin: 'created_in_prisme',
    ...overrides,
  };
}

export function anArea(overrides: Partial<Area> = {}): Area {
  return { key: 'alpha', name: 'Alpha', kind: 'area', active: true, ...overrides };
}

export function anAreaContext(overrides: Partial<AreaScoringContext> = {}): AreaScoringContext {
  return {
    key: 'alpha',
    targetShare: 25,
    actualShare: 25,
    balanceFactor: 1,
    stale: false,
    ...overrides,
  };
}

export const date = parseCalendarDate;
