'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@prisme/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ReviewCadence } from '@/lib/contracts';
import { CADENCE_LABELS, discardConsequence } from '@/lib/review-wizard';
import { discardReview } from './review-actions';

/**
 * Discard an open review, behind a confirmation.
 *
 * It confirms because it cannot be undone: the ticks and the decisions typed
 * into the session go with it. The dialog says how much is about to go, since
 * "discard" over a session with three recorded decisions is a different click
 * from one over an empty checklist.
 *
 * After it, the page refreshes in place — the wizard then offers to start a
 * fresh session, which is usually why somebody discarded the old one.
 */
export function DiscardReviewButton({
  reviewId,
  cadence,
  done,
  decisions,
}: {
  reviewId: string;
  cadence: ReviewCadence;
  /** Steps ticked so far, for the dialog's sentence. */
  done: number;
  /** Decisions recorded so far, for the same sentence. */
  decisions: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const discard = (): void => {
    startTransition(async () => {
      const result = await discardReview({ reviewId, cadence });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden className="size-4" />
        Discard
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this {CADENCE_LABELS[cadence].toLowerCase()} review?</DialogTitle>
            <DialogDescription>{discardConsequence(done, decisions)}</DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep it open
            </Button>
            <Button variant="danger" disabled={pending} onClick={discard}>
              {pending ? 'Discarding…' : 'Discard the review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
