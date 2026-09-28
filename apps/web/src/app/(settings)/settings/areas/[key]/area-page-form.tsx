'use client';

import {
  Card,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { AreaPageChoice } from '@/lib/settings-view';
import { saveAreaPage } from '../../settings-actions';

/** Radix refuses an empty item value, so "no page" needs a value of its own. */
const NO_PAGE = '__none__';
/**
 * The page the area has when it is not among the store's entries. Shown as the
 * current value, so choosing *None* is a change the select can report.
 */
const ELSEWHERE = '__elsewhere__';

/**
 * This area's own page in Notion's Life areas database (ADR-0033).
 *
 * A Notion database whose **Area column** is chosen on Settings → Notion
 * relates each entry to a Life areas page; the page is how prisme knows which
 * area the entry belongs to. So it is picked from that database's entries —
 * never typed — and matched by identifier, never by title: a renamed page stays
 * this area's, and two areas cannot share one.
 */
export function AreaPageForm({
  areaKey,
  choice,
  href,
}: {
  areaKey: string;
  choice: AreaPageChoice;
  /** The current page in Notion, when the deployment has a link template. */
  href: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const selectId = `area-page-${areaKey}`;

  const save = (pageId: string | null): void => {
    startTransition(async () => {
      const result = await saveAreaPage({ key: areaKey, pageId });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  const current = choice.state === 'choose' ? (choice.chosen ?? choice.elsewhere) : choice.chosen;

  return (
    <Section
      title="Its page in Notion"
      description="The page for this area in your Life areas database. A Notion entry related to exactly this page — through the database’s Area column, chosen on Settings → Notion — belongs to this area in Adoption."
    >
      <Card className="flex flex-col gap-3">
        {choice.state === 'choose' ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="text-sm text-ink">
              Page
            </label>
            <Select
              value={choice.chosen ?? (choice.elsewhere === null ? NO_PAGE : ELSEWHERE)}
              disabled={pending}
              onValueChange={(value) => {
                if (value === ELSEWHERE) return;
                save(value === NO_PAGE ? null : value);
              }}
            >
              <SelectTrigger id={selectId} className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choice.elsewhere === null ? null : (
                  <SelectItem value={ELSEWHERE} disabled>
                    A page no longer in Life areas
                  </SelectItem>
                )}
                <SelectItem value={NO_PAGE}>None</SelectItem>
                {choice.options.map((option) => (
                  <SelectItem key={option.id} value={option.id} disabled={option.takenBy !== null}>
                    {option.title === '' ? 'Untitled' : option.title}
                    {option.takenBy === null ? '' : ` — ${option.takenBy}’s page`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <p className="text-xs text-ink-muted">
          {choice.state === 'unbound'
            ? 'Bind your Life areas database on Settings → Notion to pick this area’s page from it.'
            : choice.state === 'unreadable'
              ? `Notion’s Life areas database could not be read (${choice.failure}). The page this area has is kept.`
              : choice.elsewhere !== null
                ? 'This area has a page that is not in the Life areas database any more. Pick its page again, or clear it.'
                : 'Picked from the database, by page — renaming the page in Notion changes nothing here.'}
        </p>

        {current !== null && href !== null ? (
          <p className="text-sm">
            <a
              className="underline underline-offset-2"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              Open its page in Notion
            </a>
          </p>
        ) : null}
      </Card>
    </Section>
  );
}
