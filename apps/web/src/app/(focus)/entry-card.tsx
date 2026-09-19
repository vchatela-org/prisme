import { AreaBadge, Badge, Card, ScorePill } from '@prisme/ui';
import { AlarmClock, CircleDot, Hourglass, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { EstimateEditor } from '@/components/estimate-editor';
import { StatusMenu } from '@/components/status-menu';
import type { FocusEntry } from '@/lib/contracts';
import {
  deadlineSentence,
  reasonSentence,
  stalenessOf,
  STALE_AFTER_DAYS,
  type DueSummary,
} from '@/lib/focus-view';
import type { WipCounts } from '@/lib/guardrails';

/**
 * One line of the now set, or of the queue behind it.
 *
 * Everything on this card is something the API decided: the score and its
 * sentence, the rank, why it is here, whether its deadline is reachable, how
 * many tasks are open under it. The card arranges them and computes exactly one
 * thing itself — how many days it has been since anything moved — which is the
 * signal the weekly review is mostly looking for and which no endpoint returns.
 *
 * A server component. The two interactive pieces inside it (the status menu and
 * the estimate editor) are client components taking plain data.
 */

export interface EntryCardProps {
  entry: FocusEntry;
  areaName: string;
  areaKind: 'area' | 'run' | 'signals';
  /** The instant the page was rendered at, so staleness agrees with the header. */
  now: string;
  /** The method behind the score — `wsjf-balanced v1` — shown in the popover. */
  method: string;
  weightsStale: boolean;
  counts?: WipCounts;
  due?: DueSummary;
  /** `queue` entries are not in `now`; they explain why instead. */
  variant?: 'now' | 'queue';
}

export function EntryCard({
  entry,
  areaName,
  areaKind,
  now,
  method,
  weightsStale,
  counts,
  due,
  variant = 'now',
}: EntryCardProps) {
  const initiative = entry.initiative;
  const staleness = stalenessOf(entry, new Date(now), STALE_AFTER_DAYS);
  const deadline = deadlineSentence(entry.daysUntilDeadline, entry.deadlineAtRisk);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/initiative/${initiative.id}`}
            className="truncate text-base font-medium text-ink hover:underline"
          >
            {initiative.title}
          </Link>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
            <AreaBadge areaKey={initiative.areaKey} name={areaName} kind={areaKind} size="sm" />
            <span className="tabular-nums">Rank {entry.rank}</span>
            {initiative.rollup.progressPct === null ? null : (
              <span className="tabular-nums">
                {Math.round(initiative.rollup.progressPct)}% done
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ScorePill
            score={entry.score}
            explain={initiative.score?.explain ?? 'No ranking has been stored for this one yet.'}
            {...(initiative.score === null ? {} : { factors: initiative.score.factors })}
            method={method}
            stale={weightsStale}
          />
          <EstimateEditor initiative={initiative} />
          <StatusMenu initiative={initiative} {...(counts === undefined ? {} : { counts })} />
        </div>
      </div>

      <p className="text-sm text-ink-secondary">{reasonSentence(entry.reason)}</p>

      <div className="flex flex-wrap items-center gap-2">
        {deadline === null ? null : (
          <Badge
            variant="outline"
            className={entry.deadlineAtRisk ? 'text-status-critical' : undefined}
          >
            <AlarmClock aria-hidden className="size-3" />
            {deadline}
          </Badge>
        )}

        {staleness.stale ? (
          <Badge variant="outline" className="text-status-warning">
            <Hourglass aria-hidden className="size-3" />
            {staleness.label}
          </Badge>
        ) : null}

        {entry.blockedBy.length > 0 ? (
          <Badge variant="neutral">
            <CircleDot aria-hidden className="size-3" />
            Waiting on {entry.blockedBy.length}
          </Badge>
        ) : null}

        {due === undefined || variant === 'queue' ? null : (
          <Badge variant="neutral" className={due.overdue > 0 ? 'text-status-warning' : undefined}>
            <ListTodo aria-hidden className="size-3" />
            {taskLine(due)}
          </Badge>
        )}
      </div>
    </Card>
  );
}

/**
 * The task line, which is counts and never titles.
 *
 * prisme mirrors the anchor subtree's structure and state; the words stay in
 * the task tool, which is why this can say "2 due today" and nothing more.
 */
function taskLine(due: DueSummary): string {
  if (due.open === 0) return 'No open tasks';
  const parts = [`${String(due.open)} open`];
  if (due.dueToday > 0) parts.push(`${String(due.dueToday)} due today`);
  if (due.overdue > 0) parts.push(`${String(due.overdue)} late`);
  return parts.join(' · ');
}
