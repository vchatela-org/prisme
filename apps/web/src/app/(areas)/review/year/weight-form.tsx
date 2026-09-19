'use client';

import { AreaBadge, Button, Card, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  driftPct,
  movedTowardObserved,
  REQUIRED_SUM_PCT,
  verdictFor,
  type WeightEntry,
} from '@/lib/year-review';
import { setYearWeights } from './weight-actions';

/**
 * Weight entry — the one decision this whole surface exists to collect.
 *
 * ## Everything the decision needs is on screen while it is made
 *
 * Each row carries what was declared last year, what the area actually
 * received, and what is being typed now. That is deliberate: ADR-0007 exists
 * because a weight adjusted in the moment gets adjusted to match observed
 * behaviour, and the only defence against doing that accidentally is seeing
 * both numbers at once. A row whose new share has moved *toward* what
 * happened says so — not as an error, because sometimes last year's
 * allocation was simply wrong, but as a question asked once.
 *
 * ## The running total blocks the button, and never surprises
 *
 * The shares are shares of one capacity, so they have to account for it. The
 * total is live above the button rather than checked at submit, because a form
 * that accepts six numbers and then refuses them is a form that makes you
 * count.
 */
export function WeightForm({
  year,
  reviewing,
  entries: initial,
}: {
  year: number;
  reviewing: number;
  entries: readonly WeightEntry[];
}) {
  const [entries, setEntries] = useState<readonly WeightEntry[]>(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const verdict = verdictFor(entries);

  const setWeight = (areaKey: string, raw: string): void => {
    // An empty box is NaN rather than 0: "not yet decided" and "decided to be
    // nothing" are different, and `verdictFor` treats them differently.
    const value = raw.trim() === '' ? Number.NaN : Number(raw);
    setEntries((current) =>
      current.map((entry) => (entry.areaKey === areaKey ? { ...entry, weightPct: value } : entry)),
    );
  };

  const submit = (): void => {
    startTransition(async () => {
      const result = await setYearWeights({
        year,
        entries: entries.map((entry) => ({ areaKey: entry.areaKey, weightPct: entry.weightPct })),
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        {entries.map((entry) => {
          const drift = driftPct(entry);
          const chasing = movedTowardObserved(entry);

          return (
            /*
              A plain row rather than `<Field>`: that primitive is a *column*
              (`flex flex-col`), which is the right arrangement for a stacked
              form and the wrong one for an allocation table, where the eye
              runs down a column of numbers. Passing a row class to it merges
              into `flex-col … items-end` and right-aligns every label, which
              is what this looked like before it was driven in a browser.
            */
            <div key={entry.areaKey} className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Label htmlFor={`weight-${entry.areaKey}`}>
                  <AreaBadge areaKey={entry.areaKey} name={entry.name} />
                </Label>
                <span className="text-xs text-ink-secondary tabular-nums">
                  {entry.previousPct === null
                    ? `No share was declared for ${String(reviewing)}`
                    : `Declared ${entry.previousPct.toFixed(0)}% for ${String(reviewing)}`}
                  {entry.observedPct === null ? '' : ` · received ${entry.observedPct.toFixed(1)}%`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  id={`weight-${entry.areaKey}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  className="w-24 text-right tabular-nums"
                  value={Number.isFinite(entry.weightPct) ? String(entry.weightPct) : ''}
                  onChange={(event) => {
                    setWeight(entry.areaKey, event.target.value);
                  }}
                />
                <span className="text-sm text-ink-secondary">%</span>
                {drift === null || drift === 0 ? (
                  <span className="w-16 text-xs text-ink-muted" />
                ) : (
                  <span className="w-16 text-xs text-ink-secondary tabular-nums">
                    {drift > 0 ? '+' : ''}
                    {drift.toFixed(0)}
                  </span>
                )}
              </div>

              {chasing ? (
                <FieldHint className="basis-full text-status-warning">
                  This moves {entry.name}&rsquo;s share toward what it actually received. Sometimes
                  last year&rsquo;s allocation was wrong — but if the reason is that the share was
                  hard to hit, the share is the decision and the gap is the finding.
                </FieldHint>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border-hairline pt-4">
        <div className="flex flex-col gap-1">
          <span
            className={
              Math.round(verdict.sumPct) === REQUIRED_SUM_PCT
                ? 'text-sm text-ink tabular-nums'
                : 'text-sm text-status-warning tabular-nums'
            }
          >
            {Number.isFinite(verdict.sumPct) ? verdict.sumPct.toFixed(0) : '—'}% of{' '}
            {REQUIRED_SUM_PCT}% allocated
          </span>
          {verdict.problems.map((problem) => (
            <span key={problem} className="max-w-prose text-xs text-ink-secondary">
              {problem}
            </span>
          ))}
        </div>

        <Button onClick={submit} disabled={!verdict.valid || pending}>
          {pending ? 'Saving…' : `Set ${String(year)} weights`}
        </Button>
      </div>
    </Card>
  );
}
