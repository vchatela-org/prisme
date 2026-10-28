/**
 * Title normalisation — rule 3 of docs/13-migration.md §3.
 *
 * The rule lives in `@prisme/domain` (`entities/title.ts`), because the
 * key-result hint on an initiative compares titles the same way, and two
 * implementations of "the same title" would drift. These are the names
 * adoption has always used for it.
 */
export {
  exactTitleForm as exactForm,
  foldAccents,
  normaliseTitle as normalise,
  stripLeadingNumbering,
} from '@prisme/domain';
