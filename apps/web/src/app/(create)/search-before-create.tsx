'use client';

import { AreaBadge, Badge, Card } from '@prisme/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SearchResult } from '@/lib/contracts';
import { matchHref, searchHeadline, similarityLabel } from '@/lib/create-view';
import { searchBeforeCreate } from './create-actions';

/**
 * *Create versus adopt is always explicit* — scope item 4, as a control.
 *
 * It sits under the title field of every creation form and answers one
 * question while somebody types: **does this already exist?** Two answers are
 * possible and they lead to different places:
 *
 *   - **prisme already holds it.** Open it. Creating a second is the
 *     near-duplicate accumulation this exists to prevent.
 *   - **an external tool holds it and prisme does not.** Adopt it, in the
 *     queue, which creates nothing (ADR-0010). The link goes to the queue
 *     rather than adopting here: adopting is one of three decisions a human
 *     makes there, and jumping past it would be prisme deciding for them.
 *
 * ## It advises and never blocks
 *
 * Nothing here can stop a submission, and the strongest thing it does is
 * change its own heading. A control that refused would get worked around —
 * by typing a slightly different title — and then the model would stop
 * describing reality, which is the failure mode `lib/guardrails.ts` describes
 * for status changes and which applies exactly as much here.
 *
 * ## The ranking is the API's
 *
 * `similarity` arrives computed and is displayed, not compared against. A
 * second implementation of the matcher on this tier would disagree with the
 * adoption queue's about the same pair of titles, and the two surfaces would
 * propose different things about one object.
 */

/** Long enough that typing a sentence is one request, short enough to feel live. */
const DEBOUNCE_MS = 350;

export interface SearchBeforeCreateProps {
  readonly title: string;
  /**
   * Area key → display name.
   *
   * Passed in rather than looked up here, and *required* rather than
   * defaulted to the key. W11 found five screens showing `health` where they
   * meant `Health`, because a key reads as a styling choice rather than as a
   * missing lookup — so this component cannot render a badge without the name
   * to put in it.
   */
  readonly areaNames: Readonly<Record<string, string>>;
}

export function SearchBeforeCreate({ title, areaNames }: SearchBeforeCreateProps) {
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    const query = title.trim();
    if (query.length < 3) {
      setResult(null);
      return;
    }

    let live = true;
    const timer = setTimeout(() => {
      void searchBeforeCreate(query).then((answer) => {
        // The guard is the point: a slow answer for a title that has since
        // been edited would replace the current one with a stale list.
        if (live) setResult(answer);
      });
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [title]);

  if (result === null || result.matches.length === 0) return null;

  return (
    <Card
      className={
        result.worthReading
          ? 'flex flex-col gap-2 border-border-strong p-3'
          : 'flex flex-col gap-2 p-3'
      }
    >
      <p className="text-sm text-ink-secondary">
        {searchHeadline(result.worthReading, result.matches.length)}
      </p>

      <ul className="flex flex-col gap-1">
        {result.matches.map((match) => (
          <li key={`${match.source}:${match.prismeId ?? match.externalId ?? match.title}`}>
            <Link
              href={matchHref(match)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-sunken"
            >
              <Badge variant={match.source === 'existing' ? 'neutral' : 'outline'}>
                {match.suggests === 'open' ? 'open' : 'adopt'}
              </Badge>
              <span className="flex-1 truncate">{match.title}</span>
              {match.areaKey !== null && areaNames[match.areaKey] !== undefined ? (
                <AreaBadge
                  areaKey={match.areaKey}
                  name={areaNames[match.areaKey] as string}
                  size="sm"
                />
              ) : null}
              <span className="tabular-nums text-xs text-ink-tertiary">
                {similarityLabel(match.similarity)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-tertiary">
        Adopting binds what already exists and creates nothing. Nothing here stops you creating
        something new.
      </p>
    </Card>
  );
}
