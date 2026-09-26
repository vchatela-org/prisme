'use client';

import { Button, useToast } from '@prisme/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { resolveConflict } from '@/lib/actions';

/**
 * Close a conflict by saying who was right.
 *
 * Resolving **records** the decision; it moves no value. prisme already wrote
 * its value back when it detected the edit, so "prisme was right" needs nothing
 * further. "The task tool was right" means prisme's value should change —
 * which is an edit to the initiative, linked here, because a button that
 * silently copied an external value into a prisme-owned field would be exactly
 * the ambiguous ownership docs/11-ownership.md exists to prevent.
 */
export function ConflictResolve({ id, entityId }: { id: string; entityId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const resolve = (resolution: 'prisme_wins' | 'external_wins'): void => {
    startTransition(async () => {
      const result = await resolveConflict({ id, resolution });
      toast(
        result.ok
          ? { title: 'Resolved', description: result.message, tone: 'success' }
          : { title: result.title, description: result.description, tone: 'error' },
      );
      if (result.ok && resolution === 'external_wins') router.push(`/initiative/${entityId}`);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          resolve('prisme_wins');
        }}
      >
        prisme was right
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          resolve('external_wins');
        }}
      >
        The task tool was right — edit the initiative
      </Button>
      <Link className="sr-only" href={`/initiative/${entityId}`}>
        Open the initiative
      </Link>
    </div>
  );
}
