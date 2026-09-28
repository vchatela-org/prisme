'use client';

import { Button, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ObjectiveType } from '@/lib/contracts';
import { moveObjectivePeriod } from '../objective-actions';

/**
 * Moving an open objective to another period (ADR-0034).
 *
 * Collapsed by default: moving a period is a correction, not something the
 * detail page invites every visit. The page renders this only for a draft or
 * active objective — a met, missed or dropped one keeps the period it was
 * judged against, and the API refuses the move anyway.
 *
 * Choosing the type offers the period the objective already has, reshaped —
 * the year of a monthly one, January of an annual one — so a type change never
 * starts from an empty field. What the move does outside prisme is said where
 * the button is: a linked page's dates follow on the next sync pass.
 */
export function PeriodEditor({
  objectiveId,
  type,
  period,
  linked,
}: {
  objectiveId: string;
  type: ObjectiveType;
  period: string;
  /** Whether the objective has a page, so the hint can say what follows. */
  linked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [nextType, setNextType] = useState<ObjectiveType>(type);
  const [nextPeriod, setNextPeriod] = useState(period);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const year = period.slice(0, 4);

  const chooseType = (next: ObjectiveType): void => {
    setNextType(next);
    setNextPeriod(next === type ? period : next === 'annual' ? year : `${year}-01`);
  };

  const unchanged = nextType === type && nextPeriod.trim() === period;

  const submit = (): void => {
    startTransition(async () => {
      const result = await moveObjectivePeriod({
        objectiveId,
        type: nextType,
        period: nextPeriod.trim(),
      });

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

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Move period
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="move-type">Type</Label>
        <select
          id="move-type"
          className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
          value={nextType}
          disabled={pending}
          onChange={(event) => {
            chooseType(event.target.value === 'annual' ? 'annual' : 'monthly');
          }}
        >
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="move-period">Period</Label>
        <Input
          id="move-period"
          className="w-32 tabular-nums"
          value={nextPeriod}
          disabled={pending}
          placeholder={nextType === 'annual' ? '2027' : '2027-03'}
          onChange={(event) => {
            setNextPeriod(event.target.value);
          }}
        />
      </div>

      <Button
        size="sm"
        onClick={submit}
        disabled={pending || unchanged || nextPeriod.trim() === ''}
      >
        {pending ? 'Moving…' : 'Move'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setNextType(type);
          setNextPeriod(period);
        }}
      >
        Cancel
      </Button>

      <FieldHint className="basis-full">
        The move is kept in the objective’s history.
        {linked
          ? ' Its Notion page’s dates follow on the next sync pass, and a date edited there by hand is put back.'
          : ''}
      </FieldHint>
    </div>
  );
}
