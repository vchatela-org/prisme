'use server';

import { apiFetch } from '@/lib/api';
import { areaListSchema } from '@/lib/contracts';

/**
 * The areas a capture can be filed under, for the dialog.
 *
 * A server action rather than a fetch from the browser, for the reason every
 * write here is one: the API is reached with the caller's forwarded assertion
 * and the web tier holds no credential of its own. A `fetch` straight to the
 * API would also need its origin in `connect-src`, which is the exfiltration
 * channel W14's content security policy closes (`lib/actions.ts`).
 *
 * An area with no mapping is returned and marked, not filtered out. The form
 * shows how many are missing and why — a list that silently omits an area is
 * a list somebody reads as "that area is gone".
 */
export interface CaptureAreaChoice {
  readonly key: string;
  readonly name: string;
  readonly mapped: boolean;
}

export async function loadAreasForCapture(): Promise<readonly CaptureAreaChoice[]> {
  const areas = await apiFetch({ path: '/areas', schema: areaListSchema });
  if (!areas.ok) return [];

  return areas.data.items
    .filter((area) => area.kind === 'area')
    .map((area) => ({
      key: area.key,
      name: area.name,
      mapped: area.mappings.length > 0,
    }));
}
