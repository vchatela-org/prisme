'use client';

import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { formatDuration, relativeTime } from '../lib/relative-time.js';
import { Button } from '../primitives/button.js';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface SyncStatusProps {
  state: SyncState;
  /** When the last run finished. `null` before the first one ever. */
  lastSyncAt: Date | null;
  lastDurationMs?: number;
  /** Open conflicts waiting for a human. Never resolved automatically. */
  conflicts?: number;
  /** Passed in rather than read from the clock — see `relative-time.ts`. */
  now: Date;
  locale?: string;
  onForce?: () => void;
  className?: string;
}

/**
 * What the sync is doing, and the one button that makes it do it again.
 *
 * It exists because the failure this system is most likely to hide is a sync
 * that quietly stopped: every screen still renders, the numbers just get
 * older. So the last run is always on screen with its age, and "never" is a
 * state this component can say out loud.
 *
 * Conflicts are shown as a count and never resolved here — reconciliation is
 * level-triggered and a conflict is a decision a person makes (ADR-0009).
 */
export function SyncStatus({
  state,
  lastSyncAt,
  lastDurationMs,
  conflicts = 0,
  now,
  locale,
  onForce,
  className,
}: SyncStatusProps) {
  const hasConflicts = conflicts > 0;

  return (
    <div
      className={cn('flex items-center gap-3 text-xs text-ink-secondary', className)}
      // Polite rather than assertive: a sync finishing is worth hearing about,
      // but not worth interrupting whatever the reader is doing.
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5">
        {state === 'error' ? (
          <CircleX className="size-3.5 text-status-critical" aria-hidden="true" />
        ) : state === 'syncing' ? (
          <RefreshCw className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />
        ) : (
          <CircleCheck className="size-3.5 text-status-good" aria-hidden="true" />
        )}

        {state === 'syncing'
          ? 'Syncing…'
          : lastSyncAt === null
            ? 'Never synced'
            : `Synced ${relativeTime(lastSyncAt, now, locale)}`}
      </span>

      {lastDurationMs !== undefined && state !== 'syncing' ? (
        <span className="text-ink-muted tabular-nums">{formatDuration(lastDurationMs)}</span>
      ) : null}

      {hasConflicts ? (
        <span className="flex items-center gap-1 text-ink">
          <TriangleAlert className="size-3.5 text-status-warning" aria-hidden="true" />
          {conflicts} {conflicts === 1 ? 'conflict' : 'conflicts'}
        </span>
      ) : null}

      {onForce ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onForce}
          disabled={state === 'syncing'}
          className="h-6 px-2 text-xs"
        >
          Sync now
        </Button>
      ) : null}
    </div>
  );
}
