import { docIdKey, type DocPropertyValue } from '@prisme/connectors';

/**
 * Which area a document-tool entry belongs to — ADR-0033, as a pure function.
 *
 * `area_mapping` speaks the task tool's vocabulary (a project, a section), so
 * it has nothing to say about a page. The workspace does: every store points at
 * the Life areas database through a relation, and each prisme area knows its own
 * page there (`area.external_page_id`). An entry's area is read from that
 * relation, by **page identifier**, never by title — a title is a word two areas
 * can share, and a rename would move work between areas silently.
 *
 * The rule, and every other case is *no area*:
 *
 * > exactly one related page, and that page is exactly one area's page.
 *
 * No relation, several, or a page no area names is not a guess waiting to be
 * made. It is an entry the queue shows outside every area, which is the truth,
 * and the same answer ADR-0029 gives a project that spans areas. Identifiers are
 * compared through {@link docIdKey}, because the tool writes one page dashed in
 * a relation and bare in a copied link.
 */

/** Each area's page, by {@link docIdKey}, with every area that names it. */
export type AreaPageIndex = ReadonlyMap<string, readonly string[]>;

export interface AreaPage {
  readonly key: string;
  readonly externalPageId: string | null | undefined;
}

/**
 * Index the areas' pages once per scan.
 *
 * Every area naming a page is kept rather than the last one winning: a page two
 * areas name is ambiguous, and the index has to be able to say so for
 * {@link areaOfRelation} to refuse it. The API refuses to set one up that way;
 * this is the second line of defence, for a value set before it did.
 */
export function indexAreaPages(areas: readonly AreaPage[]): AreaPageIndex {
  const index = new Map<string, string[]>();
  for (const area of areas) {
    const page = area.externalPageId?.trim() ?? '';
    if (page === '') continue;
    const key = docIdKey(page);
    const holders = index.get(key);
    if (holders === undefined) index.set(key, [area.key]);
    else holders.push(area.key);
  }
  return index;
}

/** The area one relation value names, or nothing. */
export function areaOfRelation(
  value: DocPropertyValue | undefined,
  areaByPage: AreaPageIndex,
): string | undefined {
  if (value?.kind !== 'relation') return undefined;
  // The same page written twice is still one page.
  const pages = new Set(value.ids.map(docIdKey));
  if (pages.size !== 1) return undefined;
  const [page] = [...pages];
  const areas = page === undefined ? undefined : areaByPage.get(page);
  return areas?.length === 1 ? areas[0] : undefined;
}
