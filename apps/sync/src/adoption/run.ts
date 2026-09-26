import type { DocToolClient, RoleKey, TaskToolClient } from '@prisme/connectors';
import { isReadable, isTemplateRole, ROLE_KEYS } from '@prisme/connectors';
import { adaptDocRecords, adaptProjects, adaptTasks, type AdaptOptions } from './adapt.js';
import { coverage, type CoverageReport } from './coverage.js';
import type { AdoptionStore, TakeawaySeen } from './ports.js';
import { scan, type ScanResult } from './queue.js';
import { formatAdoptionPlan } from './report.js';
import type { ClassifierConfig } from './classify.js';
import type { ExternalObject } from './types.js';
import { documentToolLine, unreadReason, type UnreadReason } from '../unread.js';

/**
 * One adoption pass: read both tools, classify, resolve, report, mirror.
 *
 * **There is no `apply` here, and there cannot be one.** Every scope item in
 * W12 is `plan`-only, and the shape of this module is what enforces it: it
 * takes two *read* clients and one store whose only write is the candidate
 * mirror. There is no writer, so there is nothing to freeze — the write freeze
 * is irrelevant to this path because the path has no outward door at all
 * (docs/13-migration.md §1).
 *
 * Decisions are made by a human in the queue at `/adoption`, one at a time,
 * through the API. That is deliberate: the brief says to keep this `plan`-only
 * "until a human has read a full plan end to end", and a bulk-adopt command run
 * from a terminal is exactly the thing that gets run before the plan is read.
 */

export interface AdoptOptions {
  readonly store: AdoptionStore;
  readonly taskClient: TaskToolClient;
  /** Absent when no document-tool binding is configured. The scan still runs. */
  readonly docClient?: DocToolClient | undefined;
  readonly now: () => Date;
  readonly classifier?: ClassifierConfig | undefined;
  /** Names of the two instance-specific properties the adapter reads. */
  readonly mappingProperty?: string | undefined;
  readonly takeawayTypeProperty?: string | undefined;
  /** Write the candidate mirror. False for a pure question. */
  readonly persist?: boolean | undefined;
}

export interface AdoptResult {
  readonly scan: ScanResult;
  readonly coverage: CoverageReport;
  /** The plan, rendered. **Contains instance data**; print it, never commit it. */
  readonly report: string;
}

/**
 * The document-tool stores worth scanning.
 *
 * `reviews_db` is write-only and `assertReadable` refuses it; `media_db` holds
 * readings, which are a lane rather than backlog candidates; the page stores
 * are not readable at all — ADR-0025 grants them `create` and nothing else —
 * so they fall out on the first condition.
 *
 * The **templates** are the one exclusion worth stating: they are readable, and
 * a scan that walked them would propose adopting a document nobody wrote as a
 * backlog candidate. A template is a page whose blocks get copied; it is
 * neither work nor adoptable.
 */
const SCANNED_ROLES: readonly RoleKey[] = ROLE_KEYS.filter(
  (role) => isReadable(role) && role !== 'media_db' && !isTemplateRole(role),
);

export async function adopt(options: AdoptOptions): Promise<AdoptResult> {
  const startedAt = options.now();

  const [targets, decided, auditable, areaMap] = await Promise.all([
    options.store.loadTargets(),
    options.store.loadDecided(),
    options.store.loadAuditable(),
    options.store.loadAreaMap(),
  ]);

  const adaptOptions: AdaptOptions = {
    areaByLocation: areaMap.areaByLocation,
    laneByArea: areaMap.laneByArea,
    ...(options.mappingProperty === undefined ? {} : { mappingProperty: options.mappingProperty }),
    ...(options.takeawayTypeProperty === undefined
      ? {}
      : { takeawayTypeProperty: options.takeawayTypeProperty }),
  };

  // A full read of both tools (docs/13-migration.md §5, step 3). Level-triggered
  // like every other pass: the candidate set is what the world looks like now,
  // not an accumulation of what it has looked like.
  const snapshot = await options.taskClient.fetchAll();

  const objects: ExternalObject[] = [
    ...adaptTasks(snapshot.tasks, adaptOptions),
    ...adaptProjects(snapshot.projects, snapshot.sections, adaptOptions),
  ];

  const docCounts: string[] = [];
  const docUnread: UnreadReason[] = [];
  let takeaways: TakeawaySeen[] | undefined;
  if (options.docClient !== undefined) {
    for (const role of SCANNED_ROLES) {
      // One store at a time, and a store that is not bound is skipped rather
      // than failing the pass: a workspace that has no processes store is a
      // workspace with no rituals, not a broken configuration.
      const read = await readRole(options.docClient, role);
      if (!read.ok) {
        docUnread.push(read.reason);
        continue;
      }
      const adapted = adaptDocRecords(read.records, adaptOptions);
      objects.push(...adapted);
      docCounts.push(`${role}=${String(read.records.length)}`);
      if (role === 'takeaways_db') {
        // Only a takeaway whose type the instance's property states: an
        // untyped one is neither a principle nor an action, and guessing would
        // be the wrong direction (see `takeawayTypeOf`).
        takeaways = adapted.flatMap((object) =>
          object.takeawayType === undefined || object.closed
            ? []
            : [{ externalPageId: object.externalId, kind: object.takeawayType }],
        );
      }
    }
  }

  const result = scan(
    { objects, targets, decided },
    { ...(options.classifier === undefined ? {} : { classifier: options.classifier }) },
  );
  const report = coverage(auditable, result);

  if (options.persist === true) {
    await options.store.replaceCandidates(result.queue, startedAt);
    if (takeaways !== undefined) await options.store.mirrorTakeaways(takeaways, startedAt);
  }

  const source = [
    `task tool       full read      tasks=${String(snapshot.tasks.length)}   projects=${String(snapshot.projects.length)}`,
    `document tool   ${documentToolLine(docCounts, docUnread)}`,
    `prisme          entities=${String(report.entities.total)}   unbound targets=${String(targets.length)}`,
  ];

  return {
    scan: result,
    coverage: report,
    report: formatAdoptionPlan(result, report, { source, mode: 'plan' }),
  };
}

/** One role's read: the records, or why there are none. */
type RoleRead =
  | { readonly ok: true; readonly records: Awaited<ReturnType<DocToolClient['queryByRole']>> }
  | { readonly ok: false; readonly reason: UnreadReason };

/**
 * Read one store, or say why it could not be read.
 *
 * An unbound role throws from `createRoleBindings`' resolver, and that is the
 * right behaviour for the reconciler — but here it is a fact about the
 * instance's configuration rather than a failure, and refusing to scan the task
 * tool because a document store is missing would help nobody.
 *
 * The **message** stays swallowed and a **reason** comes back in its place: the
 * message names the role binding, which is instance data, while the failure
 * kind is vendor vocabulary that `packages/connectors/src/errors.ts` already
 * rules safe. Before this, an unbound store and a refused read both printed
 * "not read", and the two call for opposite responses.
 */
async function readRole(client: DocToolClient, role: RoleKey): Promise<RoleRead> {
  try {
    return { ok: true, records: await client.queryByRole(role) };
  } catch (error) {
    return { ok: false, reason: unreadReason(error) };
  }
}
