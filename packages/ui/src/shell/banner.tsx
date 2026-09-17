import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface StaleWeightsBannerProps {
  /** The year with no weights of its own. */
  year: number;
  /** The year whose weights are being used instead. */
  carriedFrom: number;
  /** Takes the reader to the year review, where the decision gets made. */
  action?: ReactNode;
  className?: string;
}

/**
 * The year gate, made unavoidable.
 *
 * A year with no weights does not silently inherit last year's (docs/10-model.md
 * §3). Every balance factor computed against carried weights is marked stale,
 * and this banner stays on screen until the yearly decision is actually taken —
 * the point is to make that decision unavoidable at the moment it is due, using
 * evidence rather than memory.
 *
 * It is `role="status"` rather than `role="alert"`: it is a persistent
 * condition, and an alert would interrupt on every navigation.
 */
export function StaleWeightsBanner({
  year,
  carriedFrom,
  action,
  className,
}: StaleWeightsBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-border-strong',
        'bg-surface-raised px-4 py-2.5 text-sm text-ink',
        className,
      )}
    >
      <TriangleAlert className="size-4 shrink-0 text-status-warning" aria-hidden="true" />
      <p className="flex-1">
        <span className="font-medium">No weights set for {year}.</span>{' '}
        <span className="text-ink-secondary">
          Every balance factor is being computed from {carriedFrom}&apos;s weights and is marked
          stale until you set this year&apos;s.
        </span>
      </p>
      {action}
    </div>
  );
}
