import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import { areaKey, entityId, fibonacci, instant, page } from './common.js';

/**
 * The creation flows (W15): quick capture, and the external objects prisme
 * decides should exist.
 *
 * ## Create versus adopt is a field, not an omission
 *
 * ADR-0011 gives an initiative's page three states — none, create one, link
 * one that already exists — and ADR-0019 gives a project's task-tool structure
 * the same three. Both are modelled here as a **discriminated union with no
 * default**, rather than as an optional `externalPageId` whose absence means
 * "make one".
 *
 * That is the whole of scope item 4. A caller cannot create by forgetting a
 * field, and cannot link by guessing at one: `{"mode":"create"}` and
 * `{"mode":"link","externalId":"…"}` are different sentences, and the request
 * that means neither has to say `{"mode":"none"}` out loud. An optional field
 * would have made "I did not think about the page" and "make me a page"
 * identical on the wire, which is how a workspace fills with empty pages the
 * ADR exists to prevent.
 *
 * ## What a capture is not
 *
 * A capture has no estimates, no status and no score, and none of those is an
 * optional field here. It is a small thing that **stays a task** — the scored
 * unit is the initiative (ADR-0004), and a scored unit nobody scored is how the
 * previous system accumulated its "missing score" backlog. Promotion is a
 * separate, deliberate request, and it is the one that asks for the four
 * estimates.
 */

/** ADR-0011's three states, and ADR-0019's, as one vocabulary. */
export const EXTERNAL_MODES = ['none', 'create', 'link'] as const;

export const externalRequest = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('create') }),
  z.strictObject({ mode: z.literal('link'), externalId: z.string().min(1).max(200) }),
]);

export type ExternalRequest = z.infer<typeof externalRequest>;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export const captureDto = z.object({
  id: entityId,
  title: z.string(),
  areaKey,
  /** Where the task is to live. Resolved from `area_mapping` when captured. */
  externalProjectId: z.string().nullable(),
  externalSectionId: z.string().nullable(),
  /** Null until the converge pass has confirmed the task exists. */
  externalTaskId: z.string().nullable(),
  /** The initiative this became, if it ever did. Most captures never do. */
  promotedTo: entityId.nullable(),
  promotedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});

export const CaptureDto = named('Capture', captureDto);
export const CapturePageDto = named('CapturePage', page(captureDto));

export const createCaptureBody = defineWrite(
  'CreateCapture',
  z.strictObject({
    title: z.string().min(1).max(500),
    areaKey,
    /** A capture is a task. Asking for a page is the one decision it may defer to. */
    page: externalRequest.default({ mode: 'none' }),
  }),
  {
    value: 'a capture is not scored — promote it to an initiative first (ADR-0004)',
    timeCriticality: 'a capture is not scored — promote it to an initiative first (ADR-0004)',
    risk: 'a capture is not scored — promote it to an initiative first (ADR-0004)',
    size: 'a capture is not scored — promote it to an initiative first (ADR-0004)',
    status: 'a capture has no status: it is a task, and the task tool owns its state',
    externalTaskId:
      'the converge pass binds the task it created; binding it by hand would defeat guard 1 (docs/13-migration.md §2)',
    due: 'the task tool owns `due` (ADR-0003)',
    deadline:
      'a deadline prioritizes, and a capture is not ranked. Promote it if the date matters (ADR-0003)',
  },
);

/**
 * Promotion: this capture becomes an initiative, and the initiative **reuses
 * the capture's task** as its anchor.
 *
 * The four estimates are required rather than optional, because this is the
 * moment the decision is cheap and the moment it is normally skipped. There is
 * no `externalAnchorId` here and there cannot be: the anchor is the capture's
 * task, and letting a caller name a different one would be a way to bind an
 * arbitrary object as an anchor without going through the adoption queue.
 */
export const promoteCaptureBody = defineWrite(
  'PromoteCapture',
  z.strictObject({
    /** Rephrased as a result — "fence replaced", not "work on fence". */
    title: z.string().min(1).max(500),
    areaKey: areaKey.optional(),
    projectId: entityId.optional(),
    value: fibonacci,
    timeCriticality: fibonacci,
    risk: fibonacci,
    size: fibonacci,
  }),
  {
    externalAnchorId:
      'promotion reuses the capture’s own task as the anchor — naming another would create a second (ADR-0010, guard 2)',
    origin: 'a promoted capture was created in prisme, and origin is immutable (ADR-0010, guard 2)',
  },
);

/**
 * A project's external structure, decided after the project exists.
 *
 * The same two three-state fields `createProject` carries. Having it as its
 * own request is what makes a half-created project **resumable**: the ledger
 * says which sections are still pending, and this is how a human asks for the
 * rest without creating a second project.
 */
export const projectStructureBody = defineWrite(
  'ProjectStructure',
  z.strictObject({
    taskProject: externalRequest.default({ mode: 'none' }),
    page: externalRequest.default({ mode: 'none' }),
  }),
  {
    sections:
      'the sections are the project’s own ordered list — change them with PATCH /projects/{id}, and this endpoint asks for what is missing',
  },
);

/** ADR-0011's page button, for an entity that already exists. */
export const pageRequestBody = defineWrite(
  'PageRequest',
  z.strictObject({ page: externalRequest }),
  {
    externalPageId:
      'say `{"page":{"mode":"link","externalId":"…"}}` instead: the three states are create, link and none, and an identifier alone cannot say which you mean (ADR-0011)',
  },
);

// ---------------------------------------------------------------------------
// The creation ledger
// ---------------------------------------------------------------------------

export const creationIntentDto = z.object({
  id: entityId,
  entityKind: z.enum(['capture', 'initiative', 'project']),
  entityId,
  tool: z.enum(['task', 'document']),
  objectKind: z.enum(['task', 'project', 'section', 'page']),
  ordinal: z.int(),
  state: z.enum(['pending', 'satisfied', 'failed']),
  /** What it made, once it has. Null while pending and after a failure. */
  externalId: z.string().nullable(),
  attempts: z.int(),
  /**
   * Why the last attempt failed, in prisme's words. Never the tool's prose:
   * that quotes the object's own content back.
   */
  lastError: z.string().nullable(),
  /** What must be satisfied first — a section waits for its project. */
  requires: entityId.nullable(),
  createdAt: instant,
  updatedAt: instant,
  /**
   * Deliberately absent: `draft`. It carries a real title and a real external
   * location, and nothing on a screen needs it — the entity it belongs to has
   * the title already. A field nobody reads cannot reach a log line
   * (docs/17-privacy.md).
   */
});

export const CreationIntentDto = named('CreationIntent', creationIntentDto);
export const CreationIntentPageDto = named('CreationIntentPage', page(creationIntentDto));

// ---------------------------------------------------------------------------
// Search before create
// ---------------------------------------------------------------------------

/**
 * One thing prisme found that might be what you were about to create.
 *
 * Two sources, and the difference is what the reader does about it:
 *
 *   - `existing` — prisme already holds this entity. Open it; creating a second
 *     is the near-duplicate accumulation scope item 4 exists to prevent.
 *   - `adoptable` — the object exists in an external tool and prisme does not
 *     hold it. **Adopt it**, which creates nothing (ADR-0010).
 *
 * `similarity` is computed on the API side by W12's matcher, not in a browser:
 * a second implementation of the ranking would disagree with the adoption
 * queue's, and the two would propose different things about the same pair.
 */
export const searchMatchDto = z.object({
  source: z.enum(['existing', 'adoptable']),
  kind: z.enum(['initiative', 'project', 'capture', 'task', 'page']),
  /** The prisme id for `existing`; null for something prisme does not hold. */
  prismeId: entityId.nullable(),
  externalId: z.string().nullable(),
  title: z.string(),
  areaKey: areaKey.nullable(),
  /** 0–1, from the same Sørensen–Dice matcher the adoption queue uses. */
  similarity: z.number().min(0).max(1),
  /** `open`, `adopt` — what this match invites, in one word. */
  suggests: z.enum(['open', 'adopt']),
});

export const SearchDto = named(
  'SearchResult',
  z.object({
    query: z.string(),
    /** True when at least one match is close enough to be worth reading first. */
    worthReading: z.boolean(),
    matches: z.array(searchMatchDto),
  }),
);
