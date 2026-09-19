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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  StatusChip,
  statusLabel,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { transitionInitiative } from '@/lib/actions';
import { INITIATIVE_STATUSES, type Initiative, type InitiativeStatus } from '@/lib/contracts';
import { guardrailsFor, type WipCounts } from '@/lib/guardrails';

/**
 * Changing an initiative's status, with the guardrails between the choice and
 * the write.
 *
 * ## The shape of the interaction
 *
 * Choose a status, read what that will mean, confirm. The middle step only
 * appears when there is something to say: moving something to `later` warns
 * about nothing and so opens nothing, while moving a blocked, oversized
 * initiative into a full area explains all three and **still lets it happen**.
 * The confirm button is never disabled by a warning
 * (`docs/40-workstreams/W08-ui-focus.md`: a hard refusal gets worked around,
 * and then the model no longer describes reality).
 *
 * ## Optimistic, and honest about it
 *
 * The chip changes as soon as the action is sent, and changes back if the
 * write fails — with the failure in a toast rather than a silent revert, which
 * would look like the click missed.
 *
 * Keyboard throughout: the trigger is a button, the list is a Radix select,
 * the dialog traps focus and closes on Escape.
 */

export interface StatusMenuProps {
  initiative: Initiative;
  /** Slot counts for this initiative's area. Absent when Focus could not be read. */
  counts?: WipCounts;
  /** The statuses offered. The default is everything except where it already is. */
  allowed?: readonly InitiativeStatus[];
  size?: 'sm' | 'md';
}

export function StatusMenu({ initiative, counts, allowed, size = 'sm' }: StatusMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // The chip a reader sees: the optimistic value while a write is in flight,
  // the real one otherwise.
  const [optimistic, setOptimistic] = useState<InitiativeStatus | null>(null);
  const [proposed, setProposed] = useState<InitiativeStatus | null>(null);
  const [reason, setReason] = useState('');

  const shown = optimistic ?? initiative.status;
  const options = (allowed ?? INITIATIVE_STATUSES).filter((status) => status !== initiative.status);
  const warnings = proposed === null ? [] : guardrailsFor(initiative, proposed, counts);
  const needsReason = proposed === 'dropped';

  const commit = (to: InitiativeStatus): void => {
    setProposed(null);
    setOptimistic(to);

    startTransition(async () => {
      const result = await transitionInitiative(
        needsReason ? { id: initiative.id, to, reason: reason.trim() } : { id: initiative.id, to },
      );

      if (result.ok) {
        toast({ title: result.message, tone: 'success' });
        setReason('');
        // The server components re-render with the real value; the optimistic
        // one is dropped only once that has happened, or the chip would flick
        // back to the old status for a frame.
        router.refresh();
      } else {
        setOptimistic(null);
        toast({ title: result.title, description: result.description, tone: 'error' });
      }
    });
  };

  const choose = (to: InitiativeStatus): void => {
    const pendingWarnings = guardrailsFor(initiative, to, counts);
    if (pendingWarnings.length === 0) commit(to);
    else setProposed(to);
  };

  return (
    <>
      <Select
        value={shown}
        onValueChange={(next) => {
          choose(next as InitiativeStatus);
        }}
        disabled={pending}
      >
        <SelectTrigger
          aria-label={`Status of ${initiative.title}: ${statusLabel(shown)}. Change it.`}
          className={size === 'sm' ? 'h-7 w-auto gap-1 px-2 text-xs' : undefined}
        >
          {/*
            The chip is the value, rather than `<SelectValue>` rendering the
            item's text: a status is a chip everywhere else in the system, and
            a trigger showing the word while the table shows the chip makes the
            two look like different fields.
          */}
          <StatusChip status={shown} />
        </SelectTrigger>
        <SelectContent>
          {options.map((status) => (
            <SelectItem key={status} value={status}>
              {statusLabel(status)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog
        open={proposed !== null}
        onOpenChange={(open) => {
          if (!open) setProposed(null);
        }}
      >
        <DialogContent aria-describedby="guardrail-description">
          <DialogHeader>
            <DialogTitle>
              {proposed === null
                ? ''
                : `Move to ${statusLabel(proposed)}: ${String(warnings.length)} thing${warnings.length === 1 ? '' : 's'} worth knowing`}
            </DialogTitle>
            <DialogDescription id="guardrail-description">
              None of these stops the move. They are here so that what happens next is a decision
              rather than a surprise.
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-3">
            {warnings.map((warning) => (
              <li
                key={warning.code}
                className="rounded-lg border border-border-hairline bg-surface-page p-3"
              >
                <p className="text-sm font-semibold text-ink">{warning.title}</p>
                <p className="mt-1 text-sm text-ink-secondary">{warning.detail}</p>
                <p className="mt-2 text-sm text-ink">{warning.suggestion}</p>
              </li>
            ))}
          </ul>

          {needsReason ? (
            <label className="flex flex-col gap-1 text-sm text-ink">
              Why is it being dropped?
              <Input
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                placeholder="Superseded by something else"
                maxLength={500}
                autoFocus
              />
            </label>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setProposed(null);
              }}
            >
              Cancel
            </Button>
            <Button
              // Warnings never disable this. The only thing that does is the
              // reason a drop is recorded with, which the API requires too.
              disabled={needsReason && reason.trim() === ''}
              onClick={() => {
                if (proposed !== null) commit(proposed);
              }}
            >
              {proposed === null ? 'Move' : `Move to ${statusLabel(proposed)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
