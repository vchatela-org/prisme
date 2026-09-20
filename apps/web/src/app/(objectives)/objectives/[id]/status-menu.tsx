'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { OBJECTIVE_STATUSES, type ObjectiveStatus } from '@/lib/contracts';
import { setObjectiveStatus } from '../objective-actions';

/**
 * An objective's lifecycle, as buttons rather than a dropdown.
 *
 * `met` and `missed` are both offered, and neither is styled as the failure.
 * An objective recorded as missed is the one worth reading next year; one
 * quietly left `active` forever, or dropped to avoid saying it, teaches the
 * yearly review nothing. `dropped` exists for the objective that stopped being
 * the right objective — which is a different fact from having missed it.
 */
export function ObjectiveStatusMenu({
  objectiveId,
  status,
}: {
  objectiveId: string;
  status: ObjectiveStatus;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const choose = (next: ObjectiveStatus): void => {
    if (next === status) return;
    startTransition(async () => {
      const result = await setObjectiveStatus({ objectiveId, status: next });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {OBJECTIVE_STATUSES.map((candidate) => (
        <Button
          key={candidate}
          size="sm"
          variant={candidate === status ? 'primary' : 'ghost'}
          disabled={pending || candidate === status}
          onClick={() => {
            choose(candidate);
          }}
        >
          {candidate}
        </Button>
      ))}
    </div>
  );
}
