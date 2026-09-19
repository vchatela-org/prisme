'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import { initiativeSchema, replanSchema, type Replan } from '@/lib/contracts';

/**
 * The two halves of a drag: ask, then — separately — commit.
 *
 * They live beside the screen that makes them rather than in `lib/actions.ts`,
 * which holds the writes the *daily* surfaces make. That also keeps four
 * wave-4 agents out of one file, as W09 did for the weight write.
 *
 * ## Asking is a read, and it stays one
 *
 * `previewMove` calls `GET /timeline/replan`, which computes a hypothetical
 * plan and writes nothing. Its scope is `read:timeline`, so an instance with
 * writes frozen can still be asked what a move would cost — which is the moment
 * somebody most wants to know.
 *
 * ## Committing writes one field, and it is not a date the plan owns
 *
 * A drag writes **`earliest_start`**: "do not begin this before X". That is the
 * only scheduling date a human owns (docs/11-ownership.md).
 * `planned_start`/`planned_end` are derived — the engine computes them and the
 * reconciler propagates them — so writing one from here would be the UI
 * claiming a field it does not own, and the next schedule run would overwrite
 * it anyway.
 *
 * **No deadline is ever written.** There is no path from this screen to one:
 * the body below names a single field, and prisme flags an impossible deadline
 * rather than moving it (ADR-0003, W02 brief §4).
 */

const moveSchema = z.object({
  initiativeId: z.string().min(1).max(200),
  newStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a calendar date, YYYY-MM-DD'),
});

export type MoveInput = z.infer<typeof moveSchema>;

export interface PreviewResult {
  readonly ok: boolean;
  readonly preview: Replan | null;
  readonly title: string;
  readonly description: string;
}

export interface CommitResult {
  readonly ok: boolean;
  readonly title: string;
  readonly description: string;
}

function refused(failure: ApiFailure, what: string): { title: string; description: string } {
  return failureCopy(failure, what);
}

/**
 * What would happen if this initiative started on this day.
 *
 * A server action is a public endpoint — the boundary is its arguments, not the
 * component that called it — so the move is re-parsed here before a request is
 * built (`lib/actions.ts`).
 */
export async function previewMove(input: MoveInput): Promise<PreviewResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      preview: null,
      title: 'That is not a day this can move to',
      description: 'A move names one initiative and one calendar date.',
    };
  }

  const result = await apiFetch({
    path: '/timeline/replan',
    query: { initiativeId: parsed.data.initiativeId, newStart: parsed.data.newStart },
    schema: replanSchema,
  });

  if (!result.ok) {
    const copy = refused(result, 'this move');
    return { ok: false, preview: null, ...copy };
  }

  return { ok: true, preview: result.data, title: '', description: '' };
}

/**
 * Commit the move the preview described.
 *
 * The preview is not replayed and no diff is sent: the API recomputes the plan
 * from the field this writes, so there is exactly one thing here that can be
 * wrong, and it is the same thing the preview was asked about. What guards the
 * agreement between the two is a test that commits a previewed move against a
 * real database and asserts the plan served afterwards carries the dates the
 * preview promised (`apps/api/src/routes/integration.test.ts`).
 */
export async function commitMove(input: MoveInput): Promise<CommitResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That is not a day this can move to',
      description: 'A move names one initiative and one calendar date.',
    };
  }

  const result = await apiFetch({
    path: `/initiatives/${encodeURIComponent(parsed.data.initiativeId)}`,
    method: 'PATCH',
    // Named, never spread. This body has one field in it and that is the
    // point: a drag cannot reach a second one.
    body: { earliestStart: parsed.data.newStart },
    schema: initiativeSchema,
  });

  if (!result.ok) return { ok: false, ...refused(result, 'this move') };

  // Every surface that reads a planned date or a deadline flag.
  revalidatePath('/timeline');
  revalidatePath('/');
  revalidatePath('/backlog');
  revalidatePath(`/initiative/${parsed.data.initiativeId}`);

  return {
    ok: true,
    title: 'The plan is updated',
    description: `Its earliest start is now ${parsed.data.newStart}. Everything downstream was replanned with it; no deadline changed.`,
  };
}
