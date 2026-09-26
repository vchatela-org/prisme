import type { AreaColorOverrides, SeriesSlot } from '@prisme/ui/server';
import { cache } from 'react';
import { apiFetch } from './api';
import { settingsAreaListSchema } from './contracts';
import { chosenAreaColors } from './settings-view';

/**
 * The colours the application paints with: a colour chosen on the Settings
 * screen, else the key's hash (`areaColorSlot`).
 *
 * `areaColorSlot` hashes an area's key into the palette's eight categorical
 * slots, and six areas hashed into eight collide most of the time — the
 * birthday problem, not a bad hash. The remedy is a colour chosen per area in
 * Settings → Areas, stored in the database like the rest of an instance's
 * configuration; the Areas screen names any pair still sharing a hue.
 *
 * Read once per request (`cache`). When the area list cannot be read — the
 * sign-in routes have no session, and an API outage should not take the
 * palette with it — every area falls back to its hash.
 */
export const instanceAreaColors = cache(async (): Promise<AreaColorOverrides> => {
  const areas = await apiFetch({ path: '/areas', schema: settingsAreaListSchema }).catch(
    () => undefined,
  );
  if (areas === undefined || !areas.ok) return {};
  return chosenAreaColors(areas.data.items);
});

export type { AreaColorOverrides, SeriesSlot };
