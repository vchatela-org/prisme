'use client';

import { Button, Card, FieldHint, Input, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ReviewCadence } from '@/lib/contracts';
import { closeReview, recordDecision } from './review-actions';

/**
 * Record a decision, from wherever in the review it was made.
 *
 * This sits on **every** step rather than only the last one, which is the
 * brief's "decisions are recorded as they are made, not retyped at the end".
 * The step that surfaces a decision is rarely the step where somebody would
 * think to write it down, and a decision reconstructed twenty minutes later
 * has lost the words it was made in — which is the part worth reading a month
 * afterwards.
 *
 * The text is sent as typed. Nothing here summarises, reformats or structures
 * it: any normalisation would be a paraphrase nobody agreed to.
 */
export function DecisionRecorder({
  reviewId,
  cadence,
  canClose,
  remaining,
}: {
  reviewId: string;
  cadence: ReviewCadence;
  canClose: boolean;
  remaining: number;
}) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const ready = text.trim() !== '';

  const record = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await recordDecision({ reviewId, cadence, decision: text.trim() });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setText('');
        router.refresh();
      }
    });
  };

  const close = (): void => {
    startTransition(async () => {
      const result = await closeReview({ reviewId, cadence });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) router.push('/review/history');
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="decision" className="text-sm font-medium text-ink">
            Record a decision
          </label>
          <Input
            id="decision"
            value={text}
            disabled={pending}
            placeholder="What you decided, in the words you decided it in"
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') record();
            }}
          />
        </div>
        <Button onClick={record} disabled={!ready || pending}>
          {pending ? 'Saving…' : 'Record'}
        </Button>
      </div>

      <FieldHint>
        Saved to this session as you go, from any step. Nothing has to be retyped at the end.
      </FieldHint>

      {canClose ? (
        <div className="flex flex-col gap-2 border-t border-border-hairline pt-3">
          <p className="max-w-prose text-sm text-ink-secondary">
            Closing takes a snapshot of per-area capacity as it stands right now and stores it with
            the session. It is never retaken — what the review saw is part of what the review
            decided.
            {remaining > 0
              ? ` ${String(remaining)} step${remaining === 1 ? ' is' : 's are'} still unticked; they will be listed in the artefact as not covered.`
              : ''}
          </p>
          <Button variant="secondary" onClick={close} disabled={pending} className="self-start">
            {pending ? 'Closing…' : 'Close this review'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
