import type { PageKind } from '../../role-key.js';
import type { IdempotencyKey } from '../types.js';

/**
 * The creating write path — **the only code in this package that can add an
 * object to someone's real workspace.**
 *
 * `../types.ts` is the companion to this file and states the rule both obey:
 * what is absent here is the specification. So read the table there first, and
 * then this one, which is about creation specifically.
 *
 * | Not here | Why |
 * |---|---|
 * | any `delete`, `archive` or `complete` | prisme never destroys an external object. A creation ledger with a rollback would be the one path in this repository able to remove somebody's real work |
 * | creating an *anchor* | `TaskToolWriter.createTask` already does it, emitted only by the reconciler's planner under ADR-0010 guard 2. A second door to the same object is a second way to duplicate it |
 * | creating an area's project | Areas map onto structure that already exists (`area_mapping`). prisme adapts to the workspace; it does not reorganise it (OQ-3) |
 * | `updateProject`, `renameSection` | Once created, the structure is the task tool's. prisme writes the fields docs/11-ownership.md gives it and no others |
 *
 * ## Every method returns an id, and none returns void
 *
 * A creation whose id is lost is exactly the orphan the ledger exists to
 * prevent — an object in the workspace that nothing in prisme points at, found
 * months later by a human wondering what made it. So there is no shape here
 * that can succeed without saying what it made, and the ledger's
 * `satisfied_intents_name_what_they_made` check says the same thing in SQL.
 */

/** A dedicated project in the task tool, for the large-effort shape (ADR-0019). */
export interface ProjectDraft {
  /** prisme owns a project's name (docs/10-model.md §4). */
  readonly name: string;
  /** Nest under an existing project, when the workspace is organised that way. */
  readonly parentId?: string | undefined;
}

/**
 * One section of that project, mirroring a prisme subtopic.
 *
 * `order` is carried rather than inferred from call order: sections are an
 * *ordered* list in prisme, the tool stores the order itself, and a converge
 * pass that resumes half-way would otherwise renumber whatever it created.
 */
export interface SectionDraft {
  readonly projectId: string;
  readonly name: string;
  readonly order: number;
}

/**
 * A task that is **not** an anchor: a capture, which stays a task.
 *
 * Conspicuously without a `priority` and without a `deadline`. A capture is not
 * scored and not scheduled — that is the whole point of the shape — and a
 * priority field here would be a way to give one a rank that no method
 * produced. The anchor label is likewise absent: applying it would make the
 * reconciler adopt this task as an initiative's anchor on its next pass.
 */
export interface LooseTaskDraft {
  readonly projectId: string;
  readonly sectionId?: string | undefined;
  /** What the person typed. prisme owns it, having written it. */
  readonly content: string;
  /** First line is the backlink, so the task says where it came from. */
  readonly description: string;
  /** Never the anchor label — see above. */
  readonly labels: readonly string[];
}

/**
 * A narrative page in the document tool (ADR-0011, ADR-0019, ADR-0025).
 *
 * `kind` rather than a role key: which store a page goes in and which template
 * it copies are prisme's decisions, and a draft carrying role keys would let a
 * caller choose them. The mapping is `PAGE_ROLE_FOR` in `../../role-key.ts`.
 *
 * There is no body here, and that is the design. The page's content is a copy
 * of the template's top-level blocks; a marker, a backlink or a heading of
 * prisme's own would be prisme writing into a body the document tool owns
 * outright (docs/11-ownership.md §3).
 */
export interface PageDraft {
  readonly kind: PageKind;
  /** prisme owns the title of a thing it created. */
  readonly title: string;
}

/**
 * The document tool's creating port.
 *
 * Separate from {@link CreationWriter} rather than a fourth method on it,
 * because the two address different tools with different tokens and different
 * capabilities — and because a single port would force the task-tool writer to
 * implement an operation it cannot perform, which is exactly the shape that
 * ends in a method that throws at run time.
 *
 * One method, and none returning `void`: a creation whose id is lost is the
 * orphan the ledger exists to prevent.
 */
export interface DocumentCreationWriter {
  /**
   * Creates a page, or returns the one that is already there.
   *
   * `key` is carried for the ledger's sake and **is not sent** — the document
   * tool has no idempotency key. The operation is level-triggered instead: it
   * asks whether a page with this title already exists under the parent, which
   * is a question about the world and therefore safe to ask twice (ADR-0009).
   * See `doc-tool/client.ts` for the limitation that carries.
   */
  createPage(draft: PageDraft, key: IdempotencyKey): Promise<{ readonly externalId: string }>;
}

export interface CreationWriter {
  createProject(draft: ProjectDraft, key: IdempotencyKey): Promise<{ readonly externalId: string }>;
  createSection(draft: SectionDraft, key: IdempotencyKey): Promise<{ readonly externalId: string }>;
  createLooseTask(
    draft: LooseTaskDraft,
    key: IdempotencyKey,
  ): Promise<{ readonly externalId: string }>;
}
