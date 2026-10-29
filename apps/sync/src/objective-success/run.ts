import { docIdKey, type DocToolClient } from '@prisme/connectors';
import {
  documentSuccessPct,
  documentSuccessScale,
  type DocumentSuccessScale,
} from '@prisme/domain';
import { unreadReason } from '../unread.js';

/**
 * The document tool's own success figure, read into prisme once per pass
 * (ADR-0042).
 *
 * The objectives store keeps a success percentage per objective. It is the
 * document tool's: prisme **reads** it, shows it beside the status when an
 * objective is judged. It never writes it, nothing scores with it, and it
 * changes no status: an objective still open when its window ends is closed
 * as ADR-0037 says, whatever the page says.
 *
 * **Off unless chosen.** Nothing is read until a number property is chosen as
 * the store's success column on Settings → Notion. Unset, the pass clears
 * every figure it read before, so a column given up stops holding objectives
 * open on the next pass.
 *
 * **Level-triggered** (ADR-0009): every pass reads the whole store and
 * rewrites the figure for every objective linked to a page — `null` for a page
 * that is gone, archived or holds no number — so a missed pass or a restored
 * backup converges on the next one.
 *
 * Under `plan` nothing is written (`plan` has no side effects). A failed read
 * leaves the figures stored by the last good pass in place: a store that did
 * not answer says nothing about what its pages hold.
 *
 * prisme's own table only; it runs under the write freeze.
 */

export interface SuccessColumn {
  readonly property: string;
  /** The format the store's last check declared for it. */
  readonly format: string;
}

export interface LinkedObjective {
  readonly id: string;
  readonly pageId: string;
}

export interface ObjectiveSuccessStore {
  /** The objectives store's success column, when one is chosen. */
  loadSuccessColumn(): Promise<SuccessColumn | undefined>;
  /** Every objective with a linked page, whatever its status. */
  loadLinkedObjectives(): Promise<readonly LinkedObjective[]>;
  /** Write the figure read for each objective named, `null` included, with when. */
  recordSuccess(byId: ReadonlyMap<string, number | null>, at: Date): Promise<number>;
  /** Clear every figure: the column was given up. Returns how many were cleared. */
  clearSuccess(): Promise<number>;
}

export interface ObjectiveSuccessOptions {
  readonly mode: 'plan' | 'apply';
  readonly store: ObjectiveSuccessStore;
  readonly docClient: Pick<DocToolClient, 'queryByRole'>;
  readonly now: () => Date;
}

/**
 * What this pass read, for the logs and the tests. Nothing decides on it.
 *
 * - `enabled: false` — no success column: no figure counts, whatever is stored.
 * - `byId` present — the figures read this pass, by objective.
 * - `enabled: true` and no `byId` — not read this pass: use what is stored.
 */
export interface DocumentSuccessReading {
  readonly enabled: boolean;
  readonly byId?: ReadonlyMap<string, number | null> | undefined;
}

export interface ObjectiveSuccessResult {
  readonly reading: DocumentSuccessReading;
  /** Why nothing was read, when nothing was. Safe to log: no instance data. */
  readonly skipped?: string | undefined;
  /** Objectives with a figure of their own this pass. */
  readonly read: number;
  /** Rows written (apply) — 0 under `plan`. */
  readonly written: number;
}

export async function readObjectiveSuccess(
  options: ObjectiveSuccessOptions,
): Promise<ObjectiveSuccessResult> {
  const column = await options.store.loadSuccessColumn();
  const off = async (skipped: string): Promise<ObjectiveSuccessResult> => ({
    reading: { enabled: false },
    skipped,
    read: 0,
    written: options.mode === 'apply' ? await options.store.clearSuccess() : 0,
  });

  if (column === undefined) return off('no success column is chosen on Settings → Notion');

  // The API refuses such a choice; a check that changed the format since is
  // caught here, and refused rather than read on a guessed scale.
  const scale: DocumentSuccessScale | undefined = documentSuccessScale(column.format);
  if (scale === undefined) {
    return off('the success column is neither a percentage nor a plain number');
  }

  const objectives = await options.store.loadLinkedObjectives();
  if (objectives.length === 0) {
    return {
      reading: { enabled: true, byId: new Map() },
      skipped: 'no objective is linked to a page',
      read: 0,
      written: 0,
    };
  }

  let records;
  try {
    records = await options.docClient.queryByRole('objectives_db');
  } catch (error) {
    return {
      reading: { enabled: true },
      skipped: `the objectives store was not read (${unreadReason(error)})`,
      read: 0,
      written: 0,
    };
  }

  const figureByPage = new Map<string, number | null>();
  for (const record of records) {
    if (record.archived) continue;
    const value = record.properties.get(column.property);
    const raw = value?.kind === 'number' ? value.value : null;
    figureByPage.set(docIdKey(record.externalId), documentSuccessPct(raw, scale) ?? null);
  }

  const byId = new Map<string, number | null>();
  for (const objective of objectives) {
    byId.set(objective.id, figureByPage.get(docIdKey(objective.pageId)) ?? null);
  }

  const read = [...byId.values()].filter((figure) => figure !== null).length;
  const written =
    options.mode === 'apply' ? await options.store.recordSuccess(byId, options.now()) : 0;
  return { reading: { enabled: true, byId }, read, written };
}
