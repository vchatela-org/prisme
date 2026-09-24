import { describe, expect, it } from 'vitest';
import { areaColorCollisions, type AreaColorOverrides } from '@prisme/ui/server';
import { pinsToEnvValue, proposePins, type AreaLike } from './area-pin-proposal';

/**
 * The pinning proposal.
 *
 * The assertion that matters is not which slot each area got — that is an
 * implementation detail — but the property the whole thing exists for: **after
 * the proposal is applied, no two ranked areas share a hue**, checked with the
 * same `areaColorCollisions` the screens use rather than with a hand-written
 * comparison.
 *
 * The keys are invented (`alpha`-style, like `fixtures/`), and `fixtures/areas.json`
 * carries real-shaped six-area and lane sets that are also invented.
 */

const KEY_AREAS: readonly AreaLike[] = [
  { key: 'alpha' },
  { key: 'beta' },
  { key: 'gamma' },
  { key: 'delta' },
  { key: 'epsilon' },
  { key: 'zeta' },
];

describe('proposePins', () => {
  it('gives every ranked area its own hue, checked by the collision detector', () => {
    const { pins, assigned, exhausted } = proposePins(KEY_AREAS);

    expect(exhausted).toBe(false);
    expect(assigned).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma', 'zeta']);
    // **The control, and it is not decoration.** Without it this test passes on
    // a set of keys that happened not to collide, and would keep passing after a
    // change that broke the proposal. `beta` and `zeta` both hash to slot 8
    // today; if that ever stops being true this line goes red and says so.
    expect(areaColorCollisions(KEY_AREAS, {})).not.toEqual([]);
    // The property, not the numbers: no two ranked areas share a hue once the
    // proposal is in force.
    expect(areaColorCollisions(KEY_AREAS, pins)).toEqual([]);
  });

  it('deals the lowest free slot, so the output is stable and readable', () => {
    const { pins } = proposePins([{ key: 'beta' }, { key: 'alpha' }, { key: 'gamma' }]);

    expect(pins).toEqual({ alpha: 1, beta: 2, gamma: 3 });
  });

  it('does not depend on the order the areas arrive in', () => {
    const forwards = proposePins(KEY_AREAS).pins;
    const backwards = proposePins([...KEY_AREAS].reverse()).pins;

    expect(backwards).toEqual(forwards);
  });

  it('keeps what is already pinned and fills only the gaps', () => {
    // The reason this is not a fresh round-robin: colour is identity, and moving
    // an area a reader has learned invalidates every screenshot and every habit.
    const { pins, assigned } = proposePins(KEY_AREAS, { beta: 7, gamma: 2 });

    expect(pins['beta']).toBe(7);
    expect(pins['gamma']).toBe(2);
    expect(assigned).not.toContain('beta');
    expect(assigned).not.toContain('gamma');
    // Not slot 2 or 7: those are held.
    expect(assigned).toContain('alpha');
    expect(pins['alpha']).toBe(1);
    expect(areaColorCollisions(KEY_AREAS, pins)).toEqual([]);
  });

  it('gives lanes no pin at all, because a lane has no hue', () => {
    const { pins } = proposePins([
      { key: 'alpha' },
      { key: 'run', kind: 'run' },
      { key: 'signals', kind: 'signals' },
    ]);

    expect(Object.keys(pins)).toEqual(['alpha']);
    // And the lanes still paint: grey, by `areaColorSlot`'s null.
    expect(areaColorCollisions([{ key: 'alpha' }, { key: 'run', kind: 'run' }], pins)).toEqual([]);
  });

  it('corrects a configuration that pins two areas to one slot', () => {
    // The defect arriving by hand instead of by hash, which is the other way it
    // happens. A proposal that kept both would print a map that still collides:
    // the notice would name the problem and the line under it would not fix it.
    const { pins } = proposePins([{ key: 'alpha' }, { key: 'beta' }], { alpha: 3, beta: 3 });

    expect(areaColorCollisions([{ key: 'alpha' }, { key: 'beta' }], pins)).toEqual([]);
    // The first key by sort keeps what a person chose; the second is re-dealt.
    expect(pins['alpha']).toBe(3);
    expect(pins['beta']).toBe(1);
  });

  it('drops a pin for a key that is no longer an area', () => {
    const { pins } = proposePins([{ key: 'alpha' }], { alpha: 3, gone: 5 });

    expect(pins).toEqual({ alpha: 3 });
  });

  it('reports exhaustion past the palette ceiling rather than reusing a hue', () => {
    // Nine ranked areas, eight hues. No ninth hue is generated — one would be
    // indistinguishable from an existing one under colour-vision deficiency —
    // and nothing already placed is moved to make room.
    const nine: readonly AreaLike[] = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'eta',
      'theta',
      'iota',
    ].map((key) => ({ key }));

    const { pins, exhausted, assigned } = proposePins(nine);

    expect(exhausted).toBe(true);
    expect(Object.keys(pins)).toHaveLength(8);
    expect(assigned).toHaveLength(8);
    // The two that could be placed are placed, and the caller is told.
    expect(Object.values(pins).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('is exhausted by the existing pins alone when they fill the palette', () => {
    const full: AreaColorOverrides = {
      alpha: 1,
      beta: 2,
      gamma: 3,
      delta: 4,
      epsilon: 5,
      zeta: 6,
      eta: 7,
      theta: 8,
    };
    const { pins, exhausted, assigned } = proposePins(
      [...Object.keys(full).map((key) => ({ key })), { key: 'iota' }],
      full,
    );

    expect(exhausted).toBe(true);
    expect(assigned).toEqual([]);
    expect(pins['iota']).toBeUndefined();
  });
});

describe('pinsToEnvValue', () => {
  it('is the string a person pastes, ordered so it does not churn', () => {
    expect(pinsToEnvValue({ zeta: 4, alpha: 1 })).toBe('{"alpha":1,"zeta":4}');
  });

  it('is an empty object for an instance that ranks nothing', () => {
    expect(pinsToEnvValue({})).toBe('{}');
  });
});
