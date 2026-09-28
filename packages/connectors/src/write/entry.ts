import type { CalendarDate } from '@prisme/domain';
import type { DocToolClient } from '../doc-tool/types.js';
import { ConnectorError } from '../errors.js';
import type { IdempotencyKey } from './types.js';

/**
 * The editing write path to the document tool — **the only code in this
 * package that can change a page that already exists** (ADR-0034).
 *
 * `./types.ts` and `./create/types.ts` state the rule this file obeys too: what
 * is absent is the specification. So, specifically for editing:
 *
 * | Not here | Why |
 * |---|---|
 * | the page's title, its area relation, its status | prisme owns an objective's title, area and status, and nothing writes them outward yet (docs/11-ownership.md §6). Each would be its own decision, with its own `last_applied` field |
 * | the page's body, or any block | The narrative is the document tool's outright (§6). prisme never writes prose |
 * | any page of a store other than `objectives_db` | The edit capability is that store's alone (`assertEditable`), and the port names no role a caller could change |
 * | a date with a time or a time zone | A period is days |
 *
 * One method. The role is not a parameter — like a page draft's kind, which
 * store an edit may reach is decided here and not by the pass.
 */

/** An objective's period, as the date column of its linked page carries it. */
export interface ObjectivePageDates {
  /** The objective's linked page — `objective.external_page_id`. */
  readonly pageId: string;
  /** The objectives store's date column, chosen on Settings → Notion. Instance data. */
  readonly property: string;
  readonly startsOn: CalendarDate;
  readonly endsOn: CalendarDate;
}

export interface DocumentEntryWriter {
  /**
   * Sets the page's date column to the objective's period.
   *
   * `key` is carried for the audit's sake and **is not sent** — the document
   * tool has no idempotency key, and none is needed: setting a date to a value
   * is the same request however many times it is made.
   */
  setObjectivePageDates(write: ObjectivePageDates, key: IdempotencyKey): Promise<void>;
}

export interface DocToolEntryWriterOptions {
  readonly client: DocToolClient;
}

/**
 * The live editing writer. It wraps `DocToolClient.setEntryDate`, which holds
 * the token, the binding, the retry policy and the three checks made before
 * anything is sent — this adds the one decision the pass must not make: the
 * store is `objectives_db`.
 */
export function createDocToolEntryWriter(options: DocToolEntryWriterOptions): DocumentEntryWriter {
  return {
    setObjectivePageDates(write, _key) {
      return options.client.setEntryDate({
        role: 'objectives_db',
        pageId: write.pageId,
        property: write.property,
        start: write.startsOn,
        end: write.endsOn,
      });
    },
  };
}

/**
 * The editing writer a frozen deployment is handed — the mechanism of
 * `./frozen.ts`, for the reason given there: with `SYNC_WRITE_ENABLED=false`
 * the object in hand cannot reach the document tool at all.
 */
export function createFrozenDocumentEntryWriter(
  reason = 'the write freeze is on',
): DocumentEntryWriter {
  return {
    setObjectivePageDates: () =>
      Promise.reject(
        new ConnectorError('refused', `nothing was written: ${reason}`, {
          tool: 'doc',
          operation: 'set objective page dates',
        }),
      ),
  };
}
