'use client';

import {
  Button,
  FibonacciSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveEstimates } from '@/lib/actions';
import type { Fibonacci, Initiative } from '@/lib/contracts';

/**
 * The four estimates, editable where the initiative is.
 *
 * ## Why all four, and why in a popover on a row
 *
 * Value, time criticality, risk and size are the *inputs*; the score is what
 * the active method makes of them. Editing one without seeing the others is
 * how an estimate drifts — so the row shows the four as a compact summary and
 * opens all four together. Four selects laid out across a backlog row would
 * make the table unreadable and still hide the fourth on a narrow screen.
 *
 * ## The score is never computed here
 *
 * On save, the row is refreshed and the API returns the new ranking. This
 * component knows the scale and nothing else: no formula, no re-sorting, no
 * "the score will probably be" preview. The UI and `packages/domain` disagreeing
 * about a number in front of the reader is the specific failure
 * `apps/web/CLAUDE.md` forbids.
 */

export type EstimateField = 'value' | 'timeCriticality' | 'risk' | 'size';

const FIELDS: readonly { field: EstimateField; label: string; hint: string }[] = [
  { field: 'value', label: 'Value', hint: 'What it is worth if it lands.' },
  { field: 'timeCriticality', label: 'Time criticality', hint: 'How fast that value decays.' },
  { field: 'risk', label: 'Risk / opportunity', hint: 'What it unlocks or removes.' },
  { field: 'size', label: 'Size', hint: 'The effort, on the same scale as everything else.' },
];

export interface EstimateEditorProps {
  initiative: Initiative;
  /** `row` is the compact popover; `panel` lays the four out for a detail page. */
  variant?: 'row' | 'panel';
}

export function EstimateEditor({ initiative, variant = 'row' }: EstimateEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [estimates, setEstimates] = useState<Record<EstimateField, Fibonacci>>({
    value: initiative.value,
    timeCriticality: initiative.timeCriticality,
    risk: initiative.risk,
    size: initiative.size,
  });

  const change = (field: EstimateField, next: Fibonacci): void => {
    const previous = estimates[field];
    if (previous === next) return;

    // Optimistic: the select shows the new value immediately, and is put back
    // if the write fails. A select that snaps back with no explanation reads
    // as a broken control, so the toast carries the reason.
    setEstimates((current) => ({ ...current, [field]: next }));

    startTransition(async () => {
      const result = await saveEstimates({ id: initiative.id, [field]: next });
      if (result.ok) {
        router.refresh();
      } else {
        setEstimates((current) => ({ ...current, [field]: previous }));
        toast({ title: result.title, description: result.description, tone: 'error' });
      }
    });
  };

  /**
   * Keep the placeholder as the estimate (S5). Writing the four as they are is
   * a judgement that they are right, and the API marks the initiative
   * estimated for any estimate written — the same value included.
   */
  const keep = (): void => {
    startTransition(async () => {
      const result = await saveEstimates({ id: initiative.id, ...estimates });
      if (result.ok) router.refresh();
      else toast({ title: result.title, description: result.description, tone: 'error' });
    });
  };

  const unestimated = initiative.estimated ? null : (
    <div className="flex flex-col gap-2 rounded-md bg-surface-page p-2 text-xs text-ink-secondary">
      <p>
        <span className="font-medium text-ink">Not estimated yet.</span> These are the middle values
        it was adopted with, the same as every other adopted initiative, so its score ties with
        theirs and it is held out of now. Change any of them, or keep them if they are right.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={pending}
        onClick={keep}
      >
        Keep these estimates
      </Button>
    </div>
  );

  const selects = FIELDS.map(({ field, label, hint }) => (
    <div key={field} className="flex flex-col gap-1">
      <FibonacciSelect
        label={label}
        value={estimates[field]}
        onValueChange={(next) => {
          change(field, next);
        }}
        disabled={pending}
      />
      <p className="text-xs text-ink-muted">{hint}</p>
    </div>
  ));

  if (variant === 'panel') {
    return (
      <div className="flex flex-col gap-4">
        {unestimated}
        <div className="grid gap-4 sm:grid-cols-2">{selects}</div>
      </div>
    );
  }

  const summary = `V${String(estimates.value)} · T${String(estimates.timeCriticality)} · R${String(estimates.risk)} · S${String(estimates.size)}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs tabular-nums"
          aria-label={`Estimates for ${initiative.title}: ${initiative.estimated ? summary : 'not estimated yet'}. Change them.`}
        >
          {initiative.estimated ? summary : 'Unestimated'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink">{initiative.title}</p>
          {unestimated}
          {selects}
          <p className="border-t border-border-hairline pt-2 text-xs text-ink-muted">
            The ranking is recomputed by prisme, not here.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
