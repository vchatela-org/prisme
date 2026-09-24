'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import {
  captureSchema,
  creationIntentSchema,
  FIBONACCI,
  initiativeSchema,
  projectSchema,
  searchSchema,
  type SearchResult,
} from '@/lib/contracts';

/**
 * Every write the creation flows make.
 *
 * Beside the screens rather than in `lib/actions.ts`, as W09, W10 and W11 did:
 * that file holds the daily surfaces' writes, and one module edited by several
 * workstreams is the conflict `apps/web/CLAUDE.md` warns about.
 *
 * ## Nothing here creates anything outward, and the copy says so
 *
 * Every one of these writes prisme rows and, where an external object is
 * wanted, a ledger row recording that. The converge pass makes the object.
 * That is not an implementation detail to hide behind a spinner: a person who
 * captures something and then opens their task tool needs to know whether to
 * expect it yet. So each success message says what exists **now** and what is
 * pending, rather than claiming a task was created.
 *
 * ## Create versus adopt is never inferred
 *
 * `page` and `taskProject` are sent as `{mode}` objects, matching the API's
 * discriminated union. There is deliberately no code path here that turns an
 * empty field into `{mode:'create'}`: forgetting to think about a page and
 * asking for one are different requests, and this tier does not collapse them.
 *
 * Each action re-parses its arguments — a server action is a public endpoint,
 * and the boundary is the argument list rather than the form that called it.
 */

export interface ActionSuccess {
  readonly ok: true;
  readonly title: string;
  readonly description: string;
  /** Where the caller should go next, when there is somewhere. */
  readonly href?: string;
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

/** Everywhere a creation is visible. The ledger most of all. */
function revalidateCreations(): void {
  revalidatePath('/create/creations');
  revalidatePath('/inbox');
  revalidatePath('/backlog');
  revalidatePath('/');
}

const externalRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('create') }),
  z.object({ mode: z.literal('link'), externalId: z.string().min(1).max(200) }),
]);

const captureInputSchema = z.object({
  title: z.string().min(1).max(500),
  areaKey: z.string().min(1).max(64),
  page: externalRequestSchema.default({ mode: 'none' }),
});

export type CaptureInput = z.input<typeof captureInputSchema>;

/**
 * Quick capture: a small thing, decisions deferred.
 *
 * Two fields and a keystroke. There is no estimate here and no status —
 * asking for them is what turns a ten-second capture into a decision, and the
 * decision is what people avoid by not capturing at all.
 */
export async function captureThing(input: CaptureInput): Promise<ActionResult> {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That cannot be captured',
      description: 'A capture needs a line of text and an area to file it under.',
    };
  }

  const result = await apiFetch({
    path: '/captures',
    method: 'POST',
    body: {
      title: parsed.data.title,
      areaKey: parsed.data.areaKey,
      page: parsed.data.page,
    },
    schema: captureSchema,
  });

  if (!result.ok) return failed(result, 'this capture');

  revalidateCreations();

  return {
    ok: true,
    title: 'Captured',
    description:
      'It is in prisme now. The task appears in your task tool on the next pass — it is not scored and will not be ranked, which is the point.',
  };
}

const promoteInputSchema = z.object({
  captureId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  value: z.literal(FIBONACCI),
  timeCriticality: z.literal(FIBONACCI),
  risk: z.literal(FIBONACCI),
  size: z.literal(FIBONACCI),
  areaKey: z.string().min(1).max(64).optional(),
});

export type PromoteInput = z.infer<typeof promoteInputSchema>;

/**
 * This capture is really an initiative.
 *
 * The four estimates are required, and the form collects them here rather
 * than later for the reason the brief gives: "a score assigned later is a
 * score never assigned". The API binds the capture's **existing** task as the
 * new initiative's anchor, so nothing is created — which the copy says,
 * because a person who expects a second task and does not get one should be
 * told that is correct.
 */
export async function promoteCapture(input: PromoteInput): Promise<ActionResult> {
  const parsed = promoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That cannot be promoted yet',
      description:
        'An initiative needs a title phrased as a result, and the four estimates on the 1·2·3·5·8·13 scale.',
    };
  }

  const result = await apiFetch({
    path: `/captures/${encodeURIComponent(parsed.data.captureId)}/promote`,
    method: 'POST',
    body: {
      title: parsed.data.title,
      value: parsed.data.value,
      timeCriticality: parsed.data.timeCriticality,
      risk: parsed.data.risk,
      size: parsed.data.size,
      ...(parsed.data.areaKey === undefined ? {} : { areaKey: parsed.data.areaKey }),
    },
    schema: initiativeSchema,
  });

  if (!result.ok) return failed(result, 'this capture');

  revalidateCreations();
  revalidatePath(`/initiative/${result.data.id}`);

  return {
    ok: true,
    title: 'Promoted',
    description:
      'The initiative is anchored to the task this capture already had. No second task was created, and none will be.',
    href: `/initiative/${result.data.id}`,
  };
}

const initiativeInputSchema = z.object({
  title: z.string().min(1).max(500),
  areaKey: z.string().min(1).max(64),
  projectId: z.string().min(1).max(200).optional(),
  value: z.literal(FIBONACCI),
  timeCriticality: z.literal(FIBONACCI),
  risk: z.literal(FIBONACCI),
  size: z.literal(FIBONACCI),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: externalRequestSchema.default({ mode: 'none' }),
});

export type InitiativeInput = z.input<typeof initiativeInputSchema>;

/**
 * A new initiative, scored at creation.
 *
 * Its anchor task is **not** requested here and is not in the ledger: the
 * reconciler derives it from `origin = created_in_prisme AND external_anchor_id
 * IS NULL` (ADR-0010 guard 2) on its next pass. Asking for it as well would be
 * two systems deciding to make one task.
 *
 * `deadline`, not `due`. There is nowhere on this form for a `due` date and
 * there never will be: prisme writes `deadline`, the task tool owns `due`
 * (ADR-0003).
 */
export async function createInitiative(input: InitiativeInput): Promise<ActionResult> {
  const parsed = initiativeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That initiative cannot be created',
      description:
        'An initiative needs a title phrased as a result, an area, and the four estimates on the 1·2·3·5·8·13 scale.',
    };
  }

  const created = await apiFetch({
    path: '/initiatives',
    method: 'POST',
    body: {
      title: parsed.data.title,
      areaKey: parsed.data.areaKey,
      value: parsed.data.value,
      timeCriticality: parsed.data.timeCriticality,
      risk: parsed.data.risk,
      size: parsed.data.size,
      ...(parsed.data.projectId === undefined ? {} : { projectId: parsed.data.projectId }),
      ...(parsed.data.deadline === undefined ? {} : { deadline: parsed.data.deadline }),
    },
    schema: initiativeSchema,
  });

  if (!created.ok) return failed(created, 'this initiative');

  // A second request rather than a field on the first, because the page is a
  // separate decision with its own endpoint and its own three states. A
  // failure here leaves a created initiative with no page, which is the
  // recoverable half — the button on its detail page asks again.
  if (parsed.data.page.mode !== 'none') {
    const page = await apiFetch({
      path: `/initiatives/${encodeURIComponent(created.data.id)}/page`,
      method: 'POST',
      body: { page: parsed.data.page },
      schema: initiativeSchema,
    });

    if (!page.ok) {
      revalidateCreations();
      return {
        ok: false,
        title: 'Created, but the page was not arranged',
        description:
          'The initiative exists and is scored. Ask for its page again from its detail screen — nothing was lost.',
      };
    }
  }

  revalidateCreations();
  revalidatePath(`/initiative/${created.data.id}`);

  return {
    ok: true,
    title: 'Initiative created',
    description:
      'Scored and in the inbox. Its anchor task appears on the next pass — the reconciler makes it, which is why there can never be two.',
    href: `/initiative/${created.data.id}`,
  };
}

const projectInputSchema = z.object({
  name: z.string().min(1).max(300),
  areaKey: z.string().min(1).max(64),
  sections: z.array(z.string().min(1).max(200)).max(50),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  taskProject: externalRequestSchema.default({ mode: 'none' }),
  page: externalRequestSchema.default({ mode: 'none' }),
});

export type ProjectInput = z.input<typeof projectInputSchema>;

/**
 * A new project — the large-effort shape (ADR-0019).
 *
 * One request, one transaction: the prisme project and every intent it
 * implies. The structure in the external tools follows from the converge
 * pass, and the ledger says how far it has got — which is what makes a
 * half-created project a screen rather than a mystery.
 */
export async function createProject(input: ProjectInput): Promise<ActionResult> {
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That project cannot be created',
      description: 'A project needs a name, an area, and sections of at most 200 characters each.',
    };
  }

  const result = await apiFetch({
    path: '/projects',
    method: 'POST',
    body: {
      name: parsed.data.name,
      areaKey: parsed.data.areaKey,
      sections: parsed.data.sections,
      taskProject: parsed.data.taskProject,
      page: parsed.data.page,
      ...(parsed.data.deadline === undefined ? {} : { deadline: parsed.data.deadline }),
    },
    schema: projectSchema,
  });

  if (!result.ok) return failed(result, 'this project');

  revalidateCreations();
  revalidatePath('/timeline');

  const external =
    parsed.data.taskProject.mode === 'link'
      ? 'It is bound to the project you already had — nothing was created there.'
      : parsed.data.taskProject.mode === 'create'
        ? 'Its project and sections are queued; the converge pass makes them, in order, and the ledger says how far it has got.'
        : 'It has no structure in the task tool. Ask for one from the ledger when you want it.';

  return {
    ok: true,
    title: 'Project created',
    description: `The project exists in prisme. ${external}`,
    href: '/create/creations',
  };
}

const pageRequestInputSchema = z.object({
  initiativeId: z.string().min(1).max(200),
  page: externalRequestSchema,
});

export type PageRequestInput = z.infer<typeof pageRequestInputSchema>;

/**
 * ADR-0011's page button, for an initiative that already exists.
 *
 * `none` is not offered by any caller and the API refuses it: an initiative
 * with no page is already in that state, and a control that accepts it reads
 * as detaching one — which prisme never does.
 */
export async function requestInitiativePage(input: PageRequestInput): Promise<ActionResult> {
  const parsed = pageRequestInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.page.mode === 'none') {
    return {
      ok: false,
      title: 'That is not a page decision',
      description: 'Either create a page, or link one that already exists.',
    };
  }

  const result = await apiFetch({
    path: `/initiatives/${encodeURIComponent(parsed.data.initiativeId)}/page`,
    method: 'POST',
    body: { page: parsed.data.page },
    schema: initiativeSchema,
  });

  if (!result.ok) return failed(result, 'this page');

  revalidateCreations();
  revalidatePath(`/initiative/${parsed.data.initiativeId}`);

  return parsed.data.page.mode === 'link'
    ? {
        ok: true,
        title: 'Page linked',
        description: 'Bound to the page you already had. Nothing was created.',
      }
    : {
        ok: true,
        title: 'Page requested',
        description:
          'Recorded. The converge pass makes it, if this instance has bound where a page of this kind lives — otherwise the plan reports it blocked with that reason (ADR-0025, ADR-0028). Linking an existing one works today.',
      };
}

const retrySchema = z.object({ id: z.string().min(1).max(200) });

/** Queue a failed creation again, under the key it has always carried. */
export async function retryCreation(input: { id: string }): Promise<ActionResult> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, title: 'That is not a creation', description: 'A retry needs its id.' };
  }

  const result = await apiFetch({
    path: `/creations/${encodeURIComponent(parsed.data.id)}/retry`,
    method: 'POST',
    body: {},
    schema: creationIntentSchema,
  });

  if (!result.ok) return failed(result, 'this creation');

  revalidateCreations();

  return {
    ok: true,
    title: 'Queued again',
    description:
      'The same command, under the same key. If the write in fact succeeded the first time, the tool hands back what it made rather than making a second.',
  };
}

/**
 * Look for what the person is about to create.
 *
 * A read, called from a client component as they type. It returns the API's
 * answer unchanged — no re-ranking, no re-thresholding — because a second
 * implementation of the matcher would disagree with the adoption queue's.
 */
export async function searchBeforeCreate(query: string): Promise<SearchResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;

  const result = await apiFetch({
    path: '/search',
    query: { q: trimmed.slice(0, 200) },
    schema: searchSchema,
  });

  // Null rather than an error: this is an advisory read beside a form
  // somebody is typing into, and a failure to look is not a reason to stop
  // them creating.
  return result.ok ? result.data : null;
}
