'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { retryCreation } from '../../create-actions';

/**
 * Queue a failed creation again.
 *
 * Offered only where `ledgerAdvice` says it is retryable, which is the point:
 * a page intent is not retryable — nothing about pressing it again changes
 * whether a role key exists — and a button that cannot work is an invitation
 * to press it forever.
 *
 * No confirmation dialog. A retry is safe by construction: it sends the same
 * command under the same idempotency key the intent has carried since it was
 * written, so a write that in fact succeeded binds what it made rather than
 * making a second.
 */
export function RetryButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await retryCreation({ id });
          toast({
            title: result.title,
            description: result.description,
            tone: result.ok ? 'success' : 'error',
          });
          if (result.ok) router.refresh();
        });
      }}
    >
      {pending ? 'Queueing…' : 'Try again'}
    </Button>
  );
}
