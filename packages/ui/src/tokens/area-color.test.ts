import { describe, expect, it } from 'vitest';
import {
  areaColorCollisions,
  areaColorSlot,
  areaColorVar,
  hashKey,
  type AreaColorOverrides,
} from './area-color.js';
import { CATEGORICAL_SLOT_COUNT } from './palette.js';

/** The fixture areas (fixtures/areas.json). Invented keys, as required. */
const FIXTURE_AREAS = [
  { key: 'health', kind: 'area' },
  { key: 'relationships', kind: 'area' },
  { key: 'craft', kind: 'area' },
  { key: 'money', kind: 'area' },
  { key: 'home', kind: 'area' },
  { key: 'community', kind: 'area' },
  { key: 'run', kind: 'run' },
  { key: 'signals', kind: 'signals' },
] as const;

/** The pinning the gallery uses, mirrored here so the mechanism is tested. */
const FIXTURE_OVERRIDES: AreaColorOverrides = {
  health: 1,
  relationships: 2,
  craft: 3,
  money: 4,
  home: 5,
  community: 6,
};

describe('the hash', () => {
  it('is stable — the same key gives the same number, every run', () => {
    expect(hashKey('health')).toBe(hashKey('health'));
    // Pinned: a change to the hash function repaints every unpinned instance,
    // so it should be a decision rather than a refactor.
    expect(hashKey('health')).toBe(0x6b98ed8f);
    expect(hashKey('')).toBe(0x811c9dc5);
  });

  it('separates keys that differ by one character', () => {
    expect(hashKey('health')).not.toBe(hashKey('healths'));
    expect(hashKey('craft')).not.toBe(hashKey('Craft'));
  });

  it('handles a non-ASCII key, since instance data is French', () => {
    // An invented word rather than a plausible one: a real area name does not
    // belong in a public repository even as a test value.
    expect(() => hashKey('ünïcøde-kéy')).not.toThrow();
    expect(hashKey('ünïcøde-kéy')).toBe(hashKey('ünïcøde-kéy'));
    expect(hashKey('ünïcøde-kéy')).not.toBe(hashKey('unicode-key'));
  });
});

describe('a slot is a function of the key alone', () => {
  it('does not depend on position, neighbours, or how many areas exist', () => {
    const alone = areaColorSlot('craft');
    const crowded = areaColorSlot('craft');
    expect(crowded).toBe(alone);

    // The same key read from opposite ends of a list agrees with itself.
    const forward = FIXTURE_AREAS.map((a) => areaColorSlot(a.key, a.kind));
    const backward = [...FIXTURE_AREAS].reverse().map((a) => areaColorSlot(a.key, a.kind));
    expect(forward).toEqual([...backward].reverse());
  });

  it('always lands inside the palette', () => {
    for (const key of ['a', 'health', 'a-very-long-area-key-indeed', 'ünïcøde-kéy', '123']) {
      const slot = areaColorSlot(key);
      expect(slot).not.toBeNull();
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(CATEGORICAL_SLOT_COUNT);
    }
  });

  it('gives lanes no hue at all', () => {
    expect(areaColorSlot('run', 'run')).toBeNull();
    expect(areaColorSlot('signals', 'signals')).toBeNull();
    expect(areaColorVar('run', 'run')).toBe('var(--prisme-lane)');
    expect(areaColorVar('signals', 'signals')).toBe('var(--prisme-lane)');
  });

  it('ignores an override aimed at a lane — a lane is never a series', () => {
    expect(areaColorSlot('run', 'run', { run: 2 })).toBeNull();
  });

  it('lets an instance pin a key, and pins win over the hash', () => {
    expect(areaColorSlot('craft', 'area', { craft: 7 })).toBe(7);
    expect(areaColorVar('craft', 'area', { craft: 7 })).toBe('var(--prisme-series-7)');
    // Pinning one key leaves every other key exactly where it was.
    expect(areaColorSlot('health', 'area', { craft: 7 })).toBe(areaColorSlot('health'));
  });

  it('returns a custom property, never a frozen colour', () => {
    for (const area of FIXTURE_AREAS) {
      expect(areaColorVar(area.key, area.kind, FIXTURE_OVERRIDES)).toMatch(
        /^var\(--prisme-(series-[1-8]|lane)\)$/,
      );
    }
  });
});

describe('collisions are reported rather than hidden', () => {
  it('finds the clashes in the unpinned fixture set', () => {
    // Six keys into eight slots: the birthday problem says this collides, and
    // it does. The point of the report is that an instance sees it before a
    // reader does.
    const collisions = areaColorCollisions(FIXTURE_AREAS);
    expect(collisions.length).toBeGreaterThan(0);
  });

  it('reports none once the fixture areas are pinned', () => {
    expect(areaColorCollisions(FIXTURE_AREAS, FIXTURE_OVERRIDES)).toEqual([]);
  });

  it('never counts lanes as a clash, however many there are', () => {
    expect(
      areaColorCollisions([
        { key: 'run', kind: 'run' },
        { key: 'signals', kind: 'signals' },
        { key: 'upkeep', kind: 'run' },
      ]),
    ).toEqual([]);
  });

  it('groups every key that shares a slot', () => {
    const collisions = areaColorCollisions([{ key: 'a' }, { key: 'b' }, { key: 'c' }], {
      a: 1,
      b: 1,
      c: 1,
    });
    expect(collisions).toEqual([['a', 'b', 'c']]);
  });
});
