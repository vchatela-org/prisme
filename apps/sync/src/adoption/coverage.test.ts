import { describe, expect, it } from 'vitest';
import { coverage, type AuditableEntity } from './coverage.js';
import { formatAdoptionPlan } from './report.js';
import { scan, type ScanInput } from './queue.js';
import type { ExternalObject, MatchTarget } from './types.js';

/**
 * The verification tooling, and the report a human reads before step 8.
 *
 * The number that matters is **would create**. Everything else on the report is
 * context for it: coverage says how much of the world prisme knows about, the
 * manual remainder says how much work is left, and `wouldCreate` says whether
 * running `apply` today would damage anything.
 */

function objectOf(overrides: Partial<ExternalObject> = {}): ExternalObject {
  return {
    kind: 'task',
    externalId: 'x-1',
    title: 'Rebuild the garden shed',
    areaKey: 'home',
    areaLane: 'area',
    closed: false,
    childCount: 3,
    ...overrides,
  };
}

function entityOf(overrides: Partial<AuditableEntity> = {}): AuditableEntity {
  return {
    prismeId: 'i-1',
    kind: 'initiative',
    origin: 'adopted',
    bound: true,
    ...overrides,
  };
}

function scanOf(objects: readonly ExternalObject[], targets: readonly MatchTarget[] = []) {
  const input: ScanInput = { objects, targets, decided: { linked: new Set(), ignored: new Set() } };
  return scan(input);
}

describe('link coverage', () => {
  it('is the share of entities bound to something', () => {
    const report = coverage(
      [
        entityOf({ prismeId: 'a' }),
        entityOf({ prismeId: 'b' }),
        entityOf({ prismeId: 'c', bound: false }),
      ],
      scanOf([]),
    );
    expect(report.linkCoveragePct).toBe(66.7);
    expect(report.entities).toMatchObject({ total: 3, bound: 2, unbound: 1 });
  });

  it('is 100 for an empty model rather than a division by zero', () => {
    expect(coverage([], scanOf([])).linkCoveragePct).toBe(100);
  });
});

describe('what the audit surfaces', () => {
  it('reports an adopted entity that lost its subject', () => {
    const report = coverage([entityOf({ prismeId: 'i-orphan', bound: false })], scanOf([]));
    expect(report.adoptedWithoutRef).toEqual(['i-orphan']);
    // Not a create risk. It produces nothing at all, which is its own problem.
    expect(report.wouldCreate).toEqual([]);
  });

  it('reports exactly the entities that satisfy guard 2s predicate', () => {
    const report = coverage(
      [
        entityOf({ prismeId: 'adopted-bound' }),
        entityOf({ prismeId: 'adopted-unbound', bound: false }),
        entityOf({ prismeId: 'created-bound', origin: 'created_in_prisme' }),
        entityOf({ prismeId: 'created-unbound', origin: 'created_in_prisme', bound: false }),
      ],
      scanOf([]),
    );
    expect(report.wouldCreate.map((risk) => risk.prismeId)).toEqual(['created-unbound']);
  });

  it('counts the queue by kind and separates the manual remainder', () => {
    const report = coverage(
      [],
      scanOf(
        [
          objectOf({ externalId: 'a', title: 'Rebuild the garden shed' }),
          objectOf({ externalId: 'b', title: 'Nothing matches' }),
          objectOf({ externalId: 'c', childCount: 0 }),
        ],
        [
          {
            prismeId: 'i-1',
            kind: 'initiative',
            title: 'Rebuild the garden shed',
            areaKey: 'home',
            closed: false,
          },
        ],
      ),
    );
    expect(report.queue).toMatchObject({ total: 2, autoLinkable: 0, manualRemainder: 2 });
    expect(report.queue.byKind).toEqual({ initiative: 2 });
    expect(report.leftInPlace.task).toBe(1);
  });
});

describe('the rendered plan', () => {
  const objects = [
    objectOf({ externalId: 'mapped', title: 'Already known', mappedPrismeId: 'i-map' }),
    objectOf({ externalId: 'exact', title: 'Rebuild the garden shed' }),
    objectOf({ externalId: 'alone', title: 'Nothing matches this at all' }),
    objectOf({ externalId: 'loose', childCount: 0 }),
  ];
  const targets: MatchTarget[] = [
    {
      prismeId: 'i-map',
      kind: 'initiative',
      title: 'A different title entirely',
      areaKey: 'home',
      closed: false,
    },
    {
      prismeId: 'i-1',
      kind: 'initiative',
      title: 'Rebuild the garden shed',
      areaKey: 'home',
      closed: false,
    },
  ];

  it('separates certain, proposed and manual, and says the create count out loud', () => {
    const result = scanOf(objects, targets);
    const report = coverage([entityOf()], result);
    const text = formatAdoptionPlan(result, report, { mode: 'plan' });

    expect(text).toContain('Certain');
    expect(text).toContain('Proposals');
    expect(text).toContain('Manual');
    expect(text).toContain('Would create: 0');
    expect(text).toContain('Link coverage: 100.0%');
    // The invitation is absent: this command cannot apply anything.
    expect(text).not.toContain('apply');
  });

  it('spells out what a non-zero create count means, rather than printing a number', () => {
    const result = scanOf(objects, targets);
    const report = coverage([entityOf({ origin: 'created_in_prisme', bound: false })], result);
    const text = formatAdoptionPlan(result, report, { mode: 'plan' });
    expect(text).toContain('Would create: 1');
    expect(text).toContain('threshold is 0');
  });

  it('is stable — the same scan renders identically twice', () => {
    const result = scanOf(objects, targets);
    const report = coverage([entityOf()], result);
    expect(formatAdoptionPlan(result, report, { mode: 'plan' })).toBe(
      formatAdoptionPlan(result, report, { mode: 'plan' }),
    );
  });

  it('says something useful when there is nothing to do', () => {
    const result = scanOf([]);
    const text = formatAdoptionPlan(result, coverage([], result), { mode: 'plan' });
    expect(text).toContain('none');
    expect(text).toContain('Would create: 0');
  });

  it('keeps its columns aligned so a long queue stays readable', () => {
    const result = scanOf([
      objectOf({ externalId: 'a', title: 'A short one' }),
      objectOf({
        externalId: 'b',
        title:
          'A very much longer title than anyone would reasonably write in a task tool, going on and on',
      }),
    ]);
    const text = formatAdoptionPlan(result, coverage([], result), { mode: 'plan' });
    const rows = text.split('\n').filter((row) => row.startsWith('  manual '));
    expect(rows).toHaveLength(2);

    // The detail column begins at the same offset on both rows: the long title
    // is clipped rather than allowed to push the column along. Found by reading
    // real output, which is the only way a formatting bug is ever found.
    const reasonStarts = rows.map((row) => row.indexOf('a parent task with subtasks'));
    expect(reasonStarts[0]).toBeGreaterThan(0);
    expect(reasonStarts[0]).toBe(reasonStarts[1]);
  });
});
