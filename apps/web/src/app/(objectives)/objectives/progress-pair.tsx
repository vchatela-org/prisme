'use client';

import { Badge, Button, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { KeyResult } from '@/lib/contracts';
import { divergenceOf, looksLikeAHabit } from '@/lib/objectives-view';
import { setKeyResultProgress } from './objective-actions';

/**
 * One key result, with both progress numbers side by side.
 *
 * ## The layout is the argument
 *
 * Two numbers, equally sized, equally weighted, with a gap between them that
 * is stated rather than resolved. There is deliberately no combined figure, no
 * progress bar spanning both, and no "actual" label on either — ADR-0013 says
 * they measure different things, and any single visual that contains both
 * implies one is an approximation of the other.
 *
 * Only the left one is editable, and that asymmetry is visible: the judgement
 * is an input, the computed number is text. A reader who wants to move the
 * right-hand number has to go and close tasks, which is the correct answer.
 *
 * ## Where the reading appears
 *
 * Under the pair, not as a tooltip or an icon. A divergence that has to be
 * hovered to be read is a divergence nobody reads, and the whole reason the
 * monthly review stops here is to have the conversation the gap starts.
 * Every applicable reading is shown, not the strongest one — a key result can
 * be both diverging and at risk, and picking one hides the other at exactly
 * the review where both matter.
 */
export function ProgressPair({
  keyResult,
  objectiveId,
  elapsedPct,
}: {
  keyResult: KeyResult;
  objectiveId: string;
  elapsedPct: number;
}) {
  const [draft, setDraft] = useState<string>(String(keyResult.progressSelf));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const divergence = divergenceOf(keyResult, elapsedPct);
  const habit = looksLikeAHabit(keyResult);

  // An empty box is NaN rather than 0: "not yet decided" and "decided to be
  // nothing" are different, and only the second is worth sending.
  const value = draft.trim() === '' ? Number.NaN : Number(draft);
  const valid = Number.isFinite(value) && value >= 0 && value <= 100;
  const changed = valid && value !== keyResult.progressSelf;

  const save = (): void => {
    if (!changed) return;
    startTransition(async () => {
      const result = await setKeyResultProgress({
        keyResultId: keyResult.id,
        objectiveId,
        progressSelf: value,
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
    <div className="flex flex-col gap-2 rounded-lg border border-border-hairline p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink">{keyResult.statement}</span>
          <span className="text-xs text-ink-muted">
            Target {keyResult.target} {keyResult.unit}
            {keyResult.measurementCount > 0
              ? ` · ${String(keyResult.measurementCount)} measurement${
                  keyResult.measurementCount === 1 ? '' : 's'
                }`
              : ' · no measurements yet'}
            {keyResult.servedBy.length === 0
              ? ' · nothing serves it'
              : ` · served by ${String(keyResult.servedBy.length)}`}
          </span>
        </div>

        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`self-${keyResult.id}`} className="text-xs text-ink-secondary">
              Self-assessed
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id={`self-${keyResult.id}`}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                className="w-20 text-right tabular-nums"
                value={draft}
                disabled={pending}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save();
                }}
              />
              <span className="text-sm text-ink-muted">%</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-secondary">Computed</span>
            <span className="py-1.5 text-sm text-ink tabular-nums">
              {keyResult.progressComputed === null
                ? '—'
                : `${keyResult.progressComputed.toFixed(0)}%`}
            </span>
          </div>

          <Button size="sm" onClick={save} disabled={!changed || pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {!valid && draft.trim() !== '' ? (
        <p className="text-xs text-status-warning">
          Self-assessed progress is a judgement between 0 and 100.
        </p>
      ) : null}

      {keyResult.progressComputed === null ? (
        <p className="text-xs text-ink-muted">
          Nothing computes this yet — there is no task breakdown beneath an anchor to count. That is
          not zero progress, which is why no number is shown.
        </p>
      ) : null}

      {divergence.findings.map((finding) => (
        <p key={finding.pattern} className="max-w-prose text-xs text-ink-secondary">
          <span className="font-medium text-ink">
            {divergence.gapPct === null
              ? 'Reading'
              : `${divergence.gapPct > 0 ? '+' : ''}${divergence.gapPct.toFixed(0)} points`}
            :
          </span>{' '}
          {finding.reading}
        </p>
      ))}

      {habit ? (
        <p className="max-w-prose text-xs text-ink-secondary">
          <Badge variant="outline">Ritual?</Badge> This is measured in a rate, which is usually a
          habit rather than an outcome. A habit written as a key result is a target that is never
          reached and an adherence measure nobody has (ADR-0012). It may well be right — the
          question is only worth asking once.
        </p>
      ) : null}

      <Link
        href={`/objectives/${objectiveId}#kr-${keyResult.id}`}
        className="text-xs text-ink-muted hover:underline"
      >
        Measurement history and the anchor
      </Link>
    </div>
  );
}
