'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy } from '@/lib/api-result';
import { ritualSchema } from '@/lib/contracts';
import { pageIdFrom } from '@/lib/page-id';

/**
 * Defining a ritual — until this screen, only `POST /rituals` with a
 * hand-written call could (the restore-rehearsal entry's finding).
 *
 * A ritual is a habit with a cadence and a target, in an area, optionally
 * joined to its process page in the document tool. It is what ritual
 * adherence is measured over, and the page is where the declared-duration
 * tier reads a duration from.
 */

export type RitualResult =
  | { readonly ok: true; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

const cadence = z.enum(['daily', 'weekly', 'monthly']);

const ritualInput = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200),
  areaKey: z.string().min(1).max(64),
  cadence,
  targetAdherencePct: z.number().min(0).max(100),
  page: z.string().trim().max(2000),
});

export async function saveRitual(input: z.input<typeof ritualInput>): Promise<RitualResult> {
  const parsed = ritualInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'Not saved',
      description: 'A ritual needs a name, an area, a cadence and a target between 0 and 100%.',
    };
  }
  const value = parsed.data;
  const pageId = value.page === '' ? null : pageIdFrom(value.page);
  if (pageId === undefined) {
    return {
      ok: false,
      title: 'Not saved',
      description: 'The process page should be a link copied from the document tool, or empty.',
    };
  }

  const result =
    value.id === undefined
      ? await apiFetch({
          path: '/rituals',
          method: 'POST',
          body: {
            name: value.name,
            areaKey: value.areaKey,
            cadence: value.cadence,
            targetAdherencePct: value.targetAdherencePct,
            ...(pageId === null ? {} : { externalPageId: pageId }),
          },
          schema: ritualSchema,
        })
      : await apiFetch({
          path: `/rituals/${encodeURIComponent(value.id)}`,
          method: 'PATCH',
          body: {
            name: value.name,
            cadence: value.cadence,
            targetAdherencePct: value.targetAdherencePct,
            externalPageId: pageId,
          },
          schema: ritualSchema,
        });

  if (!result.ok) {
    const copy = failureCopy(result, 'this ritual');
    return { ok: false, title: copy.title, description: copy.description };
  }
  revalidatePath('/rituals');
  revalidatePath('/kpi');
  return {
    ok: true,
    title: value.id === undefined ? 'Ritual defined' : 'Saved',
    description: `${value.name}, ${value.cadence}, aiming for ${String(value.targetAdherencePct)}%.`,
  };
}
