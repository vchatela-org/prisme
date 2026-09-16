import type { CalendarDate } from '@prisme/domain';
import type { RoleKey } from '../role-key.js';
import type { SanitisedText } from '../sanitise.js';

/**
 * What the document tool looks like once it has been through the boundary.
 *
 * Two absences are deliberate and worth reading as decisions rather than gaps:
 *
 *   - **No workspace URL.** The tool returns one on every page; it identifies
 *     the workspace, so it is instance data (docs/17-privacy.md §1) and this
 *     package never carries it. A backlink is built from prisme's own base URL.
 *   - **No people, e-mail addresses, phone numbers or file links.** prisme has
 *     no use for any of them, and the first three are the most sensitive thing
 *     in a personal workspace. They map to `not_read`, which records that a
 *     property exists and stops there. A file link is additionally a
 *     time-limited signed URL — storing one is storing a credential.
 */

export type DocPropertyValue =
  | { readonly kind: 'title'; readonly text: SanitisedText }
  | { readonly kind: 'rich_text'; readonly text: SanitisedText }
  | { readonly kind: 'number'; readonly value: number | null }
  | { readonly kind: 'select'; readonly value: string | null }
  | { readonly kind: 'status'; readonly value: string | null }
  | { readonly kind: 'multi_select'; readonly values: readonly string[] }
  | {
      readonly kind: 'date';
      readonly start: CalendarDate | null;
      readonly end: CalendarDate | null;
    }
  | { readonly kind: 'checkbox'; readonly value: boolean }
  | { readonly kind: 'url'; readonly value: string | null }
  | { readonly kind: 'relation'; readonly ids: readonly string[] }
  | { readonly kind: 'created_time'; readonly at: Date }
  | { readonly kind: 'last_edited_time'; readonly at: Date }
  /** Known to prisme, and deliberately not read. The count is all that is kept. */
  | { readonly kind: 'not_read'; readonly externalType: string; readonly count: number }
  /** Not known to prisme. Recorded, never interpreted — a guess here is a wrong value. */
  | { readonly kind: 'unsupported'; readonly externalType: string };

export interface DocRecord {
  readonly role: RoleKey;
  readonly externalId: string;
  /** **Rounded down to the minute by the tool.** The whole reason for the overlap. */
  readonly lastEditedAt: Date;
  readonly createdAt: Date;
  readonly archived: boolean;
  /** From the title-typed property, whatever it happens to be called in this workspace. */
  readonly title: string;
  /** Keyed by the property's name in the workspace — instance data; never logged. */
  readonly properties: ReadonlyMap<string, DocPropertyValue>;
  /** Collected from every text-bearing property. Never fetched. */
  readonly urls: readonly string[];
  readonly contentHash: string;
}

export interface DocBlock {
  readonly externalId: string;
  /** The tool's own block type: `paragraph`, `heading_1`, `to_do`, … */
  readonly type: string;
  /** 0 for a direct child of the page. */
  readonly depth: number;
  readonly text: SanitisedText;
  /** Only for a checkbox-bearing block. */
  readonly checked?: boolean | undefined;
}

export interface DocPage {
  readonly externalId: string;
  readonly title: string;
  readonly lastEditedAt: Date;
  readonly createdAt: Date;
  readonly archived: boolean;
  readonly blocks: readonly DocBlock[];
  /** The body, flattened. What a hash, a search or an agent's context uses. */
  readonly text: string;
  readonly urls: readonly string[];
  /** Block types prisme does not extract text from. Vendor vocabulary, safe to log. */
  readonly skippedBlockTypes: readonly string[];
  readonly contentHash: string;
}

/**
 * The read path to the document tool.
 *
 * The signatures are the contract in docs/40-workstreams/W03-connectors.md.
 * `since` is the **already-overlapped** floor: callers compute it with
 * `watermarkFloor`, so that the one place the two-minute rule is implemented is
 * the one place it can be tested.
 */
export interface DocToolClient {
  queryByRole(role: RoleKey, since?: Date): Promise<DocRecord[]>;
  fetchPage(id: string): Promise<DocPage>;
}
