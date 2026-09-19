/**
 * Area colour — derived from the area **key**, never from list position.
 *
 * This is the rule the brief repeats twice, and the reason is worth keeping in
 * front of whoever changes this file: positional colour changes meaning when an
 * area is added. Every screenshot taken before the change, and every reader who
 * learned "the green one is Home", is silently invalidated. A key-derived
 * colour survives an area being added, renamed, archived or filtered out of a
 * chart.
 *
 * ## Why there is an override table as well as a hash
 *
 * The palette has eight categorical slots and that ceiling is fixed — a ninth
 * generated hue is indistinguishable from an existing one under CVD, so the
 * skill forbids it. Six areas hashed into eight slots collide most of the
 * time: this is the birthday problem, not a bad hash, and swapping the hash
 * function only moves which pair collides (both FNV-1a and djb2 were measured
 * over the fixture keys; both collide).
 *
 * So the hash is the *fallback*, and an instance pins its areas explicitly:
 *
 *   areaColorVar('craft', 'area', { craft: 3 })   // slot 3, forever
 *
 * The map is keyed by area key, so it is still never positional, and it lives
 * in instance configuration rather than in this repository — area keys are
 * instance data and this repository is public (docs/17-privacy.md). The only
 * map committed here is the fixture one in the gallery, and those six keys are
 * invented.
 */

import { CATEGORICAL_SLOT_COUNT } from './palette.js';

/** Matches `kind` on an area (docs/10-model.md §3). */
export type AreaKind = 'area' | 'run' | 'signals';

/** 1-based, matching the palette's slot numbering. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Every slot a mark can take: one of the eight hues, or the lane grey. */
export type ColorSlot = SeriesSlot | 'lane';

/**
 * A reference to one of the design system's custom properties.
 *
 * The template type is the point, not decoration: this value is written into
 * an SVG `fill` attribute, so restricting it to `var(--prisme-…)` is what
 * keeps a caller from ever putting data-derived text there.
 */
export type ColorVar = `var(--prisme-${string})`;

export type AreaColorOverrides = Readonly<Record<string, SeriesSlot>>;

/**
 * The class that paints a slot, in HTML.
 *
 * Tailwind resolves each of these to `var(--prisme-series-n)` through the
 * `@theme inline` block the token sheet generates, so a swatch follows the
 * active theme exactly as an inline `background-color` did — and, unlike the
 * inline style, it survives a Content-Security-Policy that refuses `style`
 * attributes (docs/14-threat-model.md; `no-inline-style.test.tsx`).
 *
 * The table is written out rather than assembled because Tailwind scans source
 * *text*: a class name built at runtime is one its scanner never sees, and the
 * swatch would render unpainted with nothing failing.
 */
const SLOT_CLASS: Readonly<Record<ColorSlot, string>> = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
  4: 'bg-series-4',
  5: 'bg-series-5',
  6: 'bg-series-6',
  7: 'bg-series-7',
  8: 'bg-series-8',
  lane: 'bg-lane',
};

/** The class an HTML mark paints with. */
export function colorSlotClass(slot: ColorSlot): string {
  return SLOT_CLASS[slot];
}

/** The CSS value an SVG mark paints with, as a `fill` or a `stroke`. */
export function colorSlotVar(slot: ColorSlot): ColorVar {
  return slot === 'lane' ? 'var(--prisme-lane)' : `var(--prisme-series-${String(slot)})`;
}

/**
 * FNV-1a over the key's UTF-8 bytes. Chosen for being small, dependency-free
 * and stable across runtimes — `String.prototype.hashCode` does not exist and
 * anything involving `Math.random` or insertion order would defeat the point.
 */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The slot an area paints with, or `null` for a lane.
 *
 * Run and Signals deliberately have no hue: they are context rather than
 * identity (ADR-0014 keeps them out of ranking while counting them in
 * capacity), and painting upkeep in a categorical hue makes it compete with
 * the areas on the one chart where the areas are the subject.
 */
export function areaColorSlot(
  key: string,
  kind: AreaKind = 'area',
  overrides: AreaColorOverrides = {},
): SeriesSlot | null {
  if (kind !== 'area') return null;

  const pinned = overrides[key];
  if (pinned !== undefined) return pinned;

  return ((hashKey(key) % CATEGORICAL_SLOT_COUNT) + 1) as SeriesSlot;
}

/**
 * The CSS value an area's **SVG** marks paint with — always a custom property,
 * so the colour follows the active theme instead of being frozen at render
 * time.
 *
 * HTML marks use `areaColorClass` instead. The split is not taste: a `style`
 * attribute is refused by the policy the web tier sends, while an SVG `fill`
 * is an attribute CSP does not govern. Neither carries anything but a token.
 */
export function areaColorVar(
  key: string,
  kind: AreaKind = 'area',
  overrides: AreaColorOverrides = {},
): ColorVar {
  return colorSlotVar(areaColorSlot(key, kind, overrides) ?? 'lane');
}

/** The class an area's HTML marks paint with. */
export function areaColorClass(
  key: string,
  kind: AreaKind = 'area',
  overrides: AreaColorOverrides = {},
): string {
  return colorSlotClass(areaColorSlot(key, kind, overrides) ?? 'lane');
}

/**
 * Reports keys that share a slot, so a caller can pin them instead of
 * discovering the clash on a chart. The gallery runs this over the fixture
 * set; an instance should run it over its own.
 */
export function areaColorCollisions(
  areas: ReadonlyArray<{ readonly key: string; readonly kind?: AreaKind }>,
  overrides: AreaColorOverrides = {},
): ReadonlyArray<readonly string[]> {
  const bySlot = new Map<SeriesSlot, string[]>();
  for (const area of areas) {
    const slot = areaColorSlot(area.key, area.kind ?? 'area', overrides);
    if (slot === null) continue;
    const existing = bySlot.get(slot);
    if (existing) existing.push(area.key);
    else bySlot.set(slot, [area.key]);
  }
  return [...bySlot.values()].filter((keys) => keys.length > 1);
}
