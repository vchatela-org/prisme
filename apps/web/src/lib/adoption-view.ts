import type { AdoptionCandidate } from './contracts';
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
