import type { EntityRefs, Intent } from './types.js';

/**
 * What the converge pass needs from prisme's own database.
 *
 * Note what is **absent**, because the absence is the specification here as
 * much as it is in `packages/connectors/src/write/types.ts`:
 *
 * | Not here | Why |
 * |---|---|
 * | any method that creates an intent | The API decides what should exist. A pass that could add to its own queue could create an object nobody asked for |
 * | any method that deletes one | prisme never destroys an external object, so it never forgets that it made one. A failed intent is abandoned with a reason, never removed |
 * | anything that reads an entity's title | A pass that could read a title could write one outward that the ledger never recorded. It reads external *references* and nothing else |
 *
 * So the pass can drain the queue and record what happened, and it cannot
 * decide what the queue contains.
 */
export interface CreationStore {
  /** Every intent that is not yet satisfied, with its prerequisites. */
  loadOutstanding(): Promise<readonly Intent[]>;

  /** The external references of the entities those intents belong to. */
  loadEntityRefs(entityIds: readonly string[]): Promise<ReadonlyMap<string, EntityRefs>>;

  /**
   * Record a creation that worked: the intent, the entity's own reference
   * column, and `entity_external_ref` — in one transaction.
   *
   * All three together, because each on its own is a lie. The intent alone
   * leaves the entity unbound; the column alone leaves guard 1 unable to
   * refuse a second binding of the same object; the ref alone leaves the
   * ledger about to make a second one.
   */
  recordSatisfied(input: {
    readonly intentId: string;
    readonly externalId: string;
    readonly at: Date;
  }): Promise<void>;

  /**
   * Record a creation that did not work, with prisme's own sentence.
   *
   * **Never the tool's prose** — it quotes the object's own content back
   * (`packages/connectors/src/errors.ts`), and `creation_intent.last_error` is
   * read on a screen.
   */
  recordFailed(input: {
    readonly intentId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
}
