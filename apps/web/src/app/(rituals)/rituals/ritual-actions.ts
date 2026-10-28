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

const cadence = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);

const ritualInput = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200),
  areaKey: z.string().min(1).max(64),
  cadence,
  targetAdherencePct: z.number().min(0).max(100),
  page: z.string().trim().max(2000),
  /** The recurring task it is measured from, or null for a habit recorded by hand. */
  task: z.string().min(1).max(200).nullable(),
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
            ...(value.task === null ? {} : { externalTaskId: value.task }),
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
            // Sent as it is: the task the ritual already has is a no-op, and
            // the form holds it even when the task tool cannot be read.
            externalTaskId: value.task,
          },
          schema: ritualSchema,
        });

  if (!result.ok) {
    if (result.status === 409) {
      return {
        ok: false,
        title: 'That task is taken',
        description:
          'It already belongs to something else in prisme — an initiative, a key result or another ritual — and one task cannot measure two things. Choose another, or none.',
      };
    }
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

const periodInput = z.object({
  id: z.string().min(1).max(200),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opportunities: z.number().int().min(1),
  completions: z.number().int().min(0),
});

/**
 * *Done this period*, for a habit that is not a task (S2).
 *
 * The period and its opportunities come from the API (`currentPeriod`), so
 * this sends back what it was given with the new count — the same absolute
 * write twice is the same row, which a double click cannot turn into two. A
 * ritual measured from its task answers 409: its periods are the refresh's.
 */
export async function recordPeriod(input: z.input<typeof periodInput>): Promise<RitualResult> {
  const parsed = periodInput.safeParse(input);
  if (!parsed.success || parsed.data.completions > parsed.data.opportunities) {
    return { ok: false, title: 'Not recorded', description: 'That count is outside the period.' };
  }
  const value = parsed.data;
  const result = await apiFetch({
    path: `/rituals/${encodeURIComponent(value.id)}/adherence`,
    method: 'POST',
    body: {
      periodStart: value.periodStart,
      opportunities: value.opportunities,
      completions: value.completions,
    },
    schema: z.object({ ritualId: z.string() }),
  });
  if (!result.ok) {
    if (result.status === 409) {
      return {
        ok: false,
        title: 'Measured from its task',
        description:
          'This ritual counts the completions of its recurring task, so a period recorded here would be overwritten. Complete the task instead.',
      };
    }
    const copy = failureCopy(result, 'this ritual');
    return { ok: false, title: copy.title, description: copy.description };
  }
  revalidatePath('/rituals');
  revalidatePath('/kpi');
  return {
    ok: true,
    title: 'Recorded',
    description: `${String(value.completions)} of ${String(value.opportunities)} this period.`,
  };
}
