'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ReviewCadence } from '@/lib/contracts';
import { tickStep } from './review-actions';

/**
 * Tick a step, and move on.
 *
 * Ticking and advancing are one action because they are one intention, but
 * they are not the same thing: "Skip for now" advances without ticking, and
 * the artefact will list the step as not covered. A review that got to the
 * deadlines and found nothing, and one that never got there, must not read
 * identically a month later.
 *
 * Unticking is offered too. A mis-click that cannot be undone makes the
 * artefact lie.
 */
export function StepControl({
  reviewId,
  cadence,
  stepId,
  done,
  nextHref,
}: {
  reviewId: string;
  cadence: ReviewCadence;
  stepId: string;
  done: boolean;
  nextHref: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const tick = (next: boolean, advance: boolean): void => {
    startTransition(async () => {
      const result = await tickStep({ reviewId, cadence, stepId, done: next });

      if (!result.ok) {
        toast({ title: result.title, description: result.description, tone: 'error' });
        return;
      }

      if (advance && nextHref !== null) router.push(nextHref);
      else router.refresh();
    });
  };

  if (done) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-secondary">This step is done.</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            tick(false, false);
          }}
        >
          {pending ? 'Saving…' : 'Reopen it'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          tick(true, nextHref !== null);
        }}
      >
        {pending ? 'Saving…' : nextHref === null ? 'Mark done' : 'Done — next step'}
      </Button>
      {nextHref === null ? null : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            tick(true, false);
          }}
        >
          Mark done, stay here
        </Button>
      )}
    </div>
  );
}
