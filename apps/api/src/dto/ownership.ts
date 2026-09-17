/**
 * The ownership matrix, as HTTP responses.
 *
 * [`docs/11-ownership.md`](../../../../docs/11-ownership.md) is the contract:
 * every field belongs to exactly one of prisme, the document tool or the task
 * tool. This file is the part of that contract a caller can hit — the fields
 * this API knows about and **refuses to write**, each with the sentence that
 * says who owns it instead.
 *
 * ADR-0008 is the decision; apps/api/CLAUDE.md §4 is the instruction: reject
 * with `400` naming the field, rather than accepting the request and dropping
 * the value. A caller that sends `due` and gets `200` has been told that prisme
 * writes `due`. It does not, it never will, and the next thing that happens is
 * a bug report about a date that keeps reverting.
 *
 * Each entry is read by a person at the moment they got something wrong, so it
 * names the owner and cites where to read more. Adding a field to the model
 * means adding it here too — step 3 of docs/11-ownership.md §11.
 */

/** Fields the task tool owns outright, wherever they appear. */
const TASK_TOOL_OWNED = {
  due: 'the task tool owns `due` — it is when you intend to work on something, and prisme never writes it (ADR-0003, docs/11-ownership.md §5)',
  recurrence: 'the task tool owns recurrence (docs/11-ownership.md §5)',
  subtasks:
    'subtasks live in the task tool at any depth and are counted, never mirrored (docs/10-model.md §6)',
  labels: 'labels other than the anchor marker are the task tool’s (docs/11-ownership.md §5)',
} as const;

/** Fields the document tool owns outright. */
const DOCUMENT_TOOL_OWNED = {
  narrative:
    'the document tool owns the prose. prisme holds the link and has nothing to say in it (docs/11-ownership.md §4)',
  body: 'the document tool owns the page body (docs/11-ownership.md §3)',
} as const;

export const AREA_READ_ONLY = {
  key: 'an area key is stable and never changes; rename touches `name` only (docs/10-model.md §3)',
  kind: 'changing an area into a lane would rewrite the meaning of every past capacity measurement (ADR-0014)',
  weightPct:
    'a weight is year-scoped and set at the yearly review — PUT /areas/{key}/weights/{year} (ADR-0007)',
  actualShare: 'derived from the last four weeks of completions (∂, docs/11-ownership.md §2)',
  balanceFactor: 'derived from the target and observed shares (∂, docs/11-ownership.md §2)',
  ...DOCUMENT_TOOL_OWNED,
} as const;

export const AREA_WEIGHT_READ_ONLY = {
  areaKey: 'the area is named by the path, not the body',
  year: 'the year is named by the path. A weight without a year does not exist (ADR-0007)',
} as const;

export const PROJECT_READ_ONLY = {
  origin:
    'immutable after creation: an adopted entity must remain structurally incapable of producing a create (ADR-0010, guard 2)',
  externalPageId: 'set once, at creation or adoption (docs/11-ownership.md §3)',
  externalProjectId: 'set once, at creation or adoption (docs/11-ownership.md §3)',
  ...DOCUMENT_TOOL_OWNED,
} as const;

export const INITIATIVE_READ_ONLY = {
  ...TASK_TOOL_OWNED,
  ...DOCUMENT_TOOL_OWNED,
  origin:
    'immutable after creation: an adopted initiative must remain structurally incapable of producing a create (ADR-0010, guard 2)',
  score:
    'a score is never a column — it is an append-only row carrying the method that produced it (ADR-0006)',
  cod: 'derived by the active scoring method (∂, docs/10-model.md §5)',
  plannedStart: 'computed by the schedule engine (∂, docs/11-ownership.md §4)',
  plannedEnd: 'computed by the schedule engine (∂, docs/11-ownership.md §4)',
  progress: 'derived from the anchor’s subtree (∂, docs/11-ownership.md §4)',
  openTaskCount: 'derived from the anchor’s subtree (∂, docs/11-ownership.md §4)',
  lastActivity: 'derived from the anchor’s subtree (∂, docs/11-ownership.md §4)',
  externalAnchorId:
    'the reconciler binds the anchor; binding it by hand would defeat guard 1 (docs/13-migration.md §2)',
  priority:
    'the anchor’s priority follows from status and rank, and is written outward by the reconciler (docs/12-scoring.md §5)',
  status:
    'a status transition is its own request — POST /initiatives/{id}/status — so the event log records who moved it and why',
  dependsOn:
    'dependencies are replaced as a set — PUT /initiatives/{id}/dependencies — because a partial edit cannot be checked for a cycle',
  doneAt: 'set when the status becomes `done`, and never separately from it',
} as const;

export const INITIATIVE_STATUS_READ_ONLY = {
  doneAt: 'the day it finished is stamped by the transition, not sent with it',
} as const;

export const OBJECTIVE_READ_ONLY = {
  ...DOCUMENT_TOOL_OWNED,
  reflections: 'the document tool owns reflections and review notes (docs/11-ownership.md §6)',
  progressComputed:
    'tasks done ÷ total, shown beside `progressSelf` and never written anywhere (ADR-0013)',
} as const;

export const KEY_RESULT_READ_ONLY = {
  progressComputed:
    'tasks done ÷ total, shown beside `progressSelf` and never written outward. Automating the number destroys the signal the gap carries (docs/10-model.md §7)',
  externalAnchorId: 'the reconciler binds the anchor task (docs/11-ownership.md §6)',
  measurements: 'the series is append-only — POST /key-results/{id}/measurements',
  objectiveId: 'a key result does not move between objectives',
} as const;

export const RITUAL_READ_ONLY = {
  adherence: 'the adherence series is prisme’s own derived metric (∂, docs/11-ownership.md §8)',
  duration:
    'process pages are read-only: prisme writes nothing in the document tool here (ADR-0016)',
  frequency:
    'process pages are read-only: prisme writes nothing in the document tool here (ADR-0016)',
} as const;

export const TAKEAWAY_READ_ONLY = {
  title:
    'the document tool owns the takeaway outright; promotion links to it and never modifies it (docs/11-ownership.md §7)',
  kind: 'the document tool owns the takeaway outright (docs/11-ownership.md §7)',
  ...DOCUMENT_TOOL_OWNED,
  score: 'takeaways are not scored. Only promoted initiatives carry a score (ADR-0013)',
  priority: 'takeaways are not scored. Only promoted initiatives carry a score (ADR-0013)',
} as const;

export const REVIEW_READ_ONLY = {
  capacitySnapshot: 'the snapshot is taken by prisme at the moment the review closes (∂)',
  startedAt: 'stamped when the session is opened',
} as const;

export const SETTINGS_READ_ONLY = {
  syncWriteEnabled:
    'the write freeze is deployment configuration, lifted by a human at docs/13-migration.md §5 step 8 — not by an API call',
  scoringActiveMethod:
    'the active scoring method is deployment configuration; changing it through an API call would leave stored scores unattributable (ADR-0006)',
  databaseUrl: 'not configuration this API reads or reports',
} as const;
