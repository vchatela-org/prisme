import { fuzzyMatch, normalise, similarity } from '@prisme/sync';
import type { ExternalRequest } from '../dto/create.js';
import type { AreaMappingRecord } from '../store/types.js';

/**
 * Every decision a creation flow makes, as pure functions.
 *
 * Nothing here has a clock, a connection or an identifier generator. That is
 * the same split `apps/sync/src/reconcile` makes and for the same reason: the
 * hard part of creating things is *what should exist*, and it is exhaustively
 * testable against JSON as long as no step of it also has to talk to a
 * database.
 *
 * The service above this file does the I/O; this file decides what the I/O is
 * for.
 */

// ---------------------------------------------------------------------------
// Where a new object lives
// ---------------------------------------------------------------------------

export interface ExternalLocation {
  readonly externalProjectId: string;
  readonly externalSectionId?: string | undefined;
}

/**
 * The location a capture's task should be created in.
 *
 * `area_mapping` is many-to-one — several external locations fold into one
 * area — so an area can have more than one, and one of them has to be chosen.
 * The rule is **the most specific mapping, then the first by identifier**:
 * a mapping naming a section is a more deliberate statement about where things
 * go than one naming a whole project, and the tie-break is stable so two
 * captures a second apart do not land in different places.
 *
 * `undefined` when the area is mapped nowhere. That is not a failure to route
 * around with a default — prisme has no idea where the task belongs, and
 * guessing would put somebody's capture in an unrelated project. The caller
 * refuses and says which area needs a mapping.
 */
export function locationForArea(
  areaKey: string,
  mappings: readonly AreaMappingRecord[],
): ExternalLocation | undefined {
  const candidates = mappings
    .filter((mapping) => mapping.areaKey === areaKey)
    .sort((left, right) => {
      const specificity =
        Number(right.externalSectionId !== null) - Number(left.externalSectionId !== null);
      if (specificity !== 0) return specificity;
      if (left.externalProjectId !== right.externalProjectId) {
        return left.externalProjectId < right.externalProjectId ? -1 : 1;
      }
      return (left.externalSectionId ?? '') < (right.externalSectionId ?? '') ? -1 : 1;
    });

  const chosen = candidates[0];
  if (chosen === undefined) return undefined;
  return {
    externalProjectId: chosen.externalProjectId,
    ...(chosen.externalSectionId === null ? {} : { externalSectionId: chosen.externalSectionId }),
  };
}

// ---------------------------------------------------------------------------
// What a creation intends to exist
// ---------------------------------------------------------------------------

export type IntentObjectKind = 'task' | 'project' | 'section' | 'page';

/** One row the ledger is to hold, before it has an id or a key. */
export interface PlannedIntent {
  readonly tool: 'task' | 'document';
  readonly objectKind: IntentObjectKind;
  readonly ordinal: number;
  readonly draft: Readonly<Record<string, unknown>>;
  /**
   * The ordinal of the intent in the same batch this one waits for, or
   * `undefined`. Expressed positionally rather than by id because none of
   * these has an id yet — the store resolves it when it writes the rows.
   */
  readonly requiresIndex?: number | undefined;
}

/**
 * The backlink prisme writes into the first line of anything it creates.
 *
 * Not decoration: it is what makes an object prisme made findable *from* the
 * tool it was made in, which is the only direction a person is ever travelling
 * when they meet one and wonder what it is.
 */
export function backlinkFor(baseUrl: string, path: string): string {
  return `prisme: ${baseUrl.replace(/\/$/, '')}${path}`;
}

export interface CapturePlanInput {
  readonly captureId: string;
  readonly title: string;
  readonly location: ExternalLocation;
  readonly baseUrl: string;
  readonly captureLabel: string;
  readonly page: ExternalRequest;
}

/**
 * A capture: one task, and at most one page.
 *
 * The label is the *capture* label and never the anchor label. Applying the
 * anchor label would make the reconciler adopt this task as an initiative's
 * anchor on its next pass, turning "it stays a task" into a lie one cron
 * interval later.
 */
export function planCapture(input: CapturePlanInput): readonly PlannedIntent[] {
  const intents: PlannedIntent[] = [
    {
      tool: 'task',
      objectKind: 'task',
      ordinal: 0,
      draft: {
        projectId: input.location.externalProjectId,
        ...(input.location.externalSectionId === undefined
          ? {}
          : { sectionId: input.location.externalSectionId }),
        content: input.title,
        description: backlinkFor(input.baseUrl, `/capture/${input.captureId}`),
        labels: [input.captureLabel],
      },
    },
  ];

  if (input.page.mode === 'create') {
    intents.push({
      tool: 'document',
      objectKind: 'page',
      ordinal: 0,
      draft: {
        title: input.title,
        backlink: backlinkFor(input.baseUrl, `/capture/${input.captureId}`),
      },
    });
  }

  return intents;
}

export interface ProjectPlanInput {
  readonly projectId: string;
  readonly name: string;
  readonly sections: readonly string[];
  readonly baseUrl: string;
  readonly taskProject: ExternalRequest;
  readonly page: ExternalRequest;
}

/**
 * A project: a project in the task tool, one section per subtopic in order,
 * and at most one page (ADR-0019).
 *
 * The sections depend on the project, and that is an edge rather than an
 * ordering convention — `requiresIndex` — so the converge pass refuses to
 * create a section whose project is not yet satisfied rather than sending it
 * with an empty parent.
 *
 * When the task-tool project is **linked** rather than created, the sections
 * are still planned: linking says "this project already exists", not "its
 * sections do". Their draft carries no `projectId`, because the converge pass
 * reads it from the entity's own `external_project_id` — which is set either
 * by the link or by the project intent, and is the same field afterwards.
 */
export function planProject(input: ProjectPlanInput): readonly PlannedIntent[] {
  const intents: PlannedIntent[] = [];
  let projectIndex: number | undefined;

  if (input.taskProject.mode === 'create') {
    projectIndex = intents.length;
    intents.push({
      tool: 'task',
      objectKind: 'project',
      ordinal: 0,
      draft: { name: input.name },
    });
  }

  input.sections.forEach((name, index) => {
    intents.push({
      tool: 'task',
      objectKind: 'section',
      ordinal: index,
      draft: { name, order: index },
      ...(projectIndex === undefined ? {} : { requiresIndex: projectIndex }),
    });
  });

  if (input.page.mode === 'create') {
    intents.push({
      tool: 'document',
      objectKind: 'page',
      ordinal: 0,
      draft: {
        title: input.name,
        backlink: backlinkFor(input.baseUrl, `/project/${input.projectId}`),
        fromTemplate: 'project',
      },
    });
  }

  return intents;
}

export interface PagePlanInput {
  readonly entityKind: 'initiative' | 'project' | 'capture';
  readonly entityId: string;
  readonly title: string;
  readonly baseUrl: string;
}

/** ADR-0011's *create page*, on demand, for an entity that already exists. */
export function planPage(input: PagePlanInput): PlannedIntent {
  const path =
    input.entityKind === 'initiative'
      ? `/initiative/${input.entityId}`
      : input.entityKind === 'project'
        ? `/project/${input.entityId}`
        : `/capture/${input.entityId}`;

  return {
    tool: 'document',
    objectKind: 'page',
    ordinal: 0,
    draft: {
      title: input.title,
      backlink: backlinkFor(input.baseUrl, path),
      fromTemplate: input.entityKind,
    },
  };
}

// ---------------------------------------------------------------------------
// Search before create
// ---------------------------------------------------------------------------

export interface SearchCandidate {
  readonly source: 'existing' | 'adoptable';
  readonly kind: 'initiative' | 'project' | 'capture' | 'task' | 'page';
  readonly prismeId: string | null;
  readonly externalId: string | null;
  readonly title: string;
  readonly areaKey: string | null;
}

export interface RankedMatch extends SearchCandidate {
  readonly similarity: number;
  readonly suggests: 'open' | 'adopt';
}

/**
 * How close a match has to be before it is shown at all.
 *
 * Lower than W12's fuzzy threshold on purpose. The adoption queue's number
 * decides whether to *propose a binding*, where a wrong answer silently
 * corrupts a link; this one decides whether to *show a row to a human who is
 * about to type a title anyway*, where a wrong answer costs a glance. The
 * asymmetry is the point — the expensive mistake here is staying silent about
 * a near-duplicate, not mentioning one too many.
 */
export const SEARCH_FLOOR = 0.4;

/**
 * How close a match has to be before the flow says "read this first".
 *
 * This one goes through {@link fuzzyMatch} rather than comparing the score
 * itself, which matters: that function exists so "nowhere in the codebase can
 * apply the threshold without the agreement test", and interrupting somebody
 * is exactly where the test earns its keep. Pure Sørensen–Dice scores
 * `Review the 2026 budget` against `Review the 2027 budget` at 0.90, and a
 * flow that asks "did you mean the 2026 one?" while a person types the 2027
 * one teaches them to dismiss the interruption — after which it protects
 * nothing.
 *
 * The display floor above has no agreement test and does not need one: it
 * populates a list somebody is already looking at, where a weak row costs a
 * glance rather than a wrong link.
 */
export const SEARCH_INTERRUPT = 0.75;

export function rankMatches(
  query: string,
  candidates: readonly SearchCandidate[],
  limit = 8,
): { readonly matches: readonly RankedMatch[]; readonly worthReading: boolean } {
  // `similarity` normalises its own arguments; this guard is about the query
  // being nothing but punctuation, which would match everything at zero.
  if (normalise(query) === '') return { matches: [], worthReading: false };

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      similarity: similarity(query, candidate.title),
      suggests: candidate.source === 'existing' ? ('open' as const) : ('adopt' as const),
    }))
    .filter((match) => match.similarity >= SEARCH_FLOOR)
    .sort((left, right) => {
      if (right.similarity !== left.similarity) return right.similarity - left.similarity;
      // Stable below the score, so the same query twice lists the same way.
      return left.title < right.title ? -1 : left.title > right.title ? 1 : 0;
    })
    .slice(0, limit);

  const worthReading = scored.some(
    (match) => fuzzyMatch(query, match.title, SEARCH_INTERRUPT) !== undefined,
  );

  return { matches: scored, worthReading };
}
