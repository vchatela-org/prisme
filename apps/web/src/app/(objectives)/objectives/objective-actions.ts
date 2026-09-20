'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import {
  keyResultSchema,
  measurementListSchema,
  objectiveSchema,
  OBJECTIVE_STATUSES,
  OBJECTIVE_TYPES,
} from '@/lib/contracts';

/**
 * Every write the objectives surfaces make.
 *
 * They live beside the screens rather than in `lib/actions.ts` — that file
 * holds the daily surfaces' writes, and four wave-4 agents editing one module
 * is the conflict `apps/web/CLAUDE.md` warns about. W09 and W10 did the same.
 *
 * ## What is deliberately absent
 *
 * There is **no action that writes `progressComputed`**, and there is no
 * endpoint behind one (`apps/api/src/routes/objectives.ts`). It is derived
 * from the task breakdown beneath the anchor; a screen that could set it would
 * be able to close the gap ADR-0013 exists to expose, and the gap is the whole
 * signal.
 *
 * There is **no action that edits or deletes a measurement**. The series is
 * append-only, so a trend exists rather than a current number somebody has
 * tidied up.
 *
 * There is **no action that moves an objective between periods**. The API
 * refuses it and this tier never offers it: an objective that moves months is
 * a different objective, and letting one move makes attainment history
 * meaningless.
 *
 * Each action re-parses its arguments. A server action is a public endpoint —
 * the boundary is the argument list, not the form that called it — and no body
 * here is built by spreading a caller's object.
 */

export interface ActionSuccess {
  readonly ok: true;
  readonly title: string;
  readonly description: string;
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

/**
 * Every surface an objective change is visible on.
 *
 * The monthly review reads objective progress in one of its steps, so a
 * progress write during a review has to reach the wizard too — otherwise the
 * step still shows the number the reviewer just changed.
 */
function revalidateObjectives(id?: string): void {
  revalidatePath('/objectives');
  if (id !== undefined) revalidatePath(`/objectives/${id}`);
  revalidatePath('/review/monthly');
  revalidatePath('/review/quarterly');
  revalidatePath('/review/yearly');
  // The Year Review reports attainment for the year it closes.
  revalidatePath('/review/year');
  revalidatePath('/kpi');
}

const progressSchema = z.object({
  keyResultId: z.string().min(1).max(200),
  objectiveId: z.string().min(1).max(200),
  /** 0–100. The API's `percentage` refuses anything else; so does this. */
  progressSelf: z.number().min(0).max(100),
});

export type ProgressInput = z.infer<typeof progressSchema>;

/**
 * Set self-assessed progress on a key result.
 *
 * By hand, by judgement, which is what ADR-0013 makes it. This is the number
 * that syncs outward; the computed one never does.
 */
export async function setKeyResultProgress(input: ProgressInput): Promise<ActionResult> {
  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That is not a progress value',
      description: 'Self-assessed progress is a whole judgement between 0 and 100.',
    };
  }

  const result = await apiFetch({
    path: `/key-results/${encodeURIComponent(parsed.data.keyResultId)}`,
    method: 'PATCH',
    body: { progressSelf: parsed.data.progressSelf },
    schema: keyResultSchema,
  });

  if (!result.ok) return failed(result, 'this key result');

  revalidateObjectives(parsed.data.objectiveId);

  return {
    ok: true,
    title: 'Progress recorded',
    description:
      'Your judgement is saved. What the breakdown computes is unchanged — the two are never reconciled.',
  };
}

const measurementSchema = z.object({
  keyResultId: z.string().min(1).max(200),
  objectiveId: z.string().min(1).max(200),
  value: z.number(),
  note: z.string().min(1).max(500).optional(),
});

export type MeasurementInput = z.infer<typeof measurementSchema>;

/**
 * Append a measurement to a key result's series.
 *
 * `observedAt` is deliberately not sent: the API stamps it with its own clock.
 * A caller-supplied observation time is a field somebody backdates, and the
 * series stops being a record of when things were known.
 */
export async function addMeasurement(input: MeasurementInput): Promise<ActionResult> {
  const parsed = measurementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That measurement cannot be recorded',
      description: 'A measurement is a number, and a note of at most 500 characters.',
    };
  }

  const result = await apiFetch({
    path: `/key-results/${encodeURIComponent(parsed.data.keyResultId)}/measurements`,
    method: 'POST',
    body: {
      value: parsed.data.value,
      ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
    },
    schema: measurementListSchema,
  });

  if (!result.ok) return failed(result, 'this measurement');

  revalidateObjectives(parsed.data.objectiveId);

  return {
    ok: true,
    title: 'Measurement appended',
    description:
      'The series is append-only, so this becomes part of the trend rather than replacing it.',
  };
}

const objectiveStatusSchema = z.object({
  objectiveId: z.string().min(1).max(200),
  status: z.literal(OBJECTIVE_STATUSES),
});

export type ObjectiveStatusInput = z.infer<typeof objectiveStatusSchema>;

/** Move an objective through its lifecycle — including calling it missed. */
export async function setObjectiveStatus(input: ObjectiveStatusInput): Promise<ActionResult> {
  const parsed = objectiveStatusSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That is not an objective status',
      description: `An objective is one of: ${OBJECTIVE_STATUSES.join(', ')}.`,
    };
  }

  const result = await apiFetch({
    path: `/objectives/${encodeURIComponent(parsed.data.objectiveId)}`,
    method: 'PATCH',
    body: { status: parsed.data.status },
    schema: objectiveSchema,
  });

  if (!result.ok) return failed(result, 'this objective');

  revalidateObjectives(parsed.data.objectiveId);

  return {
    ok: true,
    title: `Marked ${parsed.data.status}`,
    description:
      parsed.data.status === 'missed'
        ? 'Recorded as missed rather than quietly dropped — a missed objective is the one worth reading next year.'
        : 'The objective’s status is updated.',
  };
}

const authorSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.literal(OBJECTIVE_TYPES),
  period: z.string().regex(/^\d{4}(-\d{2})?$/, 'YYYY for a year, YYYY-MM for a month'),
  areaKey: z.string().min(1).max(100),
});

export type AuthorInput = z.infer<typeof authorSchema>;

/**
 * Author an objective for a period.
 *
 * The API refuses an annual objective with a month in its period and vice
 * versa; the same pairing is checked here so the message arrives before the
 * round trip rather than as a 400 the form has to translate.
 */
export async function authorObjective(input: AuthorInput): Promise<ActionResult> {
  const parsed = authorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That objective cannot be authored',
      description: 'An objective needs a title, an area, and a period of the right shape.',
    };
  }

  const monthly = parsed.data.period.includes('-');
  if (monthly !== (parsed.data.type === 'monthly')) {
    return {
      ok: false,
      title: 'The period does not match the type',
      description:
        'An annual objective takes a period like 2026; a monthly one takes 2026-03. The pairing is fixed at authoring and cannot be changed afterwards.',
    };
  }

  const result = await apiFetch({
    path: '/objectives',
    method: 'POST',
    body: {
      title: parsed.data.title,
      type: parsed.data.type,
      period: parsed.data.period,
      areaKey: parsed.data.areaKey,
    },
    schema: objectiveSchema,
  });

  if (!result.ok) return failed(result, 'this objective');

  revalidateObjectives(result.data.id);

  return {
    ok: true,
    title: 'Objective authored',
    description:
      'It has no key results yet, so nothing measures it. Add at least one before the period starts.',
  };
}

const keyResultInputSchema = z.object({
  objectiveId: z.string().min(1).max(200),
  statement: z.string().min(1).max(500),
  target: z.number(),
  unit: z.string().min(1).max(50),
});

export type KeyResultInput = z.infer<typeof keyResultInputSchema>;

/**
 * Add a key result to an objective.
 *
 * `servedBy` is not set here and the form does not ask for it: at authoring
 * time the work usually does not exist yet, and an empty `servedBy` is what
 * makes the objective show up in the orphan list until something is linked to
 * it. Pre-filling it would hide exactly the finding the monthly review wants.
 */
export async function addKeyResult(input: KeyResultInput): Promise<ActionResult> {
  const parsed = keyResultInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That key result cannot be added',
      description: 'A key result needs a statement, a numeric target and a unit.',
    };
  }

  const result = await apiFetch({
    path: `/objectives/${encodeURIComponent(parsed.data.objectiveId)}/key-results`,
    method: 'POST',
    body: {
      statement: parsed.data.statement,
      target: parsed.data.target,
      unit: parsed.data.unit,
    },
    schema: keyResultSchema,
  });

  if (!result.ok) return failed(result, 'this key result');

  revalidateObjectives(parsed.data.objectiveId);

  return {
    ok: true,
    title: 'Key result added',
    description:
      'Nothing serves it yet, so it will appear as an orphan until work is linked to it.',
  };
}

const linkSchema = z.object({
  keyResultId: z.string().min(1).max(200),
  objectiveId: z.string().min(1).max(200),
  servedBy: z.array(z.string().min(1).max(200)).max(50),
});

export type LinkInput = z.infer<typeof linkSchema>;

/**
 * Set which initiatives serve a key result.
 *
 * The whole list is sent rather than a delta, because `servedBy` is a set the
 * API replaces wholesale — a delta would need this tier to know what it last
 * saw, and two tabs would then disagree about the membership.
 */
export async function setServedBy(input: LinkInput): Promise<ActionResult> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That link cannot be saved',
      description: 'A key result is served by a list of initiatives.',
    };
  }

  const result = await apiFetch({
    path: `/key-results/${encodeURIComponent(parsed.data.keyResultId)}`,
    method: 'PATCH',
    body: { servedBy: parsed.data.servedBy },
    schema: keyResultSchema,
  });

  if (!result.ok) return failed(result, 'this key result');

  revalidateObjectives(parsed.data.objectiveId);
  revalidatePath('/backlog');

  return {
    ok: true,
    title: 'Link saved',
    description:
      parsed.data.servedBy.length === 0
        ? 'Nothing serves this key result now, so it will appear in the orphan list.'
        : 'The objective is connected to the work that moves it.',
  };
}
