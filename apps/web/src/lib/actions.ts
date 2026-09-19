'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from './api';
import { failureCopy, type ApiFailure } from './api-result';
import {
  FIBONACCI,
  INITIATIVE_STATUSES,
  initiativeSchema,
  type InitiativeStatus,
} from './contracts';

/**
 * Every write the daily surfaces can make, in one place.
 *
 * ## Why server actions rather than fetch from the browser
 *
 * The API is reached with the caller's forwarded assertion, and the middleware
 * that verifies it also refuses a cross-site state change. A server action
 * keeps both properties: the request is a same-origin POST to this
 * application, it passes through the middleware, and the call upstream is made
 * from the server with the header it verified. A `fetch` from the browser
 * straight to the API would need the API's origin in `connect-src`, which is
 * exactly the exfiltration channel the content security policy closes.
 *
 * ## The arguments are parsed here too
 *
 * A server action is a public endpoint — the boundary is the action's
 * arguments, not the form that called it. So each one re-parses what it is
 * given before it builds a request, and none of them spreads a caller's object
 * into a body: every field is named (`apps/api/CLAUDE.md` non-negotiable 2).
 *
 * ## What they return
 *
 * A result, never an exception. Each surface shows the failure in place —
 * beside the row that failed — because an optimistic update that has to be
 * rolled back needs somewhere to say why, and a thrown error in an action is a
 * whole-page error boundary.
 */

export interface ActionSuccess {
  readonly ok: true;
  readonly message: string;
}

export interface ActionFailure {
  readonly ok: false;
  readonly title: string;
  readonly description: string;
}

export type ActionResult = ActionSuccess | ActionFailure;

function failed(failure: ApiFailure, what: string): ActionFailure {
  const copy = failureCopy(failure, what);
  return { ok: false, title: copy.title, description: copy.description };
}

/** The screens that show an initiative, so a change is visible on all of them. */
function revalidateInitiative(id: string): void {
  revalidatePath('/');
  revalidatePath('/backlog');
  revalidatePath('/inbox');
  revalidatePath(`/initiative/${id}`);
}

const estimatesSchema = z.object({
  id: z.string().min(1).max(200),
  value: z.literal(FIBONACCI).optional(),
  timeCriticality: z.literal(FIBONACCI).optional(),
  risk: z.literal(FIBONACCI).optional(),
  size: z.literal(FIBONACCI).optional(),
});

export type EstimatesInput = z.infer<typeof estimatesSchema>;

/**
 * Re-estimate an initiative.
 *
 * This writes the four inputs and **nothing else**. The score that follows is
 * the API's to compute: it recomputes the ranking per request from the active
 * method, and this application has never held a scoring formula
 * (`apps/web/CLAUDE.md` non-negotiable 1, ADR-0006).
 */
export async function saveEstimates(input: EstimatesInput): Promise<ActionResult> {
  const parsed = estimatesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That estimate is not on the scale',
      description: 'Value, time criticality, risk and size are 1, 2, 3, 5, 8 or 13.',
    };
  }

  const { id, ...estimates } = parsed.data;
  const body: Record<string, number> = {};
  if (estimates.value !== undefined) body['value'] = estimates.value;
  if (estimates.timeCriticality !== undefined) body['timeCriticality'] = estimates.timeCriticality;
  if (estimates.risk !== undefined) body['risk'] = estimates.risk;
  if (estimates.size !== undefined) body['size'] = estimates.size;

  if (Object.keys(body).length === 0) return { ok: true, message: 'Nothing changed.' };

  const result = await apiFetch({
    path: `/initiatives/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body,
    schema: initiativeSchema,
  });

  if (!result.ok) return failed(result, 'this initiative');

  revalidateInitiative(id);
  return { ok: true, message: 'Re-scored.' };
}

const transitionSchema = z.object({
  id: z.string().min(1).max(200),
  to: z.enum(INITIATIVE_STATUSES),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * Move an initiative to another status.
 *
 * The guardrails in `./guardrails.ts` have already been shown to the reader by
 * the time this is called, and none of them stops the call: they warn and
 * explain, because a refusal gets worked around and then the model stops
 * describing reality. The one thing this insists on is the reason for a drop,
 * which the API requires too — an unexplained drop is indistinguishable from a
 * deletion six months later.
 */
export async function transitionInitiative(input: {
  id: string;
  to: InitiativeStatus;
  reason?: string;
}): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That is not a status',
      description: 'An initiative moves between the eight statuses in the model.',
    };
  }

  if (parsed.data.to === 'dropped' && parsed.data.reason === undefined) {
    return {
      ok: false,
      title: 'A drop needs a reason',
      description: 'Say in one line what changed. It goes in the event log beside the transition.',
    };
  }

  const body: { to: InitiativeStatus; reason?: string } = { to: parsed.data.to };
  if (parsed.data.reason !== undefined) body.reason = parsed.data.reason;

  const result = await apiFetch({
    path: `/initiatives/${encodeURIComponent(parsed.data.id)}/status`,
    method: 'POST',
    body,
    schema: initiativeSchema,
  });

  if (!result.ok) return failed(result, 'this initiative');

  revalidateInitiative(parsed.data.id);
  return { ok: true, message: `Moved to ${parsed.data.to}.` };
}

/**
 * Move several initiatives at once — the review's bulk step.
 *
 * Sequential rather than parallel, and it reports **what actually happened**
 * rather than the first failure: a bulk action that stops halfway and says
 * "failed" leaves a reader with no idea which six of their eight moved. The
 * event log records each transition separately either way.
 */
export async function transitionMany(
  ids: readonly string[],
  to: InitiativeStatus,
  reason?: string,
): Promise<ActionResult> {
  const moved: string[] = [];
  let firstFailure: ActionFailure | undefined;

  for (const id of ids) {
    const result = await transitionInitiative(
      reason === undefined ? { id, to } : { id, to, reason },
    );
    if (result.ok) moved.push(id);
    else firstFailure ??= result;
  }

  if (firstFailure !== undefined) {
    return {
      ok: false,
      title: `${String(moved.length)} of ${String(ids.length)} moved`,
      description: `${firstFailure.title}: ${firstFailure.description}`,
    };
  }

  return { ok: true, message: `${String(moved.length)} moved to ${to}.` };
}

/**
 * Re-score everything, and append the result to history.
 *
 * The weekly review's *re-score what changed* step. Reading a list never writes
 * a score — a page view is not a decision — so this is the deliberate act that
 * does, with the method and version that produced each number (ADR-0006).
 */
export async function rescoreAll(): Promise<ActionResult> {
  const result = await apiFetch({
    path: '/initiatives/rescore',
    method: 'POST',
    body: {},
    schema: z.object({ scored: z.number().int(), changed: z.number().int() }),
  });

  if (!result.ok) return failed(result, 'the ranking');

  revalidatePath('/');
  revalidatePath('/backlog');
  return {
    ok: true,
    message: `${String(result.data.scored)} scored, ${String(result.data.changed)} changed.`,
  };
}

const syncRunSchema = z.object({
  mode: z.enum(['plan', 'apply']),
  ran: z.boolean(),
  full: z.boolean(),
  counts: z.record(z.string(), z.number().int()),
  applied: z.number().int().nullable(),
  conflicts: z.number().int().nullable(),
  refused: z.string().nullable(),
  failures: z.number().int(),
  drift: z.number().int(),
  // `report` is the rendered plan and carries real titles. It is deliberately
  // not read here: nothing on these screens needs it, and a value nobody reads
  // cannot end up in a log line or a screenshot.
});

/**
 * Force a reconciliation pass — **in `plan` mode, always**.
 *
 * `apply` is the first outward write, and it is gated by a checklist a human
 * works through once (`docs/13-migration.md` §5 step 8, `STATUS.md`). A button
 * on the daily screen that could trigger it would make that gate decorative,
 * so this one reads both tools and reports the diff. The write freeze is
 * deployment configuration either way; the API would refuse an `apply` while it
 * holds, and that refusal is surfaced rather than swallowed.
 */
export async function forceSync(): Promise<ActionResult> {
  const result = await apiFetch({
    path: '/sync',
    method: 'POST',
    body: { mode: 'plan', full: false },
    schema: syncRunSchema,
  });

  if (!result.ok) return failed(result, 'a sync pass');

  revalidatePath('/');

  if (!result.data.ran) {
    return { ok: true, message: 'Another pass was already running; this one was skipped.' };
  }
  if (result.data.refused !== null) {
    return { ok: true, message: `The plan was refused: ${result.data.refused}` };
  }

  const changes = Object.values(result.data.counts).reduce((total, count) => total + count, 0);
  return {
    ok: true,
    message:
      changes === 0
        ? 'Read both tools. Nothing would change.'
        : `Read both tools. ${String(changes)} changes are pending, and nothing was written.`,
  };
}

const promoteSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  areaKey: z.string().min(1).max(64),
  value: z.literal(FIBONACCI),
  timeCriticality: z.literal(FIBONACCI),
  risk: z.literal(FIBONACCI),
  size: z.literal(FIBONACCI),
});

export type PromoteInput = z.infer<typeof promoteSchema>;

/**
 * Promote an action takeaway into an initiative.
 *
 * The title is **written**, not copied: the takeaway's text belongs to the
 * document tool and prisme never holds it (docs/11-ownership.md), which is why
 * this form has an empty title box rather than a pre-filled one. The new
 * initiative lands in the inbox and the takeaway is not modified.
 *
 * A principle is never promotable — it is not a backlog candidate
 * (docs/10-model.md §8) — and the inbox does not offer the action for one.
 */
export async function promoteTakeaway(input: PromoteInput): Promise<ActionResult> {
  const parsed = promoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That cannot be promoted yet',
      description:
        'A promoted takeaway needs a title phrased as a result, an area, and the four estimates.',
    };
  }

  const result = await apiFetch({
    path: `/takeaways/${encodeURIComponent(parsed.data.id)}/promote`,
    method: 'POST',
    body: {
      title: parsed.data.title,
      areaKey: parsed.data.areaKey,
      value: parsed.data.value,
      timeCriticality: parsed.data.timeCriticality,
      risk: parsed.data.risk,
      size: parsed.data.size,
    },
    schema: initiativeSchema,
  });

  if (!result.ok) return failed(result, 'this takeaway');

  revalidatePath('/inbox');
  revalidatePath('/backlog');
  return { ok: true, message: 'Promoted into the inbox as an initiative.' };
}
