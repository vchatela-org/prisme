'use client';

import { Button, FieldHint, Input, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ReviewCadence } from '@/lib/contracts';
import { linkReviewPage } from './review-actions';

/**
 * Where this review's narrative lives (S4): the page in the document tool it
 * was written in, linked to the session, and its summary to copy across.
 *
 * prisme writes nothing to the page. The session keeps the decisions and the
 * snapshot; the page keeps the prose. *Copy summary* puts the session's
 * artefact on the clipboard, in the words it was recorded in, for pasting into
 * the page — so a review history kept in the document tool is one record,
 * not two that drift.
 */
export function ReviewPageLink({
  reviewId,
  cadence,
  externalPageId,
  pageHref,
  artefact,
}: {
  reviewId: string;
  cadence: ReviewCadence;
  externalPageId: string | null;
  /** The page as a link, when a page URL template is configured. */
  pageHref: string | null;
  /** The session's written artefact, as the history shows it. */
  artefact: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const save = (page: string): void => {
    startTransition(async () => {
      const result = await linkReviewPage({ reviewId, cadence, page });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) {
        setEditing(false);
        setText('');
        router.refresh();
      }
    });
  };

  const copy = (): void => {
    navigator.clipboard.writeText(artefact).then(
      () => {
        toast({
          title: 'Summary copied',
          description:
            'Paste it into the review’s page. It is Markdown, which Notion reads as such.',
        });
      },
      () => {
        toast({
          title: 'Not copied',
          description: 'The browser refused the clipboard. Open the written artefact and copy it.',
          tone: 'error',
        });
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
        <span>Review page:</span>
        {externalPageId === null ? (
          <span className="text-ink-muted">none linked</span>
        ) : pageHref === null ? (
          <span className="text-ink">linked</span>
        ) : (
          <a
            className="underline underline-offset-2"
            href={pageHref}
            target="_blank"
            rel="noreferrer"
          >
            open in Notion
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setEditing(!editing);
          }}
        >
          {editing ? 'Cancel' : externalPageId === null ? 'Link a page' : 'Change'}
        </Button>
        {externalPageId !== null && !editing ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              save('');
            }}
          >
            Unlink
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={pending} onClick={copy}>
          Copy summary
        </Button>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            aria-label="The review’s page"
            className="min-w-64 flex-1"
            value={text}
            disabled={pending}
            placeholder="Paste the link of the page this review is written in"
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <Button
            size="sm"
            disabled={pending || text.trim() === ''}
            onClick={() => {
              save(text);
            }}
          >
            {pending ? 'Saving…' : 'Link'}
          </Button>
        </div>
      ) : null}
      <FieldHint>
        prisme writes nothing to the page: it keeps the decisions and the snapshot, the page keeps
        the prose. Copy the summary into it to keep one record.
      </FieldHint>
    </div>
  );
}
