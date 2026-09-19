import type { DocToolClient, RoleKey, TaskToolClient } from '@prisme/connectors';
import { isReadable, ROLE_KEYS } from '@prisme/connectors';
import { adaptDocRecords, adaptProjects, adaptTasks, type AdaptOptions } from './adapt.js';
import { coverage, type CoverageReport } from './coverage.js';
import type { AdoptionStore } from './ports.js';
import { scan, type ScanResult } from './queue.js';
import { formatAdoptionPlan } from './report.js';
import type { ClassifierConfig } from './classify.js';
import type { ExternalObject } from './types.js';

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
 * readings, which are a lane rather than backlog candidates. Everything else is
 * read, and the classifier decides what — if anything — each store's records
 * become.
 */
const SCANNED_ROLES: readonly RoleKey[] = ROLE_KEYS.filter(
  (role) => isReadable(role) && role !== 'media_db',
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
  if (options.docClient !== undefined) {
    for (const role of SCANNED_ROLES) {
      // One store at a time, and a store that is not bound is skipped rather
      // than failing the pass: a workspace that has no processes store is a
      // workspace with no rituals, not a broken configuration.
      const records = await readRole(options.docClient, role);
      if (records === undefined) continue;
      objects.push(...adaptDocRecords(records, adaptOptions));
      docCounts.push(`${role}=${String(records.length)}`);
    }
  }

  const result = scan(
    { objects, targets, decided },
    { ...(options.classifier === undefined ? {} : { classifier: options.classifier }) },
  );
  const report = coverage(auditable, result);

  if (options.persist === true) {
    await options.store.replaceCandidates(result.queue, startedAt);
  }

  const source = [
    `task tool       full read      tasks=${String(snapshot.tasks.length)}   projects=${String(snapshot.projects.length)}`,
    `document tool   ${docCounts.length === 0 ? 'not read' : docCounts.join('   ')}`,
    `prisme          entities=${String(report.entities.total)}   unbound targets=${String(targets.length)}`,
  ];

  return {
    scan: result,
    coverage: report,
    report: formatAdoptionPlan(result, report, { source, mode: 'plan' }),
  };
}

/**
 * Read one store, or `undefined` if it is not bound.
 *
 * An unbound role throws from `createRoleBindings`' resolver, and that is the
 * right behaviour for the reconciler — but here it is a fact about the
 * instance's configuration rather than a failure, and refusing to scan the task
 * tool because a document store is missing would help nobody.
 */
async function readRole(client: DocToolClient, role: RoleKey) {
  try {
    return await client.queryByRole(role);
  } catch {
    // Deliberately swallowed and reported as "not read" rather than logged: the
    // message would carry the role binding, which is instance data.
    return undefined;
  }
}
