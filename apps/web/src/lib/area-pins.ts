import type { AreaColorOverrides, SeriesSlot } from '@prisme/ui/server';
import { cache } from 'react';
import { apiFetch } from './api';
import { settingsAreaListSchema } from './contracts';
import { webRuntime } from './runtime';
import { mergedAreaColors } from './settings-view';

/**
 * The instance's area → palette slot pinning, from configuration.
 *
 * ## The defect this closes
 *
 * `areaColorSlot` hashes an area's key into the palette's eight categorical
 * slots, and the palette's ceiling is fixed: a ninth generated hue is
 * indistinguishable from an existing one under colour-vision deficiency. Six
 * areas hashed into eight slots collide most of the time — the birthday
 * problem, not a bad hash — so two areas render in the same colour, on every
 * screen, for every instance that does not pin them. W09 recorded it as "the
 * most visible defect left": the fix (`AreaColorProvider` with a pinning map)
 * existed in `packages/ui` and **nothing outside the gallery mounted it**,
 * because the map is instance configuration and nothing loaded one.
 *
 * ## Why it arrives as configuration and not as fixture data
 *
 * Area keys are instance data, and this repository is public
 * ([`docs/17-privacy.md`](../../../../docs/17-privacy.md)). `fixtures.ts` has a
 * pinning map for the gallery, and those six keys are invented; an instance's
 * map can only come from its own environment.
 *
 * ## The cast, and what makes it true
 *
 * `AREA_COLOR_PINS` is parsed by a schema that refuses anything but a whole
 * number from 1 to 8 — `packages/config/src/schema.ts`, and its test asserts
 * the refusal. `@prisme/config` deliberately does not know about `SeriesSlot`:
 * a configuration package that depends on the design system is the wrong
 * direction, so the narrowing happens here, once, where the reader can see the
 * schema it rests on.
 */
export function areaColorPins(): AreaColorOverrides {
  return webRuntime().config.areaColorPins as AreaColorOverrides;
}

/**
 * The colours the application paints with: a colour chosen on the Settings
 * screen, else the environment's pin, else the key's hash.
 *
 * Read once per request (`cache`). When the area list cannot be read — the
 * sign-in routes have no session, and an API outage should not take the
 * palette with it — the environment's pins are the whole answer, which is
 * exactly what every screen rendered before colours could be chosen.
 */
export const instanceAreaColors = cache(async (): Promise<AreaColorOverrides> => {
  const pins = areaColorPins();
  const areas = await apiFetch({ path: '/areas', schema: settingsAreaListSchema }).catch(
    () => undefined,
  );
  if (areas === undefined || !areas.ok) return pins;
  return mergedAreaColors(pins, areas.data.items);
});

/**
 * The pinning a server component should render with.
 *
 * A named alias rather than a re-export, so a call site reads as what it is —
 * "the instance's pinning" — and there is one place to change if the map ever
 * comes from somewhere other than the environment.
 */
export type { AreaColorOverrides, SeriesSlot };
