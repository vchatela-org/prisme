import {
  CATEGORICAL_SLOT_COUNT,
  type AreaColorOverrides,
  type AreaKind,
  type SeriesSlot,
} from '@prisme/ui/server';

/**
 * Proposing the instance's area → palette slot pinning.
 *
 * ## The defect this closes
 *
 * `areaColorSlot` hashes an area's key into the palette's eight categorical
 * slots, and six areas hashed into eight slots collide most of the time — the
 * birthday problem, not a bad hash. W09 recorded it as the most visible defect
 * left, #37 mounted the pinning map, and the map itself was still something an
 * operator had to invent: the register row said so in as many words —
 * *"`AREA_COLOR_PINS` must be set by hand and **nothing generates it**"*. This
 * generates it, where the collision is visible and the config is readable.
 *
 * ## Why the proposal lives here and not in `prisme-sync`
 *
 * The palette's ceiling is `packages/ui`'s
 * ([`CATEGORICAL_SLOT_COUNT`](../../../../packages/ui/src/tokens/palette.ts)),
 * and the pinning is read by the web tier alone — `AREA_COLOR_PINS` is a web
 * variable. A `prisme-sync` subcommand was the shape the register suggested,
 * and it would have had to hold a second copy of that count: `apps/sync` cannot
 * import `@prisme/ui`, whose barrel drags React and Radix into a distroless
 * reconciler image, so the number would be duplicated and could drift. The
 * screen that paints the colours is the one place that can propose them without
 * a second source of truth.
 *
 * ## Why a proposal rather than a hash of the list
 *
 * The token file's rule is that colour is derived from the area **key**, never
 * from list position, because positional colour changes meaning when an area is
 * added. A proposal does not break that rule, it is the mechanism that keeps
 * it: the map it prints is keyed, so once pasted into the environment those
 * colours are stable for ever, and adding an area later cannot move them.
 *
 * ## Existing pins are kept, and only gaps are filled
 *
 * An operator who has pinned four areas and added a fifth must not have their
 * first four move: colour is identity, and a reader who learned "the green one
 * is Home" is invalidated by a re-shuffle even when every area still has its own
 * hue. So the proposal starts from what is already pinned and deals only the
 * unpinned keys, into the lowest slots nothing else holds.
 */

/**
 * The little the proposal needs from each area: its key, and whether it ranks.
 *
 * `kind` is declared exactly as `areaColorCollisions` declares it, because
 * `exactOptionalPropertyTypes` is on: an `AreaLike` whose `kind` could be
 * `undefined` is not the same type as one whose `kind` may be absent, and the
 * collision check would refuse to take it.
 */
export interface AreaLike {
  readonly key: string;
  readonly kind?: AreaKind;
}

export interface PinProposal {
  /** The map for `AREA_COLOR_PINS`. Every ranked area of this instance, and nothing else. */
  readonly pins: AreaColorOverrides;
  /** The ranked keys that had no pin and were given one, in the order dealt. */
  readonly assigned: readonly string[];
  /**
   * True when a ranked key had no slot left.
   *
   * The ceiling is real and not a preference: the palette has eight categorical
   * hues, and a ninth generated one is indistinguishable from an existing one
   * under colour-vision deficiency, which is why the skill forbids generating
   * one. `pins` is still returned — with what could be placed — so a caller can
   * show what it has and say what it could not do.
   */
  readonly exhausted: boolean;
}

/** Only the ranked areas take a hue; Run and Signals paint with the lane grey. */
const ranks = (area: AreaLike): boolean => (area.kind ?? 'area') === 'area';

/**
 * A keyed pinning map for `areas`, keeping whatever `existing` already pins.
 *
 * Sorted by key rather than by appearance: the *result* is keyed either way, and
 * a deterministic order means two operators with the same areas get the same
 * proposal, and a test can assert one. `Array.prototype.sort`'s code-unit order
 * is used rather than a locale comparison, which would make the result depend on
 * the machine's locale.
 */
export function proposePins(
  areas: readonly AreaLike[],
  existing: AreaColorOverrides = {},
  slots: number = CATEGORICAL_SLOT_COUNT,
): PinProposal {
  const ranked = [...new Set(areas.filter(ranks).map((area) => area.key))].sort();

  const pins: Record<string, SeriesSlot> = {};
  const taken = new Set<number>();

  // What is already pinned, and only for areas this instance still has — a pin
  // for an area that was renamed or removed is not part of a proposal about
  // this instance, and carrying it into the environment would preserve a key
  // nothing paints.
  //
  // A *slot* is kept only if nothing else holds it either. Two areas pinned to
  // one slot is the defect itself, arriving by hand rather than by hash, and a
  // proposal that echoed it back would print a map that still collides — the
  // notice would name the problem and the line below it would not fix it. The
  // second key is left to the dealing pass, which is what makes the proposal a
  // correction in that case and not a restatement.
  for (const key of ranked) {
    const pinned = existing[key];
    if (pinned !== undefined && !taken.has(pinned)) {
      pins[key] = pinned;
      taken.add(pinned);
    }
  }

  const assigned: string[] = [];
  let exhausted = false;

  for (const key of ranked) {
    if (pins[key] !== undefined) continue;

    let slot: number | undefined;
    for (let candidate = 1; candidate <= slots; candidate += 1) {
      if (!taken.has(candidate)) {
        slot = candidate;
        break;
      }
    }

    if (slot === undefined) {
      // Every hue is held. Nothing is re-shuffled to make room: an area that
      // already painted in a colour keeps it, and the operator is told.
      exhausted = true;
      continue;
    }

    pins[key] = slot as SeriesSlot;
    taken.add(slot);
    assigned.push(key);
  }

  return { pins, assigned, exhausted };
}

/**
 * The value to paste into the environment, as one line.
 *
 * A function rather than a template in the component so that the exact string a
 * person copies is asserted by a test instead of being reconstructed by eye from
 * a screenshot.
 */
export function pinsToEnvValue(pins: AreaColorOverrides): string {
  const ordered: Record<string, number> = {};
  // Sorted so the line does not re-order itself between renders of the same
  // configuration, which would make a diff in a deployment repository noise.
  for (const key of Object.keys(pins).sort()) {
    const slot = pins[key];
    if (slot !== undefined) ordered[key] = slot;
  }
  return JSON.stringify(ordered);
}
