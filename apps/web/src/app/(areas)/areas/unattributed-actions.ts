'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy } from '@/lib/api-result';
import { settingsAreaListSchema, settingsAreaSchema } from '@/lib/contracts';

/**
 * *Map the rest of this project to…* (S9).
 *
 * Adds a mapping of the **project itself** to an area, beside the area's own.
 * Attribution reads a section's mapping before its project's, so the sections
 * already mapped elsewhere keep their areas, and only what matched nothing —
 * the root tasks, the unmapped sections — lands in the area chosen. It is the
 * same write Settings → Areas makes (`PUT /areas/:key/mappings`), and a
 * location already held by another area is refused the same way.
 */
export type MapResult =
  | { readonly ok: true; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

const input = z.object({
  areaKey: z.string().min(1).max(64),
  projectId: z.string().min(1).max(200),
});

export async function mapRestOfProject(raw: z.input<typeof input>): Promise<MapResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, title: 'Not mapped', description: 'Choose an area to map it to.' };
  }
  const { areaKey, projectId } = parsed.data;

  const areas = await apiFetch({ path: '/areas', schema: settingsAreaListSchema });
  if (!areas.ok) {
    const copy = failureCopy(areas, 'the areas');
    return { ok: false, title: copy.title, description: copy.description };
  }
  const area = areas.data.items.find((candidate) => candidate.key === areaKey);
  if (area === undefined) {
    return { ok: false, title: 'Not mapped', description: 'That area no longer exists.' };
  }
  if (
    area.mappings.some(
      (mapping) => mapping.externalProjectId === projectId && mapping.externalSectionId === null,
    )
  ) {
    return {
      ok: true,
      title: 'Already mapped',
      description: 'The project already counts toward that area from the next capacity refresh.',
    };
  }

  const result = await apiFetch({
    path: `/areas/${encodeURIComponent(areaKey)}/mappings`,
    method: 'PUT',
    body: {
      mappings: [
        ...area.mappings.map((mapping) => ({
          externalProjectId: mapping.externalProjectId,
          ...(mapping.externalSectionId === null
            ? {}
            : { externalSectionId: mapping.externalSectionId }),
          isHome: mapping.isHome,
        })),
        { externalProjectId: projectId, isHome: false },
      ],
    },
    schema: settingsAreaSchema,
  });
  if (!result.ok) {
    if (result.status === 409) {
      return {
        ok: false,
        title: 'Not mapped',
        description:
          'The project itself already belongs to another area. Change it on Settings → Areas.',
      };
    }
    const copy = failureCopy(result, 'this mapping');
    return { ok: false, title: copy.title, description: copy.description };
  }
  revalidatePath('/areas');
  revalidatePath('/settings');
  return {
    ok: true,
    title: `Mapped to ${area.name}`,
    description:
      'Its unmapped tasks count toward that area from the next daily capacity refresh; mapped sections keep theirs.',
  };
}
