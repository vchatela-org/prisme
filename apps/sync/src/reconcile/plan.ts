import type { ExternalTask } from '@prisme/connectors';
import type { TaskPatch } from '@prisme/connectors/write';
import {
  mayCreateExternally,
  mayOverwrite,
  type InitiativeStatus,
  type TaskPriority,
} from '@prisme/domain';
import { composeDescription, firstLine, managedLine } from './description.js';
import {
  hasLabel,
  statusRequestIn,
  statusRequestLabel,
  withLabel,
  withoutLabel,
} from './labels.js';
import { descendantsOf, indexChildren, rollupOf, sameRollup } from './subtree.js';
import {
  ACTION_TAGS,
  lastAppliedKey,
  locationKey,
  type Action,
  type ActionTag,
  type ConflictRecord,
  type DesiredAnchor,
  type DesiredState,
  type LastAppliedIndex,
  type LastAppliedWrite,
  type ObservedState,
  type Operation,
  type Plan,
  type PlannerConfig,
} from './types.js';

/**
 * The planner. **Pure**: `plan(desired, observed, lastApplied, config) → Plan`.
 *
 * Every difficult decision in this application is taken in this file, and
 * nothing in it can read a database, call an API or look at a clock — which is
 * what makes the difficult decisions testable one at a time, against JSON
 * (docs/16-sync.md §3).
 *
 * Four rules govern the whole thing:
 *
 * 1. **Level-triggered.** Everything is decided by comparing full desired state
 *    against full observed state. Nothing here assumes it saw an event
 *    (ADR-0009).
 * 2. **A `create` requires provenance.** Only `origin = 'created_in_prisme'`
 *    with no external reference can produce one. An adopted entity is
 *    structurally incapable of it (ADR-0010, guard 2), and
 *    `plan.adversarial.test.ts` is the executable form of that sentence.
 * 3. **One owner per field.** prisme's fields are converged; the task tool's
 *    are read; the single propagated field — a subtask's priority — moves only
 *    under the overwrite guard (docs/11-ownership.md §5).
 * 4. **Refuse rather than guess.** Anything ambiguous becomes a `review`
 *    action, which writes nothing and asks a human.
 */

/** Statuses at which an initiative has an anchor: `next` and beyond (docs/10-model.md §5). */
const UNANCHORED_STATUSES: ReadonlySet<InitiativeStatus> = new Set<InitiativeStatus>([
  'inbox',
  'later',
]);

/**
 * The priority every task starts at in the task tool.
 *
 * It is the value that means *nobody chose one*, which is why prisme may claim
 * a subtask sitting at it — see {@link mayPropagate}.
 */
const UNSET_PRIORITY: TaskPriority = 'lowest';

const ANCHOR = 'anchor';
const SUBTASK = 'subtask';

function needsAnchor(status: InitiativeStatus): boolean {
  return !UNANCHORED_STATUSES.has(status);
}

/**
 * Whether prisme may write a subtask's priority.
 *
 * The task tool owns this field; prisme propagates into it (docs/11-ownership.md
 * §5, the `⇢` flow). The rule in the specification covers the case where prisme
 * has written before: *only if the current value equals the value prisme last
 * wrote*. {@link mayOverwrite} in the domain package is exactly that rule, and
 * it answers `false` when prisme has never written — correctly, because there
 * is nothing prisme may claim.
 *
 * That leaves the question of how propagation ever starts. It starts on a
 * subtask still sitting at the tool's default priority: there is no decision
 * there to protect, and docs/10-model.md §6 states the promise as *never
 * overriding a priority set by hand*. A subtask at any other priority is
 * someone's choice and is never touched.
 *
 * The known cost: a subtask deliberately set to the lowest priority is
 * indistinguishable from one never prioritised at all, and prisme will claim
 * it once. It then becomes prisme's, and a later hand edit takes it back
 * permanently.
 */
export function mayPropagate(
  task: ExternalTask,
  last: Parameters<typeof mayOverwrite>[1],
): boolean {
  if (last === undefined) return task.priority === UNSET_PRIORITY;
  return mayOverwrite(task.priority, last);
}

/** `null` and an absent value are the same fact to the ledger. */
function value(raw: string | undefined): string | null {
  return raw ?? null;
}

type Verdict = 'skip' | 'update' | 'conflict';

/**
 * How a difference on a prisme-owned field is read.
 *
 * `lastApplied` is the whole mechanism: it is what distinguishes prisme
 * changing its mind (an update) from someone editing prisme's field in the
 * task tool (a conflict). Without it, both look identical and every write
 * would have to be reported as one or the other.
 */
function classify(
  desiredValue: string | null,
  observedValue: string | null,
  lastValue: string | null | undefined,
): Verdict {
  if (desiredValue === observedValue) return 'skip';
  // prisme has never written this field, so nothing was overridden: this is
  // prisme stating its own value for the first time.
  if (lastValue === undefined) return 'update';
  return observedValue === lastValue ? 'update' : 'conflict';
}

interface FieldDiff {
  readonly field: string;
  readonly verdict: Verdict;
  readonly desiredValue: string | null;
  readonly observedValue: string | null;
  readonly detail: string;
  readonly patch: TaskPatch;
}

export function plan(
  desired: DesiredState,
  observed: ObservedState,
  lastApplied: LastAppliedIndex,
  config: PlannerConfig,
): Plan {
  const actions: Action[] = [];
  const tasksById = new Map<string, ExternalTask>();
  for (const task of observed.tasks) tasksById.set(task.externalId, task);
  const children = indexChildren(observed.tasks);

  const boundIds = new Set<string>();
  for (const anchor of desired.anchors) {
    if (anchor.externalAnchorId !== undefined) boundIds.add(anchor.externalAnchorId);
  }

  const lastValueOf = (
    entityKind: string,
    entityId: string,
    field: string,
  ): string | null | undefined =>
    lastApplied.get(lastAppliedKey(entityKind, entityId, field))?.value;

  // Sorted, so two runs over the same state produce the same plan in the same
  // order — a diff a human reads must not reshuffle between runs.
  const anchors = [...desired.anchors].sort((left, right) =>
    left.initiativeId < right.initiativeId ? -1 : left.initiativeId > right.initiativeId ? 1 : 0,
  );

  for (const anchor of anchors) {
    planAnchor(anchor);
  }

  planIntentChannel();

  return { actions, counts: countByTag(actions) };

  // ── one initiative ────────────────────────────────────────────────────────

  function planAnchor(anchor: DesiredAnchor): void {
    if (anchor.externalAnchorId === undefined) {
      planUnlinked(anchor);
      return;
    }

    const task = tasksById.get(anchor.externalAnchorId);
    if (task === undefined) {
      // Never a create. The reference exists, so guard 2 refuses one anyway;
      // saying so out loud is the point of the line.
      actions.push({
        tag: 'review',
        subject: 'anchor',
        initiativeId: anchor.initiativeId,
        externalId: anchor.externalAnchorId,
        title: anchor.title,
        detail: 'linked anchor was not returned by the tool; prisme will not recreate it',
        operations: [],
        lastApplied: [],
      });
      return;
    }

    planFields(anchor, task);
    planCompletion(anchor, task);
    planStatusRequest(anchor, task);
    planSubtree(anchor, task);
  }

  function planUnlinked(anchor: DesiredAnchor): void {
    if (anchor.pendingExternalId !== undefined) {
      planPendingLink(anchor, anchor.pendingExternalId);
      return;
    }

    if (!needsAnchor(anchor.status)) {
      actions.push(skip(anchor, `status ${anchor.status}: no anchor until \`next\``));
      return;
    }

    // ── Guard 2 (ADR-0010) ────────────────────────────────────────────────
    // The only branch in this repository that can produce a `create`. The
    // condition is not restated here: it is `mayCreateExternally` from the
    // domain package, so the planner and the entity layer cannot drift into
    // two different definitions of the same guarantee. Do not widen it.
    if (
      !mayCreateExternally(
        { id: anchor.initiativeId, origin: anchor.origin },
        anchor.externalAnchorId,
      )
    ) {
      actions.push({
        tag: 'review',
        subject: 'initiative',
        initiativeId: anchor.initiativeId,
        title: anchor.title,
        detail:
          'adopted, but nothing is linked to it; the adoption queue owns this, not the planner',
        operations: [],
        lastApplied: [],
      });
      return;
    }

    if (anchor.location === undefined) {
      actions.push({
        tag: 'review',
        subject: 'initiative',
        initiativeId: anchor.initiativeId,
        title: anchor.title,
        detail: 'no area mapping for this initiative, so there is nowhere to create an anchor',
        operations: [],
        lastApplied: [],
      });
      return;
    }

    const description = managedLine(config.baseUrl, anchor.initiativeId);
    actions.push({
      tag: 'create',
      subject: 'anchor',
      initiativeId: anchor.initiativeId,
      title: anchor.title,
      detail: `new anchor, priority ${anchor.priority}${anchor.deadline === undefined ? '' : `, deadline ${anchor.deadline}`}`,
      operations: [
        {
          type: 'create_anchor',
          initiativeId: anchor.initiativeId,
          draft: {
            projectId: anchor.location.projectId,
            ...(anchor.location.sectionId === undefined
              ? {}
              : { sectionId: anchor.location.sectionId }),
            content: anchor.title,
            description,
            labels: [config.anchorLabel],
            priority: anchor.priority,
            ...(anchor.deadline === undefined ? {} : { deadline: anchor.deadline }),
          },
        },
      ],
      // The external id is not known until the create returns, so `apply`
      // resolves these against it.
      lastApplied: [
        { entityKind: ANCHOR, entityId: '', field: 'title', value: anchor.title },
        { entityKind: ANCHOR, entityId: '', field: 'priority', value: anchor.priority },
        { entityKind: ANCHOR, entityId: '', field: 'deadline', value: value(anchor.deadline) },
        { entityKind: ANCHOR, entityId: '', field: 'label', value: 'present' },
        { entityKind: ANCHOR, entityId: '', field: 'description', value: description },
      ],
    });
  }

  function planPendingLink(anchor: DesiredAnchor, externalId: string): void {
    const target = tasksById.get(externalId);
    if (target === undefined) {
      actions.push({
        tag: 'review',
        subject: 'initiative',
        initiativeId: anchor.initiativeId,
        title: anchor.title,
        detail: 'the decided link points at a task the tool did not return',
        operations: [],
        lastApplied: [],
      });
      return;
    }
    if (boundIds.has(externalId)) {
      // Guard 1, in the pure layer: the database would refuse this, and
      // finding it here means a readable plan line instead of a constraint
      // violation halfway through an apply.
      actions.push({
        tag: 'review',
        subject: 'initiative',
        initiativeId: anchor.initiativeId,
        externalId,
        title: anchor.title,
        detail: 'that task is already bound to another initiative',
        operations: [],
        lastApplied: [],
      });
      return;
    }

    // The task's deadline was set by hand before prisme knew it. prisme owns the
    // field from now on, but adopting must not erase it: take it over, so the
    // next pass has nothing to write (G1). A deadline prisme already holds is
    // prisme's decision and is not replaced.
    const takeDeadline = anchor.deadline === undefined && target.deadline !== undefined;

    actions.push({
      tag: 'adopt',
      subject: 'initiative',
      initiativeId: anchor.initiativeId,
      externalId,
      title: anchor.title,
      detail: takeDeadline
        ? `link to the existing task and keep its deadline ${String(target.deadline)} — creates nothing`
        : 'link to the existing task — creates nothing',
      operations: [
        { type: 'bind_ref', initiativeId: anchor.initiativeId, externalId },
        ...(takeDeadline && target.deadline !== undefined
          ? [
              {
                type: 'adopt_deadline' as const,
                initiativeId: anchor.initiativeId,
                deadline: target.deadline,
              },
            ]
          : []),
      ],
      lastApplied: [],
    });
  }

  // ── the fields of a linked anchor ─────────────────────────────────────────

  function planFields(anchor: DesiredAnchor, task: ExternalTask): void {
    const diffs: FieldDiff[] = [];
    const externalId = task.externalId;

    // An anchor at `inbox` or `later` whose priority prisme has never written
    // exists only because an existing task was adopted. Writing "lowest" onto it
    // would erase a priority somebody chose, for a ranking prisme has not made
    // yet (G2) — so it is left alone until the initiative reaches `next`. Once
    // prisme has written it, prisme keeps it: a demoted initiative is lowered.
    const assertsPriority =
      needsAnchor(anchor.status) || lastValueOf(ANCHOR, task.externalId, 'priority') !== undefined;

    const desiredDescription = composeDescription(
      task.description.text,
      managedLine(config.baseUrl, anchor.initiativeId),
    );

    diffs.push(
      diff(
        'title',
        anchor.title,
        task.content,
        lastValueOf(ANCHOR, externalId, 'title'),
        `title → ${anchor.title}`,
        { content: anchor.title },
      ),
      diff(
        'priority',
        assertsPriority ? anchor.priority : task.priority,
        task.priority,
        lastValueOf(ANCHOR, externalId, 'priority'),
        `priority ${task.priority} → ${anchor.priority}`,
        { priority: anchor.priority },
      ),
      diff(
        'deadline',
        value(anchor.deadline),
        value(task.deadline),
        lastValueOf(ANCHOR, externalId, 'deadline'),
        `deadline ${task.deadline ?? 'none'} → ${anchor.deadline ?? 'none'}`,
        { deadline: anchor.deadline ?? null },
      ),
      diff(
        'label',
        'present',
        hasLabel(task.labels, config.anchorLabel) ? 'present' : 'absent',
        lastValueOf(ANCHOR, externalId, 'label'),
        `anchor label restored`,
        { labels: withLabel(task.labels, config.anchorLabel) },
      ),
      diff(
        'description',
        firstLine(desiredDescription),
        firstLine(task.description.text),
        lastValueOf(ANCHOR, externalId, 'description'),
        'backlink and managed-fields marker',
        { description: desiredDescription },
      ),
    );

    const changed = diffs.filter((entry) => entry.verdict !== 'skip');

    for (const entry of changed.filter((candidate) => candidate.verdict === 'conflict')) {
      const conflict: ConflictRecord = {
        entityId: anchor.initiativeId,
        field: entry.field,
        prismeValue: entry.desiredValue,
        externalValue: entry.observedValue,
        resolution: 'prisme_wins',
      };
      actions.push({
        tag: 'conflict',
        subject: 'anchor',
        initiativeId: anchor.initiativeId,
        externalId,
        title: anchor.title,
        detail: `${entry.field} edited externally; prisme owns it — ${entry.detail}`,
        operations: [
          {
            type: 'update_task',
            externalId,
            patch: entry.patch,
            initiativeId: anchor.initiativeId,
          },
        ],
        lastApplied: [
          {
            entityKind: ANCHOR,
            entityId: externalId,
            field: entry.field,
            value: entry.desiredValue,
          },
        ],
        conflict,
        before: { [entry.field]: entry.observedValue },
      });
    }

    const updates = changed.filter((candidate) => candidate.verdict === 'update');
    if (updates.length > 0) {
      const patch = updates.reduce<TaskPatch>(
        (merged, entry) => ({ ...merged, ...entry.patch }),
        {},
      );
      actions.push({
        tag: 'update',
        subject: 'anchor',
        initiativeId: anchor.initiativeId,
        externalId,
        title: anchor.title,
        detail: updates.map((entry) => entry.detail).join('; '),
        operations: [{ type: 'update_task', externalId, patch, initiativeId: anchor.initiativeId }],
        lastApplied: updates.map((entry) => ({
          entityKind: ANCHOR,
          entityId: externalId,
          field: entry.field,
          value: entry.desiredValue,
        })),
        before: Object.fromEntries(updates.map((entry) => [entry.field, entry.observedValue])),
      });
    }

    const moved = planLocation(anchor, task);

    if (changed.length === 0 && !moved) {
      actions.push(skip(anchor, 'anchor matches', externalId));
    }
  }

  function diff(
    field: string,
    desiredValue: string | null,
    observedValue: string | null,
    lastValue: string | null | undefined,
    detail: string,
    patch: TaskPatch,
  ): FieldDiff {
    return {
      field,
      verdict: classify(desiredValue, observedValue, lastValue),
      desiredValue,
      observedValue,
      detail,
      patch,
    };
  }

  /**
   * The anchor's project and section.
   *
   * A section is only enforced when prisme has one to enforce. An initiative
   * whose area maps to a whole project says nothing about sections, and moving
   * a task out of the section someone filed it in would be prisme asserting an
   * opinion it does not hold.
   */
  function planLocation(anchor: DesiredAnchor, task: ExternalTask): boolean {
    const location = anchor.location;
    if (location === undefined) return false;

    const projectDiffers = task.projectId !== location.projectId;
    const sectionDiffers =
      location.sectionId !== undefined && task.sectionId !== location.sectionId;
    if (!projectDiffers && !sectionDiffers) return false;

    // The area's home is where an anchor is *created*. A task already filed in
    // another location of the same area is where somebody put it, and the area
    // is all prisme owns here — so it stays (G3). Only a task outside its area
    // is moved, and a project's location is a claim that is always enforced.
    if (anchor.locationSource !== 'project') {
      const areaHere =
        desired.areaByLocation.get(locationKey(task.projectId, task.sectionId)) ??
        desired.areaByLocation.get(locationKey(task.projectId, undefined));
      if (areaHere === anchor.areaKey) return false;
    }

    const externalId = task.externalId;
    const desiredValue = locationKey(location.projectId, location.sectionId);
    const observedValue = locationKey(task.projectId, task.sectionId);
    const verdict = classify(
      desiredValue,
      observedValue,
      lastValueOf(ANCHOR, externalId, 'location'),
    );
    const record: LastAppliedWrite = {
      entityKind: ANCHOR,
      entityId: externalId,
      field: 'location',
      value: desiredValue,
    };

    actions.push({
      tag: verdict === 'conflict' ? 'conflict' : 'update',
      subject: 'anchor',
      initiativeId: anchor.initiativeId,
      externalId,
      title: anchor.title,
      detail:
        verdict === 'conflict'
          ? 'moved externally out of its area; prisme owns where an anchor lives'
          : 'move into the area’s project',
      operations: [{ type: 'move_task', externalId, location, initiativeId: anchor.initiativeId }],
      lastApplied: [record],
      ...(verdict === 'conflict'
        ? {
            conflict: {
              entityId: anchor.initiativeId,
              field: 'location',
              prismeValue: desiredValue,
              externalValue: observedValue,
              resolution: 'prisme_wins' as const,
            },
          }
        : {}),
    });
    return true;
  }

  /**
   * Completion arrives *inward*. The task tool owns it
   * (docs/11-ownership.md §4), so prisme never writes it and never undoes it —
   * it moves the initiative to `review` and asks for confirmation.
   */
  function planCompletion(anchor: DesiredAnchor, task: ExternalTask): void {
    if (!task.completed) return;
    if (anchor.status === 'review' || anchor.status === 'done' || anchor.status === 'dropped') {
      return;
    }

    actions.push({
      tag: 'review',
      subject: 'initiative',
      initiativeId: anchor.initiativeId,
      externalId: task.externalId,
      title: anchor.title,
      detail: `anchor completed → status ${anchor.status} → review`,
      operations: [
        {
          type: 'set_status',
          initiativeId: anchor.initiativeId,
          from: anchor.status,
          to: 'review',
        },
      ],
      lastApplied: [],
      before: { status: anchor.status },
    });
  }

  /**
   * The intent channel's status request (docs/16-sync.md §4).
   *
   * Applying the status and **removing the label** are one action: the request
   * is consumed by being honoured, which is what keeps the state in exactly one
   * place afterwards.
   */
  function planStatusRequest(anchor: DesiredAnchor, task: ExternalTask): void {
    const requested = statusRequestIn(task.labels, config.statusRequestPrefix);
    if (requested === undefined) return;

    const label = statusRequestLabel(config.statusRequestPrefix, requested);
    const operations: Operation[] = [];
    if (requested !== anchor.status) {
      operations.push({
        type: 'set_status',
        initiativeId: anchor.initiativeId,
        from: anchor.status,
        to: requested,
      });
    }
    operations.push({
      type: 'update_task',
      externalId: task.externalId,
      patch: { labels: withoutLabel(task.labels, label) },
      initiativeId: anchor.initiativeId,
    });

    actions.push({
      tag: 'update',
      subject: 'initiative',
      initiativeId: anchor.initiativeId,
      externalId: task.externalId,
      title: anchor.title,
      detail:
        requested === anchor.status
          ? `status request ${requested} already applied; consuming the label`
          : `status request ${anchor.status} → ${requested}; consuming the label`,
      operations,
      lastApplied: [],
      before: { status: anchor.status },
    });
  }

  /** Priority propagation into the subtree, and the roll-up out of it. */
  function planSubtree(anchor: DesiredAnchor, task: ExternalTask): void {
    const subtree = descendantsOf(children, task.externalId);

    const propagated = subtree.filter(
      (child) =>
        child.priority !== anchor.priority &&
        !child.completed &&
        mayPropagate(child, lastApplied.get(lastAppliedKey(SUBTASK, child.externalId, 'priority'))),
    );

    if (propagated.length > 0) {
      actions.push({
        tag: 'update',
        subject: 'subtree',
        initiativeId: anchor.initiativeId,
        externalId: task.externalId,
        title: anchor.title,
        detail: `${String(propagated.length)} subtask${propagated.length === 1 ? '' : 's'} inherit priority ${anchor.priority}`,
        operations: propagated.map((child) => ({
          type: 'update_task' as const,
          externalId: child.externalId,
          patch: { priority: anchor.priority },
          initiativeId: anchor.initiativeId,
        })),
        lastApplied: propagated.map((child) => ({
          entityKind: SUBTASK,
          entityId: child.externalId,
          field: 'priority',
          value: anchor.priority,
        })),
      });
    }

    const rollup = rollupOf(subtree);
    if (!sameRollup(anchor.rollup, rollup)) {
      actions.push({
        tag: 'update',
        subject: 'prisme',
        initiativeId: anchor.initiativeId,
        externalId: task.externalId,
        title: anchor.title,
        detail: `progress ${anchor.rollup?.progress ?? 0}% → ${rollup.progress}%, ${String(rollup.openTaskCount)} open`,
        operations: [
          {
            type: 'record_rollup',
            initiativeId: anchor.initiativeId,
            areaKey: anchor.areaKey,
            rollup,
            anchorTask: task,
            subtree,
          },
        ],
        lastApplied: [],
      });
    }
  }

  // ── tasks prisme does not know about ──────────────────────────────────────

  /**
   * The inbound half of the intent channel: someone added the anchor label to a
   * task in the task tool, which means *make this an initiative*
   * (docs/16-sync.md §4).
   *
   * It produces an `adopt`, never a `create`: the task already exists, and what
   * is created is a prisme row bound to it.
   */
  function planIntentChannel(): void {
    const candidates = observed.tasks
      .filter(
        (task) =>
          hasLabel(task.labels, config.anchorLabel) &&
          !boundIds.has(task.externalId) &&
          !task.completed,
      )
      .sort((left, right) => left.externalId.localeCompare(right.externalId));

    for (const task of candidates) {
      const areaKey =
        desired.areaByLocation.get(locationKey(task.projectId, task.sectionId)) ??
        desired.areaByLocation.get(locationKey(task.projectId, undefined));

      if (areaKey === undefined) {
        actions.push({
          tag: 'review',
          subject: 'initiative',
          externalId: task.externalId,
          title: task.content,
          detail: 'labelled by hand, but its project maps to no area; prisme will not guess one',
          operations: [],
          lastApplied: [],
        });
        continue;
      }

      actions.push({
        tag: 'adopt',
        subject: 'initiative',
        externalId: task.externalId,
        title: task.content,
        detail: `labelled by hand → initiative in ${areaKey}, status inbox — creates nothing`,
        operations: [
          {
            type: 'capture_initiative',
            externalId: task.externalId,
            title: task.content,
            areaKey,
            ...(task.deadline === undefined ? {} : { deadline: task.deadline }),
          },
        ],
        lastApplied: [],
      });
    }
  }
}

function skip(anchor: DesiredAnchor, detail: string, externalId?: string): Action {
  return {
    tag: 'skip',
    subject: 'anchor',
    initiativeId: anchor.initiativeId,
    ...(externalId === undefined ? {} : { externalId }),
    title: anchor.title,
    detail,
    operations: [],
    lastApplied: [],
  };
}

function countByTag(actions: readonly Action[]): Readonly<Record<ActionTag, number>> {
  const counts = Object.fromEntries(ACTION_TAGS.map((tag) => [tag, 0])) as Record<
    ActionTag,
    number
  >;
  for (const action of actions) counts[action.tag] += 1;
  return counts;
}
