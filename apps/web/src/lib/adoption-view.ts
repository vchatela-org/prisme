import {
  QUEUE_WHEN,
  type AdoptRefusal,
  type AdoptionCandidate,
  type AdoptionQueue,
  type QueueWhen,
} from './contracts';
import { pageUrl } from './page-link';

/**
 * Where an adoption candidate can be opened, as a pure function.
 *
 * A row in the queue is a title and a reason, and a title alone is often not
 * enough to decide: two pages can share one, and the page's body is what says
 * whether it is an outcome or a note. So the title opens the object where it
 * lives, whenever the web tier knows how to build a link to it.
 *
 * The links come from the same operator-supplied templates as every other
 * *Open page* in the application (`page-link.ts` says why prisme holds no URL
 * of its own), and so they carry the same two refusals: no template is no link,
 * and an identifier that would change the origin is no link.
 *
 * | Kind | Link |
 * |---|---|
 * | `page` | the document-tool page template |
 * | `project` | the task-tool project template |
 * | `section`, `task` | none — there is no template for either |
 *
 * `undefined` means the title renders as plain text, which is what the queue
 * showed before any template was set.
 */
export function candidateLink(
  candidate: Pick<AdoptionCandidate, 'externalKind' | 'externalId'>,
  links: { readonly page: string | undefined; readonly project: string | undefined },
): CandidateLink | undefined {
  const [template, tool] =
    candidate.externalKind === 'page'
      ? [links.page, 'Notion' as const]
      : candidate.externalKind === 'project'
        ? [links.project, 'Todoist' as const]
        : [undefined, undefined];
  if (tool === undefined) return undefined;
  const href = pageUrl(template, candidate.externalId);
  return href === undefined ? undefined : { href, tool };
}

/** A link to a candidate, and the tool it opens — the link's accessible name says which. */
export interface CandidateLink {
  readonly href: string;
  readonly tool: 'Notion' | 'Todoist';
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** The queue's filters, as the address carries them. */
export interface QueueFilters {
  readonly when: QueueWhen;
  readonly source: string | undefined;
  /** An area key, or {@link NO_AREA}. */
  readonly areaKey: string | undefined;
}

/** The value asking for the candidates outside every mapped area. Not a valid area key. */
export const NO_AREA = '_none';

const SOURCE_PATTERN = /^[a-z_]{1,40}$/;
const AREA_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The filters out of a query string, each one dropped rather than trusted
 * when it is not a shape the API would accept. A hand-edited address shows the
 * default view, not an error.
 */
export function queueFilters(query: Readonly<Record<string, unknown>>): QueueFilters {
  const text = (key: string): string | undefined =>
    typeof query[key] === 'string' ? query[key] : undefined;
  const when = text('when');
  const source = text('source');
  const areaKey = text('areaKey');
  return {
    when:
      when !== undefined && (QUEUE_WHEN as readonly string[]).includes(when)
        ? (when as QueueWhen)
        : 'open',
    source: source !== undefined && SOURCE_PATTERN.test(source) ? source : undefined,
    areaKey:
      areaKey !== undefined && (areaKey === NO_AREA || AREA_PATTERN.test(areaKey))
        ? areaKey
        : undefined,
  };
}

/** The address of the queue with one filter changed; `undefined` clears it. */
export function queueHref(current: QueueFilters, change: Partial<QueueFilters>): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();
  if (next.when !== 'open') params.set('when', next.when);
  if (next.source !== undefined) params.set('source', next.source);
  if (next.areaKey !== undefined) params.set('areaKey', next.areaKey);
  const query = params.toString();
  return query === '' ? '/adoption' : `/adoption?${query}`;
}

export const WHEN_LABELS: Readonly<Record<QueueWhen, string>> = {
  open: 'Not ended',
  current: 'In progress',
  upcoming: 'Upcoming',
  undated: 'No date',
  ended: 'Ended',
  all: 'All',
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  objectives_db: 'Notion · Objectives',
  takeaways_db: 'Notion · Takeaways',
  processes_db: 'Notion · Processes',
  areas_db: 'Notion · Life areas',
  media_db: 'Notion · Media library',
  // A page scanned before its store was recorded — rescan to name it.
  page: 'Notion',
  project: 'Todoist · Projects',
  section: 'Todoist · Sections',
  task: 'Todoist · Tasks',
};

/** Where a candidate was read from, in words. */
export function sourceLabel(key: string): string {
  return SOURCE_LABELS[key] ?? key;
}

/** The key a candidate's source is filtered by — the same rule as the API's. */
export function sourceKey(candidate: Pick<AdoptionCandidate, 'sourceRole' | 'externalKind'>) {
  return candidate.sourceRole ?? candidate.externalKind;
}

/**
 * Why *Adopt* is not offered on a row, in a person's words.
 *
 * The API decides — the queue row carries its `adoptRefusal`, the same rule the
 * write applies — and this only words the code. Each sentence says what to do
 * instead, because a refusal with no next step is a row nobody decides.
 */
const ADOPT_REFUSAL_TEXT: Readonly<Record<AdoptRefusal, string>> = {
  promote_takeaway: 'An action takeaway is promoted from the Inbox, not adopted.',
  needs_objective:
    'A key result needs its objective and a target. Add it under its objective on Objectives; after a Rescan, one with this title in this area is offered as a link.',
  needs_cadence:
    'A ritual needs a cadence and a target. Create it on Rituals; after a Rescan, one with this title in this area is offered as a link, and Link makes this page its process page.',
  not_adoptable: 'This stays where it is: it does not become anything in prisme.',
  no_area:
    'Outside every area. Give it one — a Todoist location on Settings → Areas, or the database’s area column on Settings → Notion — then Rescan.',
  period_not_calendar:
    'Its dates are not exactly one calendar year or one calendar month. Correct them in Notion, then Rescan.',
};

export function adoptRefusalText(refusal: AdoptRefusal): string {
  return ADOPT_REFUSAL_TEXT[refusal];
}

/**
 * A candidate's period, in words: the dates, and where they stand today. Empty
 * for an undated one, which is most of them until a date column is chosen.
 */
export function periodText(
  candidate: Pick<AdoptionCandidate, 'startsOn' | 'endsOn' | 'period'>,
): string {
  if (candidate.startsOn === null || candidate.endsOn === null) return '';
  const dates =
    candidate.startsOn === candidate.endsOn
      ? candidate.startsOn
      : `${candidate.startsOn} → ${candidate.endsOn}`;
  const standing =
    candidate.period === 'ended'
      ? 'ended'
      : candidate.period === 'upcoming'
        ? 'not started'
        : 'in progress';
  return `${dates} · ${standing}`;
}

// ---------------------------------------------------------------------------
// Ignoring everything that has ended
// ---------------------------------------------------------------------------

/** What *Ignore all ended* would send, for the view in the address. */
export interface IgnoreEndedOffer {
  readonly count: number;
  /** The API's digest of that set, echoed back so a stale view is refused. */
  readonly digest: string;
  readonly source: string | undefined;
  readonly areaKey: string | undefined;
}

/**
 * The bulk ignore, offered only where its rows are on the screen: under the
 * *Ended* filter, with at least one row. Elsewhere it would ignore rows the
 * reader is not looking at, which is the one thing a permanent click must not
 * do. The set, its count and its digest are the API's — this only decides
 * whether to offer them.
 */
export function ignoreEndedOffer(
  filters: QueueFilters,
  queue: Pick<AdoptionQueue, 'ignoreEnded'>,
): IgnoreEndedOffer | undefined {
  if (filters.when !== 'ended') return undefined;
  const set = queue.ignoreEnded;
  if (set === undefined || set.count < 1) return undefined;
  return {
    count: set.count,
    digest: set.digest,
    source: filters.source,
    areaKey: filters.areaKey,
  };
}

/** The button: the number is on it, so the click already says how many. */
export function ignoreEndedLabel(count: number): string {
  return count === 1 ? 'Ignore the 1 ended' : `Ignore all ${String(count)} ended`;
}

/**
 * The confirmation, in the words of the single *Ignore*'s: how many, under
 * which filters, and that it is permanent — including the one case that
 * permanence costs, an entry revived later by extending its date. `listed` is
 * how many rows the page draws, so a set longer than the page says so.
 */
export function ignoreEndedConfirmation(
  offer: IgnoreEndedOffer,
  listed: number,
  nameOf: (key: string) => string,
): { readonly title: string; readonly filters: string; readonly description: string } {
  const entries = offer.count === 1 ? '1 ended entry' : `${String(offer.count)} ended entries`;
  const from = offer.source === undefined ? 'Anywhere' : sourceLabel(offer.source);
  const area =
    offer.areaKey === undefined
      ? 'Any'
      : offer.areaKey === NO_AREA
        ? 'Outside every area'
        : nameOf(offer.areaKey);
  const beyond =
    offer.count > listed
      ? ` — ${String(offer.count - listed)} of them beyond the ${String(listed)} listed here`
      : '';
  return {
    title: `Ignore ${entries} permanently?`,
    filters: `Date: ${WHEN_LABELS.ended} · From: ${from} · Area: ${area}`,
    description:
      `Every entry these filters show: ${entries}${beyond}. None will appear in this queue ` +
      'again, and there is no undo — one revived later by extending its date will not come back ' +
      'either. Nothing is deleted: each stays exactly where it is, and can still be adopted ' +
      'later by its identifier.',
  };
}
