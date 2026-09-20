import type { CreationIntent, SearchMatch } from './contracts';

/**
 * Every decision the creation screens make, as pure functions.
 *
 * The same rule as `focus-view.ts`, `timeline-view.ts` and `review-wizard.ts`:
 * nothing here computes a score, a date or a similarity — those come from the
 * API — and everything here is about what a *reader* should be shown and
 * offered. Extracted so it can be tested without a browser, which is the only
 * way these branches get exercised at all.
 */

// ---------------------------------------------------------------------------
// ADR-0011's three states
// ---------------------------------------------------------------------------

export type PageState = 'absent' | 'present' | 'requested';

/**
 * Which of the page button's states an entity is in.
 *
 * ADR-0011 gives three — no page, page exists, page exists elsewhere — and
 * says the button's state is "derived from `external_page_id`, so it is always
 * accurate without extra bookkeeping". W15 adds a fourth fact the ADR could
 * not have: a page can be **requested and not yet made**, because creating one
 * is no longer synchronous.
 *
 * That is `requested`, and it is not a fourth *choice* — it offers nothing,
 * because the thing to do about it is wait. Rendering it as `absent` would
 * show a *Create page* button that enqueues a second intent every time it is
 * pressed, which is exactly how a person makes four pages for one initiative.
 */
export function pageStateOf(
  externalPageId: string | null,
  intents: readonly CreationIntent[],
): PageState {
  if (externalPageId !== null) return 'present';
  const requested = intents.some(
    (intent) => intent.objectKind === 'page' && intent.state !== 'satisfied',
  );
  return requested ? 'requested' : 'absent';
}

// ---------------------------------------------------------------------------
// A project's sections
// ---------------------------------------------------------------------------

/**
 * The ordered subtopics, from one text box.
 *
 * A line each, rather than a repeater with add and remove buttons: a person
 * listing the parts of a renovation types six lines in ten seconds and
 * rearranges them by editing text. The repeater is the more obvious control
 * and is slower for the thing it is for.
 *
 * Blank lines are dropped and duplicates are refused rather than deduplicated
 * silently — two sections with one name are two places to put the same work,
 * and prisme cannot tell them apart afterwards because a section's identity
 * here is its position and its name.
 */
export interface SectionParse {
  readonly sections: readonly string[];
  readonly duplicate?: string | undefined;
}

export function parseSections(text: string): SectionParse {
  const sections: string[] = [];
  const seen = new Set<string>();

  for (const line of text.split('\n')) {
    const name = line.trim();
    if (name === '') continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return { sections, duplicate: name };
    seen.add(key);
    sections.push(name);
  }

  return { sections };
}

// ---------------------------------------------------------------------------
// Reading the creation ledger
// ---------------------------------------------------------------------------

export interface LedgerSummary {
  readonly pending: number;
  readonly failed: number;
  readonly satisfied: number;
  /**
   * Intents nothing will ever make without a decision elsewhere — today, every
   * page, because the document tool has no addressable store for one
   * (ADR-0025). Counted apart from `pending` because "waiting for the next
   * pass" and "waiting for a human to accept an ADR" are different states and
   * only one of them resolves on its own.
   */
  readonly waitingOnADecision: number;
}

export function summariseLedger(intents: readonly CreationIntent[]): LedgerSummary {
  let pending = 0;
  let failed = 0;
  let satisfied = 0;
  let waitingOnADecision = 0;

  for (const intent of intents) {
    if (intent.state === 'satisfied') {
      satisfied += 1;
      continue;
    }
    if (intent.state === 'failed') {
      failed += 1;
      continue;
    }
    if (intent.tool === 'document') waitingOnADecision += 1;
    else pending += 1;
  }

  return { pending, failed, satisfied, waitingOnADecision };
}

/**
 * What a reader should do about one ledger row, in a sentence.
 *
 * The distinction that matters is **retryable versus not**. A failed task
 * creation is worth another go; a page intent is not, and offering a retry
 * button for it would be an invitation to press it forever.
 */
export function ledgerAdvice(intent: CreationIntent): {
  readonly sentence: string;
  readonly retryable: boolean;
} {
  if (intent.state === 'satisfied') {
    return { sentence: 'Made, and linked to the thing that asked for it.', retryable: false };
  }

  if (intent.state === 'failed') {
    return {
      sentence:
        'The last attempt did not work. Retrying sends the same command under the same key, so a write that in fact succeeded binds what it made rather than making a second.',
      retryable: true,
    };
  }

  if (intent.tool === 'document') {
    return {
      sentence:
        'Recorded, and waiting on a decision rather than on a pass: prisme has nowhere addressable to create a page (ADR-0025). Linking an existing page works today.',
      retryable: false,
    };
  }

  if (intent.requires !== null) {
    return {
      sentence: 'Waiting for the thing it belongs to. The next pass takes them in order.',
      retryable: false,
    };
  }

  return { sentence: 'Queued. The next converge pass will make it.', retryable: false };
}

// ---------------------------------------------------------------------------
// Search before create
// ---------------------------------------------------------------------------

/**
 * Where a match leads.
 *
 * `adoptable` always goes to the queue rather than to a deep link, because the
 * decision is the queue's: adopting is one of three choices a human makes
 * there, and jumping past it would be prisme adopting on their behalf.
 */
export function matchHref(match: SearchMatch): string {
  if (match.source === 'adoptable') return '/adoption';
  if (match.prismeId === null) return '/backlog';
  if (match.kind === 'project') return `/backlog?projectId=${encodeURIComponent(match.prismeId)}`;
  if (match.kind === 'capture') return '/create/creations';
  return `/initiative/${encodeURIComponent(match.prismeId)}`;
}

/** `0.87` → `87%`. Displayed, never compared against. */
export function similarityLabel(similarity: number): string {
  return `${String(Math.round(similarity * 100))}%`;
}

/**
 * The line shown above the matches.
 *
 * Deliberately different wording for the two cases. A near-certain match is
 * worth stopping for; a list of loose ones is worth a glance and no more, and
 * phrasing both as a warning is how a person learns to dismiss the warning.
 */
export function searchHeadline(worthReading: boolean, count: number): string {
  if (count === 0) return 'Nothing like this exists yet.';
  if (worthReading) {
    return 'This looks like something that already exists. Read these before creating a second.';
  }
  return `${String(count)} loosely similar ${count === 1 ? 'thing' : 'things'}, in case one is what you meant.`;
}
