import type { CalendarDate } from '@prisme/domain';
import type { RoleKey, StoreShape } from '../role-key.js';
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
 * ADR-0011's narrative page, as a creation asks for it (ADR-0025, ADR-0030).
 *
 * `role` names **the database** the page is created in, as an entry of its one
 * data source; `templateId` names **which of that database's own templates**
 * the document tool applies to it. The template is resolved by the caller from
 * the live template list, and sent as an identifier — never as "the default" —
 * so that what a plan showed is what is sent (ADR-0030 rule 4).
 *
 * There is no `backlink`, no body and no property but the title. The page's
 * content is the template's, applied by the document tool after the page exists;
 * the body belongs to the document tool the moment the page does
 * (docs/11-ownership.md §3), and a marker, a backlink or a property prisme set
 * would be exactly the ownership leak every other rule here prevents.
 */
export interface CreatePageInput {
  readonly role: RoleKey;
  readonly title: string;
  readonly templateId: string;
}

/**
 * One of a store's templates, as the document tool lists it.
 *
 * `name` is sanitised text a person typed; it is shown on a screen and printed
 * in a plan, and it is instance data like a title — never logged, never
 * committed. `id` is what a creation sends.
 */
export interface DocTemplate {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * What an identifier points at, in words a person recognises.
 *
 * `externalId` is what prisme should **bind** — for a data source pasted as the
 * database that holds it, the resolved data source rather than what was given.
 * `linkId` is what a person **opens**: the database holding the data source,
 * because a data source has no page of its own. Neither is a URL — the tool's page URL identifies the
 * workspace and is never read (docs/17-privacy.md §1).
 */
export interface DocStoreDescription {
  readonly externalId: string;
  readonly title: string;
  readonly linkId: string;
  /**
   * The names of the store's `date`-typed properties, sorted, so a screen can
   * offer one to choose. A name is the workspace's — instance data, like the
   * title. Absent from a description that did not read the schema.
   */
  readonly dateProperties?: readonly string[] | undefined;
}

/**
 * The document tool, as prisme addresses it.
 *
 * The read signatures are the contract in docs/40-workstreams/W03-connectors.md.
 * `since` is the **already-overlapped** floor: callers compute it with
 * `watermarkFloor`, so that the one place the two-minute rule is implemented is
 * the one place it can be tested.
 */
export interface DocToolClient {
  queryByRole(role: RoleKey, since?: Date): Promise<DocRecord[]>;
  /**
   * Reads the title of a store **before** it is bound, which is why it takes an
   * identifier rather than a role. Metadata only: no row, no block, no body.
   */
  describe(externalId: string, shape: StoreShape): Promise<DocStoreDescription>;
  fetchPage(id: string): Promise<DocPage>;
  /**
   * The templates a page store's database holds (ADR-0030 rule 3). One of the
   * three reads the `create` capability carries, and only on a role that
   * carries it — see `assertCreatable`.
   */
  listTemplates(role: RoleKey): Promise<readonly DocTemplate[]>;
  /**
   * Creates an entry in the role's bound database, or returns the live one that
   * already has this title. The only **writing** method on this client, and the
   * reason it exists is ADR-0025 — see the implementation for why the operation
   * is level-triggered rather than keyed.
   */
  createPage(input: CreatePageInput): Promise<DocPage>;
}
