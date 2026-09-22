import type { DocToolClient } from '@prisme/connectors';
import type { RitualRecord } from './types.js';

/**
 * The middle tier of the duration preference order: the declared duration of
 * the matching process page.
 *
 * ### What "matching" means
 *
 * It means the **ritual**, and nothing else. A ritual binds a process page
 * (`ritual.external_page_id`) to a recurring task (`entity_external_ref`), so
 * the join page → ritual → task exists structurally and needs no titles. That
 * matters twice over: title matching against a live workspace is the thing
 * W12's rule 4 showed is hard to get right, and a real task title is instance
 * data this application would then be holding in order to compare it.
 *
 * Recurring upkeep that is *not* a ritual therefore has no reachable process
 * page, and falls through to the configured default. That is a real limit, and
 * the run reports the resulting share rather than hiding it.
 *
 * ### Two ways the tier still comes back empty
 *
 * The gap this module was written inside — nothing loaded the role bindings, so
 * it had no client and could never reach three tiers — is closed (`bindings.ts`;
 * the loader `main.ts` calls). What remains is not the same thing, and the
 * difference is the point:
 *
 *   - **A client whose bindings do not name `processes_db`.** A role with no
 *     binding is not addressable, the client throws `unbound_role`, and the
 *     caller reports "not read". An instance that has bound only some roles
 *     scans what it has rather than failing a pass over a store it never
 *     claimed (W12's finding).
 *   - **No `DOCTOOL_DURATION_PROPERTY`.** Reading the property is the whole
 *     tier; without the name there is nothing to ask the page for. Unset is not
 *     a broken deployment, and the report says so rather than passing a
 *     two-tier estimate off as a three-tier one.
 *
 * Either one leaves `read` false, the map empty and the preference order
 * two-tier — which is why the result carries the flag rather than the caller
 * inferring it from an empty map, where "not read" and "read, found nothing"
 * would be indistinguishable.
 *
 * prisme **writes nothing here**. The document tool owns process pages outright
 * (ADR-0016) and this is a read of two properties.
 */

export interface ProcessDurationOptions {
  readonly docClient?: DocToolClient | undefined;
  /**
   * The name of the duration property in this workspace.
   *
   * Instance data, so it arrives as configuration: the document tool keys its
   * properties by whatever they happen to be called, and no name may be
   * compiled into this repository (docs/17-privacy.md).
   */
  readonly durationProperty?: string | undefined;
}

export interface ProcessDurations {
  /** External task id → declared minutes. Empty when the tool is not read. */
  readonly byTask: ReadonlyMap<string, number>;
  /** Whether the document tool was read at all. */
  readonly read: boolean;
  /**
   * Pages carrying the named property with a value prisme refused to interpret.
   *
   * Counted, never guessed at. A duration held as free text says "45 min" in
   * one row and "trois quarts d'heure" in the next, and a parser that gets the
   * second one wrong is worse than a default that is honestly a default.
   */
  readonly unreadable: number;
}

const EMPTY: ProcessDurations = { byTask: new Map(), read: false, unreadable: 0 };

export async function declaredMinutesFromProcesses(
  rituals: readonly RitualRecord[],
  options: ProcessDurationOptions,
): Promise<ProcessDurations> {
  const { docClient, durationProperty } = options;
  if (docClient === undefined || durationProperty === undefined) return EMPTY;

  const records = await readProcesses(docClient);
  if (records === undefined) return EMPTY;

  const minutesByPage = new Map<string, number>();
  let unreadable = 0;

  for (const record of records) {
    const property = record.properties.get(durationProperty);
    if (property === undefined) continue;

    // A number, and only a number. Anything else is a shape this code does not
    // know, and guessing at one produces a silently wrong measurement rather
    // than a visibly missing one (packages/connectors/CLAUDE.md §3).
    if (property.kind !== 'number' || property.value === null || property.value < 0) {
      unreadable += 1;
      continue;
    }

    minutesByPage.set(record.externalId, property.value);
  }

  const byTask = new Map<string, number>();
  for (const ritual of rituals) {
    if (ritual.externalTaskId === undefined || ritual.externalPageId === undefined) continue;
    const minutes = minutesByPage.get(ritual.externalPageId);
    if (minutes !== undefined) byTask.set(ritual.externalTaskId, minutes);
  }

  return { byTask, read: true, unreadable };
}

/**
 * Read the processes store, or `undefined` if it is not bound.
 *
 * Swallowed deliberately and reported as "not read" rather than logged, exactly
 * as `adoption/run.ts` does it: the message would carry the role binding, which
 * is instance data.
 */
async function readProcesses(client: DocToolClient) {
  try {
    return await client.queryByRole('processes_db');
  } catch {
    return undefined;
  }
}
