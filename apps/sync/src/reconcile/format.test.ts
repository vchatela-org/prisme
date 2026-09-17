import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  desiredOf,
  observedOf,
  taskOf,
} from '../test-support/builders.js';
import { formatPlan } from './format.js';
import { plan } from './plan.js';

/**
 * The plan is read by a human before the first `apply`. These tests are about
 * whether it can be — alignment, grouping, and the one number a reader is
 * looking for.
 *
 * Every title in here is invented (docs/17-privacy.md).
 */

const REPORT = { writeEnabled: true, createThreshold: 0, mode: 'plan' as const };

function planWith(overrides = {}) {
  return plan(
    desiredOf([anchorOf({ externalAnchorId: 'task-0001', ...overrides })]),
    observedOf([taskOf({ content: 'Renamed by hand' })]),
    convergedAnchorState(),
    CONFIG,
  );
}

describe('the rendered plan', () => {
  it('puts what needs deciding above what will simply change', () => {
    const mixed = plan(
      desiredOf([
        anchorOf({ initiativeId: 'init-001', externalAnchorId: 'task-0001' }),
        anchorOf({ initiativeId: 'init-002', status: 'next', priority: 'medium' }),
      ]),
      observedOf([taskOf({ content: 'Renamed by hand' })]),
      convergedAnchorState(),
      CONFIG,
    );

    const lines = formatPlan(mixed, { ...REPORT, createThreshold: 5 }).split('\n');

    expect(lines[0]).toMatch(/^ {2}conflict/);
    expect(lines[1]).toMatch(/^ {2}create/);
  });

  it('keeps a gap after the longest tag, so two columns never run together', () => {
    const creating = plan(
      desiredOf([anchorOf({ status: 'next', priority: 'medium' })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );

    for (const line of formatPlan(planWith(), REPORT).split('\n')) {
      if (line.startsWith('  ')) expect(line).toMatch(/^ {2}[a-z]+ {1,}[a-z]/);
    }
    expect(formatPlan(creating, { ...REPORT, createThreshold: 1 })).toContain('create   anchor');
  });

  it('lines the columns up so a long plan can be scanned', () => {
    const lines = formatPlan(planWith(), REPORT).split('\n');
    const detailColumn = lines
      .filter((line) => line.startsWith('  '))
      .map((line) => line.indexOf('title edited'));

    expect(new Set(detailColumn.filter((index) => index > 0)).size).toBeLessThanOrEqual(1);
  });

  it('summarises every tag, including what it left alone', () => {
    const converged = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    const output = formatPlan(converged, REPORT);

    expect(output).toContain('nothing to do');
    expect(output).toContain(
      'Plan: 0 to create, 0 to adopt, 0 to update, 0 to review, 0 conflicts, 1 unchanged.',
    );
  });

  it('says why nothing will happen when the creates exceed the threshold', () => {
    const creating = plan(
      desiredOf([anchorOf({ status: 'next', priority: 'medium' })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );

    const output = formatPlan(creating, REPORT);

    expect(output).toContain('Refused: 1 creates exceeds SYNC_CREATE_THRESHOLD=0');
    expect(output).not.toContain('Run `prisme-sync apply`');
  });

  it('says the write freeze is on rather than inviting an apply that would do nothing', () => {
    const output = formatPlan(planWith(), { ...REPORT, writeEnabled: false });

    expect(output).toContain('Write freeze is on');
    expect(output).not.toContain('Run `prisme-sync apply`');
  });

  it('prints where the state came from, when the caller knows', () => {
    const output = formatPlan(planWith(), {
      ...REPORT,
      source: ['task tool       token …a91f   changed=3'],
    });

    expect(output.split('\n')[0]).toContain('token …a91f');
  });
});
