'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@prisme/ui';
import { EyeOff, Link2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adoptCandidate, ignoreCandidate, mergeCandidate } from '@/lib/actions';
import type { AdoptionCandidate } from '@/lib/contracts';

/**
 * The three decisions, one button each.
 *
 * | Button | Effect |
 * |---|---|
 * | **Link** | binds this object to the entity prisme proposed — a *merge* |
 * | **Adopt** | creates one prisme entity, `origin = adopted`, bound to this object |
 * | **Ignore** | recorded permanently; the item never reappears |
 *
 * None of them touches the document tool or the task tool. That sentence is on
 * the screen as well as in this comment, because the fear that stops somebody
 * working this queue is the one it answers.
 *
 * **Ignore confirms, and the other two do not.** Adopting a thing wrongly is
 * undone by unlinking it; ignoring is permanent by design, and a dialog that
 * appears before an irreversible click is worth the extra second. It is the
 * only modal on this screen, for that reason and no other.
 */
export function CandidateDecisions({ candidate }: { candidate: AdoptionCandidate }) {
  const proposed = candidate.matchRule !== null && candidate.proposedId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {proposed ? <LinkButton candidate={candidate} /> : null}
      <AdoptButton candidate={candidate} />
      <IgnoreButton candidate={candidate} />
    </div>
  );
}

/** A hook shared by the three buttons: run an action, say what happened, refresh. */
function useDecision() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<
      { ok: true; message: string } | { ok: false; title: string; description: string }
    >,
    onDone?: () => void,
  ): void => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onDone?.();
        toast({ title: result.message, tone: 'success' });
        router.refresh();
      } else {
        toast({ title: result.title, description: result.description, tone: 'error' });
      }
    });
  };

  return { pending, run };
}

/**
 * Accept the proposal.
 *
 * The confidence sent is the rule's own, not `certain`. A human accepting a
 * `medium` proposal has made a human decision about a medium-confidence match,
 * and recording it as certain would lose exactly the information somebody needs
 * later when they ask which links deserve a second look.
 */
function LinkButton({ candidate }: { candidate: AdoptionCandidate }) {
  const { pending, run } = useDecision();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        run(() =>
          mergeCandidate({
            externalKind: candidate.externalKind,
            externalId: candidate.externalId,
            prismeId: candidate.proposedId ?? '',
            matchRule: candidate.matchRule ?? 'manual',
            confidence: candidate.confidence ?? 'manual',
          }),
        );
      }}
    >
      <Link2 aria-hidden className="size-4" />
      Link
    </Button>
  );
}

function AdoptButton({ candidate }: { candidate: AdoptionCandidate }) {
  const { pending, run } = useDecision();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        run(() =>
          adoptCandidate({
            externalKind: candidate.externalKind,
            externalId: candidate.externalId,
          }),
        );
      }}
    >
      <Plus aria-hidden className="size-4" />
      Adopt
    </Button>
  );
}

/**
 * Ignore, behind a confirmation.
 *
 * The dialog says what permanent means and what it does *not* mean: the object
 * stays where it is, untouched, and it can still be adopted later by its
 * identifier. That is true and it is the difference between a decision somebody
 * will make and one they will put off — which is how a queue stops converging.
 */
function IgnoreButton({ candidate }: { candidate: AdoptionCandidate }) {
  const { pending, run } = useDecision();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

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
        <EyeOff aria-hidden className="size-4" />
        Ignore
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ignore this permanently?</DialogTitle>
            <DialogDescription>
              It will not appear in this queue again, and there is no undo. Nothing is deleted: the
              object stays exactly where it is, and it can still be adopted later by its identifier.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={reason}
            placeholder="Why, for whoever reads this next (optional)"
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep it
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                const trimmed = reason.trim();
                run(
                  () =>
                    ignoreCandidate({
                      externalKind: candidate.externalKind,
                      externalId: candidate.externalId,
                      ...(trimmed === '' ? {} : { reason: trimmed }),
                    }),
                  () => {
                    setOpen(false);
                    setReason('');
                  },
                );
              }}
            >
              Ignore permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
