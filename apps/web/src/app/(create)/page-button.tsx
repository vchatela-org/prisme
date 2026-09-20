'use client';

import { Button, FieldHint, Input, useToast } from '@prisme/ui';
import { ExternalLink, FileText, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PageState } from '@/lib/create-view';
import { requestInitiativePage } from './create-actions';

/**
 * ADR-0011's page button, in the place the ADR puts it: the initiative detail
 * panel.
 *
 * The ADR's table is three rows, and this renders them plus one the ADR could
 * not have anticipated:
 *
 * | State | Control |
 * |---|---|
 * | No page | **Create page** — records the intention · **Link existing page** |
 * | Page exists | **Open page** |
 * | Page requested | Nothing. The thing to do about it is wait |
 *
 * ## `requested` is not a fourth choice
 *
 * It is the absence of one. Creating a page is no longer synchronous — the
 * intention is recorded and a converge pass makes the object — so between the
 * click and the page there is a state the ADR's "derived from
 * `external_page_id`" rule reads as *no page*. Rendering it that way would
 * show a **Create page** button that enqueues nothing new each time it is
 * pressed (the ledger's one-per-slot index sees to that) but tells the person
 * nothing, which is how somebody presses it four times.
 *
 * ## Create says out loud that it will not happen yet
 *
 * There is no role key naming where a page would go and none carrying the
 * capability to create one (ADR-0025). The button records the intention and
 * the copy says what that means, because an option that silently does nothing
 * is worse than one that explains itself. **Link existing** works today, and
 * it is the half adoption needs anyway.
 */
export function PageButton({ initiativeId, state }: { initiativeId: string; state: PageState }) {
  const [linking, setLinking] = useState(false);
  const [externalId, setExternalId] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const send = (page: { mode: 'create' } | { mode: 'link'; externalId: string }): void => {
    startTransition(async () => {
      const result = await requestInitiativePage({ initiativeId, page });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) {
        setLinking(false);
        setExternalId('');
        router.refresh();
      }
    });
  };

  if (state === 'present') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled>
          <ExternalLink aria-hidden />
          Open page
        </Button>
        <span className="text-xs text-ink-muted">
          A page is linked. Opening it needs the document tool&rsquo;s address, which is instance
          configuration this application is not given yet.
        </span>
      </div>
    );
  }

  if (state === 'requested') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">A page has been asked for.</span>
        <FieldHint>
          It is waiting on a decision rather than on a pass: prisme has nowhere addressable to
          create a page yet (ADR-0025). Linking an existing one works today.
        </FieldHint>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            send({ mode: 'create' });
          }}
        >
          <FileText aria-hidden />
          Create page
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setLinking((open) => !open);
          }}
        >
          <Link2 aria-hidden />
          Link an existing page
        </Button>
      </div>

      {linking ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Input
              aria-label="The page’s identifier in the document tool"
              value={externalId}
              disabled={pending}
              placeholder="The page’s identifier"
              onChange={(event) => {
                setExternalId(event.target.value);
              }}
            />
            <FieldHint>
              Binds a page you have already written. Nothing is created, and a page already bound to
              something else is refused rather than moved.
            </FieldHint>
          </div>
          <Button
            size="sm"
            disabled={pending || externalId.trim() === ''}
            onClick={() => {
              send({ mode: 'link', externalId: externalId.trim() });
            }}
          >
            {pending ? 'Linking…' : 'Link'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
