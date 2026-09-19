import { describe, expect, it } from 'vitest';
import { countsFrom, guardrailsFor, type WipCounts } from './guardrails';
import { anInitiative } from './test-fixtures';

const ROOM: WipCounts = {
  nowCount: 2,
  maxNow: 5,
  areaNowCount: 0,
  maxNowPerArea: 2,
  areaName: 'Craft',
};

describe('guardrailsFor', () => {
  it('warns about nothing when there is room and the initiative is ready', () => {
    expect(guardrailsFor(anInitiative(), 'now', ROOM)).toEqual([]);
  });

  it('leads with the area cap, because that is the one with an answer', () => {
    const warnings = guardrailsFor(anInitiative(), 'now', {
      ...ROOM,
      areaNowCount: 2,
      nowCount: 5,
    });

    expect(warnings.map((warning) => warning.code)).toEqual(['area_at_cap', 'wip_full']);
    expect(warnings[0]?.detail).toContain('2 of 2');
    expect(warnings[0]?.suggestion).toContain('Craft');
  });

  it('warns that an oversized initiative has no completion condition', () => {
    const warnings = guardrailsFor(anInitiative({ size: 13, sizedForNow: false }), 'now', ROOM);

    expect(warnings.map((warning) => warning.code)).toEqual(['too_large']);
    expect(warnings[0]?.suggestion).toContain('Split it');
  });

  it('counts blockers, and says it in the singular when there is one', () => {
    const one = guardrailsFor(anInitiative({ blockedBy: ['init-002'] }), 'now', ROOM);
    const two = guardrailsFor(anInitiative({ blockedBy: ['init-002', 'init-003'] }), 'now', ROOM);

    expect(one[0]?.detail).toContain('1 initiative it depends on is');
    expect(two[0]?.detail).toContain('2 initiatives it depends on are');
  });

  it('says nothing about capacity for an initiative already in now', () => {
    // Re-confirming a status is not starting something new.
    const full = { ...ROOM, areaNowCount: 2, nowCount: 5 };
    expect(guardrailsFor(anInitiative({ status: 'now' }), 'now', full)).toEqual([]);
  });

  it('warns without counts rather than pretending there is room', () => {
    // Focus could not be read; the size and blocker rules still apply.
    const warnings = guardrailsFor(anInitiative({ sizedForNow: false }), 'now', undefined);
    expect(warnings.map((warning) => warning.code)).toEqual(['too_large']);
  });

  it('notes open tasks on the way to done, and whose they are', () => {
    const warnings = guardrailsFor(anInitiative({ status: 'now' }), 'done', ROOM);

    expect(warnings[0]?.code).toBe('open_tasks');
    expect(warnings[0]?.detail).toContain('never edits it');
  });

  it('says nothing about tasks when they are all closed', () => {
    const closed = anInitiative({
      rollup: { openTaskCount: 0, totalTaskCount: 5, progressPct: 100, lastActivity: null },
    });

    expect(guardrailsFor(closed, 'done', ROOM)).toEqual([]);
  });

  it('always asks for a reason on a drop', () => {
    expect(guardrailsFor(anInitiative(), 'dropped', ROOM).map((w) => w.code)).toEqual([
      'drop_needs_reason',
    ]);
  });

  it('never refuses: every rule is a warning with a way forward', () => {
    const blocked = anInitiative({ sizedForNow: false, blockedBy: ['init-002'] });
    const warnings = guardrailsFor(blocked, 'now', { ...ROOM, areaNowCount: 2, nowCount: 5 });

    expect(warnings).toHaveLength(4);
    for (const warning of warnings) {
      expect(warning.suggestion.length).toBeGreaterThan(10);
    }
  });
});

describe('countsFrom', () => {
  const slots = [
    { areaKey: 'craft', used: 2, limit: 2 },
    { areaKey: 'home', used: 0, limit: 3 },
  ];

  it('reads the per-area limit from the area, not from the overall one', () => {
    const counts = countsFrom(slots, 'home', 'Home', { maxNow: 5, maxNowPerArea: 2 }, 3);

    expect(counts).toEqual({
      nowCount: 3,
      maxNow: 5,
      areaNowCount: 0,
      maxNowPerArea: 3,
      areaName: 'Home',
    });
  });

  it('falls back to the global per-area limit for an area with no slot line', () => {
    const counts = countsFrom(slots, 'money', 'Money', { maxNow: 5, maxNowPerArea: 2 }, 3);

    expect(counts.areaNowCount).toBe(0);
    expect(counts.maxNowPerArea).toBe(2);
  });
});
