import { describe, expect, it } from 'vitest';

import { assertWeightsSumTo100, resolveWeights, weightFor, type AreaWeight } from './area.js';
import {
  daysUntil,
  isCalendarDate,
  parseCalendarDate,
  parseYear,
  yearOfInstant,
} from './calendar.js';
import { assertAcyclic, blockedBy, buildDependencyGraph, statusIndex } from './dependencies.js';
import { InvariantError, isInvariantError } from './errors.js';
import { FIBONACCI_SCALE, isFibonacci, parseFibonacci } from './fibonacci.js';
import { applyPatch, mayCreateExternally } from './provenance.js';
import { indexExternalRefs, mayAutoApply, mayOverwrite } from './sync.js';
import { anInitiative, date, TEST_NOW, TEST_YEAR } from '../test-support/builders.js';

/**
 * The adversarial invariant tests (W01 brief, *Definition of done*).
 *
 * Each of these is the executable form of a promise made in the specification.
 * They are written to attack the invariant rather than to demonstrate it: a
 * test that only shows the happy path fails silently the day someone removes
 * the check as "redundant".
 */

describe('the Fibonacci scale is closed', () => {
  it('accepts exactly the six legal values', () => {
    for (const value of FIBONACCI_SCALE) expect(isFibonacci(value)).toBe(true);
  });

  it.each([0, 4, 6, 7, 9, 12, 14, -1, 1.5, Number.NaN])('rejects %p', (value) => {
    expect(isFibonacci(value)).toBe(false);
    expect(() => parseFibonacci(value)).toThrow(InvariantError);
  });

  it('does not compile with an off-scale literal', () => {
    // @ts-expect-error — 4 is not on the scale, and the union says so.
    const initiative = anInitiative({ value: 4 });
    // The runtime value is still whatever was passed; the guarantee is the
    // compiler's, and the directive above is the assertion.
    expect(initiative.value).toBe(4);
  });
});

describe('calendar dates name real days', () => {
  it.each(['2026-09-15', '2028-02-29'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '15-09-2026', '2026-9-15', 'soon'])(
    'rejects %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
      expect(() => parseCalendarDate(value)).toThrow(InvariantError);
    },
  );

  it('counts whole days, and keeps counting once a deadline is behind us', () => {
    expect(daysUntil(date('2026-09-25'), TEST_NOW)).toBe(10);
    expect(daysUntil(date('2026-09-29'), TEST_NOW)).toBe(14);
    expect(daysUntil(date('2026-09-15'), TEST_NOW)).toBe(0);
    expect(daysUntil(date('2026-09-10'), TEST_NOW)).toBe(-5);
  });

  it('ignores the time of day, so a ranking does not change at 23:00', () => {
    const lateInTheDay = new Date('2026-09-15T23:59:59Z');
    expect(daysUntil(date('2026-09-25'), lateInTheDay)).toBe(10);
  });

  it('rejects a year outside the calendar', () => {
    expect(() => parseYear(2026.5)).toThrow(InvariantError);
    expect(() => parseYear(12_026)).toThrow(InvariantError);
  });
});

describe('a weight always requires a year (ADR-0007)', () => {
  const weights: readonly AreaWeight[] = [
    { areaKey: 'alpha', year: parseYear(2026), weightPct: 60 },
    { areaKey: 'beta', year: parseYear(2026), weightPct: 40 },
    { areaKey: 'alpha', year: parseYear(2027), weightPct: 30 },
    { areaKey: 'beta', year: parseYear(2027), weightPct: 70 },
  ];

  it('does not compile without one', () => {
    // @ts-expect-error — there is no current-weight accessor, by design.
    expect(() => weightFor(weights, 'alpha')).toBeTypeOf('function');
  });

  it('does not compile with a bare number in the year position', () => {
    // @ts-expect-error — `Year` is branded so an index or a count cannot drift in.
    weightFor(weights, 'alpha', 2026);
    expect(weightFor(weights, 'alpha', TEST_YEAR)).toBe(60);
  });

  it('keeps each year separate, so last year stays correct after this year lands', () => {
    expect(weightFor(weights, 'alpha', parseYear(2026))).toBe(60);
    expect(weightFor(weights, 'alpha', parseYear(2027))).toBe(30);
  });

  it('carries a previous year forward, and says so', () => {
    const resolved = resolveWeights(weights, parseYear(2028));
    expect(resolved.sourceYear).toBe(2027);
    expect(resolved.stale).toBe(true);
    expect(resolved.weightPctByArea.get('beta')).toBe(70);
  });

  it('is not stale when the year was actually decided', () => {
    const resolved = resolveWeights(weights, parseYear(2026));
    expect(resolved.stale).toBe(false);
    expect(resolved.sourceYear).toBe(2026);
  });

  it('reports no weights at all rather than inventing some', () => {
    const resolved = resolveWeights(weights, parseYear(2020));
    expect(resolved.sourceYear).toBeUndefined();
    expect(resolved.weightPctByArea.size).toBe(0);
    expect(resolved.stale).toBe(true);
  });

  it('refuses a weight set that is not a division of one person', () => {
    const lopsided = [{ areaKey: 'alpha', year: parseYear(2026), weightPct: 60 }];
    expect(() => assertWeightsSumTo100(resolveWeights(lopsided, parseYear(2026)))).toThrow(
      /sum to 60, not 100/,
    );
    expect(() => assertWeightsSumTo100(resolveWeights(weights, parseYear(2026)))).not.toThrow();
  });

  it('takes the year from an instant in UTC', () => {
    expect(yearOfInstant(TEST_NOW)).toBe(2026);
  });
});

describe('dependencies are acyclic, and the error carries the path', () => {
  it('accepts a chain', () => {
    const graph = assertAcyclic([
      anInitiative({ id: 'a', dependsOn: ['b'] }),
      anInitiative({ id: 'b', dependsOn: ['c'] }),
      anInitiative({ id: 'c' }),
    ]);
    expect(graph.edges.get('a')).toEqual(['b']);
    expect(graph.danglingRefs).toEqual([]);
  });

  it('rejects a cycle and prints it in order', () => {
    const cyclic = [
      anInitiative({ id: 'a', dependsOn: ['b'] }),
      anInitiative({ id: 'b', dependsOn: ['c'] }),
      anInitiative({ id: 'c', dependsOn: ['a'] }),
    ];

    expect(() => assertAcyclic(cyclic)).toThrow(/a → b → c → a/);

    try {
      assertAcyclic(cyclic);
      expect.unreachable('a cycle must not be accepted');
    } catch (error) {
      if (!isInvariantError(error)) throw error;
      expect(error.code).toBe('dependency_cycle');
      expect(error.path).toEqual(['a', 'b', 'c', 'a']);
    }
  });

  it('rejects the shortest cycle there is', () => {
    expect(() => assertAcyclic([anInitiative({ id: 'a', dependsOn: ['a'] })])).toThrow(
      /depends on itself/,
    );
  });

  it('reports the same cycle every run, whatever order the input arrived in', () => {
    const forwards = [
      anInitiative({ id: 'a', dependsOn: ['b'] }),
      anInitiative({ id: 'b', dependsOn: ['a'] }),
      anInitiative({ id: 'z', dependsOn: ['y'] }),
      anInitiative({ id: 'y', dependsOn: ['z'] }),
    ];
    const backwards = [...forwards].reverse();

    const pathOf = (input: typeof forwards): readonly string[] => {
      try {
        assertAcyclic(input);
        return [];
      } catch (error) {
        return isInvariantError(error) ? (error.path ?? []) : [];
      }
    };

    expect(pathOf(forwards)).toEqual(['a', 'b', 'a']);
    expect(pathOf(backwards)).toEqual(['a', 'b', 'a']);
  });

  it('notices a dependency it has never seen', () => {
    const graph = buildDependencyGraph([anInitiative({ id: 'a', dependsOn: ['ghost'] })]);
    expect(graph.danglingRefs).toEqual(['ghost']);
  });

  it('treats done and dropped work as cleared, and everything else as blocking', () => {
    const set = [
      anInitiative({ id: 'a', dependsOn: ['done', 'dropped', 'open', 'ghost'] }),
      anInitiative({ id: 'done', status: 'done' }),
      anInitiative({ id: 'dropped', status: 'dropped' }),
      anInitiative({ id: 'open', status: 'later' }),
    ];
    const blockers = blockedBy(set[0]!, statusIndex(set));
    expect(blockers).toEqual(['ghost', 'open']);
  });
});

describe('origin is immutable after insert (Guard 2)', () => {
  const adopted = anInitiative({ id: 'adopted-1', origin: 'adopted' });

  it('does not compile when a patch names it, and refuses at runtime too', () => {
    expect(() =>
      // @ts-expect-error — the patch type cannot carry `origin`. The directive
      // is the compile-time half of the assertion; the throw is the other half.
      applyPatch(adopted, { origin: 'created_in_prisme' }),
    ).toThrow(/origin is immutable/);
  });

  it('refuses a patch that carries it anyway, from the far side of a boundary', () => {
    const fromTheWire = JSON.parse('{"origin":"created_in_prisme"}') as Record<string, unknown>;
    expect(() => applyPatch(adopted, fromTheWire)).toThrow(/origin is immutable/);
  });

  it('refuses a patch that tries to change the id', () => {
    expect(() =>
      applyPatch(adopted, JSON.parse('{"id":"other"}') as Record<string, unknown>),
    ).toThrow(/id is immutable/);
  });

  it('lets the rest of the entity change', () => {
    const patched = applyPatch(adopted, { status: 'now', title: 'Something else finished' });
    expect(patched.status).toBe('now');
    expect(patched.origin).toBe('adopted');
    expect(patched.id).toBe('adopted-1');
  });

  it('makes an adopted entity structurally incapable of producing a create', () => {
    expect(mayCreateExternally(adopted, undefined)).toBe(false);
    expect(mayCreateExternally(adopted, 'external-1')).toBe(false);

    const created = anInitiative({ id: 'new-1', origin: 'created_in_prisme' });
    expect(mayCreateExternally(created, undefined)).toBe(true);
    expect(mayCreateExternally(created, 'external-1')).toBe(false);
  });
});

describe('an external object binds to one entity (Guard 1)', () => {
  it('refuses a second binding', () => {
    expect(() =>
      indexExternalRefs([
        { prismeId: 'a', prismeKind: 'initiative', kind: 'task', externalId: 'x-1' },
        { prismeId: 'b', prismeKind: 'initiative', kind: 'task', externalId: 'x-1' },
      ]),
    ).toThrow(/already bound to a/);
  });

  it('allows the same external id under a different kind', () => {
    const index = indexExternalRefs([
      { prismeId: 'a', prismeKind: 'initiative', kind: 'task', externalId: 'x-1' },
      { prismeId: 'b', prismeKind: 'project', kind: 'page', externalId: 'x-1' },
    ]);
    expect(index.size).toBe(2);
  });

  it('is idempotent for a repeated identical binding', () => {
    const index = indexExternalRefs([
      { prismeId: 'a', prismeKind: 'initiative', kind: 'task', externalId: 'x-1' },
      { prismeId: 'a', prismeKind: 'initiative', kind: 'task', externalId: 'x-1' },
    ]);
    expect(index.size).toBe(1);
  });
});

describe('the overwrite guard', () => {
  const lastApplied = {
    entityKind: 'task',
    entityId: 'x-1',
    field: 'priority',
    value: 'high',
    appliedAt: TEST_NOW,
  };

  it('allows an overwrite only where the field still holds what prisme wrote', () => {
    expect(mayOverwrite('high', lastApplied)).toBe(true);
    expect(mayOverwrite('lowest', lastApplied)).toBe(false);
  });

  it('never claims a field prisme has not written', () => {
    expect(mayOverwrite('high', undefined)).toBe(false);
    expect(mayOverwrite(null, undefined)).toBe(false);
  });

  it('auto-applies nothing below certain', () => {
    expect(mayAutoApply({ confidence: 'certain' })).toBe(true);
    for (const confidence of ['high', 'medium', 'low', 'manual'] as const) {
      expect(mayAutoApply({ confidence })).toBe(false);
    }
  });
});
