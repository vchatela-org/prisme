'use client';

import { AreaBadge, Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RecurringTasks, Ritual } from '@/lib/contracts';
import { measuredFromLine, periodLine, stepCompletions } from '@/lib/rituals-view';
import { recordPeriod } from './ritual-actions';
import { RitualForm, type RitualDraft } from './ritual-form';

export function RitualRow({
  draft,
  areaName,
  latestAdherencePct,
  currentPeriod,
  measuredFrom,
  taskTitle,
  pageHref,
  areas,
  tasks,
  ritualNames,
}: {
  draft: RitualDraft & { id: string };
  areaName: string;
  latestAdherencePct: number | null;
  currentPeriod: Ritual['currentPeriod'];
  measuredFrom: Ritual['measuredFrom'];
  /** The task's title when Todoist listed it; null when it did not or there is none. */
  taskTitle: string | null;
  pageHref: string | null;
  areas: readonly { key: string; name: string }[];
  tasks: RecurringTasks | null;
  ritualNames: Readonly<Record<string, string>>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-ink">{draft.name}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            <AreaBadge areaKey={draft.areaKey} name={areaName} size="sm" />
            {draft.cadence} · target {String(draft.targetAdherencePct)}% · latest{' '}
            {latestAdherencePct === null ? 'not measured yet' : `${latestAdherencePct.toFixed(0)}%`}
            {pageHref === null ? null : (
              <a
                className="underline underline-offset-2"
                href={pageHref}
                target="_blank"
                rel="noreferrer"
              >
                process page
              </a>
            )}
          </span>
          <span className="text-xs text-ink-muted">
            {measuredFromLine({ cadence: draft.cadence, measuredFrom }, taskTitle)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {measuredFrom === 'hand' ? (
            <PeriodCounter id={draft.id} cadence={draft.cadence} period={currentPeriod} />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(!editing);
            }}
          >
            {editing ? 'Close' : 'Edit'}
          </Button>
        </div>
      </div>
      {editing ? (
        <RitualForm
          initial={draft}
          areas={areas}
          tasks={tasks}
          ritualNames={ritualNames}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * *Done this period* — for a habit that is not a task (S2). It writes the
 * period the API named, so a row counted here lands where a task's would.
 */
function PeriodCounter({
  id,
  cadence,
  period,
}: {
  id: string;
  cadence: Ritual['cadence'];
  period: Ritual['currentPeriod'];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const line = periodLine(cadence, period);

  const record = (step: 1 | -1): void => {
    startTransition(async () => {
      const result = await recordPeriod({
        id,
        periodStart: period.periodStart,
        opportunities: period.opportunities,
        completions: stepCompletions(period, step),
      });
      if (!result.ok) {
        toast({ title: result.title, description: result.description, tone: 'error' });
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="flex items-center gap-2 text-xs text-ink-secondary">
      <span>
        {line.label}: {line.status}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || period.completions >= period.opportunities}
        onClick={() => {
          record(1);
        }}
      >
        Done
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || period.completions === 0}
        onClick={() => {
          record(-1);
        }}
      >
        Undo
      </Button>
    </span>
  );
}
