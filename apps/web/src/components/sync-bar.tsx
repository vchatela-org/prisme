'use client';

import { Button, SyncStatus, useToast, type SyncState } from '@prisme/ui';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { forceSync, rescoreAll } from '@/lib/actions';

/**
 * Sync state in the header, and the two buttons that do something about it.
 *
 * ## Force sync runs a **plan**
 *
 * `apply` is the first outward write, and it is gated by a checklist a human
 * works through once — a backup rehearsed, a plan read by hand, `create: 0`
 * confirmed (`docs/13-migration.md` §5 step 8, and the gate listed in
 * `STATUS.md`). A button on the screen somebody opens every morning must not be
 * able to cross that line, so this one reads both tools and reports what would
 * change. The API would refuse an apply under the write freeze anyway; that is
 * the second lock, not a reason to skip the first.
 *
 * ## Re-scoring is separate, and deliberate
 *
 * Reading a list never writes a score — a page view is not a decision — so
 * appending a ranking to history is its own button, and it is the weekly
 * review's step rather than something that happens on a refresh (ADR-0006).
 *
 * Both instants arrive from the server. Computing "4 minutes ago" against a
 * clock the browser reads at render time would disagree with what the server
 * rendered and hydrate into a mismatch.
 */

export interface SyncBarProps {
  /** ISO instants, from the server, so the relative times agree with the page. */
  lastRunAt: string | null;
  now: string;
  unresolvedConflicts: number;
  /** Sync is off in configuration: the button would be a lie. */
  enabled: boolean;
}

export function SyncBar({ lastRunAt, now, unresolvedConflicts, enabled }: SyncBarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [syncing, startSync] = useTransition();
  const [rescoring, startRescore] = useTransition();

  const state: SyncState = syncing ? 'syncing' : unresolvedConflicts > 0 ? 'error' : 'idle';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SyncStatus
        state={state}
        lastSyncAt={lastRunAt === null ? null : new Date(lastRunAt)}
        conflicts={unresolvedConflicts}
        now={new Date(now)}
        // Sync switched off in configuration means no button at all: one that
        // cannot do anything is worse than its absence.
        {...(enabled
          ? {
              onForce: () => {
                startSync(async () => {
                  const result = await forceSync();
                  toast(
                    result.ok
                      ? { title: 'Sync', description: result.message, tone: 'info' }
                      : { title: result.title, description: result.description, tone: 'error' },
                  );
                  router.refresh();
                });
              },
            }
          : {})}
      />

      <Button
        variant="ghost"
        size="sm"
        disabled={rescoring}
        onClick={() => {
          startRescore(async () => {
            const result = await rescoreAll();
            toast(
              result.ok
                ? { title: 'Re-scored', description: result.message, tone: 'success' }
                : { title: result.title, description: result.description, tone: 'error' },
            );
            router.refresh();
          });
        }}
      >
        <RefreshCw aria-hidden className={rescoring ? 'animate-spin' : undefined} />
        Re-score
      </Button>
    </div>
  );
}
