'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy } from '@/lib/api-result';
import { initiativeSchema } from '@/lib/contracts';

/**
 * *Make it an initiative of …* for a task sitting unsorted in Todoist's Inbox
 * (S11).
 *
 * Adopted, never created: the API records the initiative and a link to the
 * existing task, and the reconciler binds it on its next pass — moving it into
 * the area, because an anchor's location is prisme's and the Inbox is in no
 * area. A task that should stay a plain task is Todoist's to sort, and nothing
 * here moves it.
 */
export type UnsortedResult =
  | { readonly ok: true; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

const input = z.object({
  taskId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  areaKey: z.string().min(1).max(64),
});

export async function adoptUnsorted(raw: z.input<typeof input>): Promise<UnsortedResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'Not adopted',
      description: 'It needs an outcome as its title, and an area.',
    };
  }
  const result = await apiFetch({
    path: `/task-tool/inbox/${encodeURIComponent(parsed.data.taskId)}/initiative`,
    method: 'POST',
    body: { title: parsed.data.title, areaKey: parsed.data.areaKey },
    schema: initiativeSchema,
  });
  if (!result.ok) {
    if (result.status === 409) {
      return {
        ok: false,
        title: 'Already in prisme',
        description: 'That task already belongs to, or is linked to, something in prisme.',
      };
    }
    if (result.status === 422) {
      return {
        ok: false,
        title: 'Not adopted',
        description: 'An initiative belongs to an area, not to the Run or Signals lane.',
      };
    }
    const copy = failureCopy(result, 'this task');
    return { ok: false, title: copy.title, description: copy.description };
  }
  revalidatePath('/inbox');
  revalidatePath('/backlog');
  revalidatePath('/');
  return {
    ok: true,
    title: 'Adopted',
    description:
      'It is an initiative in your Inbox now, to estimate. The next sync links the task and moves it into the area in Todoist.',
  };
}
