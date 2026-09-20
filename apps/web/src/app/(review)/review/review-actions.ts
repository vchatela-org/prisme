'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import { REVIEW_CADENCES, reviewSessionSchema, type ReviewSession } from '@/lib/contracts';

/**
 * The review session's writes.
 *
 * ## Every tick is a read-merge-write, and that is not incidental
 *
 * `PATCH /reviews/:id` **replaces** the checklist rather than merging into it
 * (`apps/api/src/store/postgres.ts` — the column is assigned, not patched). So
 * an action that sent only the step it just ticked would delete every other
 * tick in the session, and an action that sent the steps *this build knows*
 * would delete an instance's own added steps and any step from an older
 * build.
 *
 * Each tick therefore re-reads the session, merges one key into whatever is
 * actually stored, and writes the whole map back. That also narrows the window
 * in which two tabs clobber each other to the round trip itself, rather than
 * to however long a wizard has been open — and a review left open in a tab
 * overnight is the normal case, not the exotic one.
 *
 * ## Closing is a separate decision from ticking the last step
 *
 * `complete` takes the capacity snapshot, and the API never retakes it. So
 * closing is its own action with its own button, rather than something that
 * happens when the final checkbox goes green: a snapshot taken because
 * somebody tidied up a checklist is a snapshot of the wrong moment.
 */

export interface ActionSuccess {
  readonly ok: true;
  readonly title: string;
  readonly description: string;
  readonly session: ReviewSession | null;
}

export interface ActionFailure {
  readonly ok: false;
  readonly title: string;
  readonly description: string;
  readonly session: null;
}

export type ActionResult = ActionSuccess | ActionFailure;

function failed(failure: ApiFailure, what: string): ActionFailure {
  const copy = failureCopy(failure, what);
  return { ok: false, title: copy.title, description: copy.description, session: null };
}

function revalidateReview(cadence?: string): void {
  revalidatePath('/review');
  revalidatePath('/review/history');
  if (cadence !== undefined) revalidatePath(`/review/${cadence}`);
}

const openSchema = z.object({ cadence: z.literal(REVIEW_CADENCES) });

export type OpenInput = z.infer<typeof openSchema>;

/**
 * Open a review session.
 *
 * The caller checks for an open session of the same cadence first, so this is
 * not the guard against two concurrent weeklies — it is the write. Two open
 * weeklies is a mess rather than a corruption: the hub lists both and either
 * can be closed.
 */
export async function openReview(input: OpenInput): Promise<ActionResult> {
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That is not a review cadence',
      description: `A review is one of: ${REVIEW_CADENCES.join(', ')}.`,
      session: null,
    };
  }

  const result = await apiFetch({
    path: '/reviews',
    method: 'POST',
    body: { cadence: parsed.data.cadence },
    schema: reviewSessionSchema,
  });

  if (!result.ok) return failed(result, 'this review');

  revalidateReview(parsed.data.cadence);

  return {
    ok: true,
    title: `${parsed.data.cadence} review opened`,
    description: 'It stays open until you close it. Leaving halfway loses nothing.',
    session: result.data,
  };
}

const tickSchema = z.object({
  reviewId: z.string().min(1).max(200),
  cadence: z.literal(REVIEW_CADENCES),
  stepId: z.string().min(1).max(100),
  done: z.boolean(),
});

export type TickInput = z.infer<typeof tickSchema>;

/**
 * Tick or untick one step.
 *
 * Untick is offered as well as tick. A checklist that only goes forward makes
 * a mis-click permanent, and the artefact then claims the review covered
 * ground it did not — which is exactly the distinction the "not covered"
 * section exists to preserve.
 */
export async function tickStep(input: TickInput): Promise<ActionResult> {
  const parsed = tickSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That step cannot be recorded',
      description: 'A tick names one review, one step and whether it is done.',
      session: null,
    };
  }

  // Read what is actually stored, not what the browser last saw. The write
  // below replaces the whole map.
  const current = await apiFetch({
    path: `/reviews/${encodeURIComponent(parsed.data.reviewId)}`,
    schema: reviewSessionSchema,
  });

  if (!current.ok) return failed(current, 'this review');

  const checklist: Record<string, boolean> = {
    ...current.data.checklist,
    [parsed.data.stepId]: parsed.data.done,
  };

  const result = await apiFetch({
    path: `/reviews/${encodeURIComponent(parsed.data.reviewId)}`,
    method: 'PATCH',
    body: { checklist },
    schema: reviewSessionSchema,
  });

  if (!result.ok) return failed(result, 'this review');

  revalidateReview(parsed.data.cadence);

  return {
    ok: true,
    title: parsed.data.done ? 'Step done' : 'Step reopened',
    description: parsed.data.done
      ? 'Recorded as you go, so nothing has to be retyped at the end.'
      : 'Unticked. The artefact will list it as not covered.',
    session: result.data,
  };
}

const decisionSchema = z.object({
  reviewId: z.string().min(1).max(200),
  cadence: z.literal(REVIEW_CADENCES),
  decision: z.string().min(1).max(1000),
});

export type DecisionInput = z.infer<typeof decisionSchema>;

/**
 * Append a decision, in the words it was decided in.
 *
 * Appended as typed — not summarised, not reformatted, not turned into a
 * structured object. A month later the value of the artefact is that it
 * carries the reasoning as it was expressed, and any normalisation here is a
 * paraphrase nobody agreed to.
 *
 * Read-merge-write like the checklist, and for the same reason: `decisions` is
 * a column the API assigns wholesale.
 */
export async function recordDecision(input: DecisionInput): Promise<ActionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That decision cannot be recorded',
      description: 'A decision is between 1 and 1000 characters.',
      session: null,
    };
  }

  const current = await apiFetch({
    path: `/reviews/${encodeURIComponent(parsed.data.reviewId)}`,
    schema: reviewSessionSchema,
  });

  if (!current.ok) return failed(current, 'this review');

  const result = await apiFetch({
    path: `/reviews/${encodeURIComponent(parsed.data.reviewId)}`,
    method: 'PATCH',
    body: { decisions: [...current.data.decisions, parsed.data.decision] },
    schema: reviewSessionSchema,
  });

  if (!result.ok) return failed(result, 'this review');

  revalidateReview(parsed.data.cadence);

  return {
    ok: true,
    title: 'Decision recorded',
    description: 'In the words you wrote it, as part of this session rather than a note elsewhere.',
    session: result.data,
  };
}

const closeSchema = z.object({
  reviewId: z.string().min(1).max(200),
  cadence: z.literal(REVIEW_CADENCES),
});

export type CloseInput = z.infer<typeof closeSchema>;

/**
 * Close the session.
 *
 * This is what takes the per-area capacity snapshot, and the API never retakes
 * it — reopening a closed session leaves the snapshot where it was. What the
 * review saw is part of what the review decided.
 */
export async function closeReview(input: CloseInput): Promise<ActionResult> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That review cannot be closed',
      description: 'Closing names one open review session.',
      session: null,
    };
  }

  const result = await apiFetch({
    path: `/reviews/${encodeURIComponent(parsed.data.reviewId)}`,
    method: 'PATCH',
    body: { complete: true },
    schema: reviewSessionSchema,
  });

  if (!result.ok) return failed(result, 'this review');

  revalidateReview(parsed.data.cadence);

  return {
    ok: true,
    title: 'Review closed',
    description:
      'Per-area capacity as it stood right now is stored with the session, and is never retaken.',
    session: result.data,
  };
}
